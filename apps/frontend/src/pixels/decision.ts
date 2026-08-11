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
  /** Is the current route one of TinyOrder's own published pages? */
  onMarketingPath: boolean
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
 * Off a marketing page, every answer is no — including for a visitor who accepted earlier.
 * Consent given on our own pages is consent for OUR pages; it does not travel onto a shop's
 * storefront, where the audience is the merchant's customers rather than ours.
 */
export function pixelDecision({ configured, onMarketingPath, choice }: PixelDecisionInput): PixelDecision {
  if (!configured || !onMarketingPath) return { load: false, pageView: false, banner: false }
  return {
    load: choice === 'accepted',
    pageView: choice === 'accepted',
    banner: choice === null,
  }
}
