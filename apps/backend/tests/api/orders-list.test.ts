// tests/api/orders-list.test.ts
// The merchant's order list, the stats panel and the order count — past the row cap (#144).
//
// This is the suite the bug needed and did not have. The old endpoint was an unbounded
// `select *`; PostgREST caps a response at `max_rows` (1000, supabase/config.toml) and reports
// the truncation only in a `Content-Range` header nothing read. So a shop past its 1000th order
// was handed a partial list that looked complete: its oldest orders unreachable, its revenue
// chart short, and nothing anywhere saying so.
//
// None of that can be proved without real Postgres AND real PostgREST configuration, which is
// exactly what this suite has. The shop below is seeded just OVER the cap, and every assertion
// here is about a number that was wrong before the fix:
//
//   * the stats endpoint's all-time totals, against a count Postgres itself did
//   * the last page of the list, which lives beyond row 1000
//   * the count endpoint, which the "new orders" badge used to compute by measuring a list
//
// The parameter rules (which sorts exist, how big a page may be, what a search term may contain)
// are NOT here — they are pure, and live in tests/unit/orderList.test.ts.
import { describe, it, expect, beforeAll } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, serviceClient } from '../rls/helpers.js'
import type { MerchantStats } from '@bitetime/shared'

const svc = () => serviceClient()

const get = (path: string, token?: string) =>
  app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })

interface OrderPage {
  orders: { order_number: string; total: number; status: string | null }[]
  total: number
  page: number
  pageSize: number
}

// Just OVER the cap, not comfortably past it. This suite shares one Postgres with two dozen
// others and every extra row is latency the whole run pays — the same call customers.test.ts
// made, for the same reason. 1010 proves what 5000 would.
const BULK = 1010

/** What the seed below adds up to, stated once so the assertions read as arithmetic. */
const TOTAL_ORDERS = BULK + 3
/** Cancelled money is not revenue — `isBooked`, and the whole reason the rule is shared. */
const REVENUE = BULK * 1 + 4 + 6

