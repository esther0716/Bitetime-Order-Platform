import { describe, it, expect } from 'vitest'
import { signupCta } from './cta'

describe('a signup CTA', () => {
  it('reads the bare CTA, which carries no cycle', () => {
    expect(signupCta('/merchant/signup')).toEqual({})
  })

  it('reads the cycle a preselecting CTA carries', () => {
    expect(signupCta('/merchant/signup/yearly')).toEqual({ billing: 'yearly' })
    expect(signupCta('/merchant/signup/monthly')).toEqual({ billing: 'monthly' })
  })

  // The URL used to carry the plan first (`/merchant/signup/pro/yearly`), and those links are
  // still in inboxes and in Stripe's cancel_url history — so the cycle is found by scanning the
  // segments, never by its position. See the route comment in AppRouter.tsx.
  it('reads the cycle out of the older two-segment URL', () => {
    expect(signupCta('/merchant/signup/pro/yearly')).toEqual({ billing: 'yearly' })
  })

  it('ignores a query string and a hash', () => {
    expect(signupCta('/merchant/signup/yearly?ref=abc')).toEqual({ billing: 'yearly' })
    expect(signupCta('/merchant/signup#form')).toEqual({})
  })

  it('reports no cycle for a segment that is not one', () => {
    expect(signupCta('/merchant/signup/quarterly')).toEqual({})
  })
})

describe('everything that is not a signup CTA', () => {
  it('refuses another route', () => {
    expect(signupCta('/merchant/login')).toBeNull()
    expect(signupCta('/pricing')).toBeNull()
    expect(signupCta('/')).toBeNull()
  })

  // The listener sees every link on the page, and an outbound one must not become a CTA because
  // its path happens to match — `trackOutboundLinks` is off precisely so nothing reports these.
  it('refuses an absolute URL to another host', () => {
    expect(signupCta('https://example.com/merchant/signup')).toBeNull()
  })

  it('refuses a path that merely starts with the same letters', () => {
    expect(signupCta('/merchant/signups')).toBeNull()
    expect(signupCta('/merchant/signup-help')).toBeNull()
  })

  it('refuses an empty href', () => {
    expect(signupCta('')).toBeNull()
  })
})
