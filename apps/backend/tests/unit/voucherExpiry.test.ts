import { describe, it, expect } from 'vitest'
import { expiryInstant, expiryDate } from '../../src/voucherExpiry.js'

const KL = 'Asia/Kuala_Lumpur'   // UTC+8, no DST — the platform's own default
const NY = 'America/New_York'    // UTC-5/-4 — the DST case KL cannot exercise

describe('expiryInstant', () => {
  it('covers the whole of the day the merchant picked, in the shop timezone', () => {
    // The failure this exists to prevent: stored naively, "31 Aug" becomes 00:00Z, which is 8am
    // on the 31st in KL — the voucher dies mid-breakfast on the day it was meant to run.
    expect(expiryInstant('2026-08-31', KL)).toBe('2026-08-31T15:59:59.999Z')
  })

  it('lands west of UTC on the NEXT calendar day, which is the point', () => {
    expect(expiryInstant('2026-08-31', NY)).toBe('2026-09-01T03:59:59.999Z')
  })

  it('reads the offset that applies on the chosen date, not today', () => {
    // Winter and summer in New York are a whole hour apart. One fixed offset would be wrong for
    // half the year, silently, by an hour at the end of a day.
    expect(expiryInstant('2026-01-15', NY)).toBe('2026-01-16T04:59:59.999Z')
    expect(expiryInstant('2026-07-15', NY)).toBe('2026-07-16T03:59:59.999Z')
  })

  it('falls back to the default shop clock rather than throwing on a bad timezone', () => {
    // A corrupt `merchants.timezone` must not take voucher creation down — the reading every
    // other date rule here already takes (`todayInZone`).
    expect(expiryInstant('2026-08-31', 'Not/AZone')).toBe(expiryInstant('2026-08-31', KL))
    expect(expiryInstant('2026-08-31', null)).toBe(expiryInstant('2026-08-31', KL))
  })

  it('returns null for anything that is not a plain date', () => {
    for (const bad of ['', '31/08/2026', '2026-8-31', '2026-08-31T00:00:00Z', 'tomorrow', null, undefined, 5]) {
      expect(expiryInstant(bad, KL)).toBeNull()
    }
  })
})

describe('expiryDate', () => {
  it('round-trips the merchant back to the date they typed', () => {
    for (const tz of [KL, NY, 'UTC']) {
      for (const date of ['2026-01-15', '2026-07-15', '2026-08-31', '2026-12-31']) {
        expect(expiryDate(expiryInstant(date, tz), tz)).toBe(date)
      }
    }
  })

  it('does not read the instant in UTC', () => {
    // The naive `slice(0, 10)` this replaces: for a shop east of UTC the stored instant sits on
    // the PREVIOUS calendar day in UTC, so the dashboard would show an expiry a day early.
    expect('2026-08-31T15:59:59.999Z'.slice(0, 10)).toBe('2026-08-31')
    expect(expiryDate('2026-08-31T16:00:00.000Z', KL)).toBe('2026-09-01')
  })

  it('returns null for an absent or unparseable instant', () => {
    for (const bad of [null, undefined, '', 'never', 5]) expect(expiryDate(bad, KL)).toBeNull()
  })
})
