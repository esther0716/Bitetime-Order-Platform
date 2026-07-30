import { describe, it, expect } from 'vitest'
import { canStartTrial, trialStartRefusal, buildTrialReminderEmail } from '../../src/billingLifecycle.js'

describe('canStartTrial', () => {
  it('allows a merchant with no billing row (never touched Stripe)', () => {
    expect(canStartTrial(null)).toBe(true)
    expect(canStartTrial(undefined)).toBe(true)
  })

  it('allows a merchant with a customer but no subscription (created, never subscribed)', () => {
    expect(canStartTrial({ stripe_customer_id: 'cus_1', stripe_subscription_id: null })).toBe(true)
  })

  it('refuses a merchant that has ever had a subscription — one trial ever', () => {
    expect(canStartTrial({ stripe_subscription_id: 'sub_1', status: 'canceled' })).toBe(false)
    expect(canStartTrial({ stripe_subscription_id: 'sub_1', status: 'trialing' })).toBe(false)
  })
})

describe('trialStartRefusal', () => {
  it('allows a pending basic shop', () => {
    expect(trialStartRefusal({ status: 'pending', plan: 'basic' })).toBeNull()
  })

  // A NULL plan column reads as basic everywhere else (see seedMerchant's note), and must here.
  it('allows a pending shop whose plan column was never set', () => {
    expect(trialStartRefusal({ status: 'pending', plan: null })).toBeNull()
  })

  it('refuses a shop that is not pending', () => {
    expect(trialStartRefusal({ status: 'active', plan: 'basic' })).toBe('Merchant is not pending')
    expect(trialStartRefusal({ status: 'suspended', plan: 'basic' })).toBe('Merchant is not pending')
  })

  // Pro is pay-upfront: granting it a cardless trial would hand away the paid tier for a week.
  it('refuses a pro shop even when pending', () => {
    expect(trialStartRefusal({ status: 'pending', plan: 'pro' }))
      .toBe('Pro shops activate via payment, not approval')
  })

  // Status is checked first: a suspended pro shop is refused for the reason a caller can act on.
  it('reports the status refusal before the plan refusal', () => {
    expect(trialStartRefusal({ status: 'suspended', plan: 'pro' })).toBe('Merchant is not pending')
  })
})

describe('buildTrialReminderEmail', () => {
  const input = {
    shopName: 'Sunny Bakes',
    trialEndsAt: '2026-07-09T08:00:00.000Z',
    dashboardUrl: 'http://localhost:5173/merchant',
  }

  it('names the shop, links the dashboard, and states the deadline', () => {
    const { subject, text } = buildTrialReminderEmail(input)
    expect(subject).toContain('Sunny Bakes')
    expect(subject).toContain('3 days')
    expect(text).toContain('Sunny Bakes')
    expect(text).toContain('http://localhost:5173/merchant')
    expect(text).toContain('Jul 9, 2026')
  })

  it('warns that the shop is suspended if unpaid', () => {
    const { text } = buildTrialReminderEmail(input)
    expect(text.toLowerCase()).toContain('suspended')
  })
})
