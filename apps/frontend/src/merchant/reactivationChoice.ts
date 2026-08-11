// Pure helpers for the suspended shop's reactivation picker.
//
// Same discipline as billingBannerState / subscriptionTabState next door: the merchant row goes
// in, a decision comes out, and the component only renders. Small, but both of these are the kind
// of thing that is wrong in a way nobody notices — a default that silently re-sells the wrong
// tier, or a saving percentage quoted off the wrong pair of numbers.

export type Cycle = 'monthly' | 'yearly'

export interface Reactivation {
  cycle: Cycle
}

/**
 * Where the picker starts: the cycle the shop last paid on.
 *
 * NOT a fixed 'monthly'. A shop that was paying yearly is reopening the shop it had, and making
 * it re-choose is the wrong first impression of a screen whose entire job is to be easy to say
 * yes to.
 *
 * A missing or unrecognised column reads as monthly, and it is normalised HERE rather than
 * trusted, because this value is posted straight to `/api/checkout`, which refuses anything it
 * does not recognise.
 */
export function defaultReactivation(
  merchant: { billing_cycle?: string | null } | null | undefined,
): Reactivation {
  return {
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
