// WHAT this app reports, and the only door to the SDK's `track`.
//
// A union rather than a string, for the reason pixels/track.ts gives: the set of events is then a
// rule the compiler holds instead of a sentence someone has to remember, and adding one is a type
// error at every call site until somebody edits this file.
//
// NO PII EVER, and the property types are what enforce it rather than this comment. `billing` is a
// word the pricing page already shows, and `from`/`cta` name a place in the UI. No name, no email
// address, no contact number, no shop slug, no order.
//
// The client arrives through setAnalyticsClient rather than being created here. That keeps this
// module pure enough to test in the `node` environment the rest of the suite runs in, and it makes
// "Praxor is not configured" the ordinary state rather than a special case.

import type { PraxorClient } from 'praxor'

/** The two billing cycles. One plan remains, so there is no `plan` property anywhere here. */
export type Billing = 'monthly' | 'yearly'

export type AnalyticsEvent =
  | 'merchant_signup'
  | 'trial_started'
  | 'merchant_login'
  | 'billing_checkout_started'
  | 'cta_click'

// `type`, NOT `interface`, and it matters: an interface has no implicit index signature, so it is
// not assignable to the SDK's EventProperties (Record<string, unknown>) and the track call below
// fails to compile.
type EventProps = {
  merchant_signup: { billing: Billing }
  /** The shop was created AND Stripe provisioned the cardless trial. */
  trial_started: undefined
  merchant_login: undefined
  billing_checkout_started: { billing: Billing; from: 'subscription' | 'suspended' }
  cta_click: { from: string; cta: string; billing?: Billing }
}

let client: PraxorClient | null = null

/** Called by useAnalytics once the client exists, and with null when it does not. */
export function setAnalyticsClient(next: PraxorClient | null): void {
  client = next
}

/**
 * Report one named event.
 *
 * The rest-tuple signature is what makes the properties REQUIRED for the three events that have
 * them and absent for the two that do not, rather than optional everywhere.
 */
export function trackEvent<E extends AnalyticsEvent>(
  event: E,
  ...rest: EventProps[E] extends undefined ? [] : [properties: EventProps[E]]
): void {
  if (!client) return
  try {
    client.track(event, rest[0])
  } catch {
    // An ad blocker can leave a global that throws. A missing measurement is acceptable; a submit
    // handler or a checkout click that dies inside it is not.
  }
}
