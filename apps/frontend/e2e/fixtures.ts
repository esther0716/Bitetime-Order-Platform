// The shop the e2e run orders from, seeded through the service role.
//
// Its own slug, owner email and order prefix, disjoint from every fixture in
// apps/backend/tests — those suites key their cleanup on slugs and emails, so sharing one
// would make two independently-passing suites fail depending on which ran last.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { stackEnv } from './stack'

export const SHOP_SLUG = 'e2e-pickup-shop'
export const SHOP_NAME = 'E2E Pickup Shop'
export const ORDER_PREFIX = 'E2'
export const PRODUCT_NAME = 'Pandan Kaya Roll'
export const PRODUCT_PRICE = 12
const OWNER_EMAIL = 'e2e-shop-owner@test.dev'

export function serviceClient(): SupabaseClient {
  const env = stackEnv()
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Every table carrying a `merchant_id`, children first.
 *
 * Taken from the schema, not from the neighbouring list in apps/backend/tests/rls/helpers.ts
 * (`resetMerchant`) — that one predates two of these tables and also lists `settings`, which has
 * no merchant_id at all (it is a global key/value table). It gets away with the mismatch because
 * it never checks the delete errors, so both the missing tables and the impossible one are
 * silent. This one checks, so it has to be right.
 *
 * Add a tenant-scoped table and this list needs it: the symptom of missing one is the suite
 * passing once and failing on every rerun, because the leftover child makes the merchant
 * undeletable and the reseed collides on the slug.
 */
const TENANT_TABLES = [
  'orders',
  'products',
  'merchant_secrets',
  'order_counters',
  'vouchers',
  'merchant_billing',
  // merchant_feedback is DELIBERATELY ABSENT. service_role is granted everything on it except
  // DELETE (20260720120000_merchant_feedback.sql), so feedback cannot be erased through the REST
  // path at all — and this fixture never writes any, since nothing in a guest checkout submits
  // merchant feedback. Adding it back turns every rerun into a permission error.
  // Merchant-SCOPED profile rows only. A customer's global profile carries merchant_id null and
  // is therefore never matched — deleting those would take real accounts with it.
  'profiles',
]

/** The shop is rebuilt from nothing on every run, so a rerun is never a different fixture. */
async function resetShop(svc: SupabaseClient): Promise<void> {
  const { data: existing } = await svc.from('merchants').select('id').eq('slug', SHOP_SLUG).maybeSingle()
  if (!existing) return
  // Children first — each carries an FK back to the merchant.
  for (const table of TENANT_TABLES) {
    const { error } = await svc.from(table).delete().eq('merchant_id', existing.id)
    if (error) throw new Error(`clearing ${table}: ${error.message}`)
  }
  // CHECKED, unlike the first version of this function. An unchecked delete that the FKs refuse
  // leaves the old shop in place, and the failure surfaces as a confusing duplicate-slug error
  // from the insert below rather than as the delete that actually failed.
  const { error } = await svc.from('merchants').delete().eq('id', existing.id)
  if (error) throw new Error(`clearing merchant ${SHOP_SLUG}: ${error.message}`)
}

/**
 * An owner account for the shop. `merchants.owner_id` is NOT NULL and references auth.users, so
 * the shop cannot exist without one — even though this flow never signs in as them.
 *
 * Reused rather than recreated when a prior account cannot be deleted: orders.user_id and
 * merchants.owner_id are ON DELETE NO ACTION, so an owner that has been ordered through is
 * undeletable. Same fault that made makeUser fail in the backend suites.
 */
async function ensureOwner(svc: SupabaseClient): Promise<string> {
  const perPage = 200
  for (let page = 1; ; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`listing users: ${error.message}`)
    const users = data?.users ?? []
    const hit = users.find((u) => u.email === OWNER_EMAIL)
    if (hit) return hit.id
    if (users.length < perPage) break
  }
  const { data, error } = await svc.auth.admin.createUser({
    email: OWNER_EMAIL,
    password: 'password123',
    email_confirm: true,
  })
  if (error || !data?.user) throw new Error(`creating shop owner: ${error?.message ?? 'no user returned'}`)
  return data.user.id
}

/**
 * Seed an ACTIVE pickup-only shop with one product.
 *
 * Pickup-only on purpose. Delivery would drag in a region or a routed distance — and the
 * distance path calls Google, which this suite forces off. Pickup is the shortest complete path
 * from an empty cart to a committed order, which is exactly what a smoke test should cover.
 */
export async function seedShop(): Promise<{ merchantId: string; productId: string }> {
  const svc = serviceClient()
  await resetShop(svc)
  const ownerId = await ensureOwner(svc)

  const { data: merchant, error: mErr } = await svc
    .from('merchants')
    .insert({
      slug: SHOP_SLUG,
      name: SHOP_NAME,
      owner_id: ownerId,
      order_prefix: ORDER_PREFIX,
      status: 'active', // a storefront renders at nothing else
      pickup_enabled: true,
      delivery_enabled: false,
      express_enabled: false,
    })
    .select('id')
    .single()
  if (mErr) throw new Error(`seeding merchant: ${mErr.message}`)

  const { data: product, error: pErr } = await svc
    .from('products')
    .insert({ merchant_id: merchant!.id, name: PRODUCT_NAME, price: PRODUCT_PRICE, active: true })
    .select('id')
    .single()
  if (pErr) throw new Error(`seeding product: ${pErr.message}`)

  return { merchantId: merchant!.id as string, productId: product!.id as string }
}
