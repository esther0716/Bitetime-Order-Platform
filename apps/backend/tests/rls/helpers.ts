// tests/rls/helpers.ts
// Builds Supabase clients for the DB-backed suites (tests/rls and tests/api).
// Credentials come from env vars, which vitest.db.config.ts fills in from the
// running local stack when they are not already set.
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

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
/**
 * The children that BLOCK a merchant delete: every FK to `merchants` declared ON DELETE NO
 * ACTION. Those are the only ones worth clearing by hand.
 *
 * `merchant_secrets`, `merchant_billing`, `merchant_feedback` and `referral_rewards` are all ON
 * DELETE CASCADE, so they go with the merchant on their own. That is not a tidiness point:
 * service_role is granted everything on `merchant_feedback` EXCEPT delete, so an explicit delete
 * of it fails with a permission error — which the old unchecked loop swallowed, along with a
 * delete against `settings`, a table that has no merchant_id at all (it is a global key/value
 * table left over from the single-tenant app). Both were no-ops pretending to be cleanup.
 *
 * `profiles` is the one that mattered: NO ACTION, and absent from the old list. A merchant-scoped
 * profile row would have blocked the merchant delete outright.
 */
const BLOCKING_CHILDREN = ['orders', 'products', 'vouchers', 'order_counters', 'profiles']

export async function resetMerchant(slug: string) {
  assertLocal()
  const svc = serviceClient()
  const { data } = await svc.from('merchants').select('id').eq('slug', slug).maybeSingle()
  if (!data) return
  for (const table of BLOCKING_CHILDREN) {
    // Matches merchant-SCOPED rows only. A customer's global profile carries merchant_id null and
    // is never touched — deleting those would take real accounts with it.
    const { error } = await svc.from(table).delete().eq('merchant_id', data.id)
    if (error) throw new Error(`resetMerchant(${slug}): clearing ${table}: ${error.message}`)
  }
  // CHECKED. An unchecked delete that the FKs refuse leaves the old merchant in place, and the
  // failure resurfaces as a duplicate-slug error from the next seed — pointing at the insert
  // rather than at the cleanup that actually failed.
  const { error } = await svc.from('merchants').delete().eq('id', data.id)
  if (error) throw new Error(`resetMerchant(${slug}): ${error.message}`)
}

