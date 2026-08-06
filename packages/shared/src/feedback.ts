// Merchant platform-feedback rules (#89). Shared because both sides enforce them: the
// dashboard form disables submit and shows a counter, the backend refuses. A merchant
// should be told their message is too long before they lose it to a 400.
//
// The database CHECK constraints in 20260720120000_merchant_feedback.sql are the final
// authority. These rules exist to keep the browser and the server from disagreeing about
// what the database will accept.

export const FEEDBACK_CATEGORIES = ['bug', 'feature', 'billing', 'other'] as const
export const FEEDBACK_STATUSES = ['open', 'resolved'] as const
export const FEEDBACK_MAX_LENGTH = 2000

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export interface FeedbackDraft {
  category: FeedbackCategory
  message: string
}

export type FeedbackValidation =
  | { ok: true; value: FeedbackDraft }
  | { ok: false; error: string }

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === 'string' && (FEEDBACK_CATEGORIES as readonly string[]).includes(value)
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === 'string' && (FEEDBACK_STATUSES as readonly string[]).includes(value)
}

/**
 * Validates a feedback submission and returns a clean draft.
 *
 * This is also the write allowlist. It BUILDS its result field by field rather than
 * spreading the body, so a caller cannot smuggle `status`, `merchant_id` or `user_id`
 * through it — the backend forces all three itself. Never bypass this and insert a raw body.
 */
export function validateFeedback(body: unknown): FeedbackValidation {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as {
    category?: unknown
    message?: unknown
  }

  if (!isFeedbackCategory(raw.category)) {
    return { ok: false, error: 'Pick a feedback category' }
  }
  if (typeof raw.message !== 'string') {
    return { ok: false, error: 'Feedback message is required' }
  }

  const message = raw.message.trim()
  if (message.length === 0) {
    return { ok: false, error: 'Feedback message is required' }
  }
  if (message.length > FEEDBACK_MAX_LENGTH) {
    return { ok: false, error: `Feedback message must be ${FEEDBACK_MAX_LENGTH} characters or fewer` }
  }

  return { ok: true, value: { category: raw.category, message } }
}

// ── Screenshot attachments ────────────────────────────────────────────────────
// Shared for the same reason the message bounds are: the browser tells the merchant before
// a 5 MiB body crosses the wire, and the backend refuses regardless of the client. The
// bucket config in 20260806120000_feedback_images.sql is the final authority — these rules
// exist so the two never disagree about what Storage will take.

export const FEEDBACK_MAX_IMAGES = 3
export const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024
export const FEEDBACK_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type FeedbackImageValidation = { ok: true } | { ok: false; error: string }

/**
 * Type and size of ONE file. The caller counts files against FEEDBACK_MAX_IMAGES itself,
 * and the caller names the offending file: this takes `{ type, size }` rather than a `File`
 * so the backend can call it on a multipart part without constructing one, and so nothing
 * here assumes how either side displays an error.
 */
export function validateFeedbackImage(file: { type: string; size: number }): FeedbackImageValidation {
  if (!(FEEDBACK_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, error: 'Screenshots must be JPEG, PNG or WebP' }
  }
  // Zero bytes passes a size ceiling but is not a screenshot. Caught here rather than at the
  // route so the merchant is told, matching the byteLength === 0 check the payment-proof
  // upload already makes.
  if (file.size === 0) {
    return { ok: false, error: 'Screenshot is empty' }
  }
  if (file.size > MAX_FEEDBACK_IMAGE_BYTES) {
    return { ok: false, error: 'Each screenshot must be 5MB or smaller' }
  }
  return { ok: true }
}
