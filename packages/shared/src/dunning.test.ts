import { describe, it, expect } from 'vitest'
import {
  PAST_DUE_GRACE_DAYS, pastDueDeadline, pastDueGraceExpired, pastDueDaysLeft,
} from './dunning.js'

const NOW = new Date('2026-09-02T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

describe('pastDueDeadline', () => {
  it('closes the shop three days after the unpaid period began', () => {
    expect(pastDueDeadline('2026-09-02T00:00:00Z')?.toISOString()).toBe('2026-09-05T00:00:00.000Z')
    expect(PAST_DUE_GRACE_DAYS).toBe(3)
  })

  // No deadline means no countdown on the dashboard and no closure in the sweep. Both callers
  // read this as "leave it alone", which is the safe direction for a date we do not have.
  it('has no deadline without a usable period start', () => {
    expect(pastDueDeadline(null)).toBeNull()
    expect(pastDueDeadline(undefined)).toBeNull()
    expect(pastDueDeadline('not-a-date')).toBeNull()
  })
})

describe('pastDueGraceExpired', () => {
  // THE BUG THIS CLOSES. Stripe's default, after its final retry fails, is to leave the
  // subscription `past_due` for ever — nothing configures otherwise for a renewal. So a check
  // that waits for `canceled` waits for ever, and the shop sells unpaid for ever with it.
  it('closes a shop whose grace has run out', () => {
    expect(pastDueGraceExpired('past_due', daysAgo(PAST_DUE_GRACE_DAYS), NOW)).toBe(true)
    expect(pastDueGraceExpired('past_due', daysAgo(30), NOW)).toBe(true)
  })

  it('leaves a shop open inside the window', () => {
    expect(pastDueGraceExpired('past_due', daysAgo(0), NOW)).toBe(false)
    expect(pastDueGraceExpired('past_due', daysAgo(2), NOW)).toBe(false)
  })

  // Load-bearing. Every healthy shop's period started weeks ago, so reading the status first is
  // the only thing standing between this rule and closing all of them.
  it('never fires on a status that is not past_due', () => {
    expect(pastDueGraceExpired('active', daysAgo(30), NOW)).toBe(false)
    expect(pastDueGraceExpired('trialing', daysAgo(30), NOW)).toBe(false)
    expect(pastDueGraceExpired('canceled', daysAgo(30), NOW)).toBe(false)
    expect(pastDueGraceExpired(null, daysAgo(30), NOW)).toBe(false)
  })

  it('refuses to close without a usable period start', () => {
    expect(pastDueGraceExpired('past_due', null, NOW)).toBe(false)
    expect(pastDueGraceExpired('past_due', 'not-a-date', NOW)).toBe(false)
  })
})

describe('pastDueDaysLeft', () => {
  // Floored, because the banner says it out loud: "1 day left" with 30 hours to go is a promise
  // the sweep will keep, and "2 days left" with 30 hours to go is not.
  it('counts whole days down to zero', () => {
    expect(pastDueDaysLeft(daysAgo(0), NOW)).toBe(3)
    expect(pastDueDaysLeft(daysAgo(1.5), NOW)).toBe(1)
    expect(pastDueDaysLeft(daysAgo(2.9), NOW)).toBe(0)
    expect(pastDueDaysLeft(daysAgo(9), NOW)).toBe(0)
  })

  // The banner must render something rather than blank out on a missing date; the full window is
  // the reading that never promises less time than the shop actually has.
  it('falls back to the full window with no period start', () => {
    expect(pastDueDaysLeft(null, NOW)).toBe(PAST_DUE_GRACE_DAYS)
  })
})
