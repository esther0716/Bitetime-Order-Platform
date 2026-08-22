/**
 * The promo block in the product form is closed by default, and a closed block must still say
 * what it holds — otherwise a merchant editing a product with a live promo sees a form that
 * looks like it has none.
 *
 * Pure, and reads the FORM DRAFT (strings, '' for empty), not a `products` row: the summary has
 * to follow what the merchant is typing, not what was last saved.
 */

export interface PromoDraft {
  /** '' is no promo. '0' is a real one — a free item. */
  promo_price: string
  promo_limit: string
  /** 'YYYY-MM-DD', or '' for no end date. */
  promo_end: string
}

interface SummaryFormat {
  money: (amount: number) => string
  date: (isoDate: string) => string
  t: (en: string, zh: string) => string
}

/**
 * Does this draft describe a promo?
 *
 * The price alone decides, and the test is against '' rather than falsiness: `promo_price: 0` is
 * a free item, which is a promo. A cap or an end date without a price is not one — the storefront
 * charges the normal price — so neither can open the block on its own.
 */
export const hasPromo = (d: PromoDraft): boolean => d.promo_price !== ''

/**
 * The segments of the one-line summary, for the caller to join. A segment whose number is not
 * finite is dropped rather than shown: a price the merchant is half-way through typing would
 * otherwise read as `RM NaN` on every keystroke.
 */
export function promoSummaryParts(d: PromoDraft, fmt: SummaryFormat): string[] {
  if (!hasPromo(d)) return []
  const parts: string[] = []

  const price = Number(d.promo_price)
  if (Number.isFinite(price)) parts.push(fmt.money(price))

  const limit = Number(d.promo_limit)
  if (d.promo_limit !== '' && Number.isFinite(limit)) {
    parts.push(fmt.t(`${limit} units`, `${limit} 件`))
  }

  if (d.promo_end) {
    const shown = fmt.date(d.promo_end)
    parts.push(fmt.t(`until ${shown}`, `至 ${shown}`))
  }

  return parts
}
