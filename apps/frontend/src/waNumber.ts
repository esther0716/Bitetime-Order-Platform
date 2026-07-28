/**
 * How a customer's WhatsApp number is SHOWN and DIALLED, in one place.
 *
 * The number is stored exactly as the customer typed it into checkout — `orders.customer_wa` is
 * a fact about that order, not a normalised field — so one shop's list holds `+60 12-345 6789`,
 * `0123456789` and `60123456789` side by side, all of them the same person's number. Reading a
 * column like that is guesswork; the digits do not line up and nothing can be scanned.
 *
 * This is presentation only. It never rewrites what is stored, and it is NOT the identity rule:
 * who counts as one customer is `phoneKey`'s decision, on the backend (ADR 0007). Two numbers
 * this module prints identically are the same person; that is a consequence of that rule, not a
 * second copy of it.
 *
 * Frontend-only on purpose, and deliberately not in `@bitetime/shared`: nothing on the wire
 * depends on the two sides agreeing about hyphens. Only the browser renders a number to a human.
 */

const digitsOf = (raw: string) => raw.replace(/\D/g, '')

/**
 * The number in international digits (no `+`), or null when there is nothing to dial.
 *
 * Three shapes arrive and only two can be resolved with any confidence:
 *
 *   * `60…`  — already international
 *   * `0…`   — Malaysian local; the leading zero is the trunk prefix and is REPLACED by 60,
 *              never merely stripped or prefixed
 *   * anything else — taken as already-international digits, because guessing a country code
 *     for it would produce a confidently wrong number
 */
export function waDigits(raw: string): string | null {
  const digits = digitsOf(raw)
  if (digits.length < 7) return null // no plausible subscriber number in there
  if (digits.startsWith('60')) return digits
  if (digits.startsWith('0')) return `60${digits.slice(1)}`
  return digits
}

/**
 * The tap-to-message link.
 *
 * `wa.me` wants the full international number and nothing else: no `+`, no spaces, and above all
 * no leading zero. Stripping non-digits alone — what this replaces — turned `0198765432` into
 * `wa.me/0198765432`, a link that resolves to no one. The merchant discovered that by tapping it.
 */
export function waHref(raw: string): string | null {
  const digits = waDigits(raw)
  return digits === null ? null : `https://wa.me/${digits}`
}

/**
 * The number as the column shows it: `+60 12-345 6789`.
 *
 * The grouping is Malaysian and is applied ONLY to Malaysian mobiles, which is the whole
 * population of numbers this product collects. Everything else is handed back exactly as typed —
 * a Singapore number regrouped by Malaysian rules is a number that reads wrong to whoever dials
 * it, and a landline (`03-1234 5678`) grouped as a mobile becomes `31-234 5678`, which is worse
 * than leaving it alone. Reformatting is only an improvement when we are sure of the shape.
 */
export function waDisplay(raw: string): string {
  const digits = waDigits(raw)
  if (digits === null || !digits.startsWith('60')) return raw

  const subscriber = digits.slice(2)
  // Mobile prefixes are 1X. A subscriber that is not a mobile keeps its digits, spaced from the
  // country code and no further — enough to make the column line up without asserting a shape.
  if (!subscriber.startsWith('1') || subscriber.length < 9 || subscriber.length > 10) {
    return `+60 ${subscriber}`
  }

  // `NN-…-NNNN`: two-digit operator, four-digit tail, and whatever is in between. That covers
  // both the nine-digit common case (12-345 6789) and the ten-digit 011 block (11-2345 6789)
  // without a special case for either.
  const operator = subscriber.slice(0, 2)
  const tail = subscriber.slice(-4)
  const middle = subscriber.slice(2, -4)
  return `+60 ${operator}-${middle} ${tail}`
}
