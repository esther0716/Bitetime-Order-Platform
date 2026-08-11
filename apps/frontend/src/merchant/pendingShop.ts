// The shop a merchant asked for at signup, parked on the auth user until it can be created.
//
// Merchant signup creates the ACCOUNT and the SHOP in two steps, and email confirmation splits
// them: with confirmations on, `signUp` returns no session, the immediate `signIn` fails, and
// the `createMerchant` call that follows it never runs. The account exists; the shop does not.
// Everything the form collected then died with the page, and the merchant came back after
// confirming to a landing page that had no idea they had ever asked for a shop.
//
// So the form's answers ride along in the auth user's `user_metadata`, which is the one place
// that survives both the confirmation round trip AND the device change of reading the email on
// a phone — a localStorage stash survives neither.
//
// Everything read back is UNTRUSTED: a signed-in user can rewrite their own metadata
// (`supabase.auth.updateUser`), so this parses rather than casts.

import { isBusinessNature, isCurrencyCode, DEFAULT_CURRENCY, type CurrencyCode } from '@bitetime/shared'

export interface PendingShop {
  name: string
  /** '' for "never chose one" — same as the picker's empty value. */
  businessNature: string
  currency: CurrencyCode
  billing: 'monthly' | 'yearly'
  ref?: string
}

/** What `signUp` hands to Supabase as `options.data`. Prefixed so it cannot collide with the
 *  `name` the profile row already reads out of this same bag. */
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
