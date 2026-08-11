import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pixelPageView, pixelTrack } from './track'

let fbqCalls: unknown[][]
let ttqPageCalls: number
let ttqTrackCalls: unknown[][]

beforeEach(() => {
  fbqCalls = []
  ttqPageCalls = 0
  ttqTrackCalls = []
  ;(globalThis as any).fbq = (...args: unknown[]) => { fbqCalls.push(args) }
  ;(globalThis as any).ttq = {
    page: () => { ttqPageCalls += 1 },
    track: (...args: unknown[]) => { ttqTrackCalls.push(args) },
  }
})
afterEach(() => {
  delete (globalThis as any).fbq
  delete (globalThis as any).ttq
})

describe('pixelPageView', () => {
  it('tells both vendors a page was viewed', () => {
    pixelPageView()
    expect(fbqCalls).toEqual([['track', 'PageView']])
    expect(ttqPageCalls).toBe(1)
  })
})

describe('pixelTrack', () => {
  it('reports a named event to both vendors', () => {
    pixelTrack('CompleteRegistration')
    expect(fbqCalls).toEqual([['track', 'CompleteRegistration']])
    expect(ttqTrackCalls).toEqual([['CompleteRegistration']])
  })

  it('sends the event name and nothing else — there is no payload to carry personal data', () => {
    pixelTrack('CompleteRegistration')
    expect(fbqCalls[0]).toHaveLength(2)
    expect(ttqTrackCalls[0]).toHaveLength(1)
  })
})

describe('when the vendors are not there', () => {
  it('does nothing before the snippets have loaded', () => {
    delete (globalThis as any).fbq
    delete (globalThis as any).ttq
    expect(() => pixelPageView()).not.toThrow()
    expect(() => pixelTrack('CompleteRegistration')).not.toThrow()
  })

  it('survives a vendor that throws, which an ad blocker can produce', () => {
    ;(globalThis as any).fbq = () => { throw new Error('blocked') }
    ;(globalThis as any).ttq = {
      page: () => { throw new Error('blocked') },
      track: () => { throw new Error('blocked') },
    }
    expect(() => pixelPageView()).not.toThrow()
    expect(() => pixelTrack('CompleteRegistration')).not.toThrow()
  })

  it('ignores a global that is not the shape it expects', () => {
    ;(globalThis as any).fbq = 'not a function'
    ;(globalThis as any).ttq = { page: 'not a function' }
    expect(() => pixelPageView()).not.toThrow()
  })

  it('still reaches the vendor that IS there when the other is missing', () => {
    delete (globalThis as any).ttq
    pixelPageView()
    expect(fbqCalls).toEqual([['track', 'PageView']])
  })
})
