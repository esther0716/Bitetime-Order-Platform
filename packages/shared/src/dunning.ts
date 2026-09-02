// When an unpaid renewal closes a shop.
//
// SHARED because the two sides must not disagree by so much as an hour: the backend SUSPENDS on
// this deadline and the merchant dashboard COUNTS DOWN to it. A merchant told "your shop closes
// on Friday" whose shop closed on Thursday has been lied to by software, and the only way to be
// sure that cannot happen is one rule with one copy.

/**
 * How long a shop stays open after a renewal payment fails.
 *
 * Three days. Short deliberately: the shop is selling on credit the whole time, and the merchant
 * is warned every day of it (see the reminder emails and the dashboard banner). Stripe's own
 * retries continue after this — closing the storefront does not cancel the subscription, and the
 * moment the invoice is paid the shop reopens on its own.
 */
export const PAST_DUE_GRACE_DAYS = 3

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The instant an unpaid shop closes, or null when there is nothing to count from.
 *
 * `periodStart` is the start of the period the shop has NOT paid for — Stripe's
 * `current_period_start` on the subscription. NOT the period END: Stripe advances the billing
 * period when it issues the renewal invoice, whether or not that invoice is ever paid, so the end
 * of a past_due subscription's period is a month in the future and measures nothing at all.
 *
 * Null in, null out, and an unparseable date is null too: no deadline means no closure and no
 * countdown, which is the safe direction for both callers.
 */
export function pastDueDeadline(periodStart: string | null | undefined): Date | null {
  if (!periodStart) return null
  const started = new Date(periodStart).getTime()
  if (Number.isNaN(started)) return null
  return new Date(started + PAST_DUE_GRACE_DAYS * DAY_MS)
}

/**
 * Has this shop's grace run out? True only for a `past_due` subscription past its deadline.
 *
 * The status test is first and load-bearing: every healthy shop's period started weeks ago, so a
 * deadline read without it would close all of them.
 */
export function pastDueGraceExpired(
  status: string | null | undefined,
  periodStart: string | null | undefined,
  now: Date,
): boolean {
  if (status !== 'past_due') return false
  const deadline = pastDueDeadline(periodStart)
  return !!deadline && now.getTime() >= deadline.getTime()
}

/**
 * Whole days left before the shop closes, floored at 0. What the dashboard banner says out loud,
 * so it rounds DOWN — "1 day left" with 30 hours to go is a promise that can be kept.
 */
export function pastDueDaysLeft(periodStart: string | null | undefined, now: Date): number {
  const deadline = pastDueDeadline(periodStart)
  if (!deadline) return PAST_DUE_GRACE_DAYS
  return Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / DAY_MS))
}
