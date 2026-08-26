// The shop a merchant asked for at signup, carried on the auth user's `user_metadata`.
//
// Shared rather than frontend-only because BOTH sides of the wire touch it now: the backend
// WRITES the bag when it creates the account (`POST /api/merchant/signup` passes it to
// `admin.auth.admin.createUser`), and the browser READS it back when a shop still has to be
// created for an account that already exists. A key spelled one way in one workspace and
// another way in the other is a shop that silently loses its name, so the spelling is one rule
// in one file.
//
// Everything read back is UNTRUSTED: a signed-in user can rewrite their own metadata
// (`supabase.auth.updateUser`), so this parses rather than casts.

import { isBusinessNature } from './businessNature.js'
import { isCurrencyCode, DEFAULT_CURRENCY, type CurrencyCode } from './currency.js'

export interface PendingShop {
  name: string
  /** '' for "never chose one" — same as the picker's empty value. */
  businessNature: string
  currency: CurrencyCode
  billing: 'monthly' | 'yearly'
  ref?: string
}

/** What the account-creating call hands Supabase as the user's metadata. Prefixed so it cannot
 *  collide with the `name` the profile row already reads out of this same bag. */
export function pendingShopMetadata(shop: PendingShop): Record<string, string> {
  return {
    shop_name: shop.name,
    shop_business_nature: shop.businessNature,
    shop_currency: shop.currency,
    shop_billing: shop.billing,
    ...(shop.ref ? { shop_ref: shop.ref } : {}),
  }
}

/** The parked shop, or null when the user never asked for one (an ordinary customer, or a
 *  merchant who signed up before this shipped — both land on the manual form instead). */
export function pendingShopFromMetadata(meta: unknown): PendingShop | null {
  if (!meta || typeof meta !== 'object') return null
  const bag = meta as Record<string, unknown>
  const name = typeof bag.shop_name === 'string' ? bag.shop_name.trim() : ''
  if (!name) return null
  return {
    name,
    businessNature: isBusinessNature(bag.shop_business_nature) ? bag.shop_business_nature : '',
    currency: isCurrencyCode(bag.shop_currency) ? bag.shop_currency : DEFAULT_CURRENCY,
    billing: bag.shop_billing === 'yearly' ? 'yearly' : 'monthly',
    ref: typeof bag.shop_ref === 'string' && bag.shop_ref ? bag.shop_ref : undefined,
  }
}

/**
 * The shop half of a merchant signup request body, parsed.
 *
 * The BACKEND's door, and the reason this lives beside the metadata rules rather than in
 * `app.ts`: the request body and the metadata bag are the same five answers in two shapes, and
 * a route that parsed them separately would be the drift this module exists to stop. Returns
 * null for a body with no usable shop name, which the route answers as `invalid_shop`.
 */
export function pendingShopFromBody(body: unknown): PendingShop | null {
  if (!body || typeof body !== 'object') return null
  const bag = body as Record<string, unknown>
  const name = typeof bag.name === 'string' ? bag.name.trim() : ''
  if (!name) return null
  return {
    name,
    businessNature: isBusinessNature(bag.businessNature) ? bag.businessNature : '',
    currency: isCurrencyCode(bag.currency) ? bag.currency : DEFAULT_CURRENCY,
    billing: bag.billing === 'yearly' ? 'yearly' : 'monthly',
    ref: typeof bag.ref === 'string' && bag.ref ? bag.ref : undefined,
  }
}
