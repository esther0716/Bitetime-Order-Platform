// tests/unit/aiUsage.test.ts
// The month a Claude call is billed to, and the date a merchant gets their allowance back.
//
// Both are computed on the SHOP's clock. That is the whole point of the module: a merchant in
// Kuala Lumpur whose month rolls over on the server's UTC midnight loses eight hours of the new
// month's allowance and is told a reset date that has already passed. These are pure so they can
// be tested without a database — the counter itself lives in aiUsageDb.ts.
import { describe, it, expect } from 'vitest'
import { usagePeriod, nextResetDate } from '../../src/aiUsage.js'

describe('usagePeriod', () => {
  it('is the shop\'s own year and month', () => {
    expect(usagePeriod('Asia/Kuala_Lumpur', new Date('2026-08-13T04:00:00Z'))).toBe('2026-08')
  })

  it('has already rolled over for a shop whose month has turned, while UTC is still in the old one', () => {
    // 31 Aug 18:00 UTC is 1 Sept 02:00 in Kuala Lumpur. The shop is in September; the server is not.
    const instant = new Date('2026-08-31T18:00:00Z')

    expect(usagePeriod('Asia/Kuala_Lumpur', instant)).toBe('2026-09')
    expect(usagePeriod('UTC', instant)).toBe('2026-08')
  })

  it('has NOT yet rolled over for a shop behind UTC', () => {
    // 1 Sept 02:00 UTC is still 31 Aug in Los Angeles.
    expect(usagePeriod('America/Los_Angeles', new Date('2026-09-01T02:00:00Z'))).toBe('2026-08')
  })

  it('falls back rather than throwing on an unusable timezone', () => {
    // `merchants.timezone` is validated on write, but a bad row must cost a shop its AI features,
    // not take the route down with an Intl error.
    expect(usagePeriod('Not/AZone', new Date('2026-08-13T04:00:00Z'))).toMatch(/^\d{4}-\d{2}$/)
  })
})

describe('nextResetDate', () => {
  it('is the first of the following month', () => {
    expect(nextResetDate('2026-08')).toBe('2026-09-01')
  })

  it('rolls the year over in December', () => {
    expect(nextResetDate('2026-12')).toBe('2027-01-01')
  })
})
