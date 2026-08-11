// WHERE the platform's own pixels are allowed to fire.
//
// DERIVED, never hand-maintained. ROUTE_META's keys already are the set of public pages that have
// a title and a description of their own — the marketing pages plus the two app pages sitemap.xml
// lists plus the two legal documents. A second list spelling the same set out again is a list that
// drifts, and the drift here is not cosmetic: a new marketing page would silently lose its
// tracking, and, far worse, a new route shape under /s/ would silently gain it.
//
// Everything absent from that table is excluded for free and for the right reason: a storefront,
// a dashboard and an admin screen have no build-time title precisely because they are not pages
// we publish. /reset-password and /releases/:tag fall out for the same reason.
//
// Note what is deliberately IN: /merchant/signup. It is the page an ad lands on and the page the
// conversion happens on.

import { ROUTE_META } from '../routeMeta'
import { normalisedPath } from '../canonical'

/**
 * Is this path one of TinyOrder's own published pages?
 *
 * Normalised by the SAME function the canonical URL uses, not by a second copy of its rules: a
 * trailing slash is dropped and a signup preselection collapses to the page it preselects, so one
 * route cannot answer differently here than it does there.
 */
export function isMarketingPath(pathname: string): boolean {
  return normalisedPath(pathname) in ROUTE_META
}
