// Pure helpers for the suspended shop's reactivation picker.
//
// Same discipline as billingBannerState / subscriptionTabState next door: the merchant row goes
// in, a decision comes out, and the component only renders. Small, but both of these are the kind
// of thing that is wrong in a way nobody notices — a default that silently re-sells the wrong
// tier, or a saving percentage quoted off the wrong pair of numbers.

export type Plan = 'basic' | 'pro'
export type Cycle = 'monthly' | 'yearly'

export interface Reactivation {
  plan: Plan
  cycle: Cycle
}

/**
 * Where the picker starts: the tier and cycle the shop last had.
 *
 * NOT a fixed 'basic'/'monthly'. A Pro shop whose card expired is reopening the shop they had,
 * and making them re-choose Pro to get back what they already lost is the wrong first impression
 * of a screen whose entire job is to be easy to say yes to.
 *
 * A missing or unrecognised column reads as basic/monthly, matching every other reader of these
 * columns — `merchants.plan` is nullable and null has always meant basic (the Pro gate is
 * `plan === 'pro'` and nothing else). It has to be normalised HERE rather than trusted, because
 * this value is posted straight to `/api/checkout`, which refuses anything it does not recognise.
 *
 * One caveat this cannot fix, and should not pretend to: a shop that lapsed is returned to Basic
 * by `lapseMerchant`, so by the time this screen renders, `plan` usually already says basic. That
 * is correct — entitlement follows the money — and it means the Pro default here really only
 * applies to a shop suspended by a superadmin while still on Pro. The picker is what covers the
 * rest, which is exactly why it exists.
 */
export function defaultReactivation(
  merchant: { plan?: string | null; billing_cycle?: string | null } | null | undefined,
): Reactivation {
  return {
    plan: merchant?.plan === 'pro' ? 'pro' : 'basic',
    cycle: merchant?.billing_cycle === 'yearly' ? 'yearly' : 'monthly',
  }
}

/**
 * How much the yearly price saves against twelve monthly ones, as a whole percent — or null when
 * there is nothing to claim.
 *
 * Null rather than 0 when the yearly price is not actually cheaper: a "Save 0%" badge is worse
 * than no badge, and a negative one is a lie the pricing page would then have to explain. Derived
 * from the LIVE prices (they come from Stripe via usePlatformPricing), never hardcoded, so a
 * price change in the Stripe dashboard cannot leave this quoting a saving that no longer exists.
 */
export function yearlySavingPercent(monthly: number, yearly: number): number | null {
  const full = monthly * 12
  if (!(full > 0) || !(yearly > 0) || yearly >= full) return null
  return Math.round(((full - yearly) / full) * 100)
}
