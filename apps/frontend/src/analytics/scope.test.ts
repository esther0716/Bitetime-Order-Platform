import { describe, it, expect } from 'vitest'
import { isPlatformPath } from './scope'

describe('the platform’s own pages', () => {
  it('measures the marketing pages', () => {
    expect(isPlatformPath('/')).toBe(true)
    expect(isPlatformPath('/pricing')).toBe(true)
    expect(isPlatformPath('/features')).toBe(true)
    expect(isPlatformPath('/sample-shops')).toBe(true)
    expect(isPlatformPath('/for/bakery')).toBe(true)
  })

  it('measures the legal documents and the release notes', () => {
    expect(isPlatformPath('/terms')).toBe(true)
    expect(isPlatformPath('/privacy')).toBe(true)
    expect(isPlatformPath('/releases/v1.2.0')).toBe(true)
  })

  it('measures the merchant app, which is where the funnel continues', () => {
    expect(isPlatformPath('/merchant/signup')).toBe(true)
    expect(isPlatformPath('/merchant/signup/yearly')).toBe(true)
    expect(isPlatformPath('/merchant/login')).toBe(true)
    expect(isPlatformPath('/merchant')).toBe(true)
    expect(isPlatformPath('/admin/merchants')).toBe(true)
  })
})

describe('pages that belong to somebody else', () => {
  // The rule this file exists for. A storefront visitor is the MERCHANT's customer, not ours, and
  // the app is one SPA — a visitor reaches a storefront from /pricing with no document load, so
  // without this rule the SDK's global history patch would report that navigation too.
  it('measures no storefront, on any path under it', () => {
    expect(isPlatformPath('/s/kopi-corner')).toBe(false)
    expect(isPlatformPath('/s/kopi-corner/')).toBe(false)
    expect(isPlatformPath('/s/kopi-corner/track/TC-260812-0050')).toBe(false)
    expect(isPlatformPath('/s')).toBe(false)
  })

  it('measures no password reset, which is role-blind and reached by a shop’s customer', () => {
    expect(isPlatformPath('/reset-password')).toBe(false)
    expect(isPlatformPath('/reset-password?shop=kopi-corner')).toBe(false)
  })

  // `s` is a reserved platform segment (RESERVED_SLUGS), so no platform page can begin with it,
  // and a path that merely CONTAINS the letter is not a storefront.
  it('does not mistake a platform page whose name contains the segment', () => {
    expect(isPlatformPath('/sample-shops')).toBe(true)
    expect(isPlatformPath('/for/s-and-co')).toBe(true)
  })
})
