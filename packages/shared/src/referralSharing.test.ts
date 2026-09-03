import { describe, it, expect } from 'vitest'
import { canShareReferral } from './referralSharing.js'

describe('canShareReferral', () => {
  it('lets a paying shop share', () => {
    expect(canShareReferral({ status: 'active' })).toBe(true)
    expect(canShareReferral({ status: 'active', comped: false, cancel_at_period_end: false })).toBe(true)
  })

  it('refuses every status that is not a running paid subscription', () => {
    for (const status of ['trialing', 'past_due', 'canceled', 'incomplete', 'unpaid', '']) {
      expect(canShareReferral({ status })).toBe(false)
    }
  })

  it('refuses a shop with no billing row at all', () => {
    expect(canShareReferral(null)).toBe(false)
    expect(canShareReferral(undefined)).toBe(false)
    expect(canShareReferral({})).toBe(false)
    expect(canShareReferral({ status: null })).toBe(false)
  })

  // A comp writes status 'active' with no subscription behind it, so the status alone says yes.
  // There is no Stripe customer to credit, so the reward could never be paid.
  it('refuses a comped shop despite its active status', () => {
    expect(canShareReferral({ status: 'active', comped: true })).toBe(false)
  })

  // Stripe keeps a cancelled subscription 'active' until the period ends. The invited shop pays
  // its first invoice long after that, so a referral made here forfeits.
  it('refuses a subscription that is cancelling at the period end', () => {
    expect(canShareReferral({ status: 'active', cancel_at_period_end: true })).toBe(false)
  })

  it('lets a resumed subscription share again', () => {
    expect(canShareReferral({ status: 'active', cancel_at_period_end: false })).toBe(true)
  })
})
