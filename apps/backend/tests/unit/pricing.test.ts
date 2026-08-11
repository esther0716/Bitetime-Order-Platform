import { describe, it, expect, vi } from 'vitest'
import { priceId, cycleFromPriceId, fetchBasePricing, createPricingCache } from '../../src/pricing.js'

const PRICES = { monthly: 'p_m', yearly: 'p_y' }

describe('priceId', () => {
  it('resolves the configured price id', () => {
    expect(priceId(PRICES, 'monthly')).toBe('p_m')
    expect(priceId(PRICES, 'yearly')).toBe('p_y')
  })

  it('throws when a price is not configured', () => {
    expect(() => priceId({ ...PRICES, yearly: '' }, 'yearly')).toThrow(/yearly/)
  })
})

// The inverse of priceId. This is how the webhook learns which cycle a shop is actually paying
// on: `merchants.billing_cycle` stops being the signup body's claim and becomes whatever price is
// on the live subscription.
describe('cycleFromPriceId', () => {
  it('resolves every configured price back to its cycle', () => {
    expect(cycleFromPriceId(PRICES, 'p_m')).toEqual({ cycle: 'monthly' })
    expect(cycleFromPriceId(PRICES, 'p_y')).toEqual({ cycle: 'yearly' })
  })

  // Load-bearing: an unrecognised price must change NOTHING. A price made by hand in the
  // dashboard, a legacy price, a currency variant — guessing here writes a wrong renewal date
  // onto a real shop, and a stale column is the cheaper failure.
  it('returns null for a price it does not recognise, rather than guessing', () => {
    expect(cycleFromPriceId(PRICES, 'price_made_by_hand')).toBeNull()
    expect(cycleFromPriceId(PRICES, '')).toBeNull()
  })

  // An unconfigured slot is an empty string in `Prices`; it must never match an empty/absent id
  // and hand back a cycle nobody bought.
  it('never matches an empty configured slot', () => {
    expect(cycleFromPriceId({ ...PRICES, yearly: '' }, '')).toBeNull()
  })

  it('ignores keys that are not a cycle', () => {
    expect(cycleFromPriceId({ ...PRICES, legacy_thing: 'p_x' }, 'p_x')).toBeNull()
  })
})

const AMOUNTS: Record<string, number> = { p_m: 3990, p_y: 39900 }
const retrievePrice = async (id: string) => ({ unit_amount: AMOUNTS[id], currency: 'myr' })

describe('fetchBasePricing', () => {
  it('returns MYR currency and major-unit amounts read from Stripe', async () => {
    const payload = await fetchBasePricing({ prices: PRICES, retrievePrice })
    expect(payload).toEqual({
      currency: 'MYR',
      prices: { pro: { monthly: 39.9, yearly: 399 } },
    })
  })

  it('rejects when a retrieved Stripe Price is not MYR', async () => {
    const usdRetrieve = async (id: string) => ({
      unit_amount: AMOUNTS[id],
      currency: id === 'p_m' ? 'usd' : 'myr',
    })
    await expect(fetchBasePricing({ prices: PRICES, retrievePrice: usdRetrieve })).rejects.toThrow(
      /monthly is USD, expected MYR/,
    )
  })
})

describe('createPricingCache', () => {
  it('caches within the TTL and reloads after it', async () => {
    let t = 0
    const cache = createPricingCache<number>({ ttlMs: 100, now: () => t })
    const loader = vi.fn(async () => 42)
    expect(await cache.get('k', loader)).toBe(42)
    t = 50
    expect(await cache.get('k', loader)).toBe(42)
    expect(loader).toHaveBeenCalledTimes(1)
    t = 200
    await cache.get('k', loader)
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
