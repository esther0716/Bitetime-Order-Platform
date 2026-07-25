// The one owner of the quote-and-charge sequence: peek the cache, and only on a miss run the
// caller's guard, spend a slot of the shop's daily ceiling, ask the provider, and map the answer
// (including beyond-max-km) to a wire-agnostic outcome. Both `/api/shipping/quote` and order
// intake go through this, which is what stops the number quoted and the number charged from
// drifting apart. NO NETWORK, NO DATABASE — every dependency is injected.
import { describe, it, expect } from 'vitest'
import { resolveRoutedDistance, type RoutedOutcome } from '../../src/routedDistance.js'
import { CACHE_TTL_MS, type DistanceDeps } from '../../src/distance.js'
import type { RouteOutcome } from '../../src/maps.js'
import type { SlidingWindow } from '../../src/rateLimit.js'
import type { ShopDistance } from '@bitetime/shared'

const NOW = new Date('2026-07-22T10:00:00Z')
const DEST = 'ChIJdest'

// A usable distance policy: origin present, rate sane, a 30 km cap.
const POLICY: ShopDistance = {
  enabled: true,
  base: 6,
  ratePerKm: 1,
  maxKm: 30,
  originPlaceId: 'ChIJorigin',
  usable: true,
}

/** A fake cache + router with the two things worth asserting: was the provider reached (money),
 *  and what got written back. */
function tracked(over: { cached?: number | null; cachedAt?: Date; route?: RouteOutcome; readThrows?: boolean }) {
  let calls = 0
  const written: number[] = []
  const deps: DistanceDeps = {
    readCache: async (_o, _d, notBefore) => {
      if (over.readThrows) throw new Error('connection reset')
      if (over.cached == null) return null
      return (over.cachedAt ?? NOW) >= notBefore ? over.cached : null
    },
    writeCache: async (_o, _d, metres) => { written.push(metres) },
    lookup: async () => { calls++; return over.route ?? { status: 'failed' } },
  }
  return { deps, calls: () => calls, written }
}

/** A window whose verdict is fixed, recording every key it was asked about. */
function fakeWindow(verdict: boolean): SlidingWindow & { keys: string[] } {
  const keys: string[] = []
  return { keys, allow: (key: string) => { keys.push(key); return verdict }, size: () => keys.length }
}

const opts = (over: Partial<Parameters<typeof resolveRoutedDistance>[4]> = {}) => ({
  merchantKey: 'shop-1',
  merchantWindow: fakeWindow(true),
  ...over,
})

