import { describe, it, expect } from 'vitest'
import {
  canStartTrial, trialStartRefusal, buildTrialReminderEmail, isLapsed, needsReconcile,
  dunningGraceExpired, PAST_DUE_GRACE_DAYS,
} from '../../src/billingLifecycle.js'

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
  it('allows a pending shop', () => {
    expect(trialStartRefusal({ status: 'pending' })).toBeNull()
  })

  it('refuses a shop that is not pending', () => {
    expect(trialStartRefusal({ status: 'active' })).toBe('Merchant is not pending')
    expect(trialStartRefusal({ status: 'suspended' })).toBe('Merchant is not pending')
  })
})

describe('isLapsed', () => {
  // The three Stripe statuses that mean there is no longer anything paying for this shop.
  // `canceled` is the one a cardless trial ends in (trial_settings.end_behavior), which is the
  // whole reason this predicate exists.
  it('reports a subscription Stripe has finished with', () => {
    expect(isLapsed('canceled')).toBe(true)
    expect(isLapsed('incomplete_expired')).toBe(true)
    expect(isLapsed('unpaid')).toBe(true)
  })

  // LOAD-BEARING. `past_due` is Stripe still retrying the card — the shop stays open through
  // dunning and only closes when Stripe gives up, which it reports as one of the three above.
  // Treating it as lapsed would suspend a shop over a single declined charge.
  it('leaves a live or retrying subscription alone', () => {
    expect(isLapsed('trialing')).toBe(false)
    expect(isLapsed('active')).toBe(false)
    expect(isLapsed('past_due')).toBe(false)
    expect(isLapsed('paused')).toBe(false)
  })

  // A status we have never seen must never close a shop. An unknown string here is Stripe
  // adding a state, and guessing "probably dead" would take shops offline on a Stripe release.
  it('never lapses on an unrecognised or missing status', () => {
    expect(isLapsed('something_new')).toBe(false)
    expect(isLapsed(null)).toBe(false)
    expect(isLapsed(undefined)).toBe(false)
  })
})

describe('dunningGraceExpired', () => {
  const NOW = new Date('2026-09-02T12:00:00Z')
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

  // THE BUG THIS CLOSES. Stripe's default, after its last retry fails, is to leave the
  // subscription `past_due` for ever — nothing in this repo configures otherwise for a renewal.
  // So `isLapsed` waits for a status that never arrives and the shop sells indefinitely unpaid.
  it('lapses a past_due subscription once the grace window has run out', () => {
    expect(dunningGraceExpired('past_due', daysAgo(PAST_DUE_GRACE_DAYS), NOW)).toBe(true)
    expect(dunningGraceExpired('past_due', daysAgo(40), NOW)).toBe(true)
  })

  // The other half, and the reason for a window rather than closing on the first decline:
  // Stripe's smart retries run for about two weeks, and a card that recovers on the last
  // attempt must recover before the storefront ever goes dark.
  it('leaves a shop alone while Stripe is still retrying', () => {
    expect(dunningGraceExpired('past_due', daysAgo(1), NOW)).toBe(false)
    expect(dunningGraceExpired('past_due', daysAgo(PAST_DUE_GRACE_DAYS - 1), NOW)).toBe(false)
  })

  // Only dunning. A healthy shop's period start is weeks old by definition, so reading the
  // status first is what stops this closing every shop on earth.
  it('never fires on a status that is not past_due', () => {
    expect(dunningGraceExpired('active', daysAgo(40), NOW)).toBe(false)
    expect(dunningGraceExpired('trialing', daysAgo(40), NOW)).toBe(false)
    expect(dunningGraceExpired('canceled', daysAgo(40), NOW)).toBe(false)
    expect(dunningGraceExpired(null, daysAgo(40), NOW)).toBe(false)
  })

  // No date, no lapse. A missing or unparseable timestamp measures nothing, and guessing
  // "probably long enough" takes a paying merchant's storefront down.
  it('refuses to lapse without a usable period start', () => {
    expect(dunningGraceExpired('past_due', null, NOW)).toBe(false)
    expect(dunningGraceExpired('past_due', undefined, NOW)).toBe(false)
    expect(dunningGraceExpired('past_due', 'not-a-date', NOW)).toBe(false)
  })
})

describe('needsReconcile', () => {
  const NOW = new Date('2026-08-06T12:00:00Z')
  const past = '2026-08-06T09:00:00Z'
  const future = '2026-08-09T09:00:00Z'

  // The sweep's worklist test. A row whose deadline has passed while the status still says the
  // subscription is running is the exact shape of a webhook that never arrived.
  it('picks a trial whose end date has passed but still reads trialing', () => {
    expect(needsReconcile({ status: 'trialing', trial_ends_at: past, stripe_subscription_id: 'sub_1' }, NOW)).toBe(true)
  })

  it('picks a period that should have renewed but still reads active', () => {
    expect(needsReconcile({ status: 'active', current_period_end: past, stripe_subscription_id: 'sub_1' }, NOW)).toBe(true)
  })

  // past_due is included deliberately: dunning ends in a cancellation, and that cancellation is
  // exactly the event this sweep exists to survive the loss of.
  it('picks a past_due row whose period has elapsed', () => {
    expect(needsReconcile({ status: 'past_due', current_period_end: past, stripe_subscription_id: 'sub_1' }, NOW)).toBe(true)
  })

  // A past_due row is selected whatever its deadline says. Stripe advances the billing period
  // when it issues the unpaid invoice, so a shop in dunning carries a period end a MONTH away —
  // the deadline tests drop it, and it then goes a month unexamined with the grace window never
  // evaluated. This is what keeps the hourly sweep looking at it.
  it('picks a past_due row whose period end is still in the future', () => {
    expect(needsReconcile({ status: 'past_due', current_period_end: future, stripe_subscription_id: 'sub_1' }, NOW)).toBe(true)
  })

  it('leaves a shop still inside its trial or period alone', () => {
    expect(needsReconcile({ status: 'trialing', trial_ends_at: future, stripe_subscription_id: 'sub_1' }, NOW)).toBe(false)
    expect(needsReconcile({ status: 'active', current_period_end: future, stripe_subscription_id: 'sub_1' }, NOW)).toBe(false)
  })

  // Already reconciled — nothing to ask Stripe about, and asking would spend an API call per
  // dead shop on every run, forever.
  it('leaves a row that already reads canceled alone', () => {
    expect(needsReconcile({ status: 'canceled', current_period_end: past, stripe_subscription_id: 'sub_1' }, NOW)).toBe(false)
  })

  // A comp is not a subscription. It carries status 'active' with no Stripe object behind it,
  // so a lookup would 404 and, untended, read as "lapsed" — suspending the shops a superadmin
  // deliberately opened.
  it('never touches a comped row', () => {
    expect(needsReconcile(
      { status: 'active', current_period_end: past, stripe_subscription_id: 'sub_1', comped: true }, NOW,
    )).toBe(false)
  })

  // Nothing to look up. A row with no subscription id is a shop that reached Stripe as a
  // customer and no further; there is no object whose truth could be read.
  it('never touches a row with no subscription id', () => {
    expect(needsReconcile({ status: 'active', current_period_end: past }, NOW)).toBe(false)
  })

  // Both deadlines null on a live row means we do not know when it is due — a shop mid-period
  // whose period end we never stored. Nothing has demonstrably elapsed, so leave it.
  it('leaves a live row with no deadline at all alone', () => {
    expect(needsReconcile({ status: 'active', stripe_subscription_id: 'sub_1' }, NOW)).toBe(false)
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