describe('merchant order list, stats and count past the row cap', () => {
  let token: string, otherToken: string, id: string

  beforeAll(async () => {
    const owner = await makeUser('orders-list-owner@example.com', 'password123')
    const other = await makeUser('orders-list-other@example.com', 'password123')
    const { data: os } = await owner.auth.getSession()
    const { data: xs } = await other.auth.getSession()
    id = await seedMerchant({ slug: 'orders-list-shop', owner_id: os.session!.user.id })
    await seedMerchant({ slug: 'orders-list-other-shop', owner_id: xs.session!.user.id })
    token = os.session!.access_token
    otherToken = xs.session!.access_token

    const bulk = Array.from({ length: BULK }, (_, i) => ({
      merchant_id: id,
      customer_name: 'Bulk',
      customer_wa: '60123456789',
      customer_phone_key: '23456789',
      mode: 'pickup',
      total: 1,
      status: 'completed',
      order_number: `BULK-${String(i).padStart(4, '0')}`,
      created_at: new Date(Date.UTC(2026, 6, 1, 0, 0, i)).toISOString(),
    }))

    const rest = [
      // Cancelled: counted as an order, NOT as revenue.
      {
        merchant_id: id, customer_name: 'Ah Meng', customer_wa: '60198765432',
        customer_phone_key: '98765432', mode: 'pickup', total: 999, status: 'cancelled',
        order_number: 'CANCELLED', created_at: '2026-07-02T00:00:00Z',
      },
      // No status at all — rows predating the column, which the dashboard has always read as new.
      // No phone key either, so it is an order with no customer behind it.
      {
        merchant_id: id, customer_name: 'Walk-in', customer_wa: null,
        customer_phone_key: null, mode: 'pickup', total: 4, status: null,
        order_number: 'NOSTATUS', created_at: '2026-07-03T00:00:00Z',
      },
      // The one the merchant could not reach. Oldest by a wide margin, so it is the last row of
      // the last page — which, at this volume, is past row 1000.
      {
        merchant_id: id, customer_name: 'Ah Meng', customer_wa: '60198765432',
        customer_phone_key: '98765432', mode: 'pickup', total: 6, status: 'completed',
        order_number: 'OLDEST', created_at: '2020-01-01T00:00:00Z',
      },
    ]

    for (let i = 0; i < bulk.length; i += 505) {
      const { error } = await svc().from('orders').insert(bulk.slice(i, i + 505))
      if (error) throw new Error(error.message)
    }
    const { error } = await svc().from('orders').insert(rest)
    if (error) throw new Error(error.message)
  })

  // ── The stats panel ─────────────────────────────────────────────────────────

  it('totals every order the shop has, matching a count Postgres did itself', async () => {
    const { count } = await svc()
      .from('orders').select('id', { count: 'exact', head: true }).eq('merchant_id', id)
    expect(count).toBe(TOTAL_ORDERS)

    const stats = (await (await get(`/api/merchants/${id}/stats?days=12`, token)).json()) as MerchantStats
    // The assertion the bug fails: this read 1000 before, and said nothing about the rest.
    expect(stats.totalOrders).toBe(count)
  })

  it('excludes cancelled orders from revenue, over the whole history', async () => {
    const stats = (await (await get(`/api/merchants/${id}/stats?days=12`, token)).json()) as MerchantStats
    expect(stats.revenue).toBe(REVENUE)
    // Booked orders only — the cancelled one is in `totalOrders` and out of the average.
    expect(stats.avgOrder).toBeCloseTo(REVENUE / (TOTAL_ORDERS - 1), 6)
  })

  it('counts distinct customers by phone key, ignoring orders with no number', async () => {
    const stats = (await (await get(`/api/merchants/${id}/stats?days=12`, token)).json()) as MerchantStats
    // '23456789' (every bulk order) and '98765432' — and NOT the keyless walk-in.
    expect(stats.customerCount).toBe(2)
  })

  it('refuses a range it does not offer rather than answering a different question', async () => {
    expect((await get(`/api/merchants/${id}/stats?days=7`, token)).status).toBe(400)
    expect((await get(`/api/merchants/${id}/stats?days=12&granularity=hour`, token)).status).toBe(400)
  })

  it("forbids another merchant from reading this shop's figures", async () => {
    expect((await get(`/api/merchants/${id}/stats`, otherToken)).status).toBe(403)
    expect((await get(`/api/merchants/${id}/stats`)).status).toBe(401)
  })

  // ── The list ────────────────────────────────────────────────────────────────

  it('serves a page and states what it is a slice of', async () => {
    const page = (await (await get(`/api/merchants/${id}/orders?pageSize=25`, token)).json()) as OrderPage
    expect(page.orders).toHaveLength(25)
    expect(page.total).toBe(TOTAL_ORDERS)
    expect(page.page).toBe(1)
    expect(page.pageSize).toBe(25)
  })

  // THE assertion. Row 1011 of 1013, in the region the row cap made unreachable.
  it('reaches the oldest order by paging past the row cap', async () => {
    const last = Math.ceil(TOTAL_ORDERS / 100)
    const res = await get(`/api/merchants/${id}/orders?pageSize=100&page=${last}`, token)
    const page = (await res.json()) as OrderPage

    expect(page.orders).toHaveLength(TOTAL_ORDERS - (last - 1) * 100)
    expect(page.orders[page.orders.length - 1]!.order_number).toBe('OLDEST')
  })

  it('pages a total order, so a row cannot appear on two pages', async () => {
    const seen = new Set<string>()
    for (let p = 1; p <= Math.ceil(TOTAL_ORDERS / 100); p++) {
      const page = (await (await get(`/api/merchants/${id}/orders?pageSize=100&page=${p}`, token)).json()) as OrderPage
      for (const o of page.orders) seen.add(o.order_number)
    }
    expect(seen.size).toBe(TOTAL_ORDERS)
  })

  it('sorts on the column and direction asked for', async () => {
    const asc = (await (await get(`/api/merchants/${id}/orders?sort=created_at&dir=asc&pageSize=1`, token)).json()) as OrderPage
    expect(asc.orders[0]!.order_number).toBe('OLDEST')

    const dear = (await (await get(`/api/merchants/${id}/orders?sort=total&dir=desc&pageSize=1`, token)).json()) as OrderPage
    expect(dear.orders[0]!.order_number).toBe('CANCELLED')
  })

  it('searches the whole history, not the page', async () => {
    const hit = (await (await get(`/api/merchants/${id}/orders?search=OLDEST`, token)).json()) as OrderPage
    expect(hit.total).toBe(1)
    expect(hit.orders[0]!.order_number).toBe('OLDEST')

    // By name, across the two orders Ah Meng placed.
    const byName = (await (await get(`/api/merchants/${id}/orders?search=Ah%20Meng`, token)).json()) as OrderPage
    expect(byName.total).toBe(2)

    // `total` is the MATCHED count, so the pager narrows with the search rather than staying
    // at the shop's full history.
    const none = (await (await get(`/api/merchants/${id}/orders?search=nobody`, token)).json()) as OrderPage
    expect(none).toMatchObject({ orders: [], total: 0 })
  })

  // A comma is PostgREST's own `or` separator: unsanitised, this would not search for a comma,
  // it would change the query — and a 400, or worse a wrong list, is what the merchant would get.
  it('survives a search term full of filter syntax', async () => {
    const res = await get(`/api/merchants/${id}/orders?search=${encodeURIComponent('a,b.eq.c)(%')}`, token)
    expect(res.status).toBe(200)
    expect(((await res.json()) as OrderPage).total).toBe(0)
  })

  it('refuses a sort, direction or page size it does not offer', async () => {
    for (const qs of ['sort=customer_wa', 'dir=sideways', 'pageSize=5000', 'page=0']) {
      expect((await get(`/api/merchants/${id}/orders?${qs}`, token)).status).toBe(400)
    }
  })

  // ── The count ───────────────────────────────────────────────────────────────

  it('counts every order, and every order of one status', async () => {
    const count = async (qs = '') =>
      ((await (await get(`/api/merchants/${id}/orders/count${qs}`, token)).json()) as { count: number }).count

    expect(await count()).toBe(TOTAL_ORDERS)
    expect(await count('?status=completed')).toBe(BULK + 1)
    expect(await count('?status=cancelled')).toBe(1)
    // An absent status IS 'new' — the badge has always read those rows that way.
    expect(await count('?status=new')).toBe(1)
  })

  it('refuses a status that is not one', async () => {
    expect((await get(`/api/merchants/${id}/orders/count?status=shipped`, token)).status).toBe(400)
  })

  // ── The status filter and its tallies ───────────────────────────────────────

  const list = async (qs: string) =>
    (await (await get(`/api/merchants/${id}/orders${qs}`, token)).json()) as OrderPage

  const tallies = async (qs = '') =>
    ((await (await get(`/api/merchants/${id}/orders/status-counts${qs}`, token)).json()) as
      { counts: Record<string, number> }).counts

  it('narrows the list to one status, and says what that slice totals', async () => {
    const page = await list('?status=cancelled')
    expect(page.total).toBe(1)
    expect(page.orders[0]!.order_number).toBe('CANCELLED')
  })

  // An absent status IS 'new', in the list exactly as in the count — one rule, one answer.
  it('reads a row with no status at all as new', async () => {
    const page = await list('?status=new')
    expect(page.total).toBe(1)
    expect(page.orders[0]!.order_number).toBe('NOSTATUS')
  })

  it('refuses a status the list cannot filter on', async () => {
    expect((await get(`/api/merchants/${id}/orders?status=shipped`, token)).status).toBe(400)
  })

  it('tallies every status, over the whole history rather than a page of it', async () => {
    expect(await tallies()).toEqual({ completed: BULK + 1, cancelled: 1, new: 1 })
  })

  // The one rule this feature states twice — the three searched columns, in PostgREST for the
  // list and in SQL for the tallies. If they ever drift, a chip promises rows the list will not
  // show, and this is what fails.
  it('tallies the same rows the list itself would show, under a search', async () => {
    const counts = await tallies('?search=Ah Meng')
    for (const [status, count] of Object.entries(counts)) {
      expect((await list(`?search=Ah Meng&status=${status}`)).total).toBe(count)
    }
    expect(counts).toEqual({ completed: 1, cancelled: 1 })
  })

  it("forbids another merchant from reading this shop's tallies", async () => {
    expect((await get(`/api/merchants/${id}/orders/status-counts`, otherToken)).status).toBe(403)
    expect((await get(`/api/merchants/${id}/orders/status-counts`)).status).toBe(401)
  })
})
