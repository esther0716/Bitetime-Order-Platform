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
import type { OnboardingStep } from '../merchant/onboardingSteps'
import type { SignupErrorCode } from '../signupError'

/** The two billing cycles. One plan remains, so there is no `plan` property anywhere here. */
export type Billing = 'monthly' | 'yearly'

/**
 * A cycle the rest of the app carries as a bare `string`, narrowed to the two words this module
 * reports.
 *
 * One place rather than a `=== 'yearly' ? … : …` at each of the four call sites: they all answer
 * the same question, and four copies is four chances for one of them to report the other cycle.
 * Monthly is the fallback because it is what the backend defaults to (`billing = 'monthly'` in
 * store.ts's createMerchant).
 */
export function toBilling(value: string): Billing {
  return value === 'yearly' ? 'yearly' : 'monthly'
}

/**
 * Why a merchant signup did not finish.
 *
 * The backend's own refusal codes, plus the one failure that happens AFTER the account exists:
 * `POST /api/merchants` refused, so there is an account with no shop. Reusing SignupErrorCode
 * rather than restating it keeps this from drifting behind the endpoint it describes — a new
 * refusal the backend learns to send is a compile error here until it is named.
 */
export type SignupFailure = SignupErrorCode | 'shop_create_failed'

export type AnalyticsEvent =
  /** The signup form was touched. Fires once per visit, on first focus of any field. */
  | 'signup_started'
  /** The form was submitted. Fires before the network call, so it counts intent, not success. */
  | 'signup_submitted'
  /** The submit did not end in a shop. */
  | 'signup_failed'
  | 'merchant_signup'
  | 'trial_started'
  | 'merchant_login'
  | 'billing_checkout_started'
  | 'onboarding_step'
  | 'cta_click'
  /** The end-of-page signup card came on screen. */
  | 'scroll_cta_shown'
  /** The reader closed it. */
  | 'scroll_cta_dismissed'

// `type`, NOT `interface`, and it matters: an interface has no implicit index signature, so it is
// not assignable to the SDK's EventProperties (Record<string, unknown>) and the track call below
// fails to compile.
type EventProps = {
  /**
   * The three signup events carry no more than the funnel needs to be readable:
   *
   *   pageview /merchant/signup → signup_started → signup_submitted → merchant_signup
   *
   * with signup_failed naming every gap. Without them the only measurable outcome is success,
   * which cannot tell a visitor who bounced off the form from one who filled it in and was
   * refused — and those two have opposite fixes.
   */
  signup_started: undefined
  signup_submitted: { billing: Billing }
  signup_failed: { reason: SignupFailure }
  merchant_signup: { billing: Billing }
  /** The shop was created AND Stripe provisioned the cardless trial. */
  trial_started: undefined
  merchant_login: undefined
  billing_checkout_started: { billing: Billing; from: 'subscription' | 'suspended' }
  /**
   * One of the three setup steps just completed, for the first and only time in this shop's life.
   * Which step, and nothing else — the drop-off point is the whole question, and a shop id would
   * make this the one event here that identifies a merchant.
   *
   * There is deliberately no `shop_activated` beside it: a shop that fired all three IS activated,
   * so the fourth event would be derived data. It would also have nowhere honest to remember it had
   * already fired, and an event re-sent per visit is how /merchant became the busiest page on the
   * site (see the comment in index.html).
   */
  onboarding_step: { step: OnboardingStep }
  cta_click: { from: string; cta: string; billing?: Billing }
  /**
   * The end-of-page signup card (marketing/ScrollCta.tsx), which exists to turn a visit into a
   * signup and can only be judged as a pair:
   *
   *   scroll_cta_shown → cta_click { cta: 'scroll-end' } → pageview /merchant/signup → merchant_signup
   *
   * with scroll_cta_dismissed naming the readers who refused it. `cta_click` alone counts the
   * clicks and cannot say how many readers were asked, so it cannot tell a card nobody sees from a
   * card nobody wants — and those two have opposite fixes. `from` is the marketing path the card
   * appeared on, the same property and the same values `cta_click` reports.
   */
  scroll_cta_shown: { from: string }
  scroll_cta_dismissed: { from: string }
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

/**
 * Report one pageview, for the given path.
 *
 * Here rather than in the hook so this module really is the only door to the SDK, and so the
 * pageview is guarded the same way an event is. It needs BOTH guards: `trackPageview` returns a
 * promise, so a synchronous throw and a rejection are two different failures and neither may reach
 * a route effect.
 */
export function trackPageview(path: string): void {
  if (!client) return
  try {
    void client.trackPageview(path).catch(() => {})
  } catch {
    // Same trade as above: a missing pageview never costs a route transition.
  }
}
