import { describe, it, expect } from 'vitest'
import { hasPromo, promoSummaryParts } from './promoSummary'

const t = (en: string) => en
const fmt = {
  money: (n: number) => `RM ${n.toFixed(2)}`,
  date: (iso: string) => iso,
  t,
}

describe('hasPromo', () => {
  it('reads an empty promo price as no promo', () => {
    expect(hasPromo({ promo_price: '', promo_limit: '', promo_end: '' })).toBe(false)
  })

  it('reads a zero promo price as a real promo — a free item is a promo', () => {
    expect(hasPromo({ promo_price: '0', promo_limit: '', promo_end: '' })).toBe(true)
  })

  it('reads a price as a promo', () => {
    expect(hasPromo({ promo_price: '9.9', promo_limit: '', promo_end: '' })).toBe(true)
  })

  // A limit or an end date without a price is not a promo. The merchant typed a cap and no
  // price; `promoFields` writes the cap, and the storefront charges the normal price.
  it('needs a price — a limit alone is not a promo', () => {
    expect(hasPromo({ promo_price: '', promo_limit: '20', promo_end: '' })).toBe(false)
  })
})

describe('promoSummaryParts', () => {
  it('says nothing when there is no promo', () => {
    expect(promoSummaryParts({ promo_price: '', promo_limit: '20', promo_end: '2026-08-31' }, fmt))
      .toEqual([])
  })

  it('quotes the price alone when there is no cap and no end date', () => {
    expect(promoSummaryParts({ promo_price: '9.9', promo_limit: '', promo_end: '' }, fmt))
      .toEqual(['RM 9.90'])
  })

  it('adds the cap and the end date when they are set', () => {
    expect(promoSummaryParts({ promo_price: '9.9', promo_limit: '20', promo_end: '2026-08-31' }, fmt))
      .toEqual(['RM 9.90', '20 units', 'until 2026-08-31'])
  })

  // A price the merchant is mid-way through typing must not read as `RM NaN`.
  it('drops a price that is not a number yet', () => {
    expect(promoSummaryParts({ promo_price: '-', promo_limit: '20', promo_end: '' }, fmt))
      .toEqual(['20 units'])
  })

  it('drops a cap that is not a number yet', () => {
    expect(promoSummaryParts({ promo_price: '9.9', promo_limit: 'x', promo_end: '' }, fmt))
      .toEqual(['RM 9.90'])
  })
})
