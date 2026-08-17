import { describe, it, expect } from 'vitest'
import {
  computeMerchantStats, ordersInWindow, windowTotals, isBooked, isRevenueRange, REVENUE_RANGES,
  parseCustomRange, MAX_CUSTOM_SPAN_DAYS,
} from './merchantStats.js'
import type { StatsOrder } from './merchantStats.js'

const NOW = new Date('2026-06-15T12:00:00')

function order(o: Partial<StatsOrder>): StatsOrder {
  return { status: 'completed', total: 0, items: [], created_at: NOW.toISOString(), ...o }
}

describe('computeMerchantStats', () => {
  it('totals revenue over non-cancelled orders and counts every order', () => {
    const orders = [
      order({ total: 30 }),
      order({ total: 20 }),
      order({ total: 99, status: 'cancelled' }),
    ]
    const s = computeMerchantStats(orders, 0, [], NOW)
    expect(s.totalOrders).toBe(3)
    expect(s.revenue).toBe(50) // cancelled excluded
    expect(s.avgOrder).toBe(25) // 50 / 2 booked
  })

  it('avgOrder is 0 with no booked orders', () => {
    const s = computeMerchantStats([], 0, [], NOW)
    expect(s.avgOrder).toBe(0)
    expect(s.revenue).toBe(0)
  })

  it('counts customers and redeemed voucher uses', () => {
    const s = computeMerchantStats([], 2, [
      { code: 'A', usedBy: ['x', 'y'] },
      { code: 'B', usedBy: [] },
    ], NOW)
    expect(s.customerCount).toBe(2)
    expect(s.vouchersRedeemed).toBe(2)
  })

  it('computes month-over-month order delta', () => {
    const may = new Date('2026-05-10T10:00:00').toISOString()
    const orders = [
      order({ total: 10 }), order({ total: 10 }), order({ total: 10 }), // 3 this month (Jun)
      order({ total: 10, created_at: may }),                            // 1 last month (May)
    ]
    const s = computeMerchantStats(orders, 0, [], NOW)
    expect(s.ordersDelta).toEqual({ pct: 200, dir: 'up' }) // 3 vs 1
    expect(s.revenueDelta.dir).toBe('up')
  })

  it('delta is up=100 when previous month had zero', () => {
    const s = computeMerchantStats([order({ total: 5 })], 0, [], NOW)
    expect(s.ordersDelta).toEqual({ pct: 100, dir: 'up' })
  })

  it('builds a daily series of the requested length, bucketing revenue', () => {
    const orders = [order({ total: 40, created_at: new Date('2026-06-15T08:00:00').toISOString() })]
    const s = computeMerchantStats(orders, 0, [], NOW, { days: 12 })
    expect(s.granularity).toBe('day')
    expect(s.series).toHaveLength(12)
    const today = s.series[s.series.length - 1]
    expect(today.label).toBe('6/15')
    expect(today.range).toBeUndefined() // daily bars need no range in the tooltip
    expect(today.revenue).toBe(40)
    expect(today.orders).toBe(1)
  })

  it('stays daily at 30 days and switches to weekly past it', () => {
    expect(computeMerchantStats([], 0, [], NOW, { days: 30 }).granularity).toBe('day')
    expect(computeMerchantStats([], 0, [], NOW, { days: 30 }).series).toHaveLength(30)
    expect(computeMerchantStats([], 0, [], NOW, { days: 60 }).granularity).toBe('week')
    expect(computeMerchantStats([], 0, [], NOW, { days: 60 }).series).toHaveLength(9) // 8 whole weeks + a 4-day tail
    expect(computeMerchantStats([], 0, [], NOW, { days: 90 }).series).toHaveLength(13) // 12 whole weeks + a 6-day tail
  })

  it('an explicit granularity overrides the default for the range, either way', () => {
    const daily90 = computeMerchantStats([], 0, [], NOW, { days: 90, granularity: 'day' })
    expect(daily90.granularity).toBe('day')
    expect(daily90.series).toHaveLength(90)
    expect(daily90.series[0].range).toBeUndefined()

    const weekly12 = computeMerchantStats([], 0, [], NOW, { days: 12, granularity: 'week' })
    expect(weekly12.granularity).toBe('week')
    expect(weekly12.series).toHaveLength(2) // one whole week + a 5-day tail
    expect(weekly12.series[weekly12.series.length - 1].range).toBe('6/9 – 6/15')
  })

  it('a forced granularity still bins every order in the window exactly once', () => {
    const orders = [
      order({ total: 10, created_at: new Date('2026-06-15T09:00:00').toISOString() }),
      order({ total: 20, created_at: new Date('2026-05-01T09:00:00').toISOString() }),
      order({ total: 30, created_at: new Date('2026-03-25T09:00:00').toISOString() }),
    ]
    for (const granularity of ['day', 'week'] as const) {
      const s = computeMerchantStats(orders, 0, [], NOW, { days: 90, granularity })
      expect(s.series.reduce((sum, p) => sum + p.revenue, 0)).toBe(60)
      expect(s.series.reduce((sum, p) => sum + p.orders, 0)).toBe(3)
    }
  })

  it('weekly buckets are trailing 7-day windows anchored on today, newest one whole', () => {
    const s = computeMerchantStats([], 0, [], NOW, { days: 90 })
    const newest = s.series[s.series.length - 1]
    expect(newest.range).toBe('6/9 – 6/15') // ends today, seven days wide
    expect(newest.label).toBe('6/9')        // axis shows the window's first day
    expect(s.series[0].range).toBe('3/18 – 3/23') // oldest window is the short one
  })

  it('sums a whole week into one weekly bar, and drops orders past the window', () => {
    const at = (iso: string, total: number) => order({ total, created_at: new Date(iso).toISOString() })
    const s = computeMerchantStats([
      at('2026-06-09T09:00:00', 10), // first day of the newest week
      at('2026-06-15T09:00:00', 15), // last day of the newest week (today)
      at('2026-06-08T09:00:00', 7),  // one day earlier — previous week
      at('2026-03-17T09:00:00', 99), // 90 days back — outside the window
    ], 0, [], NOW, { days: 90 })

    const newest = s.series[s.series.length - 1]
    expect(newest.revenue).toBe(25)
    expect(newest.orders).toBe(2)
    expect(s.series[s.series.length - 2].revenue).toBe(7)
    expect(s.series.reduce((sum, p) => sum + p.revenue, 0)).toBe(32) // the 99 never lands
  })

  it('aggregates product revenue from line items, descending', () => {
    const orders = [
      order({ items: [{ id: 'p1', name: 'Cake', qty: 2, price: 10 }, { id: 'p2', name: 'Tea', qty: 1, price: 5 }] }),
      order({ items: [{ id: 'p1', name: 'Cake', qty: 1, price: 10 }] }),
    ]
    const s = computeMerchantStats(orders, 0, [], NOW)
    expect(s.productRevenue[0]).toEqual({ name: 'Cake', value: 30, units: 3 })
    expect(s.productRevenue[1]).toEqual({ name: 'Tea', value: 5, units: 1 })
  })

  it('folds products beyond the top 6 into "Other"', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, qty: 1, price: 9 - i }))
    const s = computeMerchantStats([order({ items })], 0, [], NOW)
    expect(s.productRevenue).toHaveLength(7) // 6 + Other
    expect(s.productRevenue[6].name).toBe('Other')
    expect(s.productRevenue[6].value).toBe(3 + 2 + 1) // p6,p7,p8 prices = 3,2,1
  })

  it('breaks down orders by status with percentages', () => {
    const orders = [order({ status: 'new' }), order({ status: 'new' }), order({ status: 'completed' }), order({ status: 'cancelled' })]
    const s = computeMerchantStats(orders, 0, [], NOW)
    expect(s.statusBreakdown[0]).toEqual({ status: 'new', count: 2, pct: 50 })
    expect(s.statusBreakdown.reduce((sum, x) => sum + x.count, 0)).toBe(4)
  })

  it('ranges the product donut and the status breakdown with the chart, not all-time', () => {
    const old = new Date('2026-01-10T09:00:00').toISOString() // months before any window
    const orders = [
      order({ status: 'completed', total: 10, items: [{ id: 'p1', name: 'Cake', qty: 1, price: 10 }] }),
      order({ status: 'cancelled', total: 99, created_at: old, items: [{ id: 'p2', name: 'Tea', qty: 5, price: 20 }] }),
    ]
    const s = computeMerchantStats(orders, 0, [], NOW, { days: 12 })
    expect(s.productRevenue).toEqual([{ name: 'Cake', value: 10, units: 1 }]) // the old Tea never lands
    expect(s.statusBreakdown).toEqual([{ status: 'completed', count: 1, pct: 100 }])
    // …and the KPI cards above the range pills stay all-time.
    expect(s.totalOrders).toBe(2)
  })

  it('widening the range pulls older orders into both panels', () => {
    const orders = [
      order({ items: [{ id: 'p1', name: 'Cake', qty: 1, price: 10 }] }),
      order({
        status: 'new',
        created_at: new Date('2026-05-01T09:00:00').toISOString(), // 45 days back
        items: [{ id: 'p2', name: 'Tea', qty: 1, price: 40 }],
      }),
    ]
    const short = computeMerchantStats(orders, 0, [], NOW, { days: 30 })
    expect(short.productRevenue.map(p => p.name)).toEqual(['Cake'])
    expect(short.statusBreakdown.map(x => x.status)).toEqual(['completed'])

    const long = computeMerchantStats(orders, 0, [], NOW, { days: 90 })
    expect(long.productRevenue.map(p => p.name)).toEqual(['Tea', 'Cake'])
    expect(long.statusBreakdown.map(x => x.count)).toEqual([1, 1])
    expect(long.statusBreakdown[0].pct).toBe(50)
  })

  it('drops orders with no usable date from the ranged panels, as the chart already did', () => {
    const orders = [
      order({ items: [{ id: 'p1', name: 'Cake', qty: 1, price: 10 }] }),
      order({ status: 'new', created_at: undefined, items: [{ id: 'p2', name: 'Tea', qty: 1, price: 40 }] }),
      order({ status: 'new', created_at: 'not-a-date', items: [{ id: 'p3', name: 'Bun', qty: 1, price: 40 }] }),
    ]
    const s = computeMerchantStats(orders, 0, [], NOW, { days: 90 })
    expect(s.productRevenue).toEqual([{ name: 'Cake', value: 10, units: 1 }])
    expect(s.statusBreakdown).toEqual([{ status: 'completed', count: 1, pct: 100 }])
  })
})

