// Trial feedback (#155) — validation for the one-time, platform-initiated survey asked
// once a shop's 7-day trial ends. Shared because both sides enforce it: the dashboard form
// disables submit until a rating is picked, and the backend refuses anything else. The
// database CHECK constraints in 20260804150000_trial_feedback.sql are the final authority;
// this exists to keep the browser and the server from disagreeing about what will be
// accepted. Mirrors feedback.ts's shape and reasoning.

export const TRIAL_FEEDBACK_RATING_MIN = 1
export const TRIAL_FEEDBACK_RATING_MAX = 5
export const TRIAL_FEEDBACK_COMMENT_MAX_LENGTH = 2000

export interface TrialFeedbackDraft {
  rating: number
  comment: string | null
}

export type TrialFeedbackValidation =
  | { ok: true; value: TrialFeedbackDraft }
  | { ok: false; error: string }

/**
 * Validates a trial-feedback submission and returns a clean draft.
 *
 * This is also the write allowlist: it BUILDS its result field by field rather than
 * spreading the body, so a caller cannot smuggle `responded_at`, `merchant_id` or
 * `skipped_at` through it — the backend derives all of those itself. Never bypass this
 * and insert a raw body.
 */
export function validateTrialFeedback(body: unknown): TrialFeedbackValidation {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as {
    rating?: unknown
    comment?: unknown
  }

  if (
    typeof raw.rating !== 'number' ||
    !Number.isInteger(raw.rating) ||
    raw.rating < TRIAL_FEEDBACK_RATING_MIN ||
    raw.rating > TRIAL_FEEDBACK_RATING_MAX
  ) {
    return {
      ok: false,
      error: `Rating must be an integer between ${TRIAL_FEEDBACK_RATING_MIN} and ${TRIAL_FEEDBACK_RATING_MAX}`,
    }
  }

  let comment: string | null = null
  if (raw.comment !== undefined && raw.comment !== null) {
    if (typeof raw.comment !== 'string') {
      return { ok: false, error: 'Comment must be text' }
    }
    const trimmed = raw.comment.trim()
    if (trimmed.length > TRIAL_FEEDBACK_COMMENT_MAX_LENGTH) {
      return { ok: false, error: `Comment must be ${TRIAL_FEEDBACK_COMMENT_MAX_LENGTH} characters or fewer` }
    }
    comment = trimmed.length > 0 ? trimmed : null
  }

  return { ok: true, value: { rating: raw.rating, comment } }
}
