import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pixelPageView, pixelTrack } from './track'

const META = '123456789012345'
const TIKTOK = 'CQ1234567890ABCDEFGH'
const BOTH = { meta: META, tiktok: TIKTOK }

let fbqCalls: unknown[][]
// Per instance id, so the "one shop's event must not reach another shop's pixel" rule below has
// something to assert against rather than a single shared counter.
let ttqPage: Record<string, number>
let ttqTrack: Record<string, unknown[][]>

function stubTtq(ids: string[]) {
  ttqPage = {}
  ttqTrack = {}
  for (const id of ids) { ttqPage[id] = 0; ttqTrack[id] = [] }
  ;(globalThis as any).ttq = {
    instance: (id: string) => ids.includes(id)
      ? {
          page: () => { ttqPage[id] += 1 },
          track: (...args: unknown[]) => { ttqTrack[id].push(args) },
        }
      : undefined,
  }
}

beforeEach(() => {
  fbqCalls = []
  ;(globalThis as any).fbq = (...args: unknown[]) => { fbqCalls.push(args) }
  stubTtq([META, TIKTOK])
})
afterEach(() => {
  delete (globalThis as any).fbq
  delete (globalThis as any).ttq
})

describe('pixelPageView', () => {
  it('tells both vendors a page was viewed, each on its own pixel', () => {
    pixelPageView(BOTH)
    expect(fbqCalls).toEqual([['trackSingle', META, 'PageView']])
    expect(ttqPage[TIKTOK]).toBe(1)
  })

  it('says nothing to a vendor with no id', () => {
    pixelPageView({ meta: META })
    expect(fbqCalls).toEqual([['trackSingle', META, 'PageView']])
    expect(ttqPage[TIKTOK]).toBe(0)
  })
})

describe('pixelTrack', () => {
  it('reports a named event to each given pixel', () => {
    pixelTrack(BOTH, 'AddToCart')
    expect(fbqCalls).toEqual([['trackSingle', META, 'AddToCart']])
    expect(ttqTrack[TIKTOK]).toEqual([['AddToCart', undefined]])
  })

  it('carries the sale value and currency, and nothing else', () => {
    pixelTrack(BOTH, 'Purchase', { value: 42.5, currency: 'MYR' })
    expect(fbqCalls).toEqual([['trackSingle', META, 'Purchase', { value: 42.5, currency: 'MYR' }]])
    expect(ttqTrack[TIKTOK]).toEqual([['CompletePayment', { value: 42.5, currency: 'MYR' }]])
  })

  // TikTok has no `Purchase`. Sent one, it records an unrecognised custom event that no campaign
  // optimizes on — the whole feature failing in silence.
  it('sends TikTok its own name for the sale', () => {
    pixelTrack({ tiktok: TIKTOK }, 'Purchase', { value: 1, currency: 'MYR' })
    expect(ttqTrack[TIKTOK][0][0]).toBe('CompletePayment')
  })

  it('sends no payload for an event that has no value', () => {
    pixelTrack({ meta: META }, 'CompleteRegistration')
    expect(fbqCalls[0]).toHaveLength(3)
  })

  // The rule this file is built around. Meta's queue is global, so an unscoped `fbq('track', …)`
  // reports to EVERY inited pixel — which, once a customer has opened two storefronts in one SPA
  // session, sends one shop's order to another shop's ad account.
  it('scopes every call to the id it was given', () => {
    const other = '999999999999999'
    pixelTrack({ meta: other }, 'Purchase', { value: 9, currency: 'MYR' })
    expect(fbqCalls).toEqual([['trackSingle', other, 'Purchase', { value: 9, currency: 'MYR' }]])
    expect(fbqCalls[0]).not.toContain(META)
  })
})

describe('when the vendors are not there', () => {
  it('does nothing before the snippets have loaded', () => {
    delete (globalThis as any).fbq
    delete (globalThis as any).ttq
    expect(() => pixelPageView(BOTH)).not.toThrow()
    expect(() => pixelTrack(BOTH, 'Purchase', { value: 1, currency: 'MYR' })).not.toThrow()
  })

  it('survives a vendor that throws, which an ad blocker can produce', () => {
    ;(globalThis as any).fbq = () => { throw new Error('blocked') }
    ;(globalThis as any).ttq = { instance: () => { throw new Error('blocked') } }
    expect(() => pixelPageView(BOTH)).not.toThrow()
    expect(() => pixelTrack(BOTH, 'AddToCart')).not.toThrow()
  })

  it('ignores a global that is not the shape it expects', () => {
    ;(globalThis as any).fbq = 'not a function'
    ;(globalThis as any).ttq = { instance: 'not a function' }
    expect(() => pixelPageView(BOTH)).not.toThrow()
  })

  it('ignores an instance the vendor does not know about', () => {
    stubTtq([])
    expect(() => pixelPageView(BOTH)).not.toThrow()
  })

  it('still reaches the vendor that IS there when the other is missing', () => {
    delete (globalThis as any).ttq
    pixelPageView(BOTH)
    expect(fbqCalls).toEqual([['trackSingle', META, 'PageView']])
  })
})