// ── Time zones ───────────────────────────────────────────────────────────────
// The chart runs in the merchant's browser and the XLSX export runs on a UTC server. Unless
// both bucket by the SHOP's civil day, an evening order lands on different days in the two, and
// the file disagrees with the chart it came from.
describe('computeMerchantStats time zones', () => {
  // 2026-06-14T17:30:00Z is 2026-06-15 01:30 in Asia/Kuala_Lumpur (UTC+8) but still the 14th in UTC.
  const NOW_UTC = new Date('2026-06-15T04:00:00Z')
  const LATE = order({ total: 40, created_at: '2026-06-14T17:30:00Z' })

  it('buckets an order by the shop’s civil day, not the runtime’s', () => {
    const kl = computeMerchantStats([LATE], 0, [], NOW_UTC,
      { days: 3, granularity: 'day', timeZone: 'Asia/Kuala_Lumpur' })
    const today = kl.series[kl.series.length - 1]
    expect(today.start).toBe('2026-06-15')
    expect(today.revenue).toBe(40)

    const utc = computeMerchantStats([LATE], 0, [], NOW_UTC,
      { days: 3, granularity: 'day', timeZone: 'UTC' })
    expect(utc.series[utc.series.length - 1].revenue).toBe(0)
    expect(utc.series[utc.series.length - 2].revenue).toBe(40)
  })

  it('labels every daily bucket with its own civil date, start equal to end', () => {
    const s = computeMerchantStats([], 0, [], NOW_UTC,
      { days: 3, granularity: 'day', timeZone: 'Asia/Kuala_Lumpur' })
    expect(s.series.map(p => p.start)).toEqual(['2026-06-13', '2026-06-14', '2026-06-15'])
    expect(s.series.every(p => p.start === p.end)).toBe(true)
  })

  it('gives a weekly bucket a seven-day span ending on the shop’s today', () => {
    const s = computeMerchantStats([], 0, [], NOW_UTC,
      { days: 14, granularity: 'week', timeZone: 'Asia/Kuala_Lumpur' })
    const last = s.series[s.series.length - 1]
    expect(last.start).toBe('2026-06-09')
    expect(last.end).toBe('2026-06-15')
  })

  // The window is ranged in the shop's zone too, not just the buckets — otherwise an order can
  // survive the filter and then find no bucket to sit in.
  it('ranges the product and status panels by the shop’s civil day', () => {
    const edge = order({ total: 5, created_at: '2026-06-12T17:00:00Z', items: [{ id: 'p', name: 'Bun', qty: 1, price: 5 }] })
    const kl = computeMerchantStats([edge], 0, [], NOW_UTC,
      { days: 3, granularity: 'day', timeZone: 'Asia/Kuala_Lumpur' })
    expect(kl.productRevenue).toEqual([{ name: 'Bun', value: 5, units: 1 }])

    const utc = computeMerchantStats([edge], 0, [], NOW_UTC,
      { days: 3, granularity: 'day', timeZone: 'UTC' })
    expect(utc.productRevenue).toEqual([])
  })

  it('falls back to the runtime zone when the window carries none', () => {
    const s = computeMerchantStats([], 0, [], NOW_UTC, { days: 3, granularity: 'day' })
    expect(s.series).toHaveLength(3)
    expect(s.series[2].start).toBe(s.series[2].end)
  })
})

