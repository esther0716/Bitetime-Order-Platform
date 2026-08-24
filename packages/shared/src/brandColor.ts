/* A shop's brand colour, as it is allowed to be stored.
 *
 * Shared because the rule runs on both sides of the wire: the dashboard's picker runs it to decide
 * whether Save is enabled and what to send, and `pickMerchantConfig` runs it to decide whether to
 * refuse. One regex in the endpoint and a different one in the form is how a value that the picker
 * accepts starts coming back as a 400.
 */

/** The platform accent — `--brand-500` in tokens.css. A shop with no colour of its own gets this. */
export const PLATFORM_BRAND_COLOR = '#7A1028'

export type BrandColorError = 'malformed_brand_color'

export type BrandColorResult =
  | { ok: true; value: string | null }
  | { ok: false; error: BrandColorError }

/* Both CSS forms, with the hash optional: a merchant copying a colour out of a design tool gets a
   bare six digits as often as a `#`-prefixed one, and refusing that would be pedantry. */
const HEX = /^#?(?:([0-9a-f]{3})|([0-9a-f]{6}))$/i

/**
 * Normalise a submitted brand colour to `#RRGGBB`, or to `null` for "use the platform colour".
 *
 * `null`, `''` and whitespace all mean the same thing — take it down — and all store `null`, so
 * the column never holds a blank string. Anything else that is not a hex colour is REFUSED, never
 * coerced: a value that fails to save while the merchant sees a success toast is worse than an
 * error, and this is the same posture `tax_rate` and `payment_qr` already take next door.
 */
export function normalizeBrandColor(value: unknown): BrandColorResult {
  if (value === null || value === undefined) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: 'malformed_brand_color' }
  const trimmed = value.trim()
  if (trimmed === '') return { ok: true, value: null }
  const m = HEX.exec(trimmed)
  if (!m) return { ok: false, error: 'malformed_brand_color' }
  // The three-digit form is expanded here rather than stored: the column feeds a colour parser
  // that reads six digits, and two spellings of one colour is two things to keep in step.
  const six = m[1] ? m[1].split('').map((c) => c + c).join('') : m[2]
  return { ok: true, value: `#${six.toUpperCase()}` }
}
