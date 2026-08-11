/**
 * The single decision that determines whether an advertising pixel does anything.
 *
 * It lives here, apart from the hook, because it is worth stating once and testing against a
 * truth table rather than being reachable only by clicking through a consent banner — the same
 * argument checkoutGate.ts makes for the sign-in gate, and for the same reason.
 *
 * It exists because splitting the rule across two effects got it wrong once: the pageview was
 * gated on the path and the LOAD was not, so a visitor who accepted on /pricing and then opened
 * a storefront link injected fbevents.js onto that merchant's page. No event was reported, and
 * the damage was already done — the load IS the third-party request and the advertising cookie.
 * One function now answers all three questions from one set of inputs, so they cannot disagree.
 */

import type { ConsentChoice } from './consent'

export interface PixelDecisionInput {
  /** Is any pixel id configured at all? */
  configured: boolean
  /**
   * May these pixels be used at all?
   *
   * Always true for TinyOrder's own (#217) — the platform's pixels are on no plan. For a shop's
   * own (#220) it is `plan === 'pro'`, and it is an input here rather than an `if` inside the
   * hook so the plan gate is a row in this file's truth table instead of a branch only a click
   * through a settings form can reach. A downgrade therefore stops the LOAD, not just the
   * events — the load is the third-party request and the advertising cookie.
   */
  entitled: boolean
  /**
   * Is the current route one this set of pixels may fire on?
   *
   * TinyOrder's own pixels: one of its published marketing pages. A shop's own: that shop's
   * storefront and nowhere else. Deliberately not named after either — the two answers must not
   * be able to leak into each other, and a shared name is how that starts.
   */
  inScope: boolean
  /** What the visitor answered, or null if they have not been asked yet. */
  choice: ConsentChoice | null
}

export interface PixelDecision {
  /** Inject the vendor scripts. The moment a third party is contacted. */
  load: boolean
  /** Report a pageview for this route. */
  pageView: boolean
  /** Show the consent banner. */
  banner: boolean
}

/**
 * Out of scope, every answer is no — including for a visitor who accepted earlier. Consent given
 * on our own pages is consent for OUR pages; it does not travel onto a shop's storefront, where
 * the audience is the merchant's customers rather than ours. The same holds in the other
 * direction: an answer given at one shop is not an answer at the next one.
 *
 * Not entitled is the same "no", and for a reason worth stating: a shop that stops paying stops
 * tracking, and the banner stops asking its customers a question that can no longer lead
 * anywhere.
 */
export function pixelDecision({ configured, entitled, inScope, choice }: PixelDecisionInput): PixelDecision {
  if (!configured || !entitled || !inScope) return { load: false, pageView: false, banner: false }
  return {
    load: choice === 'accepted',
    pageView: choice === 'accepted',
    banner: choice === null,
  }
}
