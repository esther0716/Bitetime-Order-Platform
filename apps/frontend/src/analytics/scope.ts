// WHERE first-party analytics may report.
//
// A DENY-list, and deliberately not the allow-list marketingPaths.ts uses. That file answers a
// narrower question — is this a published page with a title of its own? — which excludes the whole
// merchant dashboard, and this feature exists to measure the owner funnel through it. A new
// platform page must be measured the day it ships; only the two exclusions below are deliberate.
//
// This rule is the whole reason the SDK's automatic capture stays off. `praxor` captures pageviews
// by patching window.history.pushState/replaceState and captures outbound clicks with a listener
// on document. Both are global to the page and neither can be told to ignore /s/:slug. This app is
// one SPA, so a visitor reaches a storefront from /pricing with no document load — and the SDK
// would report that navigation out of a merchant customer's browser. See pixels/decision.ts, which
// holds the same line for the advertising pixels.

import { pathOnly } from './path'

/** A storefront lives under this segment, which RESERVED_SLUGS keeps any shop from claiming. */
const STOREFRONT_PREFIX = '/s/'

/**
 * Role-blind, and reached by a shop's customer after a recovery link, so it is not our page to
 * measure. See the route comment in AppRouter.tsx for why it is top-level rather than under /s/.
 */
const RESET_PASSWORD = '/reset-password'

/**
 * Is this path one of TinyOrder's own pages?
 *
 * A query string and a hash are stripped first. React Router hands this a bare pathname today, and
 * an answer that depended on that would be wrong the first time a caller passed anything else.
 */
export function isPlatformPath(pathname: string): boolean {
  const path = pathOnly(pathname)
  if (path === STOREFRONT_PREFIX.slice(0, -1) || path.startsWith(STOREFRONT_PREFIX)) return false
  if (path === RESET_PASSWORD) return false
  return true
}
