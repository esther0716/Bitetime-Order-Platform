// WHICH link is a signup CTA, and what cycle it preselects.
//
// Here rather than inside useAnalytics for the reason pixels/decision.ts gives for its own split:
// a rule reachable only by clicking a link in a browser is a rule nobody tests. This one decides
// what `cta_click` reports and has four shapes to get right — bare, preselecting, the older
// two-segment URL, and every link on the page that is not a CTA at all.

import { pathOnly } from './path'
import type { Billing } from './events'

/** The href every signup CTA points at. */
const SIGNUP_PATH = '/merchant/signup'

/**
 * `{}` for a CTA that names no cycle, `{ billing }` for one that does, and `null` for a link that
 * is not a signup CTA.
 *
 * Relative hrefs only: an absolute URL is refused even when its path matches, because a link to
 * another host that happens to end in /merchant/signup is not our CTA.
 */
export function signupCta(href: string): { billing?: Billing } | null {
  if (!href.startsWith('/')) return null
  const path = pathOnly(href)
  if (path !== SIGNUP_PATH && !path.startsWith(`${SIGNUP_PATH}/`)) return null
  const segments = path.split('/')
  if (segments.includes('yearly')) return { billing: 'yearly' }
  if (segments.includes('monthly')) return { billing: 'monthly' }
  return {}
}
