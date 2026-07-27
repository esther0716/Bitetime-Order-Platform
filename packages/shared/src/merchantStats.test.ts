import { describe, it, expect } from 'vitest'
import { computeMerchantStats } from './merchantStats.js'
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
    const s = computeMerchantStats(orders, [], [], [], NOW)
    expect(s.totalOrders).toBe(3)
    expect(s.revenue).toBe(50) // cancelled excluded
    expect(s.avgOrder).toBe(25) // 50 / 2 booked
  })

  it('avgOrder is 0 with no booked orders', () => {
    const s = computeMerchantStats([], [], [], [], NOW)
    expect(s.avgOrder).toBe(0)
    expect(s.revenue).toBe(0)
  })

  it('counts customers and redeemed voucher uses', () => {
    const s = computeMerchantStats([], [], [{ orderCount: 2 }, { orderCount: 1 }], [
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
    const s = computeMerchantStats(orders, [], [], [], NOW)
    expect(s.ordersDelta).toEqual({ pct: 200, dir: 'up' }) // 3 vs 1
    expect(s.revenueDelta.dir).toBe('up')
  })

  it('delta is up=100 when previous month had zero', () => {
    const s = computeMerchantStats([order({ total: 5 })], [], [], [], NOW)
    expect(s.ordersDelta).toEqual({ pct: 100, dir: 'up' })
  })

  it('builds a daily series of the requested length, bucketing revenue', () => {
    const orders = [order({ total: 40, created_at: new Date('2026-06-15T08:00:00').toISOString() })]
    const s = computeMerchantStats(orders, [], [], [], NOW, { days: 12 })
    expect(s.granularity).toBe('day')
    expect(s.series).toHaveLength(12)
    const today = s.series[s.series.length - 1]
    expect(today.label).toBe('6/15')
    expect(today.range).toBeUndefined() // daily bars need no range in the tooltip
    expect(today.revenue).toBe(40)
    expect(today.orders).toBe(1)
  })

  it('stays daily at 30 days and switches to weekly past it', () => {
    expect(computeMerchantStats([], [], [], [], NOW, { days: 30 }).granularity).toBe('day')
    expect(computeMerchantStats([], [], [], [], NOW, { days: 30 }).series).toHaveLength(30)
    expect(computeMerchantStats([], [], [], [], NOW, { days: 60 }).granularity).toBe('week')
    expect(computeMerchantStats([], [], [], [], NOW, { days: 60 }).series).toHaveLength(9) // 8 whole weeks + a 4-day tail
    expect(computeMerchantStats([], [], [], [], NOW, { days: 90 }).series).toHaveLength(13) // 12 whole weeks + a 6-day tail
  })

  it('an explicit granularity overrides the default for the range, either way', () => {
    const daily90 = computeMerchantStats([], [], [], [], NOW, { days: 90, granularity: 'day' })
    expect(daily90.granularity).toBe('day')
    expect(daily90.series).toHaveLength(90)
    expect(daily90.series[0].range).toBeUndefined()

    const weekly12 = computeMerchantStats([], [], [], [], NOW, { days: 12, granularity: 'week' })
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
      const s = computeMerchantStats(orders, [], [], [], NOW, { days: 90, granularity })
      expect(s.series.reduce((sum, p) => sum + p.revenue, 0)).toBe(60)
      expect(s.series.reduce((sum, p) => sum + p.orders, 0)).toBe(3)
    }
  })

  it('weekly buckets are trailing 7-day windows anchored on today, newest one whole', () => {
    const s = computeMerchantStats([], [], [], [], NOW, { days: 90 })
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
    ], [], [], [], NOW, { days: 90 })

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
    const s = computeMerchantStats(orders, [], [], [], NOW)
    expect(s.productRevenue[0]).toEqual({ name: 'Cake', value: 30 })
    expect(s.productRevenue[1]).toEqual({ name: 'Tea', value: 5 })
  })

  it('folds products beyond the top 6 into "Other"', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, qty: 1, price: 9 - i }))
    const s = computeMerchantStats([order({ items })], [], [], [], NOW)
    expect(s.productRevenue).toHaveLength(7) // 6 + Other
    expect(s.productRevenue[6].name).toBe('Other')
    expect(s.productRevenue[6].value).toBe(3 + 2 + 1) // p6,p7,p8 prices = 3,2,1
  })

  it('breaks down orders by status with percentages', () => {
    const orders = [order({ status: 'new' }), order({ status: 'new' }), order({ status: 'completed' }), order({ status: 'cancelled' })]
    const s = computeMerchantStats(orders, [], [], [], NOW)
    expect(s.statusBreakdown[0]).toEqual({ status: 'new', count: 2, pct: 50 })
    expect(s.statusBreakdown.reduce((sum, x) => sum + x.count, 0)).toBe(4)
  })

  it('ranges the product donut and the status breakdown with the chart, not all-time', () => {
    const old = new Date('2026-01-10T09:00:00').toISOString() // months before any window
    const orders = [
      order({ status: 'completed', total: 10, items: [{ id: 'p1', name: 'Cake', qty: 1, price: 10 }] }),
      order({ status: 'cancelled', total: 99, created_at: old, items: [{ id: 'p2', name: 'Tea', qty: 5, price: 20 }] }),
    ]
    const s = computeMerchantStats(orders, [], [], [], NOW, { days: 12 })
    expect(s.productRevenue).toEqual([{ name: 'Cake', value: 10 }]) // the old Tea never lands
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
    const short = computeMerchantStats(orders, [], [], [], NOW, { days: 30 })
    expect(short.productRevenue.map(p => p.name)).toEqual(['Cake'])
    expect(short.statusBreakdown.map(x => x.status)).toEqual(['completed'])

    const long = computeMerchantStats(orders, [], [], [], NOW, { days: 90 })
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
    const s = computeMerchantStats(orders, [], [], [], NOW, { days: 90 })
    expect(s.productRevenue).toEqual([{ name: 'Cake', value: 10 }])
    expect(s.statusBreakdown).toEqual([{ status: 'completed', count: 1, pct: 100 }])
  })
})
