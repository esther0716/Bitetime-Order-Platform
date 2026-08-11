// Platform subscription pricing. One plan, and everyone is charged in MYR, so there is one Stripe
// Price per billing cycle — amounts are read from the actual Stripe Prices so the displayed price
// can never drift from what is charged. Pure and dependency-injected.

const CYCLES = ['monthly', 'yearly'] as const
type Cycle = (typeof CYCLES)[number]

/** Cycle → Stripe Price ID (MYR). A missing/empty id is "not configured". */
export type Prices = Record<string, string>

export interface PricingPayload {
  currency: string
  /**
   * Kept keyed under `pro` rather than flattened. The wire shape survives the tier's removal, so
   * a page reading `prices.pro.monthly` did not have to change, and a second plan — if there is
   * ever one again — is a new key rather than a new envelope.
   */
  prices: { pro: Record<Cycle, number> }
}

/** Look up the Stripe Price ID for a cycle. Throws if absent. */
export function priceId(prices: Prices, cycle: string): string {
  const id = prices[cycle]
  if (!id) throw new Error(`No price configured for ${cycle}`)
  return id
}

/**
 * The inverse of `priceId`: which cycle is this subscription actually paying on?
 *
 * Reading it back off the configured map means no Stripe-side setup can drift — no lookup keys to
 * forget on a price, no product metadata to keep in step. Both ids are already `required()` at
 * boot (see env.ts), so if this returns null the price genuinely is not one of ours.
 *
 * **Null means "change nothing"**, and every caller must honour that. A price made by hand in the
 * dashboard, a legacy price, a currency variant — guessing a cycle from one of those writes a
 * wrong renewal date onto a real shop. A stale column is the cheaper failure.
 */
export function cycleFromPriceId(prices: Prices, id: string): { cycle: Cycle } | null {
  if (!id) return null
  for (const cycle of CYCLES) {
    // Not `priceId()` — an unconfigured slot must be skipped, not thrown on. This function
    // answers a question about a price we did not choose, so a half-configured env is a
    // no-match, not an error.
    if (prices[cycle] === id) return { cycle }
  }
  return null
}

/**
 * Build the pricing payload: read each cycle's amount from Stripe (`unit_amount` is minor units,
 * converted to major) and stamp the MYR currency.
 */
export async function fetchBasePricing(deps: {
  prices: Prices
  retrievePrice: (id: string) => Promise<{ unit_amount: number | null; currency: string }>
}): Promise<PricingPayload> {
  const amountOf = async (cycle: Cycle) => {
    const price = await deps.retrievePrice(priceId(deps.prices, cycle))
    if (price.currency.toLowerCase() !== 'myr') {
      throw new Error(`Price for ${cycle} is ${price.currency.toUpperCase()}, expected MYR`)
    }
    return (price.unit_amount ?? 0) / 100
  }

  const pro = {} as Record<Cycle, number>
  for (const cycle of CYCLES) {
    pro[cycle] = await amountOf(cycle)
  }

  return { currency: 'MYR', prices: { pro } }
}

/**
 * Tiny per-key TTL cache so landing-page traffic does not hit Stripe on every
 * view. Clock is injected for deterministic tests.
 */
export function createPricingCache<T>({ ttlMs, now }: { ttlMs: number; now: () => number }) {
  const store = new Map<string, { at: number; value: T }>()
  return {
    async get(key: string, loader: () => Promise<T>): Promise<T> {
      const hit = store.get(key)
      if (hit && now() - hit.at < ttlMs) return hit.value
      const value = await loader()
      store.set(key, { at: now(), value })
      return value
    },
  }
}