// ── Export-shaped aggregates ─────────────────────────────────────────────────
// The XLSX export reads the same window as the chart but needs two things the dashboard does
// not: every product rather than the donut's legible top six, and totals for the WINDOW rather
// than the all-time KPI cards that sit above the range pills.
describe('productTop', () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, qty: 2, price: 9 - i }))

  it('folds beyond the top 6 by default, as the donut needs', () => {
    const s = computeMerchantStats([order({ items })], 0, [], NOW)
    expect(s.productRevenue).toHaveLength(7)
    expect(s.productRevenue[6].name).toBe('Other')
  })

  it('returns every product with no Other row when the cap is lifted', () => {
    const s = computeMerchantStats([order({ items })], 0, [], NOW, { days: 12, productTop: Infinity })
    expect(s.productRevenue).toHaveLength(9)
    expect(s.productRevenue.some(p => p.name === 'Other')).toBe(false)
  })

  it('counts units alongside revenue, and folds units into Other too', () => {
    const s = computeMerchantStats([order({ items })], 0, [], NOW)
    expect(s.productRevenue[0]).toEqual({ name: 'P0', value: 18, units: 2 })
    // p6, p7, p8 at prices 3, 2, 1 and two units each.
    expect(s.productRevenue[6]).toEqual({ name: 'Other', value: 2 * (3 + 2 + 1), units: 6 })
  })

  it('sums units across separate orders of the same product', () => {
    const one = order({ items: [{ id: 'a', name: 'Cookie', qty: 2, price: 5 }] })
    const two = order({ items: [{ id: 'a', name: 'Cookie', qty: 3, price: 5 }] })
    const s = computeMerchantStats([one, two], 0, [], NOW)
    expect(s.productRevenue).toEqual([{ name: 'Cookie', value: 25, units: 5 }])
  })
})

