// WHICH advertising pixels exist, as data rather than as an `if` buried in a hook.
//
// Deliberately a plain value object with two optional fields, not two booleans and two constants:
// this is the type the merchant-pixel feature (#220) hands over per shop, read off the merchant
// row instead of the environment. Everything downstream of here takes a PixelIds and asks no
// question about where it came from — that seam is the reason this ships first.
//
// An id is public: it ships in the page, and Meta and TikTok both treat it as such. The env var
// is not a secret, it is a switch.

export interface PixelIds {
  /** Meta (Facebook) pixel id. */
  meta?: string
  /** TikTok pixel id. */
  tiktok?: string
}

/**
 * Empty, whitespace and unset all mean the same thing: no pixel.
 *
 * A Vercel variable set to a blank string is the shape of a half-finished configuration, and
 * `''` is truthy to nobody but is a perfectly good value to inject into a vendor snippet — which
 * would then initialise a pixel with no id and report to nowhere, silently.
 */
function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** The platform's own ids, from the build environment. */
export function platformPixelIds(): PixelIds {
  return {
    meta: configured(import.meta.env.VITE_META_PIXEL_ID),
    tiktok: configured(import.meta.env.VITE_TIKTOK_PIXEL_ID),
  }
}

/**
 * A shop's OWN ids, off its merchant row (#220).
 *
 * The same `configured` trim as the platform's, and for a sharper version of the same reason: a
 * merchant clearing the field in Shop Settings sends `''`, and a row written before the columns
 * existed has neither. Absent, null and blank are one state — no pixel — and reading them as
 * three is how a shop ends up initialising a pixel with no id.
 *
 * Says NOTHING about the shop's plan. Whether a configured pixel may fire is `entitled` in
 * pixelDecision, which is where a downgrade is answered.
 */
export function merchantPixelIds(merchant: {
  meta_pixel_id?: string | null
  tiktok_pixel_id?: string | null
} | null | undefined): PixelIds {
  return {
    meta: configured(merchant?.meta_pixel_id ?? undefined),
    tiktok: configured(merchant?.tiktok_pixel_id ?? undefined),
  }
}

/**
 * Is anything configured at all?
 *
 * The gate on the whole feature, banner included. With neither id set nothing loads and nothing
 * renders, which is what keeps dev, CI, Vitest and Playwright free of third-party scripts with
 * no stubbing anywhere.
 */
export function hasAnyPixel(ids: PixelIds): boolean {
  return Boolean(ids.meta || ids.tiktok)
}
