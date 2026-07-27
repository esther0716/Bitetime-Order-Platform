// Pure aggregation for the merchant Overview dashboard. No Supabase / React here —
// the dashboard fetches rows via store.ts, this turns them into KPI numbers and
// chart series. Kept pure so it is unit-tested like pricing.ts.

import type { Order, Product, Voucher } from '../types'

export interface Delta { pct: number; dir: 'up' | 'down' | 'flat' }
// One bar of the revenue chart. `label` is what the axis shows; `range` is set only
// on weekly buckets, where the axis label alone (the week's first day) would be a lie
// about what the bar contains — the tooltip shows this instead.
export interface SeriesPoint { key: string; label: string; range?: string; revenue: number; orders: number }
export interface Slice { name: string; value: number }
export interface StatusSlice { status: string; count: number; pct: number }

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

// Past a month, one bar per day is unreadable: the bars go to slivers and the axis
// drops most of its labels. Bucket by week instead — 90 days is 13 bars, not 90.
export const granularityFor = (days: number): Granularity => (days > 30 ? 'week' : 'day')

// "Booked" revenue counts every order that wasn't cancelled (pending orders are
// still money in the pipeline) — matches the storefront's own total field.
const counts = (o: Order) => (o.status ?? 'new') !== 'cancelled'
const orderTotal = (o: Order) => (counts(o) ? Number(o.total) || 0 : 0)

function monthKey(iso?: string): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.getFullYear() * 12 + d.getMonth()
}

function delta(cur: number, prev: number): Delta {
  if (prev === 0) return { pct: cur > 0 ? 100 : 0, dir: cur > 0 ? 'up' : 'flat' }
  const pct = ((cur - prev) / prev) * 100
  return { pct: Math.round(pct), dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' }
}

const MS_PER_DAY = 86_400_000
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const dayLabel = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`

// Whole days between two local midnights. Uses UTC arithmetic on the floored dates so a
// DST shift inside the window cannot round a day to 0.96 and land an order in the wrong bucket.
function daysAgo(then: Date, now: Date): number {
  const a = midnight(then), b = midnight(now)
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
    - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / MS_PER_DAY)
}

// Buckets covering the last `days` days ending on `now` (inclusive), oldest first.
// Weekly buckets are trailing 7-day windows anchored on today — not calendar weeks, so the
// newest bar is always a full week rather than a part-week that reads as a collapse in sales.
// The oldest bucket is the short one instead (90 days is 12 whole weeks plus 6 days).
function revenueSeries(orders: Order[], now: Date, days: number, granularity: Granularity): SeriesPoint[] {
  const span = granularity === 'week' ? 7 : 1
  const bucketCount = Math.ceil(days / span)
  const points: SeriesPoint[] = []

  // Bucket b counts back from today: it holds orders `b * span` … `b * span + span - 1` days ago.
  for (let b = bucketCount - 1; b >= 0; b--) {
    const newest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - b * span)
    const oldestOffset = Math.min(b * span + span - 1, days - 1)
    const oldest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - oldestOffset)
    points.push({
      key: String(b),
      label: dayLabel(oldest),
      range: granularity === 'week' ? `${dayLabel(oldest)} – ${dayLabel(newest)}` : undefined,
      revenue: 0,
      orders: 0,
    })
  }

  for (const o of orders) {
    if (!o.created_at) continue
    const d = new Date(o.created_at)
    if (Number.isNaN(d.getTime())) continue
    const ago = daysAgo(d, now)
    if (ago < 0 || ago >= days) continue
    const p = points[bucketCount - 1 - Math.floor(ago / span)]
    if (!p) continue
    p.orders += 1
    p.revenue += orderTotal(o)
  }
  return points
}

// Revenue per product from line items; top `top` by value, remainder folded into "Other".
function productRevenue(orders: Order[], top: number): Slice[] {
  const by = new Map<string, number>()
  for (const o of orders) {
    if (!counts(o)) continue
    for (const it of o.items ?? []) {
      const name = it.name || it.id || '—'
      const value = (Number(it.price) || 0) * (Number(it.qty) || 0)
      by.set(name, (by.get(name) ?? 0) + value)
    }
  }
  const sorted = [...by.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  if (sorted.length <= top) return sorted
  const head = sorted.slice(0, top)
  const other = sorted.slice(top).reduce((s, x) => s + x.value, 0)
  return other > 0 ? [...head, { name: 'Other', value: other }] : head
}

function statusBreakdown(orders: Order[]): StatusSlice[] {
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

export function computeMerchantStats(
  orders: Order[],
  _products: Product[],
  customers: { orderCount?: number }[],
  vouchers: Voucher[],
  now: Date = new Date(),
  days = 12,
): MerchantStats {
  const booked = orders.filter(counts)
  const revenue = orders.reduce((s, o) => s + orderTotal(o), 0)
  const thisKey = now.getFullYear() * 12 + now.getMonth()
  const granularity = granularityFor(days)

  let ordersThis = 0, ordersLast = 0, revThis = 0, revLast = 0
  for (const o of orders) {
    const k = monthKey(o.created_at)
    if (k === thisKey) { ordersThis++; revThis += orderTotal(o) }
    else if (k === thisKey - 1) { ordersLast++; revLast += orderTotal(o) }
  }

  return {
    totalOrders: orders.length,
    revenue,
    customerCount: customers.length,
    avgOrder: booked.length ? revenue / booked.length : 0,
    vouchersRedeemed: vouchers.reduce((s, v) => s + (v.usedBy?.length ?? 0), 0),
    ordersDelta: delta(ordersThis, ordersLast),
    revenueDelta: delta(revThis, revLast),
    series: revenueSeries(orders, now, days, granularity),
    granularity,
    productRevenue: productRevenue(orders, 6),
    statusBreakdown: statusBreakdown(orders),
  }
}
