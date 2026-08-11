import { describe, it, expect } from 'vitest'
import { toDate, toIso } from './calendarDate'

describe('calendarDate', () => {
  it('round-trips a date to itself', () => {
    for (const iso of ['2026-01-01', '2026-08-16', '2026-12-31', '2028-02-29']) {
      expect(toIso(toDate(iso))).toBe(iso)
    }
  })

  it('round-trips every day of a year, including both DST boundaries', () => {
    // The failure this guards: a conversion that goes through UTC or `Date.parse` slips a day on
    // the dates where local midnight does not exist or happens twice. Northern DST changes fall in
    // March and October/November, southern ones in April and September — a whole year covers all
    // of them whatever zone the test runs in.
    let ms = Date.UTC(2026, 0, 1)
    for (let i = 0; i < 365; i++) {
      const d = new Date(ms)
      const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
      expect(toIso(toDate(iso))).toBe(iso)
      ms += 86_400_000
    }
  })

  it('pads single-digit months and days, so the string sorts chronologically', () => {
    // The allowlist is sorted with a plain string sort, which is only chronological while every
    // date is zero-padded to the same width.
    expect(toIso(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(['2026-01-10', '2026-01-05', '2026-02-01'].sort())
      .toEqual(['2026-01-05', '2026-01-10', '2026-02-01'])
  })
})
