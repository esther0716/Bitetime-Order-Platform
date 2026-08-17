// The Overview's range selection, as the two things it turns into: a query string for both
// revenue endpoints, and a span the granularity default reads. The pills and the merchant's own
// two dates (#234) are one selection type here, so nothing downstream has to ask which it holds.
import { describe, it, expect } from 'vitest'
import { revenueQuery, selectionSpan, type RevenueSelection } from './revenueRange'

const LAST: RevenueSelection = { kind: 'last', days: 30 }
const CUSTOM: RevenueSelection = { kind: 'custom', from: '2026-01-01', to: '2026-03-31' }
const TODAY = '2026-06-15'

describe('revenueQuery', () => {
  it('sends a pill as days', () => {
    expect(revenueQuery(LAST, 'day')).toBe('days=30&granularity=day')
  })

  it('sends a custom range as its two dates', () => {
    expect(revenueQuery(CUSTOM, 'week')).toBe('from=2026-01-01&to=2026-03-31&granularity=week')
  })

  // The API refuses a request carrying both, and it is right to: two windows in one request is a
  // request whose author did not know which one they were asking for.
  it('never sends both windows at once', () => {
    for (const sel of [LAST, CUSTOM]) {
      const q = revenueQuery(sel, 'day')
      expect(q.includes('days=') && q.includes('from=')).toBe(false)
    }
  })
})

describe('selectionSpan', () => {
  it('is the pill itself', () => {
    expect(selectionSpan(LAST, TODAY)).toBe(30)
  })

  it('is the inclusive span of a custom range', () => {
    expect(selectionSpan(CUSTOM, TODAY)).toBe(90)
  })

  // Half-typed dates are the normal state of a date input, not an error to shout about.
  it('is null while the custom dates are not yet a range the API would accept', () => {
    expect(selectionSpan({ kind: 'custom', from: '', to: '' }, TODAY)).toBeNull()
    expect(selectionSpan({ kind: 'custom', from: '2026-03-31', to: '2026-01-01' }, TODAY)).toBeNull()
    expect(selectionSpan({ kind: 'custom', from: '2026-06-01', to: '2026-06-16' }, TODAY)).toBeNull()
    expect(selectionSpan({ kind: 'custom', from: '2025-01-01', to: '2026-06-15' }, TODAY)).toBeNull()
  })
})