describe('windowTotals', () => {
  it('totals a list of orders, excluding cancelled revenue but counting the row', () => {
    expect(windowTotals([
      order({ total: 30 }),
      order({ total: 20 }),
      order({ total: 99, status: 'cancelled' }),
    ])).toEqual({ totalOrders: 3, revenue: 50, avgOrder: 25 })
  })

  it('is all zeroes on an empty window rather than dividing by nothing', () => {
    expect(windowTotals([])).toEqual({ totalOrders: 0, revenue: 0, avgOrder: 0 })
  })

  it('agrees with the all-time KPI block when the window holds everything', () => {
    const orders = [order({ total: 30 }), order({ total: 20 })]
    const s = computeMerchantStats(orders, 0, [], NOW, { days: 90 })
    const w = windowTotals(ordersInWindow(orders, NOW, { days: 90 }))
    expect(w).toEqual({ totalOrders: s.totalOrders, revenue: s.revenue, avgOrder: s.avgOrder })
  })

  it('totals a custom window that ends before today', () => {
    const at = (iso: string, total: number) => order({ total, created_at: new Date(iso).toISOString() })
    const orders = [
      at('2026-06-15T09:00:00Z', 99), // today — after the window's last day
      at('2026-06-10T09:00:00Z', 30), // the window's last day
      at('2026-06-06T09:00:00Z', 20), // the window's first day
      at('2026-06-05T09:00:00Z', 99), // one day too early
    ]
    const w = windowTotals(ordersInWindow(orders, NOW, { days: 5, endDate: '2026-06-10', timeZone: 'UTC' }))
    expect(w).toEqual({ totalOrders: 2, revenue: 50, avgOrder: 25 })
  })
})

