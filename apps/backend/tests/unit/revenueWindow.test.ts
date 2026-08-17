// tests/unit/revenueWindow.test.ts
// Which window a revenue request asks for — the rule both `/stats` and `/report.xlsx` read the
// query through. Pure, so it is tested here rather than through eight HTTP round trips: the load
// bearing property is that anything it cannot answer honestly is REFUSED, never narrowed.
import { describe, it, expect } from 'vitest'
import { resolveRevenueRange } from '../../src/revenueWindow.js'

const TODAY = '2026-06-15'
const range = (days: string | undefined, from?: string, to?: string, defaultDays: number | null = null) =>
  resolveRevenueRange(days, from, to, TODAY, defaultDays)

describe('resolveRevenueRange', () => {
  it('reads one of the pills as the last N days ending today', () => {
    expect(range('30')).toEqual({ ok: true, kind: 'last-n', days: 30 })
  })

  it('refuses a range the pills do not offer', () => {
    for (const bad of ['7', '0', '91', '12.5', 'abc', '']) {
      expect(range(bad)).toEqual({ ok: false })
    }
  })

  it('falls back to the caller’s default only when it has one', () => {
    expect(range(undefined, undefined, undefined, 12)).toEqual({ ok: true, kind: 'last-n', days: 12 })
    // The export names no default: a workbook of an unstated range is worse than a refusal.
    expect(range(undefined)).toEqual({ ok: false })
  })

  it('reads two dates as a custom range, with its inclusive span', () => {
    expect(range(undefined, '2026-06-01', '2026-06-10'))
      .toEqual({ ok: true, kind: 'custom', days: 10, from: '2026-06-01', to: '2026-06-10' })
  })

  it('refuses two windows in one request rather than picking one', () => {
    expect(range('30', '2026-06-01', '2026-06-10')).toEqual({ ok: false })
  })

  it('refuses half a range', () => {
    expect(range(undefined, '2026-06-01')).toEqual({ ok: false })
    expect(range(undefined, undefined, '2026-06-10')).toEqual({ ok: false })
  })

  it('refuses a custom range the shared rule refuses', () => {
    expect(range(undefined, '2026-06-10', '2026-06-01')).toEqual({ ok: false }) // reversed
    expect(range(undefined, '2026-06-01', '2026-06-16')).toEqual({ ok: false }) // future
    expect(range(undefined, '2025-01-01', '2026-06-15')).toEqual({ ok: false }) // wider than the cap
    expect(range(undefined, '2026-02-30', '2026-03-01')).toEqual({ ok: false }) // never happened
  })

  it('ignores a default when the request names its own dates', () => {
    expect(range(undefined, '2026-06-01', '2026-06-10', 12))
      .toMatchObject({ kind: 'custom', days: 10 })
  })
})
