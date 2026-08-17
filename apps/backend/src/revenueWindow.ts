// Which window a revenue request asks for.
//
// Both `/api/merchants/:id/stats` and `/api/merchants/:id/report.xlsx` answer over a window, and
// there are exactly two ways to name one: a pill from `REVENUE_RANGES` (the last N days, ending
// today) or the merchant's own two civil dates (#234). This module turns the query string into
// one of them, or refuses.
//
// Pure — no Hono, no clock, no database — so the rule is unit-tested rather than driven through
// HTTP eight times. `today` is the SHOP's civil day, resolved by the caller from
// `merchants.timezone`: a merchant reading their dashboard abroad must not be able to ask for a
// tomorrow their shop has not had yet.
//
// Everything here REFUSES rather than narrows, which is the rule the pills already followed: a
// clamped request hands back a figure that quietly answers a different question than the one
// asked, over a merchant's own accounting.
import { isRevenueRange, parseCustomRange } from '@bitetime/shared'

export type ResolvedRevenueRange =
  | { ok: true; kind: 'last-n'; days: number }
  | { ok: true; kind: 'custom'; days: number; from: string; to: string }
  | { ok: false }

/**
 * @param daysParam    the `days` query param, if any
 * @param fromParam    the `from` query param, if any — `YYYY-MM-DD` in the shop's zone
 * @param toParam      the `to` query param, if any
 * @param today        the shop's own civil day, `YYYY-MM-DD`
 * @param defaultDays  the window to assume when the request names none, or null to refuse
 *                     (the export names null: a workbook of an unstated range gets filed)
 */
export function resolveRevenueRange(
  daysParam: string | undefined,
  fromParam: string | undefined,
  toParam: string | undefined,
  today: string,
  defaultDays: number | null,
): ResolvedRevenueRange {
  if (fromParam !== undefined || toParam !== undefined) {
    // Two windows in one request is not a range to choose between, it is a request whose author
    // did not know which one they were asking for.
    if (daysParam !== undefined) return { ok: false }
    if (fromParam === undefined || toParam === undefined) return { ok: false }
    const parsed = parseCustomRange(fromParam, toParam, today)
    if (!parsed.ok) return { ok: false }
    return { ok: true, kind: 'custom', days: parsed.days, from: parsed.from, to: parsed.to }
  }

  const raw = daysParam ?? (defaultDays === null ? undefined : String(defaultDays))
  const days = Number(raw)
  // `Number(undefined)` is NaN and `Number('')` is 0 — neither is a range, and `isRevenueRange`
  // is the same list the dashboard's pills are built from.
  if (!isRevenueRange(days)) return { ok: false }
  return { ok: true, kind: 'last-n', days }
}
