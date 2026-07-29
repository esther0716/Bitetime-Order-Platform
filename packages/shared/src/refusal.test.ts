import { describe, it, expect } from 'vitest'
import {
  ORDER_REFUSALS, REFUSAL_STATUS,
  QUOTE_REFUSALS, QUOTE_REFUSAL_STATUS,
} from './refusal.js'

describe('order refusals', () => {
  it('carries the code the hand-copied twin lost', () => {
    // The whole reason this module exists: `method_not_offered` was thrown by the backend,
    // handled in the storefront as a bare string, and absent from the frontend's own union.
    expect(ORDER_REFUSALS).toContain('method_not_offered')
  })

  it('lists every code exactly once', () => {
    expect(new Set(ORDER_REFUSALS).size).toBe(ORDER_REFUSALS.length)
  })

  it('gives every code a status', () => {
    for (const code of ORDER_REFUSALS) {
      expect(typeof REFUSAL_STATUS[code]).toBe('number')
    }
  })

  it('keeps the statuses that are not 409', () => {
    expect(REFUSAL_STATUS.merchant_not_found).toBe(404)
    expect(REFUSAL_STATUS.invalid_body).toBe(400)
    expect(REFUSAL_STATUS.order_failed).toBe(500)
  })
})

describe('quote refusals', () => {
  it('lists all eight the quote endpoint can emit', () => {
    expect([...QUOTE_REFUSALS].sort()).toEqual([
      'invalid_body', 'lookup_failed', 'merchant_inactive', 'merchant_not_found',
      'not_distance_priced', 'out_of_range', 'quota_exceeded', 'rate_limited',
    ])
  })

  it('meters the two 429s', () => {
    expect(QUOTE_REFUSAL_STATUS.rate_limited).toBe(429)
    expect(QUOTE_REFUSAL_STATUS.quota_exceeded).toBe(429)
  })
})

describe('option_unavailable', () => {
  // Its own code, not a reuse of product_unavailable: the two RECOVER differently, and reusing
  // the wrong one loops the checkout forever. See CONTEXT.md -> Menu options.
  it('is a distinct order refusal with a status', () => {
    expect(ORDER_REFUSALS).toContain('option_unavailable')
    expect(ORDER_REFUSALS).toContain('product_unavailable')
    expect(REFUSAL_STATUS.option_unavailable).toBe(409)
  })
})
