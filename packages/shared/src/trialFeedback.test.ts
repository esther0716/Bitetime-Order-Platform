import { describe, it, expect } from 'vitest'
import { validateTrialFeedback, TRIAL_FEEDBACK_COMMENT_MAX_LENGTH } from './trialFeedback.js'

describe('validateTrialFeedback', () => {
  it('accepts a rating with no comment', () => {
    expect(validateTrialFeedback({ rating: 4 })).toEqual({ ok: true, value: { rating: 4, comment: null } })
  })

  it('accepts a rating with a trimmed comment', () => {
    expect(validateTrialFeedback({ rating: 5, comment: '  loved it  ' }))
      .toEqual({ ok: true, value: { rating: 5, comment: 'loved it' } })
  })

  it('treats an empty or whitespace-only comment as none', () => {
    expect(validateTrialFeedback({ rating: 3, comment: '   ' }))
      .toEqual({ ok: true, value: { rating: 3, comment: null } })
  })

  it('rejects a missing rating', () => {
    expect(validateTrialFeedback({ comment: 'hi' }).ok).toBe(false)
  })

  it('rejects a rating outside 1–5', () => {
    expect(validateTrialFeedback({ rating: 0 }).ok).toBe(false)
    expect(validateTrialFeedback({ rating: 6 }).ok).toBe(false)
  })

  it('rejects a non-integer rating', () => {
    expect(validateTrialFeedback({ rating: 3.5 }).ok).toBe(false)
  })

  it('rejects a non-string comment', () => {
    expect(validateTrialFeedback({ rating: 3, comment: 42 }).ok).toBe(false)
  })

  it(`rejects a comment longer than ${TRIAL_FEEDBACK_COMMENT_MAX_LENGTH} characters`, () => {
    const tooLong = 'x'.repeat(TRIAL_FEEDBACK_COMMENT_MAX_LENGTH + 1)
    expect(validateTrialFeedback({ rating: 3, comment: tooLong }).ok).toBe(false)
  })

  it('accepts a comment of exactly the maximum length', () => {
    const atLimit = 'x'.repeat(TRIAL_FEEDBACK_COMMENT_MAX_LENGTH)
    expect(validateTrialFeedback({ rating: 3, comment: atLimit }).ok).toBe(true)
  })

  it('drops any extra keys — builds its result rather than spreading the body', () => {
    const result = validateTrialFeedback({
      rating: 4, comment: 'good', responded_at: 'x', merchant_id: 'someone-elses-shop',
    })
    expect(result).toEqual({ ok: true, value: { rating: 4, comment: 'good' } })
  })

  it('rejects a null or non-object body without throwing', () => {
    expect(validateTrialFeedback(null).ok).toBe(false)
    expect(validateTrialFeedback('nope').ok).toBe(false)
    expect(validateTrialFeedback(undefined).ok).toBe(false)
  })
})
