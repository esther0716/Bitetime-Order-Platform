import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PraxorClient } from 'praxor'
import { setAnalyticsClient, trackEvent } from './events'

function fakeClient(track: PraxorClient['track']): PraxorClient {
  return {
    track,
    trackPageview: async () => {},
    getVisitorId: () => null,
    destroy: () => {},
  }
}

beforeEach(() => { setAnalyticsClient(null) })

describe('trackEvent', () => {
  it('does nothing at all when Praxor is not configured', () => {
    // No client set. The whole feature is off in dev, in CI and in Vitest, with no stubbing.
    expect(() => trackEvent('merchant_login')).not.toThrow()
  })

  it('sends the event name and its properties to the client', () => {
    const track = vi.fn()
    setAnalyticsClient(fakeClient(track))
    trackEvent('merchant_signup', { billing: 'yearly' })
    expect(track).toHaveBeenCalledWith('merchant_signup', { billing: 'yearly' })
  })

  it('sends an event that carries no properties', () => {
    const track = vi.fn()
    setAnalyticsClient(fakeClient(track))
    trackEvent('trial_started')
    expect(track).toHaveBeenCalledWith('trial_started', undefined)
  })

  // These fire from click handlers and from a submit handler. A throw there trades a missing
  // measurement for a broken checkout, which is the wrong trade. Same argument as pixels/track.ts.
  it('swallows a client that throws, because it is called from click handlers', () => {
    setAnalyticsClient(fakeClient(() => { throw new Error('ad blocker') }))
    expect(() => trackEvent('cta_click', { from: '/', cta: 'hero' })).not.toThrow()
  })

  // Checked by `tsc --noEmit`, which reads this file: an @ts-expect-error that stops being an
  // error fails the typecheck. This is the whole point of the rest-tuple signature — properties
  // are required where the event has them, and rejected where it does not.
  it('requires the properties an event declares, and refuses the ones it does not', () => {
    const track = vi.fn()
    setAnalyticsClient(fakeClient(track))
    // @ts-expect-error merchant_signup declares { billing } and cannot be sent without it
    trackEvent('merchant_signup')
    // @ts-expect-error trial_started carries no properties
    trackEvent('trial_started', { billing: 'yearly' })
    // @ts-expect-error 'quarterly' is not a billing cycle
    trackEvent('merchant_signup', { billing: 'quarterly' })
    // @ts-expect-error the event name is a union, not a string
    trackEvent('shop_created')
    expect(track).toHaveBeenCalledTimes(4)
  })

  it('stops sending once the client is cleared', () => {
    const track = vi.fn()
    setAnalyticsClient(fakeClient(track))
    setAnalyticsClient(null)
    trackEvent('merchant_login')
    expect(track).not.toHaveBeenCalled()
  })
})
