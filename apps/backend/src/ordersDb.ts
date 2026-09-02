// The reads that must see a shop's WHOLE order history, and nothing else.
//
// They go through `db.ts` rather than the REST client for one reason: PostgREST caps every
// response at `max_rows` (1000, `supabase/config.toml`) and announces the truncation only in a
// `Content-Range` header that nothing was reading. So the revenue chart quietly stopped counting
// a shop's oldest orders at its 1000th one, with no error and nothing on screen to suggest the
// number was short (#144). A driver query has no such cap, which makes the completeness a
// property of the query rather than of a header everyone forgot.
//
// The row-shaped reads (the merchant's order list) deliberately stay on PostgREST with an
// explicit `.range()`: a BOUNDED page is not a truncation, and keeping that path on the REST
// client is what keeps the rows the table renders identical to the rows a status PATCH returns.
// Only the aggregates live here, and they select just the four columns the shared stats module
// reads — a shop's whole history is worth loading for a total, not for columns nobody sums.
//
// Values are MAPPED, not passed through: postgres.js hands back `timestamptz` as a Date and
// `numeric` as a string, and `computeMerchantStats` compares ISO strings and adds numbers.
//
// RLS-EXEMPT, like everything on `db.ts` — `requireMerchantOwns` on the route is what makes the
// `merchant_id` filter below true.

import { sql } from './db.js'
import type { StatsOrder, StatsOrderItem } from '@bitetime/shared'

interface StatsRow {
  created_at: Date | string | null
  status: string | null
  total: string | number | null
  items: unknown
}

const iso = (v: Date | string | null) =>
  v === null ? undefined : v instanceof Date ? v.toISOString() : v

/**
 * Every order this shop has ever taken, reduced to the four fields the stats module reads.
 *
 * Deliberately unfiltered and unlimited. The KPI cards are all-time and the month-over-month
 * deltas need last month as well as this one, so there is no window that could be pushed into
 * SQL without the caller silently getting a different answer than it asked for. The narrowing
 * that IS safe — the range pills — happens after this, in `@bitetime/shared`, where the rule is
 * stated once for the chart and the export both.
 */
export async function statsOrders(merchantId: string): Promise<StatsOrder[]> {
  const rows = await sql<StatsRow[]>`
    select created_at, status, total, items
    from orders
    where merchant_id = ${merchantId}
  `
  return rows.map(r => ({
    created_at: iso(r.created_at),
    status: r.status ?? undefined,
    total: Number(r.total) || 0,
    // `items` is jsonb, so anything could be in there; the product donut iterates it.
    items: Array.isArray(r.items) ? (r.items as StatsOrderItem[]) : [],
  }))
}

/**
 * How many distinct people have ordered from this shop.
 *
 * Counted on `customer_phone_key`, which is the same key the customer list is built from
 * (ADR 0007) — so the Customers tab and the dashboard's customer card cannot disagree about
 * whether two spellings of one number are one person. An order with no usable number is not a
 * customer and is not counted, exactly as `shopCustomers` treats it.
 *
 * `::int` because postgres.js returns `bigint` as a string, and a string count concatenates.
 */
export async function distinctCustomerCount(merchantId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(distinct customer_phone_key)::int as n
    from orders
    where merchant_id = ${merchantId} and customer_phone_key is not null
  `
  return row?.n ?? 0
}

/**
 * How many orders this shop has in EACH status, counted by Postgres in one statement.
 *
 * An aggregate, so it belongs here rather than on the REST client: PostgREST cannot group, and
 * the alternative — one `head: true` count per status — is six round trips on every poll tick.
 *
 * `search` narrows the tally to the same rows the list itself is showing, so the figure over a
 * chip and the list under it can never disagree. The three columns below are the three the list
 * route searches; that pairing is the one thing stated twice in this feature, and
 * `tests/api/orders-list.test.ts` asserts the two answers still match.
 *
 * A null status counts as `new` — the storefront writes the column, but rows predating it do not
 * have one, and the dashboard has always read those as new.
 */
export async function orderStatusCounts(
  merchantId: string,
  search = '',
): Promise<Record<string, number>> {
  const like = `%${search}%`
  const rows = await sql<{ status: string; count: number }[]>`
    select coalesce(nullif(status, ''), 'new') as status, count(*)::int as count
    from orders
    where merchant_id = ${merchantId}
      ${search
        ? sql`and (order_number ilike ${like} or customer_name ilike ${like} or customer_wa ilike ${like})`
        : sql``}
    group by 1
  `
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.status] = Number(r.count) || 0
  return counts
}