describe('isBooked', () => {
  it('books every status except cancelled', () => {
    for (const status of ['new', 'preparing', 'ready', 'completed']) {
      expect(isBooked(order({ status }))).toBe(true)
    }
    expect(isBooked(order({ status: 'cancelled' }))).toBe(false)
  })

  it('books an order with no status at all — a fresh order is money in the pipeline', () => {
    expect(isBooked(order({ status: undefined }))).toBe(true)
    expect(isBooked(order({ status: null as unknown as string }))).toBe(true)
  })

  it('is the rule windowTotals already charges by', () => {
    const orders = [order({ total: 30 }), order({ total: 99, status: 'cancelled' })]
    const booked = orders.filter(isBooked)
    expect(windowTotals(orders).revenue).toBe(booked.reduce((s, o) => s + Number(o.total), 0))
  })
})

describe('isRevenueRange', () => {
  it('accepts exactly the ranges the pills offer', () => {
    expect(REVENUE_RANGES.every(isRevenueRange)).toBe(true)
  })

  it('rejects anything else, including the strings a query param arrives as', () => {
    for (const bad of [7, 0, -12, 91, 12.5, NaN, '12', null, undefined]) {
      expect(isRevenueRange(bad)).toBe(false)
    }
  })
})

// ── Custom range ─────────────────────────────────────────────────────────────
// The merchant can name their own two civil dates instead of pressing a pill (#234). The rule
// lives here, once, because the browser greys out Apply with it and the API refuses with it — two
// copies would mean a range the merchant can submit that the download then 400s.
describe('parseCustomRange', () => {
  const TODAY = '2026-06-15'

  it('accepts two civil dates and counts the span inclusively', () => {
    expect(parseCustomRange('2026-01-01', '2026-01-31', TODAY))
      .toEqual({ ok: true, days: 31, from: '2026-01-01', to: '2026-01-31' })
  })

  it('accepts a single day, from equal to to', () => {
    const r = parseCustomRange('2026-06-01', '2026-06-01', TODAY)
    expect(r).toEqual({ ok: true, days: 1, from: '2026-06-01', to: '2026-06-01' })
  })

  it('accepts a range ending today', () => {
    expect(parseCustomRange('2026-06-01', TODAY, TODAY)).toMatchObject({ ok: true, days: 15 })
  })

  it('refuses a reversed range rather than swapping it', () => {
    expect(parseCustomRange('2026-06-10', '2026-06-01', TODAY))
      .toEqual({ ok: false, reason: 'reversed' })
  })

  it('refuses a range reaching past today — there is no revenue there yet', () => {
    expect(parseCustomRange('2026-06-01', '2026-06-16', TODAY))
      .toEqual({ ok: false, reason: 'future' })
  })

  it('accepts a span of exactly the cap and refuses one day more', () => {
    expect(MAX_CUSTOM_SPAN_DAYS).toBe(366)
    expect(parseCustomRange('2025-06-15', '2026-06-15', TODAY)).toMatchObject({ ok: true, days: 366 })
    expect(parseCustomRange('2025-06-14', '2026-06-15', TODAY))
      .toEqual({ ok: false, reason: 'too_long' })
  })

  it('refuses anything that is not a YYYY-MM-DD civil date', () => {
    for (const bad of ['', '2026-1-1', '2026/06/01', 'yesterday', '2026-06-01T00:00:00Z', '20260601']) {
      expect(parseCustomRange(bad, '2026-06-10', TODAY)).toEqual({ ok: false, reason: 'bad_date' })
      expect(parseCustomRange('2026-06-01', bad, TODAY)).toEqual({ ok: false, reason: 'bad_date' })
    }
  })

  it('refuses a date that looks well-formed but does not exist', () => {
    // Date.UTC rolls 2026-02-30 forward to March 2 — accepting it would answer a different
    // question than the merchant asked.
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-06-31', '2026-06-00']) {
      expect(parseCustomRange(bad, '2026-06-10', TODAY)).toEqual({ ok: false, reason: 'bad_date' })
    }
  })

  it('accepts a real leap day and refuses the one that is not', () => {
    expect(parseCustomRange('2024-02-29', '2024-03-01', '2026-06-15')).toMatchObject({ ok: true, days: 2 })
    expect(parseCustomRange('2026-02-29', '2026-03-01', TODAY)).toEqual({ ok: false, reason: 'bad_date' })
  })

  it('checks the dates before the span, so a malformed year is not reported as too long', () => {
    expect(parseCustomRange('nonsense', '2026-06-15', TODAY)).toEqual({ ok: false, reason: 'bad_date' })
  })
})

