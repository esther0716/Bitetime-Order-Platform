import { describe, it, expect } from 'vitest'
import { reviewErrorMessage } from './reviewError'

const en = (e: string) => e
const zh = (_e: string, z: string) => z

describe('reviewErrorMessage', () => {
  it('names the cancelled order', () => {
    expect(reviewErrorMessage('order_cancelled', en)).toBe('This order was cancelled, so it cannot be rated.')
  })

  it('names the rate limit', () => {
    expect(reviewErrorMessage('rate_limited', en)).toMatch(/Too many tries/)
  })

  it('names a missing order', () => {
    expect(reviewErrorMessage('not_found', en)).toBe('We could not find this order.')
  })

  // The point of the module: a code the browser has not been taught, the server's own English
  // validator sentence, and no code at all must all read as the general sentence — never as the
  // wire code, which is what a customer saw before this existed.
  it('falls back for an unknown code, a raw server sentence and no code', () => {
    const general = 'Could not send your review. Please try again.'
    expect(reviewErrorMessage('review_failed', en)).toBe(general)
    expect(reviewErrorMessage('Rating must be an integer between 1 and 5', en)).toBe(general)
    expect(reviewErrorMessage(undefined, en)).toBe(general)
  })

  it('answers in Chinese when the reader is reading Chinese', () => {
    expect(reviewErrorMessage('order_cancelled', zh)).toBe('此订单已取消，无法评价。')
    expect(reviewErrorMessage(undefined, zh)).toBe('无法提交你的评价，请重试。')
  })
})
