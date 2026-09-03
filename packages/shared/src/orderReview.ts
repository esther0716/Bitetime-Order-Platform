// Customer order reviews — validation for the 1-5 star rating a customer leaves on their own
// order. Shared because both sides enforce it: the storefront card disables submit until a star
// is picked and refuses to send an over-long comment, and the backend refuses anything else. The
// database
// CHECK constraints in 20260903120000_order_reviews.sql are the final authority; this exists to
// keep the browser and the server from disagreeing about what will be accepted. Mirrors
// trialFeedback.ts's shape and reasoning.
//
// The comment cap is 500, not the 2000 feedback.ts and trialFeedback.ts allow. A customer review
// is a sentence or two written on a phone straight after checkout. A merchant bug report is not.

export const ORDER_REVIEW_RATING_MIN = 1
export const ORDER_REVIEW_RATING_MAX = 5
export const ORDER_REVIEW_COMMENT_MAX_LENGTH = 500

export interface OrderReviewDraft {
  rating: number
  comment: string | null
}

export type OrderReviewValidation =
  | { ok: true; value: OrderReviewDraft }
  | { ok: false; error: string }

/**
 * Validates an order review and returns a clean draft.
 *
 * This is also the write allowlist: it BUILDS its result field by field rather than spreading
 * the body, so a caller cannot smuggle `review_at`, `user_id`, `merchant_id` or `status` through
 * it — the backend derives the timestamp itself and never takes ownership from a body. Never
 * bypass this and update from a raw body.
 */
export function validateOrderReview(body: unknown): OrderReviewValidation {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as {
    rating?: unknown
    comment?: unknown
  }

  if (
    typeof raw.rating !== 'number' ||
    !Number.isInteger(raw.rating) ||
    raw.rating < ORDER_REVIEW_RATING_MIN ||
    raw.rating > ORDER_REVIEW_RATING_MAX
  ) {
    return {
      ok: false,
      error: `Rating must be an integer between ${ORDER_REVIEW_RATING_MIN} and ${ORDER_REVIEW_RATING_MAX}`,
    }
  }

  let comment: string | null = null
  if (raw.comment !== undefined && raw.comment !== null) {
    if (typeof raw.comment !== 'string') {
      return { ok: false, error: 'Comment must be text' }
    }
    const trimmed = raw.comment.trim()
    if (trimmed.length > ORDER_REVIEW_COMMENT_MAX_LENGTH) {
      return { ok: false, error: `Comment must be ${ORDER_REVIEW_COMMENT_MAX_LENGTH} characters or fewer` }
    }
    comment = trimmed.length > 0 ? trimmed : null
  }

  return { ok: true, value: { rating: raw.rating, comment } }
}
