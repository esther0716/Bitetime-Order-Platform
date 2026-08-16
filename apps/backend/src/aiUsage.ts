// The pure half of the monthly Claude ceiling: which bucket a call is billed to, and when the
// merchant gets their allowance back. The counter itself is aiUsageDb.ts, for the reason every
// other `xDb.ts` in this directory exists — this half must stay reachable from `pnpm test`, which
// runs with no env and no Supabase.
import { todayInZone } from '@bitetime/shared'

/** The two features that spend the platform's Anthropic budget on a merchant's behalf. */
export type AiFeature = 'menu_import' | 'assistant'

/**
 * The bucket that never resets, for an allowance a shop gets once rather than monthly.
 *
 * A literal rather than a null period so one primary key covers both kinds of bucket and
 * `consumeAiCall` needs no second code path. The database's own check constraint accepts this
 * exact string and no other non-month value.
 */
export const LIFETIME_PERIOD = 'lifetime'

/**
 * The bucket a call made at `now` belongs to, as 'YYYY-MM' on the SHOP's clock.
 *
 * The shop's clock and not the server's: a merchant is told their allowance returns on the 1st,
 * and it has to be their 1st. `todayInZone` already falls back on an unreadable zone rather than
 * throwing, which is what keeps a bad `merchants.timezone` row from taking the route down.
 */
export function usagePeriod(timeZone: string, now: Date): string {
  return todayInZone(timeZone, now).slice(0, 7)
}

/**
 * The day the allowance returns: the first of the month after `period`, as 'YYYY-MM-DD'.
 *
 * Sent to the merchant with the refusal, because "you have reached this month's limit" without a
 * date reads as "this feature is gone".
 */
export function nextResetDate(period: string): string {
  const [year, month] = period.split('-').map(Number)
  const rolls = month === 12
  const nextYear = rolls ? year + 1 : year
  const nextMonth = rolls ? 1 : month + 1
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
}
