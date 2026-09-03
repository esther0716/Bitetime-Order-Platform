import { describe, it, expect } from 'vitest'
import { validateOrderReview, ORDER_REVIEW_COMMENT_MAX_LENGTH } from './orderReview.js'

describe('validateOrderReview', () => {
  it('accepts a rating with no comment', () => {
    expect(validateOrderReview({ rating: 4 })).toEqual({ ok: true, value: { rating: 4, comment: null } })
  })

  it('accepts a rating with a trimmed comment', () => {
    expect(validateOrderReview({ rating: 5, comment: '  fast and hot  ' }))
      .toEqual({ ok: true, value: { rating: 5, comment: 'fast and hot' } })
  })

  it('treats an empty or whitespace-only comment as none', () => {
    expect(validateOrderReview({ rating: 3, comment: '   ' }))
      .toEqual({ ok: true, value: { rating: 3, comment: null } })
  })

  it('accepts an explicit null comment', () => {
    expect(validateOrderReview({ rating: 1, comment: null }))
      .toEqual({ ok: true, value: { rating: 1, comment: null } })
  })

  it('rejects a missing rating', () => {
    expect(validateOrderReview({ comment: 'good' }).ok).toBe(false)
  })

  it('rejects a rating outside 1-5', () => {
    expect(validateOrderReview({ rating: 0 }).ok).toBe(false)
    expect(validateOrderReview({ rating: 6 }).ok).toBe(false)
  })

  it('rejects a non-integer rating', () => {
    expect(validateOrderReview({ rating: 4.5 }).ok).toBe(false)
  })

  it('rejects a rating that is not a number', () => {
    expect(validateOrderReview({ rating: '5' }).ok).toBe(false)
  })

  it('rejects a comment that is not text', () => {
    expect(validateOrderReview({ rating: 3, comment: 42 }).ok).toBe(false)
  })

  it('rejects a comment over the cap', () => {
    expect(validateOrderReview({ rating: 3, comment: 'x'.repeat(ORDER_REVIEW_COMMENT_MAX_LENGTH + 1) }).ok)
      .toBe(false)
  })

  it('accepts a comment exactly at the cap', () => {
    const comment = 'x'.repeat(ORDER_REVIEW_COMMENT_MAX_LENGTH)
    expect(validateOrderReview({ rating: 3, comment })).toEqual({ ok: true, value: { rating: 3, comment } })
  })

  it('rejects a body that is not an object', () => {
    expect(validateOrderReview(null).ok).toBe(false)
    expect(validateOrderReview('5').ok).toBe(false)
  })

  // The allowlist. A caller must not be able to push its own review_at, user_id or status
  // through the validator and into the update.
  it('drops every field it does not name', () => {
    const out = validateOrderReview({
      rating: 5,
      comment: 'ok',
      review_at: '1999-01-01T00:00:00.000Z',
      user_id: 'someone-else',
      merchant_id: 'another-shop',
      status: 'completed',
    })
    expect(out).toEqual({ ok: true, value: { rating: 5, comment: 'ok' } })
  })
})
