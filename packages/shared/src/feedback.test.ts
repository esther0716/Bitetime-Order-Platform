import { describe, it, expect } from 'vitest'
import {
  validateFeedback, isFeedbackStatus, validateFeedbackImage,
  FEEDBACK_MAX_LENGTH, FEEDBACK_MAX_IMAGES, MAX_FEEDBACK_IMAGE_BYTES,
} from './feedback.js'

describe('validateFeedback', () => {
  it('accepts a known category and a trimmed message', () => {
    const result = validateFeedback({ category: 'bug', message: '  the order list is empty  ' })
    expect(result).toEqual({ ok: true, value: { category: 'bug', message: 'the order list is empty' } })
  })

  it('rejects an unknown category', () => {
    const result = validateFeedback({ category: 'complaint', message: 'hello' })
    expect(result.ok).toBe(false)
  })

  it('rejects a missing category', () => {
    expect(validateFeedback({ message: 'hello' }).ok).toBe(false)
  })

  it('rejects a non-string message', () => {
    expect(validateFeedback({ category: 'other', message: 42 }).ok).toBe(false)
  })

  it('rejects a whitespace-only message', () => {
    expect(validateFeedback({ category: 'other', message: '   \n  ' }).ok).toBe(false)
  })

  it(`rejects a message longer than ${FEEDBACK_MAX_LENGTH} characters`, () => {
    const tooLong = 'x'.repeat(FEEDBACK_MAX_LENGTH + 1)
    expect(validateFeedback({ category: 'other', message: tooLong }).ok).toBe(false)
  })

  it('accepts a message of exactly the maximum length', () => {
    const atLimit = 'x'.repeat(FEEDBACK_MAX_LENGTH)
    expect(validateFeedback({ category: 'other', message: atLimit }).ok).toBe(true)
  })

  it('drops any extra keys — it builds its result rather than spreading the body', () => {
    const result = validateFeedback({
      category: 'billing', message: 'charged twice',
      status: 'resolved', merchant_id: 'someone-elses-shop', user_id: 'someone-else',
    })
    expect(result).toEqual({ ok: true, value: { category: 'billing', message: 'charged twice' } })
  })

  it('rejects a null or non-object body without throwing', () => {
    expect(validateFeedback(null).ok).toBe(false)
    expect(validateFeedback('nope').ok).toBe(false)
    expect(validateFeedback(undefined).ok).toBe(false)
  })
})

describe('validateFeedbackImage', () => {
  it('accepts each type the bucket accepts', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validateFeedbackImage({ type, size: 1024 })).toEqual({ ok: true })
    }
  })

  it('refuses a type the bucket would reject, naming what is allowed', () => {
    const r = validateFeedbackImage({ type: 'application/pdf', size: 1024 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/JPEG, PNG or WebP/)
  })

  it('refuses image/gif — an image type, but not one this bucket takes', () => {
    expect(validateFeedbackImage({ type: 'image/gif', size: 1024 }).ok).toBe(false)
  })

  it('accepts a file exactly at the ceiling and refuses one byte over', () => {
    expect(validateFeedbackImage({ type: 'image/png', size: MAX_FEEDBACK_IMAGE_BYTES }))
      .toEqual({ ok: true })
    const over = validateFeedbackImage({ type: 'image/png', size: MAX_FEEDBACK_IMAGE_BYTES + 1 })
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.error).toMatch(/5MB/)
  })

  it('refuses an empty file — the route would upload zero bytes and call it a screenshot', () => {
    expect(validateFeedbackImage({ type: 'image/png', size: 0 }).ok).toBe(false)
  })

  it('pins the count and size ceilings the migration and the route also state', () => {
    expect(FEEDBACK_MAX_IMAGES).toBe(3)
    expect(MAX_FEEDBACK_IMAGE_BYTES).toBe(5 * 1024 * 1024)
  })
})

describe('isFeedbackStatus', () => {
  it('accepts the two real statuses', () => {
    expect(isFeedbackStatus('open')).toBe(true)
    expect(isFeedbackStatus('resolved')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isFeedbackStatus('closed')).toBe(false)
    expect(isFeedbackStatus(undefined)).toBe(false)
    expect(isFeedbackStatus(1)).toBe(false)
  })
})