// The window's last day, when the merchant named one. Every bucket rule is unchanged — they
// count back from this day instead of from today.
describe('computeMerchantStats endDate', () => {
  const NOW_UTC = new Date('2026-06-15T04:00:00Z')
  const at = (iso: string, total: number) => order({ total, created_at: new Date(iso).toISOString() })

  it('anchors the daily series on the named day, not on today', () => {
    const s = computeMerchantStats([], 0, [], NOW_UTC,
      { days: 5, endDate: '2026-06-10', granularity: 'day', timeZone: 'UTC' })
    expect(s.series.map(p => p.start)).toEqual([
      '2026-06-06', '2026-06-07', '2026-06-08', '2026-06-09', '2026-06-10',
    ])
  })

  it('anchors a weekly bucket on the named day, newest one whole', () => {
    const s = computeMerchantStats([], 0, [], NOW_UTC,
      { days: 14, endDate: '2026-06-10', granularity: 'week', timeZone: 'UTC' })
    const last = s.series[s.series.length - 1]
    expect(last.start).toBe('2026-06-04')
    expect(last.end).toBe('2026-06-10')
  })

  it('drops orders after the named day from every ranged panel', () => {
    const orders = [
      order({ status: 'new', total: 99, created_at: '2026-06-15T09:00:00Z', items: [{ id: 'p1', name: 'Tea', qty: 1, price: 99 }] }),
      order({ status: 'completed', total: 30, created_at: '2026-06-10T09:00:00Z', items: [{ id: 'p2', name: 'Cake', qty: 1, price: 30 }] }),
    ]
    const s = computeMerchantStats(orders, 0, [], NOW_UTC,
      { days: 5, endDate: '2026-06-10', granularity: 'day', timeZone: 'UTC' })
    expect(s.series.reduce((sum, p) => sum + p.revenue, 0)).toBe(30)
    expect(s.productRevenue).toEqual([{ name: 'Cake', value: 30, units: 1 }])
    expect(s.statusBreakdown).toEqual([{ status: 'completed', count: 1, pct: 100 }])
  })

  it('leaves the KPI cards all-time, as the pills already do', () => {
    const s = computeMerchantStats([at('2026-06-15T09:00:00Z', 99), at('2026-06-10T09:00:00Z', 30)],
      0, [], NOW_UTC, { days: 5, endDate: '2026-06-10', timeZone: 'UTC' })
    expect(s.totalOrders).toBe(2)
    expect(s.revenue).toBe(129)
  })

  it('reads the named day in the shop’s zone, like every other bucket', () => {
    // 17:30Z on the 10th is already the 11th in Kuala Lumpur, so the KL shop's window ends
    // before it and the UTC shop's window ends on it.
    const late = at('2026-06-10T17:30:00Z', 40)
    const kl = computeMerchantStats([late], 0, [], NOW_UTC,
      { days: 5, endDate: '2026-06-10', granularity: 'day', timeZone: 'Asia/Kuala_Lumpur' })
    expect(kl.series.reduce((sum, p) => sum + p.revenue, 0)).toBe(0)

    const utc = computeMerchantStats([late], 0, [], NOW_UTC,
      { days: 5, endDate: '2026-06-10', granularity: 'day', timeZone: 'UTC' })
    expect(utc.series[utc.series.length - 1].revenue).toBe(40)
  })

  it('an absent endDate still means today', () => {
    const withOut = computeMerchantStats([], 0, [], NOW_UTC, { days: 3, granularity: 'day', timeZone: 'UTC' })
    const withToday = computeMerchantStats([], 0, [], NOW_UTC,
      { days: 3, endDate: '2026-06-15', granularity: 'day', timeZone: 'UTC' })
    expect(withOut.series).toEqual(withToday.series)
  })
})
