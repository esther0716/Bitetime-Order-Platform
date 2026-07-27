// tests/rls/helpers.ts
// Builds Supabase clients for the DB-backed suites (tests/rls and tests/api).
// Credentials come from env vars, which vitest.db.config.ts fills in from the
// running local stack when they are not already set.
import { createClient } from '@supabase/supabase-js'

/**
 * Missing credentials are a hard failure, never a skip. This suite is the only
 * proof that an order cannot be spoofed onto a stranger's account; a version of
 * it that quietly asserts nothing and still reports green is worse than no suite
 * at all, because it is trusted.
 */
function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set, so the RLS suite cannot reach a database. It must fail rather than skip. ` +
        `Run it via \`pnpm test:db\`, which reads the local stack's credentials for you.`,
    )
  }
  return value
}

export const SUPABASE_URL = required('SUPABASE_URL')
export const ANON_KEY = required('SUPABASE_ANON_KEY')
export const SERVICE_KEY = required('SUPABASE_SERVICE_ROLE_KEY')

export function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
}

export function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
}

export type MerchantStatus = 'pending' | 'active' | 'suspended'

/**
 * These helpers DELETE rows with the service role, which bypasses RLS. Pointed
 * at a real project they would destroy live orders, so refuse to run anywhere
 * but a local Supabase.
 */
function assertLocal() {
  const host = new URL(SUPABASE_URL).hostname
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(
      `RLS fixtures delete data with the service role and must only run against a local Supabase. Refusing to touch ${host}.`,
    )
  }
}

/**
 * Drop a merchant and everything hanging off it, so a suite can be re-run
 * against a database that already has its fixtures in it. Without this the
 * unique slug collides, the insert quietly returns null, and the suite dies in
 * `beforeAll` with an unhelpful "cannot read properties of null".
 */
export async function resetMerchant(slug: string) {
  assertLocal()
  const svc = serviceClient()
  const { data } = await svc.from('merchants').select('id').eq('slug', slug).maybeSingle()
  if (!data) return
  // Children first — they carry FKs back to the merchant. Mirrors the
  // tenant-scoped tables in CLAUDE.md → Data layer; a new one means adding it here.
  for (const table of ['orders', 'products', 'merchant_secrets', 'order_counters', 'vouchers', 'settings', 'merchant_feedback']) {
    await svc.from(table).delete().eq('merchant_id', data.id)
  }
  await svc.from('merchants').delete().eq('id', data.id)
}

/** Seed a merchant, clearing any prior run's copy first. Returns its id. */
export async function seedMerchant(fields: {
  slug: string
  owner_id: string
  name?: string
  order_prefix?: string
  status?: MerchantStatus
  /**
   * Subscription tier (#110). Omitted leaves the column NULL, which reads as basic —
   * the Pro gate is `plan === 'pro'` and nothing else. Pass 'pro' to seed an entitled
   * shop; the gated endpoints (secret, vouchers, product promos) refuse anything else.
   */
  plan?: 'basic' | 'pro'
  /** Defaults to the column defaults (off / 0) when omitted — see 20260720140000_merchant_tax.sql. */
  tax_enabled?: boolean
  tax_rate?: number
  /** Fulfilment methods (#103). Omitted fields keep the column defaults — pickup + delivery. */
  pickup_enabled?: boolean
  delivery_enabled?: boolean
  express_enabled?: boolean
  delivery_base_fee?: number
  delivery_rate_per_km?: number
  delivery_max_km?: number | null
  origin_place_id?: string
}) {
  await resetMerchant(fields.slug)
  const { data, error } = await serviceClient()
    .from('merchants')
    .insert({
      slug: fields.slug,
      owner_id: fields.owner_id,
      name: fields.name ?? fields.slug,
      order_prefix: fields.order_prefix ?? 'XX',
      status: fields.status ?? 'active',
      ...(fields.plan !== undefined ? { plan: fields.plan } : {}),
      ...(fields.tax_enabled !== undefined ? { tax_enabled: fields.tax_enabled } : {}),
      ...(fields.tax_rate !== undefined ? { tax_rate: fields.tax_rate } : {}),
      ...(fields.pickup_enabled !== undefined ? { pickup_enabled: fields.pickup_enabled } : {}),
      ...(fields.delivery_enabled !== undefined ? { delivery_enabled: fields.delivery_enabled } : {}),
      ...(fields.express_enabled !== undefined ? { express_enabled: fields.express_enabled } : {}),
      ...(fields.delivery_base_fee !== undefined ? { delivery_base_fee: fields.delivery_base_fee } : {}),
      ...(fields.delivery_rate_per_km !== undefined ? { delivery_rate_per_km: fields.delivery_rate_per_km } : {}),
      ...(fields.delivery_max_km !== undefined ? { delivery_max_km: fields.delivery_max_km } : {}),
      ...(fields.origin_place_id !== undefined ? { origin_place_id: fields.origin_place_id } : {}),
    })
    .select('id')
    .single()
  if (error) throw new Error(`seeding merchant ${fields.slug}: ${error.message}`)
  return data!.id as string
}

