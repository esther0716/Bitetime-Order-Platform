import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PraxorClient } from 'praxor'
import { setAnalyticsClient, trackEvent, trackPageview, toBilling } from './events'

function fakeClient(
  track: PraxorClient['track'],
  pageview: PraxorClient['trackPageview'] = async () => {},
): PraxorClient {
  return {
    track,
    trackPageview: pageview,
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

  it('sends which onboarding step a shop just completed', () => {
    const track = vi.fn()
    setAnalyticsClient(fakeClient(track))
    trackEvent('onboarding_step', { step: 'product' })
    expect(track).toHaveBeenCalledWith('onboarding_step', { step: 'product' })
  })

  // The three step names come from onboardingSteps.ts, so the checklist and the measurement of it
  // cannot drift into naming the same step two different things.
  it('accepts each of the three onboarding steps and nothing else', () => {
    const track = vi.fn()
    setAnalyticsClient(fakeClient(track))
    trackEvent('onboarding_step', { step: 'product' })
    trackEvent('onboarding_step', { step: 'shipping' })
    trackEvent('onboarding_step', { step: 'link' })
    // @ts-expect-error there is no fourth onboarding step
    trackEvent('onboarding_step', { step: 'payment' })
    // @ts-expect-error the step is required; the event says nothing without it
    trackEvent('onboarding_step')
    expect(track).toHaveBeenCalledTimes(5)
  })

  it('stops sending once the client is cleared', () => {
    const track = vi.fn()
    setAnalyticsClient(fakeClient(track))
    setAnalyticsClient(null)
    trackEvent('merchant_login')
    expect(track).not.toHaveBeenCalled()
  })
})

describe('trackPageview', () => {
  it('does nothing when Praxor is not configured', () => {
    expect(() => trackPageview('/pricing')).not.toThrow()
  })

  it('sends the path it was given, rather than leaving the SDK to read the URL', () => {
    const pageview = vi.fn(async () => {})
    setAnalyticsClient(fakeClient(vi.fn(), pageview))
    trackPageview('/pricing')
    expect(pageview).toHaveBeenCalledWith('/pricing')
  })

  it('swallows a synchronous throw, so a route effect cannot die inside it', () => {
    setAnalyticsClient(fakeClient(vi.fn(), () => { throw new Error('blocked') }))
    expect(() => trackPageview('/pricing')).not.toThrow()
  })

  // The other half, and a different failure: trackPageview returns a promise, so a rejection is
  // not caught by the try. Unhandled, it surfaces as an unhandledrejection in the visitor's
  // console for a pageview nobody was waiting on.
  it('swallows a rejection', async () => {
    setAnalyticsClient(fakeClient(vi.fn(), async () => { throw new Error('offline') }))
    trackPageview('/pricing')
    await new Promise(resolve => setTimeout(resolve, 0))
  })
})

describe('toBilling', () => {
  it('keeps the two cycles the app reports', () => {
    expect(toBilling('yearly')).toBe('yearly')
    expect(toBilling('monthly')).toBe('monthly')
  })

  // The four call sites hand this a bare `string` off a route param, a Stripe cancel_url or the
  // auth user's metadata. Anything unrecognised is the backend's own default.
  it('reads anything else as monthly, the backend’s default', () => {
    expect(toBilling('')).toBe('monthly')
    expect(toBilling('quarterly')).toBe('monthly')
    expect(toBilling('YEARLY')).toBe('monthly')
  })
})
