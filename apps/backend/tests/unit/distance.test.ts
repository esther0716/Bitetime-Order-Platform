// The known-miss lookup-and-cache policy, tested with a fake adapter — exactly the shape
// tests/unit/notify.test.ts uses for the Telegram send. NO NETWORK IN ANY TEST HERE. The cache
// PEEK (and its TTL boundary) is not here — it moved to routedDistance.ts and is tested in
// tests/unit/routedDistance.test.ts. What is left is: reaching the provider (which is money, not
// an internal detail) and what gets written back.
import { describe, it, expect } from 'vitest'
import { lookupAndCache, CACHE_TTL_MS, type DistanceDeps } from '../../src/distance.js'
import type { RouteOutcome } from '../../src/maps.js'

const PAIR = { originPlaceId: 'ChIJorigin', destinationPlaceId: 'ChIJdest' }

/** A fake router with the two things worth asserting: was the provider reached, and what got
 *  written back. `readCache` is never touched — `lookupAndCache` assumes a miss and does not peek. */
function tracked(over: { route?: RouteOutcome }) {
  let calls = 0
  const written: number[] = []
  const deps: DistanceDeps = {
    readCache: async () => { throw new Error('lookupAndCache must not peek') },
    writeCache: async (_o, _d, metres) => { written.push(metres) },
    lookup: async () => { calls++; return over.route ?? { status: 'failed' } },
  }
  return { deps, calls: () => calls, written }
}

describe('lookupAndCache', () => {
  it('caches for exactly 30 days — Google\'s terms, not a tuning knob', () => {
    // The one contractual literal; the peek that enforces it against this value is tested in
    // routedDistance.test.ts, whose fixtures derive from CACHE_TTL_MS and so move with it.
    expect(CACHE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('calls the provider exactly once and writes the answer back', async () => {
    const t = tracked({ route: { status: 'ok', metres: 25216 } })
    expect(await lookupAndCache(t.deps, PAIR)).toEqual({ status: 'ok', metres: 25216 })
    expect(t.calls()).toBe(1)
    expect(t.written).toEqual([25216])
  })

  it('reports no_route and lookup failure as DISTINCT outcomes, and caches neither', async () => {
    const noRoute = tracked({ route: { status: 'no_route' } })
    expect(await lookupAndCache(noRoute.deps, PAIR)).toEqual({ status: 'no_route' })
    expect(noRoute.written).toEqual([])

    const failed = tracked({ route: { status: 'failed' } })
    expect(await lookupAndCache(failed.deps, PAIR)).toEqual({ status: 'failed' })
    expect(failed.written).toEqual([])
  })

  it('fails rather than routing when either place id is missing', async () => {
    const t = tracked({ route: { status: 'ok', metres: 1 } })
    expect(await lookupAndCache(t.deps, { originPlaceId: '', destinationPlaceId: 'x' })).toEqual({ status: 'failed' })
    expect(await lookupAndCache(t.deps, { originPlaceId: 'x', destinationPlaceId: '' })).toEqual({ status: 'failed' })
    expect(t.calls()).toBe(0)
  })

  it('still returns the distance when writing the cache throws', async () => {
    // A cache that cannot be written is a cost problem, not a customer problem.
    let calls = 0
    const deps: DistanceDeps = {
      readCache: async () => null,
      writeCache: async () => { throw new Error('disk on fire') },
      lookup: async () => { calls++; return { status: 'ok', metres: 500 } },
    }
    expect(await lookupAndCache(deps, PAIR)).toEqual({ status: 'ok', metres: 500 })
    expect(calls).toBe(1)
  })
})
