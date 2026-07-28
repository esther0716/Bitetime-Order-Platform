// Pure aggregation for the merchant Overview dashboard AND the Pro revenue export. No Supabase
// / React here — the dashboard fetches rows via store.ts, this turns them into KPI numbers and
// chart series. Kept pure so it is unit-tested like pricing.ts.
//
// It lives in @bitetime/shared because it now runs on both sides of the wire: the browser draws
// the chart, the backend builds the XLSX the merchant downloads, and a stat derived on one side
// only is a file that disagrees with the chart it came from.

import { isTimezone } from './fulfilment.js'

// Shared code cannot import the frontend's `Order`/`Product`/`Voucher`, so it states only the
// shape it actually reads. The frontend's own types are structurally assignable to these, which
// is why Overview.tsx keeps compiling without a cast.
export interface StatsOrderItem {
  id?: string
  name?: string
  qty?: number
  price?: number
}

export interface StatsOrder {
  created_at?: string
  status?: string
  total?: number
  items?: StatsOrderItem[]
}

/** Only `usedBy` is read — the length of it is the redemption count. */
export interface StatsVoucher {
  usedBy?: unknown[]
  [key: string]: unknown
}

export interface Delta { pct: number; dir: 'up' | 'down' | 'flat' }
// One bar of the revenue chart. `label` is what the axis shows; `range` is set only
// on weekly buckets, where the axis label alone (the week's first day) would be a lie
// about what the bar contains — the tooltip shows this instead. `start`/`end` are the
// bucket's civil dates in the shop's zone: the chart ignores them, the XLSX export
// writes them as its two date columns.
export interface SeriesPoint {
  key: string
  label: string
  range?: string
  start: string
  end: string
  revenue: number
  orders: number
}
// A wedge of the revenue donut, and a row of the export's product sheet. `units` is what the
// donut has no use for and a merchant reading a spreadsheet asks for immediately.
export interface Slice { name: string; value: number; units: number }
export interface StatusSlice { status: string; count: number; pct: number }

// The KPI block (totalOrders … vouchersRedeemed) is all-time, with its own
// month-over-month delta. Everything below it — `series`, `productRevenue`,
// `statusBreakdown` — covers the selected `SeriesWindow` and nothing else.
export interface MerchantStats {
  totalOrders: number
  revenue: number
  customerCount: number
  avgOrder: number
  vouchersRedeemed: number
  ordersDelta: Delta
  revenueDelta: Delta
  series: SeriesPoint[]
  granularity: Granularity
  productRevenue: Slice[]
  statusBreakdown: StatusSlice[]
}

export type Granularity = 'day' | 'week'

// What the revenue chart covers, and how finely. `granularity` is what the merchant
// picked; leave it off to get the default for the range.
//
// `timeZone` is the SHOP's zone (`merchants.timezone`). Omit it and days are bucketed in the
// runtime's own zone, which is right for a browser standing in for its merchant and wrong for a
// UTC server building the same numbers into a file.
export interface SeriesWindow {
  days: number
  granularity?: Granularity
  timeZone?: string
  /**
   * How many products the breakdown keeps before folding the rest into "Other". Six by default,
   * which is as many wedges as the donut can label; the XLSX export passes `Infinity`, because a
   * spreadsheet row saying "Other" is a question, not an answer.
   */
  productTop?: number
}

/**
 * The ranges the dashboard offers, and the only ones the XLSX export accepts.
 *
 * Shared because it must hold identically on both sides of the wire: the pills offer these, and
 * the export endpoint REFUSES anything else outright rather than clamping it (a clamped request
 * returns a file that quietly answers a different question). Two copies of this list could drift,
 * and a drifted list means a pill the merchant can press that the download then 400s.
 */
export const REVENUE_RANGES = [12, 30, 60, 90] as const
export type RevenueRange = (typeof REVENUE_RANGES)[number]

export const isRevenueRange = (n: unknown): n is RevenueRange =>
  typeof n === 'number' && (REVENUE_RANGES as readonly number[]).includes(n)

// Past a month, one bar per day is unreadable: the bars go to slivers and the axis
// drops most of its labels. Bucket by week instead — 90 days is 13 bars, not 90.
// This is the default only; the merchant can override it either way.
export const granularityFor = (days: number): Granularity => (days > 30 ? 'week' : 'day')

/**
 * "Booked" revenue counts every order that wasn't cancelled (pending orders are
 * still money in the pipeline) — matches the storefront's own total field.
 *
 * Exported because the shop-customer aggregation charges by the same rule, and a second
 * copy of it — in TypeScript or, worse, in SQL — is how the customer list ends up
 * disagreeing with the revenue chart about what a shop actually took.
 */
export const isBooked = (o: StatsOrder) => (o.status ?? 'new') !== 'cancelled'
const orderTotal = (o: StatsOrder) => (isBooked(o) ? Number(o.total) || 0 : 0)

