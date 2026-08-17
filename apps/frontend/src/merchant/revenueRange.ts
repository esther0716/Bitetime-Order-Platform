// The Overview's revenue range, as one value.
//
// A merchant either presses one of the pills (the last N days, ending today) or names their own
// two dates (#234). Both are a `RevenueSelection`, so the chart panel, the two panels under it and
// the XLSX download all read one thing and none of them has to ask which kind it is.
//
// Pure: the wire format and the span live here, the React state and the date inputs live in
// Overview.tsx. `parseCustomRange` is the SHARED rule the API refuses with, which is what keeps a
// range the merchant can submit from being one the download then 400s.
import { parseCustomRange, type Granularity, type RevenueRange } from '@bitetime/shared'

export type RevenueSelection =
  | { kind: 'last'; days: RevenueRange }
  | { kind: 'custom'; from: string; to: string }

/** The query string both revenue endpoints read — one window, never two. */
export function revenueQuery(sel: RevenueSelection, granularity: Granularity): string {
  const window = sel.kind === 'custom'
    ? `from=${sel.from}&to=${sel.to}`
    : `days=${sel.days}`
  return `${window}&granularity=${granularity}`
}

/**
 * How many days the selection covers, or null if the merchant's dates are not yet a range the API
 * would accept — which is the ordinary state of two date inputs halfway through being filled in.
 *
 * `today` is the SHOP's civil day, so a merchant reading their dashboard abroad cannot ask for a
 * tomorrow their shop has not had.
 */
export function selectionSpan(sel: RevenueSelection, today: string): number | null {
  if (sel.kind === 'last') return sel.days
  const parsed = parseCustomRange(sel.from, sel.to, today)
  return parsed.ok ? parsed.days : null
}
