// The ONE owner of the routed-distance sequence, shared by the delivery QUOTE
// (`POST /api/shipping/quote`) and the delivery CHARGE (order intake's cache-miss path). Both ran
// this same five-step rule from a hand-maintained copy; a change to the TTL, to what counts as a
// billable call, or to the quota key applied to one and not the other desynced the number the
// customer is quoted from the number they are charged — surfacing as a `price_changed` refusal on
// every distance order at that shop. Now there is one place to change it. See ADR 0001; issue #119.
//
// It peeks the cache ONCE — the peek that used to live in `resolveDistance` AND be duplicated in
// each caller — and that single peek is what decides whether the lookup should cost the shop a
// slot of its daily ceiling. A cache hit costs nothing and must never meter.
//
// The outcome is wire-AGNOSTIC. Each caller maps it to its own refusal code, which is the only
// part that legitimately differs between quote and charge (they use different codes for the same
// facts by deliberate decision) — so that mapping stays OUT of here, with the caller.
import { lookupAndCache, CACHE_TTL_MS, type DistanceDeps } from './distance.js'
import { type ShopDistance, routedKm, exceedsMaxKm } from '@bitetime/shared'
import type { SlidingWindow } from './rateLimit.js'

export type RoutedOutcome =
  | { status: 'ok'; metres: number }
  // No route and beyond-the-maximum are ONE refusal: same fact to the customer — "this shop does
  // not deliver there".
  | { status: 'out_of_range' }
  // The shop's daily ceiling was spent; the provider was NOT called. Distinct from `failed`
  // because the quote endpoint reports it with its own code (`quota_exceeded`), separate from a
  // provider failure.
  | { status: 'quota_exceeded' }
  // Our problem, and the only outcome worth a retry.
  | { status: 'failed' }

/**
 * Resolve the routed distance for an order or a quote, metering the provider call on a cache miss.
 *
 * The caller has ALREADY proven the shop offers distance pricing (`policy.usable`) and supplied a
 * non-empty destination — those gates, the merchant fetch and the mapping of the outcome to a wire
 * refusal are the caller's, deliberately kept out of this module.
 *
 * @param policy   the shop's distance policy (origin, rate, max km) — assumed usable.
 * @param destinationPlaceId  the delivery destination — assumed non-empty.
 * @param deps     the injected cache + provider adapters.
 * @param now      the clock the TTL is measured against (the transaction's clock on intake).
 * @param opts.merchantKey     the canonical merchant id the daily ceiling is keyed on.
 * @param opts.merchantWindow  the per-shop daily provider-call ceiling, spent only on a miss.
 * @param opts.onMiss  a caller guard run on a miss BEFORE metering or the provider call; may throw
 *                     to abort (order intake uses it for its courtesy per-IP bound).
 */
export async function resolveRoutedDistance(
  policy: ShopDistance,
  destinationPlaceId: string,
  deps: DistanceDeps,
  now: Date,
  opts: { merchantKey: string; merchantWindow: SlidingWindow; onMiss?: () => void },
): Promise<RoutedOutcome> {
  const originPlaceId = policy.originPlaceId!

  // A cache read that throws degrades to a MISS, never a 500: the peek exists only to decide
  // whether this call costs the shop a slot, so a database blip just means it is metered like any
  // other miss.
  const notBefore = new Date(now.getTime() - CACHE_TTL_MS)
  let cached: number | null = null
  try {
    cached = await deps.readCache(originPlaceId, destinationPlaceId, notBefore)
  } catch (err) {
    console.error('Distance cache peek failed:', err instanceof Error ? err.message : String(err))
  }
  // A cache HIT costs nothing — no guard, no slot spent — but is STILL subject to the shop's max
  // km: a cached distance beyond the cap is refused exactly as a fresh one is, or a shop that
  // shortens its range keeps delivering to addresses cached under the old range for a month.
  if (cached !== null) return withinRange(policy, cached)

  // A miss. Run the caller's guard first (it may throw to refuse), then spend a slot, then pay.
  opts.onMiss?.()
  if (!opts.merchantWindow.allow(opts.merchantKey)) return { status: 'quota_exceeded' }

  const outcome = await lookupAndCache(deps, { originPlaceId, destinationPlaceId })
  if (outcome.status === 'no_route') return { status: 'out_of_range' }
  if (outcome.status === 'failed') return { status: 'failed' }
  return withinRange(policy, outcome.metres)
}

/** A real distance is `ok` unless it is beyond the shop's cap, which is the same refusal as no
 *  route. Applied to cached and freshly-routed distances alike. */
function withinRange(policy: ShopDistance, metres: number): RoutedOutcome {
  if (exceedsMaxKm(policy, routedKm(metres))) return { status: 'out_of_range' }
  return { status: 'ok', metres }
}