function delta(cur: number, prev: number): Delta {
  if (prev === 0) return { pct: cur > 0 ? 100 : 0, dir: cur > 0 ? 'up' : 'flat' }
  const pct = ((cur - prev) / prev) * 100
  return { pct: Math.round(pct), dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' }
}

const MS_PER_DAY = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * A clock that reports which civil day an instant falls on in `tz`, as a day index (whole days
 * since the epoch).
 *
 * Integer arithmetic from here on: no local midnights, so a DST shift inside the window cannot
 * round a day to 0.96 and land an order in the wrong bucket, and a UTC container gives the same
 * answer as the merchant's own browser.
 *
 * The formatter is built ONCE per call and reused across every order — constructing an
 * `Intl.DateTimeFormat` per row is the slow way to do this on a shop with thousands of orders.
 * An absent or unusable zone falls back to the runtime's own, which is the behaviour this
 * module had before it left the frontend.
 */
function zoneClock(tz?: string): (d: Date) => number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: isTimezone(tz) ? tz : undefined,
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return (d: Date) => {
    const parts = fmt.formatToParts(d)
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value)
    return Date.UTC(get('year'), get('month') - 1, get('day')) / MS_PER_DAY
  }
}

// A day index back into calendar fields. Built at UTC midnight, so the UTC getters are exact.
const civil = (dayIndex: number) => new Date(dayIndex * MS_PER_DAY)
const isoDay = (dayIndex: number) => {
  const d = civil(dayIndex)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
const dayLabel = (dayIndex: number) => {
  const d = civil(dayIndex)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}
const monthOf = (dayIndex: number) => {
  const d = civil(dayIndex)
  return d.getUTCFullYear() * 12 + d.getUTCMonth()
}

/**
 * The orders inside the last `days` days ending on `now`, in the shop's zone.
 *
 * An order whose `created_at` is missing or unparseable cannot be placed in the window, so it is
 * out — the same call `revenueSeries` makes bucket-side, kept here so every ranged panel drops
 * exactly the same rows.
 *
 * Exported because the XLSX export needs the window's own totals, and `MerchantStats`'s KPI
 * block is deliberately all-time (it sits above the range pills on the dashboard).
 */
export function ordersInWindow(
  orders: StatsOrder[], now: Date, days: number, timeZone?: string,
): StatsOrder[] {
  const dayOf = zoneClock(timeZone)
  return filterByWindow(orders, dayOf(now), days, dayOf)
}

// The same rule against a clock the caller already built, so `computeMerchantStats` does not
// construct a second `Intl.DateTimeFormat` just to reuse the public helper above.
function filterByWindow(
  orders: StatsOrder[], today: number, days: number, dayOf: (d: Date) => number,
): StatsOrder[] {
  return orders.filter(o => {
    if (!o.created_at) return false
    const d = new Date(o.created_at)
    if (Number.isNaN(d.getTime())) return false
    const ago = today - dayOf(d)
    return ago >= 0 && ago < days
  })
}

// Buckets covering the last `days` days ending on `now` (inclusive), oldest first.
// Weekly buckets are trailing 7-day windows anchored on today — not calendar weeks, so the
// newest bar is always a full week rather than a part-week that reads as a collapse in sales.
// The oldest bucket is the short one instead (90 days is 12 whole weeks plus 6 days).
function revenueSeries(
  orders: StatsOrder[],
  today: number,
  days: number,
  granularity: Granularity,
  dayOf: (d: Date) => number,
): SeriesPoint[] {
  const span = granularity === 'week' ? 7 : 1
  const bucketCount = Math.ceil(days / span)
  const points: SeriesPoint[] = []

  // Bucket b counts back from today: it holds orders `b * span` … `b * span + span - 1` days ago.
  for (let b = bucketCount - 1; b >= 0; b--) {
    const newest = today - b * span
    const oldest = today - Math.min(b * span + span - 1, days - 1)
    points.push({
      key: String(b),
      label: dayLabel(oldest),
      range: granularity === 'week' ? `${dayLabel(oldest)} – ${dayLabel(newest)}` : undefined,
      start: isoDay(oldest),
      end: isoDay(newest),
      revenue: 0,
      orders: 0,
    })
  }

  for (const o of orders) {
    if (!o.created_at) continue
    const d = new Date(o.created_at)
    if (Number.isNaN(d.getTime())) continue
    const ago = today - dayOf(d)
    if (ago < 0 || ago >= days) continue
    const p = points[bucketCount - 1 - Math.floor(ago / span)]
    if (!p) continue
    p.orders += 1
    p.revenue += orderTotal(o)
  }
  return points
}

// Revenue per product from line items; top `top` by value, remainder folded into "Other".
// Callers pass orders already narrowed to the window.
function productRevenue(orders: StatsOrder[], top: number): Slice[] {
  const by = new Map<string, { value: number; units: number }>()
  for (const o of orders) {
    if (!isBooked(o)) continue
    for (const it of o.items ?? []) {
      const name = it.name || it.id || '—'
      const qty = Number(it.qty) || 0
      const cur = by.get(name) ?? { value: 0, units: 0 }
      cur.value += (Number(it.price) || 0) * qty
      cur.units += qty
      by.set(name, cur)
    }
  }
  const sorted = [...by.entries()]
    .map(([name, v]) => ({ name, value: v.value, units: v.units }))
    .sort((a, b) => b.value - a.value)
  if (sorted.length <= top) return sorted
  const head = sorted.slice(0, top)
  const tail = sorted.slice(top)
  const value = tail.reduce((s, x) => s + x.value, 0)
  const units = tail.reduce((s, x) => s + x.units, 0)
  return value > 0 ? [...head, { name: 'Other', value, units }] : head
}

/** Order count, booked revenue and average, over whatever list of orders it is handed. */
export interface WindowTotals {
  totalOrders: number
  revenue: number
  avgOrder: number
}

/**
 * The same three figures the KPI cards show, over an arbitrary list of orders.
 *
 * The export needs them for its selected range, and `MerchantStats`'s own totals are all-time on
 * purpose — the cards sit above the range pills on the dashboard. Exported rather than
 * reimplemented on the backend so "revenue excludes cancelled orders" is stated once.
 */
export function windowTotals(orders: StatsOrder[]): WindowTotals {
  const booked = orders.filter(isBooked)
  const revenue = orders.reduce((s, o) => s + orderTotal(o), 0)
  return {
    totalOrders: orders.length,
    revenue,
    avgOrder: booked.length ? revenue / booked.length : 0,
  }
}

function statusBreakdown(orders: StatsOrder[]): StatusSlice[] {
  const by = new Map<string, number>()
  for (const o of orders) {
    const s = String(o.status ?? 'new')
    by.set(s, (by.get(s) ?? 0) + 1)
  }
  const total = orders.length || 1
  return [...by.entries()]
    .map(([status, count]) => ({ status, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Every figure the dashboard's Overview shows, from one shop's whole order history.
 *
 * `orders` must be the shop's COMPLETE history, not a page of it: `totalOrders`, `revenue` and
 * both deltas are all-time by design (the KPI cards sit above the range pills), so a truncated
 * list here does not produce a smaller chart — it produces a wrong revenue figure with nothing
 * on screen saying so. That is #144, and it is why this now runs on the backend against an
 * uncapped read rather than in a browser holding whatever the row cap let through.
 *
 * `customerCount` is a count rather than the customers themselves because nothing here needs
 * more than how many there are — see `distinctCustomerCount` for the rule that decides who is
 * one person.
 */
export function computeMerchantStats(
  orders: StatsOrder[],
  customerCount: number,
  vouchers: StatsVoucher[],
  now: Date = new Date(),
  window: SeriesWindow = { days: 12 },
): MerchantStats {
  const { days, granularity = granularityFor(days), timeZone, productTop = 6 } = window
  const dayOf = zoneClock(timeZone)
  const today = dayOf(now)
  // Everything the merchant sees under the range pills reads the same window: the bar chart,
  // the product donut and the status breakdown. They used to disagree — only the chart was
  // ranged, so a shop with older history read all-time figures beside a "last 12 days" chart
  // with nothing on screen saying so. The KPI cards above the pills stay all-time on purpose.
  const windowed = filterByWindow(orders, today, days, dayOf)
  const booked = orders.filter(isBooked)
  const revenue = orders.reduce((s, o) => s + orderTotal(o), 0)
  const thisKey = monthOf(today)

  let ordersThis = 0, ordersLast = 0, revThis = 0, revLast = 0
  for (const o of orders) {
    if (!o.created_at) continue
    const d = new Date(o.created_at)
    if (Number.isNaN(d.getTime())) continue
    const k = monthOf(dayOf(d))
    if (k === thisKey) { ordersThis++; revThis += orderTotal(o) }
    else if (k === thisKey - 1) { ordersLast++; revLast += orderTotal(o) }
  }

  return {
    totalOrders: orders.length,
    revenue,
    customerCount,
    avgOrder: booked.length ? revenue / booked.length : 0,
    vouchersRedeemed: vouchers.reduce((s, v) => s + (v.usedBy?.length ?? 0), 0),
    ordersDelta: delta(ordersThis, ordersLast),
    revenueDelta: delta(revThis, revLast),
    series: revenueSeries(windowed, today, days, granularity, dayOf),
    granularity,
    productRevenue: productRevenue(windowed, productTop),
    statusBreakdown: statusBreakdown(windowed),
  }
}