/** Seed a merchant, clearing any prior run's copy first. Returns its id. */
export async function seedMerchant(fields: {
  slug: string
  owner_id: string
  name?: string
  order_prefix?: string
  status?: MerchantStatus
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
  /** Landing-page sample-shops carousel flag (#107). Omitted leaves the column default (false). */
  is_sample?: boolean
  /** Manual-payment display fields (#156). Omitted leaves the column defaults (null) — used to
   * test the #182 pending-payment gate, which keys off whether any of these three is set. */
  payment_bank?: string
  payment_qr?: string
  payment_note?: string
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
      ...(fields.tax_enabled !== undefined ? { tax_enabled: fields.tax_enabled } : {}),
      ...(fields.tax_rate !== undefined ? { tax_rate: fields.tax_rate } : {}),
      ...(fields.pickup_enabled !== undefined ? { pickup_enabled: fields.pickup_enabled } : {}),
      ...(fields.delivery_enabled !== undefined ? { delivery_enabled: fields.delivery_enabled } : {}),
      ...(fields.express_enabled !== undefined ? { express_enabled: fields.express_enabled } : {}),
      ...(fields.delivery_base_fee !== undefined ? { delivery_base_fee: fields.delivery_base_fee } : {}),
      ...(fields.delivery_rate_per_km !== undefined ? { delivery_rate_per_km: fields.delivery_rate_per_km } : {}),
      ...(fields.delivery_max_km !== undefined ? { delivery_max_km: fields.delivery_max_km } : {}),
      ...(fields.origin_place_id !== undefined ? { origin_place_id: fields.origin_place_id } : {}),
      ...(fields.is_sample !== undefined ? { is_sample: fields.is_sample } : {}),
      ...(fields.payment_bank !== undefined ? { payment_bank: fields.payment_bank } : {}),
      ...(fields.payment_qr !== undefined ? { payment_qr: fields.payment_qr } : {}),
      ...(fields.payment_note !== undefined ? { payment_note: fields.payment_note } : {}),
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
  // The promo columns are optional and OMITTED when not passed, rather than defaulted to null:
  // a test that says nothing about a promo wants the column's own default, and the gate under
  // test (#145) reads a stored null as "no promo".
  promo_price?: number
  promo_limit?: number
  promo_end?: string
  // Omitted when not passed, for the same reason the promo columns are: the column's own
  // default (`'[]'`) is what a product that asks nothing should have.
  option_groups?: unknown
  /** Display order within a shop (products.sort). Omitted leaves the column default (0). */
  sort?: number
  /** Which section the product sits in (products.category_id). Omitted leaves it NULL. */
  category_id?: string
}) {
  const { data, error } = await serviceClient()
    .from('products')
    .insert({
      merchant_id: fields.merchant_id,
      name: fields.name ?? 'Matcha Cookie',
      price: fields.price,
      active: fields.active ?? true,
      ...(fields.promo_price !== undefined ? { promo_price: fields.promo_price } : {}),
      ...(fields.promo_limit !== undefined ? { promo_limit: fields.promo_limit } : {}),
      ...(fields.promo_end !== undefined ? { promo_end: fields.promo_end } : {}),
      ...(fields.option_groups !== undefined ? { option_groups: fields.option_groups } : {}),
      ...(fields.sort !== undefined ? { sort: fields.sort } : {}),
      ...(fields.category_id !== undefined ? { category_id: fields.category_id } : {}),
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
  // The lookup is a single indexed query against `auth.users` — see `findUserByEmail`. It used
  // to page through the whole admin user list, which was correct but cost a walk of every
  // account on every call; the comment that lived here recorded an earlier bug where the walk
  // was not paginated at all and silently stopped finding anyone past the first page. Neither
  // failure is reachable now: there is no page to run out of.
  // A prior account is REUSED when it cannot be deleted, rather than the delete being assumed
  // to have worked. orders.user_id and merchants.owner_id are ON DELETE NO ACTION, so an
  // account that has placed an order or owns a shop CANNOT be removed — the delete 500s, the
  // create then fails `email_exists`, and the sign-in below runs against whatever password the
  // old account was made with. On a developer database that has been ordered through, that made
  // any suite reusing such an email fail with a null session far from the real cause. Resetting
  // the password to the one the caller asked for gets the same signed-in client either way.
  const prior = await findUserByEmail(email)
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

/**
 * A PHONE-ONLY account, idempotently — the same guarantee `makeUser` gives for an email one.
 *
 * Auth reads such an account back with `email: ''`, which is the property the notify suites need:
 * an owner who plainly exists and yet has nothing to send to.
 *
 * The delete-first is the whole point. `createUser` refuses a phone that already exists, and it
 * refuses it by returning `{ user: null }` rather than by throwing — so a suite that simply
 * created one passed on a fresh database and failed on every run after with
 * `Cannot read properties of null`, an error naming nothing about its cause.
 */
export async function makePhoneOnlyUser(phone: string, password: string): Promise<string> {
  const svc = serviceClient()
  const rows = await authDb()<{ id: string }[]>`
    select id from auth.users where phone = ${phone.replace(/^\+/, '')} limit 1
  `
  const prior = rows[0]?.id
  if (prior) {
    // REUSED when it cannot be deleted, exactly as `makeUser` does and for the same reason: an
    // account that owns a shop is undeletable (`merchants.owner_id` is ON DELETE NO ACTION), and
    // this suite's phone-only account owns one by the time the test has run once. The account has
    // no state worth resetting — its whole job is to have no email — so reuse is not a compromise.
    const { error: deleteErr } = await svc.auth.admin.deleteUser(prior)
    if (deleteErr) return prior
  }

  const { data, error } = await svc.auth.admin.createUser({ phone, password, phone_confirm: true })
  if (error || !data?.user) throw new Error(`creating phone account ${phone}: ${error?.message ?? 'no user returned'}`)
  return data.user.id
}

/**
 * The id of the account with this email, straight from `auth.users`. Null when there is none.
 *
 * SQL, and not `listUsers`, and that is not a micro-optimisation. The admin list endpoint cannot
 * filter by email in this SDK, so finding one account meant walking EVERY page of the auth table
 * on every call — and `makeUser` is called several times per suite across the 29 suites vitest
 * runs concurrently. On a developer database of a couple of hundred accounts that is hundreds of
 * admin requests per run, each one a fresh GoTrue -> Postgres connection, and the failure mode
 * when the host runs out of ephemeral ports is `listing users: {}` on a hundred unrelated tests
 * — an error that names nothing about its cause. Here it is one indexed round trip on a
 * connection this module already holds, and the count of accounts stops mattering at all.
 *
 * `auth.users` is not reachable through PostgREST (it is not in the exposed schemas), so this
 * goes through the same direct driver the backend uses for transactions.
 */
async function findUserByEmail(email: string): Promise<string | null> {
  const rows = await authDb()<{ id: string }[]>`
    select id from auth.users where email = ${email} limit 1
  `
  return rows[0]?.id ?? null
}

/**
 * The direct connection this module uses to read `auth.users`.
 *
 * Lazy, so a suite that never makes a user never opens one. `max: 1` with a short
 * `idle_timeout` keeps it from holding the pool open — postgres.js will not let the process
 * exit while a connection is idle, and a vitest run that hangs is a worse failure than a slow
 * one.
 */
let authSql: ReturnType<typeof postgres> | null = null
function authDb() {
  if (!authSql) {
    authSql = postgres(required('DATABASE_URL'), {
      max: 1,
      idle_timeout: 1,
      onnotice: () => {},
    })
  }
  return authSql
}