describe('resolveRoutedDistance', () => {
  it('returns the cached distance, never reaching the provider or the ceiling', async () => {
    const t = tracked({ cached: 25216 })
    const window = fakeWindow(true)
    const out = await resolveRoutedDistance(POLICY, DEST, t.deps, NOW, opts({ merchantWindow: window }))
    expect(out).toEqual({ status: 'ok', metres: 25216 })
    expect(t.calls()).toBe(0)
    expect(window.keys).toEqual([]) // a hit costs nothing and must not eat a slot
  })

  it('refuses a CACHED distance beyond the cap — a shortened range must not honour stale rows', async () => {
    // A hit costs nothing, but the max-km cap still applies: 30 060 m → 30.1 km, beyond 30 km.
    const t = tracked({ cached: 30060 })
    const window = fakeWindow(true)
    const out = await resolveRoutedDistance(POLICY, DEST, t.deps, NOW, opts({ merchantWindow: window }))
    expect(out).toEqual({ status: 'out_of_range' })
    expect(t.calls()).toBe(0)       // still a hit — provider untouched
    expect(window.keys).toEqual([]) // and unmetered
  })

  it('treats a row older than the 30-day TTL as a miss', async () => {
    const stale = new Date(NOW.getTime() - CACHE_TTL_MS - 1)
    const t = tracked({ cached: 111, cachedAt: stale, route: { status: 'ok', metres: 222 } })
    const out = await resolveRoutedDistance(POLICY, DEST, t.deps, NOW, opts())
    expect(out).toEqual({ status: 'ok', metres: 222 })
    expect(t.calls()).toBe(1)
  })

  it('keeps a row one millisecond inside the TTL', async () => {
    const fresh = new Date(NOW.getTime() - CACHE_TTL_MS + 1)
    const t = tracked({ cached: 111, cachedAt: fresh })
    const out = await resolveRoutedDistance(POLICY, DEST, t.deps, NOW, opts())
    expect(out).toEqual({ status: 'ok', metres: 111 })
    expect(t.calls()).toBe(0)
  })

  it('degrades a throwing cache read to a MISS rather than a 500', async () => {
    const t = tracked({ readThrows: true, route: { status: 'ok', metres: 700 } })
    const out = await resolveRoutedDistance(POLICY, DEST, t.deps, NOW, opts())
    expect(out).toEqual({ status: 'ok', metres: 700 })
    expect(t.calls()).toBe(1)
  })

  it('runs the caller guard on a miss, BEFORE spending the ceiling or the provider', async () => {
    const t = tracked({ cached: null, route: { status: 'ok', metres: 500 } })
    const window = fakeWindow(true)
    const order: string[] = []
    await resolveRoutedDistance(POLICY, DEST, t.deps, NOW, opts({
      merchantWindow: window,
      onMiss: () => { order.push('onMiss') },
    }))
    // onMiss precedes the metering decision, which precedes the provider call.
    expect(order).toEqual(['onMiss'])
    expect(window.keys).toEqual(['shop-1'])
    expect(t.calls()).toBe(1)
  })

  it('lets the caller guard abort the miss before any spend', async () => {
    const t = tracked({ cached: null, route: { status: 'ok', metres: 500 } })
    const window = fakeWindow(true)
    await expect(resolveRoutedDistance(POLICY, DEST, t.deps, NOW, opts({
      merchantWindow: window,
      onMiss: () => { throw new Error('rate limited') },
    }))).rejects.toThrow('rate limited')
    expect(window.keys).toEqual([]) // never metered
    expect(t.calls()).toBe(0)       // never called the provider
  })

  it('never runs the guard on a cache hit', async () => {
    const t = tracked({ cached: 25216 })
    let ran = false
    await resolveRoutedDistance(POLICY, DEST, t.deps, NOW, opts({ onMiss: () => { ran = true } }))
    expect(ran).toBe(false)
  })

  it('refuses with quota_exceeded when the ceiling is spent, without calling the provider', async () => {
    const t = tracked({ cached: null, route: { status: 'ok', metres: 500 } })
    const out = await resolveRoutedDistance(POLICY, DEST, t.deps, NOW, opts({ merchantWindow: fakeWindow(false) }))
    expect(out).toEqual({ status: 'quota_exceeded' })
    expect(t.calls()).toBe(0)
  })

  it('maps no_route to out_of_range', async () => {
    const t = tracked({ cached: null, route: { status: 'no_route' } })
    const out = await resolveRoutedDistance(POLICY, DEST, t.deps, NOW, opts())
    expect(out).toEqual({ status: 'out_of_range' })
  })

  it('maps a beyond-max-km distance to out_of_range — same refusal as no route', async () => {
    // 30 001 m → 30.0 km after routedKm? No: 30001/1000 = 30.001 → toFixed(1) = 30.0, still within.
    // 30 060 m → 30.1 km, beyond the 30 km cap.
    const t = tracked({ cached: null, route: { status: 'ok', metres: 30060 } })
    const out = await resolveRoutedDistance(POLICY, DEST, t.deps, NOW, opts())
    expect(out).toEqual({ status: 'out_of_range' })
  })

  it('returns ok at exactly the cap', async () => {
    const t = tracked({ cached: null, route: { status: 'ok', metres: 30000 } })
    const out = await resolveRoutedDistance(POLICY, DEST, t.deps, NOW, opts())
    expect(out).toEqual({ status: 'ok', metres: 30000 })
  })

  it('passes a provider failure through as failed', async () => {
    const t = tracked({ cached: null, route: { status: 'failed' } })
    const out = await resolveRoutedDistance(POLICY, DEST, t.deps, NOW, opts())
    expect(out).toEqual({ status: 'failed' })
  })

  it('applies no cap when the shop has none', async () => {
    const uncapped: ShopDistance = { ...POLICY, maxKm: null }
    const t = tracked({ cached: null, route: { status: 'ok', metres: 999999 } })
    const out = await resolveRoutedDistance(uncapped, DEST, t.deps, NOW, opts())
    expect(out).toEqual({ status: 'ok', metres: 999999 })
  })

  it('has an exhaustive outcome set', () => {
    // A REAL compile-time guard: a Record keyed on the status union fails to type-check until
    // every member has an entry, so adding an outcome forces this test (and the reader) to
    // acknowledge it. An array literal would silently accept a stale set.
    const handled: Record<RoutedOutcome['status'], true> = {
      ok: true, out_of_range: true, quota_exceeded: true, failed: true,
    }
    expect(Object.keys(handled)).toHaveLength(4)
  })
})
