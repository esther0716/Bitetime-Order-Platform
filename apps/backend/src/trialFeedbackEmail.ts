// Pure email builder for the trial-feedback survey (#155) — mirrors buildTrialReminderEmail
// in billingLifecycle.ts. Text-only: like the trial reminder, this is a transactional nudge,
// not a marketing send. Kept in its own file, separate from trialFeedback.ts's DB access, so
// it can be unit tested without a Supabase stack — importing `admin` (trialFeedback.ts) pulls
// in env.ts at module load, which fails outside tests/api's stubbed environment.

export interface TrialFeedbackEmailInput {
  shopName: string
  dashboardUrl: string
}

export function buildTrialFeedbackEmail({ shopName, dashboardUrl }: TrialFeedbackEmailInput) {
  const subject = `How was your TinyOrder trial for ${shopName}?`
  const text = `Hi,

Your free trial for ${shopName} has ended. We'd love to know how it went — good or bad, it all helps.

Leave a quick rating: ${dashboardUrl}

It takes less than a minute.

— TinyOrder`
  return { subject, text }
}
