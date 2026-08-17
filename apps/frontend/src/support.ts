/**
 * How a merchant reaches a human, in one place.
 *
 * The feedback dialog (#89) is one-way by design: it writes a `merchant_feedback` row a
 * superadmin reads later, and nothing ever replies to it. That is the right shape for "this
 * button is confusing" and the wrong shape for "my shop is shut and I do not know why", so
 * these two links are the answer to the second question — a real inbox and a real phone,
 * reached without the platform in the middle.
 *
 * Hardcoded rather than read from `import.meta.env`. A support address changes about as often
 * as the product name, both spellings cost a redeploy to change, and only this one can be
 * pinned by a test — an env var that is unset in production degrades to a `mailto:undefined`
 * that looks like a working link right up until someone taps it.
 */
import { waHref } from './waNumber'

export const SUPPORT_EMAIL = 'enquiry@support.tinyorder.shop'

/** International digits, no `+`. `waHref` builds the `wa.me` link from this. */
export const SUPPORT_WA = '6588425267'

/**
 * The number as it is shown. Written out rather than passed through `waDisplay`, whose
 * grouping rule is Malaysian and deliberately declines to regroup anything else — it would
 * hand back these digits unspaced.
 */
export const SUPPORT_WA_DISPLAY = '+65 8842 5267'

export const SUPPORT_WA_HREF = waHref(SUPPORT_WA)

/**
 * A `mailto:` that already names the shop it is about.
 *
 * The slug is what a superadmin looks a shop up by, and a merchant writing in distress rarely
 * thinks to include it — "my orders stopped" from an unknown sender is a round trip before the
 * work can even start. Both parts are encoded: a shop name is merchant-typed and may hold a
 * `&`, which unencoded ends the subject and silently drops the rest of it.
 */
export function supportMailto(shop?: { name: string; slug: string }): string {
  if (!shop) return `mailto:${SUPPORT_EMAIL}`
  const subject = encodeURIComponent(`Support — ${shop.name} (${shop.slug})`)
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}`
}