/** Seed one product for a merchant. Returns its id. */
export async function seedProduct(fields: {
  merchant_id: string
  name?: string
  price: number
  active?: boolean
}) {
  const { data, error } = await serviceClient()
    .from('products')
    .insert({
      merchant_id: fields.merchant_id,
      name: fields.name ?? 'Matcha Cookie',
      price: fields.price,
      active: fields.active ?? true,
    })
    .select('id')
    .single()
  if (error) throw new Error(`seeding product: ${error.message}`)
  return data!.id as string
}

/**
 * Create a confirmed auth user via the service role, then sign them in with
 * the anon client and return the signed-in client.
 */
export async function makeUser(email: string, password: string) {
  const svc = serviceClient()
  // Delete any existing user with this email first (idempotent re-runs).
  //
  // PAGINATED, and it has to be: listUsers() returns the FIRST PAGE ONLY (50 accounts by
  // default). A developer database accumulates users across suite runs and seed scripts, and
  // once it passed fifty this lookup silently stopped finding anyone — so the delete was
  // skipped, createUser failed on the duplicate (its error is not read), and the sign-in below
  // ran against whatever password the OLD account was made with. The symptom is a null session
  // several lines later in whichever test happened to reuse an email, which reads as a broken
  // test rather than a broken helper.
  // A prior account is REUSED when it cannot be deleted, rather than the delete being assumed
  // to have worked. orders.user_id and merchants.owner_id are ON DELETE NO ACTION, so an
  // account that has placed an order or owns a shop CANNOT be removed — the delete 500s, the
  // create then fails `email_exists`, and the sign-in below runs against whatever password the
  // old account was made with. On a developer database that has been ordered through, that made
  // any suite reusing such an email fail with a null session far from the real cause. Resetting
  // the password to the one the caller asked for gets the same signed-in client either way.
  const prior = await findUserByEmail(svc, email)
  if (prior) {
    const { error } = await svc.auth.admin.deleteUser(prior)
    if (error) {
      await svc.auth.admin.updateUserById(prior, { password, email_confirm: true })
      const reused = anonClient()
      await reused.auth.signInWithPassword({ email, password })
      return reused
    }
  }

  const { error: createErr } = await svc.auth.admin.createUser({ email, password, email_confirm: true })
  if (createErr) throw new Error(`creating ${email}: ${createErr.message}`)
  const client = anonClient()
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password })
  if (signInErr) throw new Error(`signing in ${email}: ${signInErr.message}`)
  return client
}

/** The id of the account with this email, walking every page. Null when there is none. */
async function findUserByEmail(
  svc: ReturnType<typeof serviceClient>,
  email: string,
): Promise<string | null> {
  const perPage = 200
  for (let page = 1; ; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`listing users: ${error.message}`)
    const users = data?.users ?? []
    const hit = users.find((u) => u.email === email)
    if (hit) return hit.id
    if (users.length < perPage) return null
  }
}
