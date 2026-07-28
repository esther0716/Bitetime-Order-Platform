# Merchant Revenue Report Export Implementation Plan

> **Status: implemented** — `d18af16` … `003661f`. Kept as the record of what was built.
>
> Three things landed differently from the text below, because `dda6ba3` (the Overview ranging fix)
> merged between planning and execution:
>
> 1. `computeMerchantStats` now narrows orders to the window itself, so the report does **not**
>    pre-filter for its sheets. `ordersInWindow` is still exported and still used — for the Summary
>    sheet's totals, since the KPI block stays all-time by design.
> 2. Uncapped products became a `productTop` option on `SeriesWindow` rather than an exported
>    `productRevenue`, and `windowTotals` was added so "revenue excludes cancelled" is stated once.
> 3. `statusBreakdown` was never exported — it had no caller left.
>
> Also unplanned, and needed: `SubscriptionTab`'s Pro feature list and its downgrade warning both
> gained the report. A padlock that lands a merchant on a page never mentioning what they clicked is
> a dead end.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Pro shop download the Overview's revenue summary as a four-sheet `.xlsx`, built and gated on the backend.

**Architecture:** The dashboard's stats module moves into `@bitetime/shared` and gains time-zone-aware day bucketing, so the browser's chart and a server-built file agree on which day an order belongs to. A new `GET /api/merchants/:id/report.xlsx` (`requireMerchantOwns` → `requirePro`) fetches the shop's orders, filters them to the requested window, runs the shared stats, and hands the numbers to a pure workbook builder. The browser downloads the bytes through a new `apiGetFile` helper on the existing Result convention.

**Tech Stack:** TypeScript throughout. Hono (backend), React 19 + Vite (frontend), Vitest, `exceljs` for workbook generation, `Intl.DateTimeFormat` for time zones (no date library).

**Spec:** [docs/superpowers/specs/2026-07-27-merchant-revenue-report-export-design.md](../specs/2026-07-27-merchant-revenue-report-export-design.md)

## Global Constraints

- **Adding a backend runtime dependency means adding its `--external:` flag** to the `build` script in `apps/backend/package.json`. Without it esbuild bundles the package and the deploy breaks. See CLAUDE.md → Monorepo.
- `@bitetime/shared` ships **TypeScript source, no build step**. It may not import from `apps/frontend` or `apps/backend`; it defines its own structural input types.
- Backend relative imports keep `.js` specifiers that resolve to `.ts` source (`NodeNext`). Frontend imports are extensionless (`bundler`). Do not "fix" either.
- All UI strings go through `t(english, chinese)` from `SessionContext`. **Workbook column headers and status values are English only** — the file is a machine-readable artefact, not UI.
- The Pro gate is the **backend**. `requirePro` answers `403 {"error":"requires_pro"}`; the frontend's padlock is UX only.
- Run commands from the repo root. `pnpm test` runs frontend + shared + backend unit tests. `pnpm --filter @bitetime/backend test:db` needs a local Supabase (`supabase start` from `apps/backend`).
- Money in the workbook is **numeric cells with a number format**, never pre-formatted strings.

---

## File Structure

**Created:**
- `packages/shared/src/merchantStats.ts` — the dashboard/report aggregation, moved out of the frontend. Pure; owns bucketing, product revenue, status breakdown, window filtering.
- `packages/shared/src/merchantStats.test.ts` — moved from the frontend, extended.
- `apps/backend/src/report.ts` — `buildRevenueWorkbook` + `reportFilename`. No DB, no network, no env.
- `apps/backend/tests/unit/report.test.ts` — workbook shape assertions.
- `apps/backend/tests/api/report.test.ts` — endpoint, gate and tenancy assertions.

**Modified:**
- `apps/frontend/src/merchant/overviewStats.ts` — becomes a re-export shim so existing importers do not churn.
- `packages/shared/src/index.ts` — new exports.
- `apps/frontend/src/merchant/Overview.tsx` — passes `merchant.timezone`; adds the download button.
- `apps/frontend/src/api.ts` — new `apiGetFile`.
- `apps/frontend/src/store.ts` — new `downloadRevenueReport`.
- `apps/backend/src/app.ts` — new route; CORS gains `exposeHeaders`.
- `apps/backend/package.json` — `exceljs` dependency + `--external:exceljs`.

**Deleted:**
- `apps/frontend/src/merchant/overviewStats.test.ts` — moved to `packages/shared`.

---

## Task 1: Move the stats module into `@bitetime/shared`

Pure relocation. No behaviour change — every existing test must pass untouched apart from its import path.

**Files:**
- Create: `packages/shared/src/merchantStats.ts` (via `git mv`)
- Create: `packages/shared/src/merchantStats.test.ts` (via `git mv`)
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/frontend/src/merchant/overviewStats.ts` (replaced with a shim)

**Interfaces:**
- Consumes: nothing.
- Produces: from `@bitetime/shared` — `computeMerchantStats`, `granularityFor`, and types `MerchantStats`, `SeriesPoint`, `SeriesWindow`, `Slice`, `StatusSlice`, `Delta`, `Granularity`, `StatsOrder`, `StatsOrderItem`. `apps/frontend/src/merchant/overviewStats.ts` re-exports all of them at the old path.

- [ ] **Step 1: Move both files with git**

```bash
git mv apps/frontend/src/merchant/overviewStats.ts packages/shared/src/merchantStats.ts
git mv apps/frontend/src/merchant/overviewStats.test.ts packages/shared/src/merchantStats.test.ts
```

- [ ] **Step 2: Replace the frontend type import with local structural types**

In `packages/shared/src/merchantStats.ts`, delete this line:

```ts
import type { Order, Product, Voucher } from '../types'
```

and put these declarations in its place, directly under the file's header comment:

```ts
// Shared code cannot import the frontend's `Order`/`Product`/`Voucher`, so it states only the
// shape it actually reads. The frontend's own types are structurally assignable to these, which
// is why `Overview.tsx` keeps compiling without a cast.
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
```

Update the file's opening comment to say it serves the merchant Overview **and** the revenue report export, and that it lives here because both sides of the wire must produce identical numbers.

- [ ] **Step 3: Retype the signature's parameters**

In `computeMerchantStats`, change the parameter types only — the body is untouched:

```ts
export function computeMerchantStats(
  orders: StatsOrder[],
  _products: unknown[],
  customers: { orderCount?: number }[],
  vouchers: { usedBy?: unknown[] }[],
  now: Date = new Date(),
  window: SeriesWindow = { days: 12 },
): MerchantStats {
```

Change the two private helpers' parameter types the same way: `revenueSeries(orders: StatsOrder[], …)`, `productRevenue(orders: StatsOrder[], …)`, `statusBreakdown(orders: StatsOrder[])`, and `counts`/`orderTotal` to take `StatsOrder`.

- [ ] **Step 4: Fix the moved test's imports**

In `packages/shared/src/merchantStats.test.ts`, replace the top two imports:

```ts
import { computeMerchantStats } from './merchantStats.js'
import type { StatsOrder } from './merchantStats.js'
```

and change the local helper's signature:

```ts
function order(o: Partial<StatsOrder>): StatsOrder {
  return { status: 'completed', total: 0, items: [], created_at: NOW.toISOString(), ...o }
}
```

Leave every `it(...)` block exactly as it is.

- [ ] **Step 5: Export from the shared barrel**

Append to `packages/shared/src/index.ts`:

```ts
export { computeMerchantStats, granularityFor } from './merchantStats.js'
export type {
  MerchantStats, SeriesPoint, SeriesWindow, Slice, StatusSlice, Delta, Granularity,
  StatsOrder, StatsOrderItem,
} from './merchantStats.js'
```

- [ ] **Step 6: Write the frontend re-export shim**

Replace the whole of `apps/frontend/src/merchant/overviewStats.ts` with:

```ts
// Moved to @bitetime/shared (see packages/shared/src/merchantStats.ts): the revenue report
// export builds the same numbers on the backend, and a stat computed on one side of the wire
// only is a file that disagrees with the chart it came from.
//
// This shim exists so the dashboard's importers keep their local path. New code should import
// from '@bitetime/shared' directly.
export { computeMerchantStats, granularityFor } from '@bitetime/shared'
export type {
  MerchantStats, SeriesPoint, SeriesWindow, Slice, StatusSlice, Delta, Granularity,
} from '@bitetime/shared'
```

- [ ] **Step 7: Run tests and typecheck**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Expected: PASS. The moved suite now runs under `@bitetime/shared` instead of `@bitetime/frontend`; the same test names appear either way. If `typecheck` complains that `Order` is not assignable to `StatsOrder`, the cause is a required field on `StatsOrder` — every field there must be optional.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(stats): move the Overview aggregation into @bitetime/shared

The revenue report export computes these same numbers on the backend, and
a stat derived on one side of the wire only is a file that disagrees with
the chart it came from. Shared code cannot see the frontend's Order type,
so the module now states the shape it reads; the frontend's types are
structurally assignable, and the old path stays as a re-export."
```

---

## Task 2: Bucket days in the shop's time zone

**Files:**
- Modify: `packages/shared/src/merchantStats.ts`
- Test: `packages/shared/src/merchantStats.test.ts`
- Modify: `apps/frontend/src/merchant/Overview.tsx:75`

**Interfaces:**
- Consumes: `computeMerchantStats`, `SeriesWindow`, `StatsOrder` from Task 1. `isTimezone` from `./fulfilment.js`.
- Produces: `SeriesWindow` gains `timeZone?: string`. `SeriesPoint` gains `start: string` and `end: string`, both `YYYY-MM-DD` in that time zone. Omitting `timeZone` keeps today's behaviour (the runtime's local zone), so existing callers are unaffected.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/merchantStats.test.ts`:

```ts
describe('computeMerchantStats time zones', () => {
  // 2026-06-14T17:30:00Z is 2026-06-15 01:30 in Asia/Kuala_Lumpur (UTC+8) but still the 14th
  // in UTC. A server in a UTC container and a merchant's browser in KL must not disagree about
  // which bar this order belongs to — which is the whole reason the window carries a zone.
  const NOW_UTC = new Date('2026-06-15T04:00:00Z')
  const LATE = order({ total: 40, created_at: '2026-06-14T17:30:00Z' })

  it('buckets an order by the shop’s civil day, not the runtime’s', () => {
    const kl = computeMerchantStats([LATE], [], [], [], NOW_UTC,
      { days: 3, granularity: 'day', timeZone: 'Asia/Kuala_Lumpur' })
    const today = kl.series[kl.series.length - 1]
    expect(today.start).toBe('2026-06-15')
    expect(today.revenue).toBe(40)

    const utc = computeMerchantStats([LATE], [], [], [], NOW_UTC,
      { days: 3, granularity: 'day', timeZone: 'UTC' })
    expect(utc.series[utc.series.length - 1].revenue).toBe(0)
    expect(utc.series[utc.series.length - 2].revenue).toBe(40)
  })

  it('labels every daily bucket with its own civil date, start equal to end', () => {
    const s = computeMerchantStats([], [], [], [], NOW_UTC,
      { days: 3, granularity: 'day', timeZone: 'Asia/Kuala_Lumpur' })
    expect(s.series.map(p => p.start)).toEqual(['2026-06-13', '2026-06-14', '2026-06-15'])
    expect(s.series.every(p => p.start === p.end)).toBe(true)
  })

  it('gives a weekly bucket a seven-day span ending on the shop’s today', () => {
    const s = computeMerchantStats([], [], [], [], NOW_UTC,
      { days: 14, granularity: 'week', timeZone: 'Asia/Kuala_Lumpur' })
    const last = s.series[s.series.length - 1]
    expect(last.start).toBe('2026-06-09')
    expect(last.end).toBe('2026-06-15')
  })

  it('falls back to the runtime zone when the window carries none', () => {
    const s = computeMerchantStats([], [], [], [], NOW_UTC, { days: 3, granularity: 'day' })
    expect(s.series).toHaveLength(3)
    expect(s.series[2].start).toBe(s.series[2].end)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm --filter @bitetime/shared test
```

Expected: FAIL. `timeZone` is not a property of `SeriesWindow` (a type error), and `SeriesPoint` has no `start`/`end`.

- [ ] **Step 3: Add the time zone to the types**

In `packages/shared/src/merchantStats.ts`:

```ts
// One bar of the revenue chart. `label` is what the axis shows; `range` is set only
// on weekly buckets, where the axis label alone (the week's first day) would be a lie
// about what the bar contains — the tooltip shows this instead. `start`/`end` are the
// bucket's civil dates in the shop's zone, which the chart ignores and the XLSX export
// writes as its date columns.
export interface SeriesPoint {
  key: string
  label: string
  range?: string
  start: string
  end: string
  revenue: number
  orders: number
}

// What the revenue chart covers, and how finely. `granularity` is what the merchant
// picked; leave it off to get the default for the range. `timeZone` is the SHOP's zone
// (`merchants.timezone`) — omit it and days are bucketed in the runtime's own zone, which
// is right for a browser standing in for its merchant and wrong for a UTC server.
export interface SeriesWindow {
  days: number
  granularity?: Granularity
  timeZone?: string
}
```

- [ ] **Step 4: Replace local-midnight arithmetic with civil day numbers**

Add the import at the top of `packages/shared/src/merchantStats.ts`:

```ts
import { isTimezone } from './fulfilment.js'
```

Delete `midnight`, `daysAgo` and the old `dayLabel`, and delete the old `monthKey`. Replace them with:

```ts
const MS_PER_DAY = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * A clock that reports which civil day an instant falls on in `tz`, as a day index (whole days
 * since the epoch). Integer arithmetic from here on: no local midnights and no DST rounding,
 * and the same answer in a UTC container as in the merchant's browser.
 *
 * The formatter is built once per call and reused across every order — constructing an
 * `Intl.DateTimeFormat` per row is the slow way to do this on a shop with thousands of orders.
 * An absent or unusable zone falls back to the runtime's own, preserving the behaviour this
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

// A day index back into calendar fields. Built at UTC midnight so the getters below are exact.
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
```

- [ ] **Step 5: Rewrite `revenueSeries` against the clock**

Replace the whole function:

```ts
// Buckets covering the last `days` days ending on `today` (inclusive), oldest first.
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
```

- [ ] **Step 6: Wire the clock through `computeMerchantStats`**

Replace the head of the function body (everything from `const { days, …` down to the `for` loop over `orders`) with:

```ts
  const { days, granularity = granularityFor(days), timeZone } = window
  const dayOf = zoneClock(timeZone)
  const today = dayOf(now)
  const booked = orders.filter(counts)
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
```

and the `series` line of the returned object:

```ts
    series: revenueSeries(orders, today, days, granularity, dayOf),
```

- [ ] **Step 7: Run the shared tests**

```bash
pnpm --filter @bitetime/shared test
```

Expected: PASS, including every test that existed before Task 1.

- [ ] **Step 8: Pass the shop's zone from the dashboard**

In `apps/frontend/src/merchant/Overview.tsx`, the `useMemo` at line 74. Change the window argument:

```ts
  const stats = useMemo(
    () => rows && computeMerchantStats(
      rows.orders, rows.products, rows.customers, rows.vouchers, new Date(),
      { days: rangeDays, granularity, timeZone: merchant?.timezone },
    ),
    [rows, rangeDays, granularity, merchant?.timezone],
  )
```

- [ ] **Step 9: Typecheck, lint and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Expected: PASS.

```bash
git add -A
git commit -m "fix(stats): bucket revenue days in the shop's time zone

Day boundaries were the runtime's. A UTC server and a merchant's browser
in Asia/Kuala_Lumpur therefore put an evening order on different days,
which would have made the revenue export disagree with the chart it came
from. Days are now civil day indices in merchants.timezone, computed by
one Intl formatter per call rather than one per order.

Buckets also carry their start and end dates, which the chart ignores and
the export writes as date columns.

Visible consequence: a merchant whose browser zone differs from their
shop's will see their chart's day boundaries move to shop time."
```

---

## Task 3: Report-shaped aggregates — units, no cap, window filtering

**Files:**
- Modify: `packages/shared/src/merchantStats.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/merchantStats.test.ts`

**Interfaces:**
- Consumes: `StatsOrder`, `Slice`, `StatusSlice`, `zoneClock` from Tasks 1–2.
- Produces, exported from `@bitetime/shared`:
  - `Slice` gains `units: number`.
  - `productRevenue(orders: StatsOrder[], top?: number): Slice[]` — public; no `top` means no cap and no `"Other"` row.
  - `statusBreakdown(orders: StatsOrder[]): StatusSlice[]` — public.
  - `ordersInWindow(orders: StatsOrder[], now: Date, days: number, timeZone?: string): StatsOrder[]`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/merchantStats.test.ts`:

```ts
import { productRevenue, statusBreakdown, ordersInWindow } from './merchantStats.js'

describe('productRevenue for the export', () => {
  const orders = [
    order({ items: [{ id: 'a', name: 'Cookie', qty: 2, price: 5 }] }),
    order({ items: [{ id: 'a', name: 'Cookie', qty: 3, price: 5 }] }),
    order({ items: [{ id: 'b', name: 'Cake', qty: 1, price: 30 }] }),
    order({ items: [{ id: 'c', name: 'Tart', qty: 9, price: 1 }], status: 'cancelled' }),
  ]

  it('sums units alongside revenue and ignores cancelled orders', () => {
    const rows = productRevenue(orders)
    expect(rows).toEqual([
      { name: 'Cake', value: 30, units: 1 },
      { name: 'Cookie', value: 25, units: 5 },
    ])
  })

  it('returns every product with no cap and therefore no Other row', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      order({ items: [{ id: `p${i}`, name: `P${i}`, qty: 1, price: 9 - i }] }))
    const rows = productRevenue(many)
    expect(rows).toHaveLength(9)
    expect(rows.some(r => r.name === 'Other')).toBe(false)
  })

  it('still folds the tail into Other when a cap is given', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      order({ items: [{ id: `p${i}`, name: `P${i}`, qty: 2, price: 9 - i }] }))
    const rows = productRevenue(many, 6)
    expect(rows).toHaveLength(7)
    expect(rows[6]).toEqual({ name: 'Other', value: 2 * (3 + 2 + 1), units: 6 })
  })
})

describe('ordersInWindow', () => {
  const NOW_UTC = new Date('2026-06-15T04:00:00Z')

  it('keeps orders inside the window and drops those before it', () => {
    const inside = order({ total: 1, created_at: '2026-06-13T02:00:00Z' })
    const outside = order({ total: 2, created_at: '2026-06-11T02:00:00Z' })
    const kept = ordersInWindow([inside, outside], NOW_UTC, 3, 'Asia/Kuala_Lumpur')
    expect(kept).toEqual([inside])
  })

  it('drops orders dated in the future and rows with no usable timestamp', () => {
    const future = order({ total: 1, created_at: '2026-06-20T02:00:00Z' })
    const undated = order({ total: 1, created_at: undefined })
    const junk = order({ total: 1, created_at: 'not-a-date' })
    expect(ordersInWindow([future, undated, junk], NOW_UTC, 3, 'UTC')).toEqual([])
  })

  it('respects the shop zone at the window’s far edge', () => {
    // 2026-06-12T17:00Z is the 13th in KL — inside a 3-day window — and the 12th in UTC.
    const edge = order({ total: 1, created_at: '2026-06-12T17:00:00Z' })
    expect(ordersInWindow([edge], NOW_UTC, 3, 'Asia/Kuala_Lumpur')).toEqual([edge])
    expect(ordersInWindow([edge], NOW_UTC, 3, 'UTC')).toEqual([])
  })
})

describe('statusBreakdown', () => {
  it('counts by status, treats a missing status as new, and shares out of the rows given', () => {
    const rows = statusBreakdown([
      order({ status: 'completed' }),
      order({ status: 'completed' }),
      order({ status: undefined }),
      order({ status: 'cancelled' }),
    ])
    expect(rows).toEqual([
      { status: 'completed', count: 2, pct: 50 },
      { status: 'new', count: 1, pct: 25 },
      { status: 'cancelled', count: 1, pct: 25 },
    ])
  })
})
```

Note: merge the new `import` line into the file's existing import from `./merchantStats.js` rather than adding a second one.

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm --filter @bitetime/shared test
```

Expected: FAIL — `productRevenue`, `statusBreakdown` and `ordersInWindow` are not exported.

- [ ] **Step 3: Add `units` to `Slice`**

```ts
// A wedge of the revenue donut, and a row of the export's product sheet. `units` is what the
// donut has no use for and a merchant reading a spreadsheet immediately asks for.
export interface Slice { name: string; value: number; units: number }
```

- [ ] **Step 4: Make `productRevenue` public, uncapped by default, and unit-aware**

Replace the function:

```ts
/**
 * Revenue per product from line items, descending by value.
 *
 * `top` caps the list and folds the remainder into "Other" — right for a donut with six legible
 * wedges, wrong for a spreadsheet, so it is optional and the export omits it. Cancelled orders
 * are excluded, matching every other revenue figure here.
 */
export function productRevenue(orders: StatsOrder[], top?: number): Slice[] {
  const by = new Map<string, { value: number; units: number }>()
  for (const o of orders) {
    if (!counts(o)) continue
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
  if (top === undefined || sorted.length <= top) return sorted
  const head = sorted.slice(0, top)
  const tail = sorted.slice(top)
  const value = tail.reduce((s, x) => s + x.value, 0)
  const units = tail.reduce((s, x) => s + x.units, 0)
  return value > 0 ? [...head, { name: 'Other', value, units }] : head
}
```

- [ ] **Step 5: Make `statusBreakdown` public and add `ordersInWindow`**

Change `function statusBreakdown` to `export function statusBreakdown` (body unchanged), and add:

```ts
/**
 * The orders that fall inside the last `days` days ending on `now`, in the shop's zone.
 *
 * The export filters with this BEFORE computing anything, which is what makes its product and
 * status sheets ranged: neither `productRevenue` nor `statusBreakdown` carries a window of its
 * own, and giving them one would silently re-range the Overview's panels too.
 */
export function ordersInWindow(
  orders: StatsOrder[], now: Date, days: number, timeZone?: string,
): StatsOrder[] {
  const dayOf = zoneClock(timeZone)
  const today = dayOf(now)
  return orders.filter(o => {
    if (!o.created_at) return false
    const d = new Date(o.created_at)
    if (Number.isNaN(d.getTime())) return false
    const ago = today - dayOf(d)
    return ago >= 0 && ago < days
  })
}
```

- [ ] **Step 6: Export from the barrel**

In `packages/shared/src/index.ts`, extend the value export added in Task 1:

```ts
export {
  computeMerchantStats, granularityFor, productRevenue, statusBreakdown, ordersInWindow,
} from './merchantStats.js'
```

- [ ] **Step 7: Run everything**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Expected: PASS. `DonutCard` takes `{ name, value }[]`; the extra `units` field is structurally harmless and needs no change in `DashCharts.tsx`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(stats): expose report-shaped product, status and window helpers

The XLSX export needs every product rather than the donut's top six plus
an Other row, needs units next to revenue, and needs all of its sheets
confined to the selected range. Product revenue's cap is now optional,
Slice carries units, and ordersInWindow filters by the shop's civil day
so the export can range its rows without re-ranging the Overview panels
that deliberately still show all time."
```

---

## Task 4: The workbook builder

**Files:**
- Create: `apps/backend/src/report.ts`
- Create: `apps/backend/tests/unit/report.test.ts`
- Modify: `apps/backend/package.json`

**Interfaces:**
- Consumes: `SeriesPoint`, `Slice`, `StatusSlice` from `@bitetime/shared` (Tasks 1–3).
- Produces:
  - `buildRevenueWorkbook(report: RevenueReport, shop: ReportShop, window: ReportWindow): Promise<Buffer>`
  - `reportFilename(slug: string, today: string, days: number): string`
  - types `RevenueReport`, `ReportShop`, `ReportWindow`

- [ ] **Step 1: Add the dependency and its esbuild flag**

```bash
pnpm --filter @bitetime/backend add exceljs
```

Then in `apps/backend/package.json`, add `--external:exceljs` to the `build` script, immediately after `--external:postgres`:

```
"build": "esbuild src/index.ts --bundle --external:@hono/node-server --external:hono --external:@supabase/supabase-js --external:stripe --external:postgres --external:exceljs --external:pinyin-pro --platform=node --format=esm --target=node20 --outfile=dist/server.js --banner:js=\"import{createRequire}from'module';const require=createRequire(import.meta.url);\"",
```

Verify the flag took:

```bash
pnpm --filter @bitetime/backend build && grep -c "exceljs" apps/backend/dist/server.js
```

Expected: the build succeeds and the count is small (an `import` line), not a bundled copy of the library. If the bundle balloons past a megabyte, the flag is missing or misplaced.

- [ ] **Step 2: Write the failing test**

Create `apps/backend/tests/unit/report.test.ts`:

```ts
// tests/unit/report.test.ts
// The revenue workbook's shape. The load-bearing assertions are that money lands in NUMERIC
// cells (a merchant must be able to SUM the column — a pre-formatted string cannot be summed),
// that every sheet the spec names exists under the name it names, and that a shop with no
// orders in the range still gets a valid file with headers rather than an error.
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildRevenueWorkbook, reportFilename, type RevenueReport, type ReportShop, type ReportWindow } from '../../src/report.js'

const SHOP: ReportShop = {
  name: 'Sweet Bakes', slug: 'sweet-bakes', currency: 'MYR', timeZone: 'Asia/Kuala_Lumpur',
}
const WINDOW: ReportWindow = {
  days: 30, granularity: 'day', from: '2026-05-29', to: '2026-06-27',
  generatedAt: '2026-06-27 12:00',
}
const REPORT: RevenueReport = {
  totalOrders: 3,
  revenue: 55,
  avgOrder: 18.333333333333332,
  series: [
    { key: '1', label: '6/26', start: '2026-06-26', end: '2026-06-26', revenue: 25, orders: 1 },
    { key: '0', label: '6/27', start: '2026-06-27', end: '2026-06-27', revenue: 30, orders: 2 },
  ],
  products: [
    { name: 'Cake', value: 30, units: 1 },
    { name: 'Cookie', value: 25, units: 5 },
  ],
  statuses: [
    { status: 'completed', count: 2, pct: 67 },
    { status: 'cancelled', count: 1, pct: 33 },
  ],
}

async function readBack(buf: Buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  return wb
}

describe('buildRevenueWorkbook', () => {
  it('writes the four sheets the report is made of', async () => {
    const wb = await readBack(await buildRevenueWorkbook(REPORT, SHOP, WINDOW))
    expect(wb.worksheets.map(w => w.name)).toEqual([
      'Summary', 'Revenue over time', 'Revenue by product', 'Orders by status',
    ])
  })

  it('puts money in numeric cells so the merchant can sum them', async () => {
    const wb = await readBack(await buildRevenueWorkbook(REPORT, SHOP, WINDOW))
    const ws = wb.getWorksheet('Revenue over time')!
    const revenue = ws.getCell('D2')
    expect(typeof revenue.value).toBe('number')
    expect(revenue.value).toBe(25)
    expect(revenue.numFmt).toBe('#,##0.00')
  })

  it('names the money columns with the shop’s currency', async () => {
    const wb = await readBack(await buildRevenueWorkbook(REPORT, SHOP, WINDOW))
    const ws = wb.getWorksheet('Revenue over time')!
    expect(ws.getRow(1).values).toEqual([undefined, 'Bucket start', 'Bucket end', 'Orders', 'Revenue (MYR)'])
  })

  it('writes bucket bounds as real date cells', async () => {
    const wb = await readBack(await buildRevenueWorkbook(REPORT, SHOP, WINDOW))
    const start = wb.getWorksheet('Revenue over time')!.getCell('B2').value as Date
    expect(start).toBeInstanceOf(Date)
    expect(start.toISOString().slice(0, 10)).toBe('2026-06-26')
  })

  it('lists every product with its units, ordered as given', async () => {
    const wb = await readBack(await buildRevenueWorkbook(REPORT, SHOP, WINDOW))
    const ws = wb.getWorksheet('Revenue by product')!
    expect(ws.getRow(2).values).toEqual([undefined, 'Cake', 1, 30])
    expect(ws.getRow(3).values).toEqual([undefined, 'Cookie', 5, 25])
  })

  it('writes status share as a fraction under a percent format', async () => {
    const wb = await readBack(await buildRevenueWorkbook(REPORT, SHOP, WINDOW))
    const cell = wb.getWorksheet('Orders by status')!.getCell('C2')
    expect(cell.value).toBeCloseTo(0.67, 5)
    expect(cell.numFmt).toBe('0%')
  })

  it('carries the shop and window into the summary sheet', async () => {
    const wb = await readBack(await buildRevenueWorkbook(REPORT, SHOP, WINDOW))
    const ws = wb.getWorksheet('Summary')!
    const labels = ws.getColumn(1).values.filter(Boolean).map(String)
    expect(labels).toEqual([
      'Shop', 'Slug', 'Range', 'Granularity', 'Time zone', 'Generated at', 'Currency',
      'Total orders', 'Revenue', 'Average order',
    ])
    expect(ws.getCell('B1').value).toBe('Sweet Bakes')
    expect(ws.getCell('B3').value).toBe('Last 30 days (2026-05-29 – 2026-06-27)')
  })

  it('produces a valid workbook with headers when nothing sold in the range', async () => {
    const empty: RevenueReport = {
      totalOrders: 0, revenue: 0, avgOrder: 0, series: [], products: [], statuses: [],
    }
    const wb = await readBack(await buildRevenueWorkbook(empty, SHOP, WINDOW))
    expect(wb.worksheets).toHaveLength(4)
    expect(wb.getWorksheet('Revenue by product')!.rowCount).toBe(1) // header only
  })
})

describe('reportFilename', () => {
  it('names the file by shop, date and range', () => {
    expect(reportFilename('sweet-bakes', '2026-06-27', 30)).toBe('sweet-bakes-revenue-2026-06-27-30d.xlsx')
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm --filter @bitetime/backend test
```

Expected: FAIL — `src/report.ts` does not exist.

- [ ] **Step 4: Write the builder**

Create `apps/backend/src/report.ts`:

```ts
// The merchant revenue report, as an XLSX workbook (#…, CONTEXT.md → Plan entitlement).
//
// Pure in the sense that matters: no database, no network, no env. It receives numbers that
// @bitetime/shared already computed — the same numbers the merchant's chart is drawing — and
// turns them into bytes, so it can be tested without a Supabase stack.
//
// Money is written as NUMERIC cells under a number format, never as pre-formatted strings: a
// merchant opening this in Excel must be able to SUM the column, and a string cannot be summed.
// The currency lives in the column header instead, which also avoids mapping currency codes to
// Excel's locale format strings.
//
// Headers and status values are ENGLISH ONLY. The workbook is a machine-readable artefact bound
// for a spreadsheet and an accountant; localising it would give anything built on top of it two
// parsing contracts. The UI around the download is bilingual as usual.
import ExcelJS from 'exceljs'
import type { SeriesPoint, Slice, StatusSlice } from '@bitetime/shared'

const MONEY_FMT = '#,##0.00'
const DATE_FMT = 'yyyy-mm-dd'
const PCT_FMT = '0%'

export interface ReportShop {
  name: string
  slug: string
  currency: string
  timeZone: string
}

export interface ReportWindow {
  days: number
  granularity: 'day' | 'week'
  /** The window's first and last civil day in the shop's zone, `YYYY-MM-DD`. */
  from: string
  to: string
  /** Already rendered in the shop's zone by the caller — this module owns no clock. */
  generatedAt: string
}

export interface RevenueReport {
  totalOrders: number
  revenue: number
  avgOrder: number
  series: SeriesPoint[]
  products: Slice[]
  statuses: StatusSlice[]
}

/** `YYYY-MM-DD` → a Date at UTC midnight, which is how ExcelJS serialises a date cell exactly. */
function dateCell(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function reportFilename(slug: string, today: string, days: number): string {
  return `${slug}-revenue-${today}-${days}d.xlsx`
}

export async function buildRevenueWorkbook(
  report: RevenueReport,
  shop: ReportShop,
  window: ReportWindow,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'TinyOrder'
  const money = `Revenue (${shop.currency})`

  // ── Summary ───────────────────────────────────────────────────────────────
  // No customer count and no vouchers-redeemed figure: neither can be honestly confined to the
  // window (one is an all-time list length, the other has no redemption date), and an all-time
  // number under a "Last 30 days" heading is the error this whole report exists to avoid.
  const summary = wb.addWorksheet('Summary')
  summary.columns = [{ width: 18 }, { width: 42 }]
  const rangeLabel = `Last ${window.days} days (${window.from} – ${window.to})`
  summary.addRows([
    ['Shop', shop.name],
    ['Slug', shop.slug],
    ['Range', rangeLabel],
    ['Granularity', window.granularity === 'week' ? 'Weekly' : 'Daily'],
    ['Time zone', shop.timeZone],
    ['Generated at', window.generatedAt],
    ['Currency', shop.currency],
    ['Total orders', report.totalOrders],
    ['Revenue', report.revenue],
    ['Average order', report.avgOrder],
  ])
  summary.getColumn(1).font = { bold: true }
  summary.getCell('B9').numFmt = MONEY_FMT
  summary.getCell('B10').numFmt = MONEY_FMT

  // ── Revenue over time ─────────────────────────────────────────────────────
  const time = wb.addWorksheet('Revenue over time')
  time.columns = [
    { header: 'Bucket start', key: 'start', width: 14 },
    { header: 'Bucket end', key: 'end', width: 14 },
    { header: 'Orders', key: 'orders', width: 10 },
    { header: money, key: 'revenue', width: 16 },
  ]
  for (const p of report.series) {
    const row = time.addRow({ start: dateCell(p.start), end: dateCell(p.end), orders: p.orders, revenue: p.revenue })
    row.getCell('start').numFmt = DATE_FMT
    row.getCell('end').numFmt = DATE_FMT
    row.getCell('revenue').numFmt = MONEY_FMT
  }

  // ── Revenue by product ────────────────────────────────────────────────────
  const products = wb.addWorksheet('Revenue by product')
  products.columns = [
    { header: 'Product', key: 'name', width: 32 },
    { header: 'Units', key: 'units', width: 10 },
    { header: money, key: 'revenue', width: 16 },
  ]
  for (const p of report.products) {
    products.addRow({ name: p.name, units: p.units, revenue: p.value }).getCell('revenue').numFmt = MONEY_FMT
  }

  // ── Orders by status ──────────────────────────────────────────────────────
  const statuses = wb.addWorksheet('Orders by status')
  statuses.columns = [
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Orders', key: 'count', width: 10 },
    { header: 'Share of range', key: 'share', width: 16 },
  ]
  for (const s of report.statuses) {
    // `pct` arrives as a whole number; Excel's percent format wants the fraction.
    statuses.addRow({ status: s.status, count: s.count, share: s.pct / 100 }).getCell('share').numFmt = PCT_FMT
  }

  for (const ws of [time, products, statuses]) ws.getRow(1).font = { bold: true }

  return Buffer.from(await wb.xlsx.writeBuffer())
}
```

- [ ] **Step 5: Run the test**

```bash
pnpm --filter @bitetime/backend test
```

Expected: PASS. If `getRow(1).values` comparisons fail, note ExcelJS arrays are 1-indexed — index 0 is `undefined`, which the expectations already account for.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(report): build the merchant revenue workbook

Four sheets from numbers @bitetime/shared already computed, with no
database, network or env of its own so it can be tested without a
Supabase stack.

Money is numeric cells under a format rather than pre-formatted strings,
because a merchant opening this in Excel has to be able to SUM the
column; the currency goes in the header instead. Headers and status
values stay English — the file is parsed by spreadsheets, not read as UI."
```

---

## Task 5: The gated endpoint

**Files:**
- Modify: `apps/backend/src/app.ts:46` (CORS) and after `:193` (the owner-scoped reads block)
- Create: `apps/backend/tests/api/report.test.ts`

**Interfaces:**
- Consumes: `buildRevenueWorkbook`, `reportFilename` (Task 4); `computeMerchantStats`, `productRevenue`, `statusBreakdown`, `ordersInWindow`, `todayInZone` from `@bitetime/shared` (Tasks 1–3 and the existing `fulfilment.ts`).
- Produces: `GET /api/merchants/:id/report.xlsx?days=&granularity=` returning the workbook, and `Content-Disposition` exposed to cross-origin readers.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/api/report.test.ts`:

```ts
// tests/api/report.test.ts
// GET /api/merchants/:id/report.xlsx — the Pro-gated revenue export. The load-bearing
// assertions are: (1) the gate is the BACKEND, so a basic shop's own owner is refused with
// `requires_pro` no matter what the browser renders, (2) a superadmin passes it, mirroring
// requirePro everywhere else, (3) tenancy still comes from requireMerchantOwns, and (4) a bad
// range is REFUSED rather than clamped — a silently clamped request returns a file that answers
// a different question than the one asked. See CLAUDE.md → Backend, CONTEXT.md → Plan entitlement.
import { describe, it, expect } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function get(path: string, token?: string) {
  return app.request(path, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

describe('GET /api/merchants/:id/report.xlsx', () => {
  it('returns a workbook to a Pro shop’s owner', async () => {
    await resetMerchant('report-pro-shop')
    const client = await makeUser('report-pro@example.com', 'password123')
    const { token, userId } = await tokenOf(client)
    const id = await seedMerchant({ slug: 'report-pro-shop', owner_id: userId, plan: 'pro' })

    await serviceClient().from('orders').insert({
      merchant_id: id, order_number: 'RE-260627-0050', status: 'completed',
      total: 42, items: [{ id: 'p1', name: 'Cookie', qty: 2, price: 21 }],
    })

    const res = await get(`/api/merchants/${id}/report.xlsx?days=30&granularity=day`, token)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(XLSX_TYPE)
    expect(res.headers.get('content-disposition'))
      .toContain('report-pro-shop-revenue-')

    // A real xlsx is a zip; every zip starts "PK".
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(0)
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('403 requires_pro for a basic shop’s owner', async () => {
    await resetMerchant('report-basic-shop')
    const client = await makeUser('report-basic@example.com', 'password123')
    const { token, userId } = await tokenOf(client)
    const id = await seedMerchant({ slug: 'report-basic-shop', owner_id: userId, plan: 'basic' })

    const res = await get(`/api/merchants/${id}/report.xlsx?days=30&granularity=day`, token)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'requires_pro' })

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // `plan` is nullable and pre-billing shops carry NULL. Absence of Pro is not Pro.
  it('403 requires_pro when the shop has no plan at all', async () => {
    await resetMerchant('report-noplan-shop')
    const client = await makeUser('report-noplan@example.com', 'password123')
    const { token, userId } = await tokenOf(client)
    const id = await seedMerchant({ slug: 'report-noplan-shop', owner_id: userId })

    const res = await get(`/api/merchants/${id}/report.xlsx?days=30&granularity=day`, token)
    expect(res.status).toBe(403)

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('lets a superadmin download a basic shop’s report', async () => {
    await resetMerchant('report-super-shop')
    const owner = await makeUser('report-super-owner@example.com', 'password123')
    const { userId: ownerId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'report-super-shop', owner_id: ownerId, plan: 'basic' })

    const superClient = await makeUser('report-super-admin@example.com', 'password123')
    const { token: superToken, userId: superUserId } = await tokenOf(superClient)
    const svc = serviceClient()
    await svc.from('profiles').delete().eq('user_id', superUserId)
    await svc.from('profiles').insert({ user_id: superUserId, name: 'Super', app_role: 'superadmin' })

    const res = await get(`/api/merchants/${id}/report.xlsx?days=30&granularity=day`, superToken)
    expect(res.status).toBe(200)

    await svc.from('profiles').delete().eq('user_id', superUserId)
    await svc.from('merchants').delete().eq('id', id)
  })

  it('403 for a non-owner', async () => {
    await resetMerchant('report-a-shop')
    const owner = await makeUser('report-a@example.com', 'password123')
    const { userId: ownerId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'report-a-shop', owner_id: ownerId, plan: 'pro' })

    const other = await makeUser('report-b@example.com', 'password123')
    const { token: otherToken } = await tokenOf(other)

    const res = await get(`/api/merchants/${id}/report.xlsx?days=30&granularity=day`, otherToken)
    expect(res.status).toBe(403)

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('401 without a token', async () => {
    await resetMerchant('report-anon-shop')
    const client = await makeUser('report-anon@example.com', 'password123')
    const { userId } = await tokenOf(client)
    const id = await seedMerchant({ slug: 'report-anon-shop', owner_id: userId, plan: 'pro' })

    const res = await get(`/api/merchants/${id}/report.xlsx?days=30&granularity=day`)
    expect(res.status).toBe(401)

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('refuses a range or granularity it does not offer, rather than clamping it', async () => {
    await resetMerchant('report-range-shop')
    const client = await makeUser('report-range@example.com', 'password123')
    const { token, userId } = await tokenOf(client)
    const id = await seedMerchant({ slug: 'report-range-shop', owner_id: userId, plan: 'pro' })

    expect((await get(`/api/merchants/${id}/report.xlsx?days=7&granularity=day`, token)).status).toBe(400)
    expect((await get(`/api/merchants/${id}/report.xlsx?days=30&granularity=month`, token)).status).toBe(400)
    expect((await get(`/api/merchants/${id}/report.xlsx?days=abc&granularity=day`, token)).status).toBe(400)

    await serviceClient().from('merchants').delete().eq('id', id)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Start the local stack first if it is not running (`cd apps/backend && supabase start`), then:

```bash
pnpm --filter @bitetime/backend test:db -- report
```

Expected: FAIL with 404s — the route does not exist yet.

- [ ] **Step 3: Expose `Content-Disposition` to the browser**

The frontend and backend are different origins in production (Vercel ↔ Railway). Without `exposeHeaders` the browser can read the body but not the filename header. In `apps/backend/src/app.ts:46`:

```ts
// `exposeHeaders` is what lets the browser READ Content-Disposition on a cross-origin response.
// Without it the report download lands with a body and no filename, and saves as the URL's last
// path segment.
app.use('/api/*', cors({
  origin: env.frontendUrl,
  allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['Content-Disposition'],
}))
```

- [ ] **Step 4: Add the imports**

In `apps/backend/src/app.ts`, extend the existing `@bitetime/shared` import (or add one if the file has none) and add the report import:

```ts
import {
  computeMerchantStats, productRevenue, statusBreakdown, ordersInWindow, todayInZone,
} from '@bitetime/shared'
import { buildRevenueWorkbook, reportFilename } from './report.js'
```

- [ ] **Step 5: Add the route**

Insert immediately after the `GET /api/merchants/:id/orders/count` handler (around line 208):

```ts
// The Pro-only revenue export (CONTEXT.md → Plan entitlement). The gate is HERE — the padlock
// in the dashboard is UX, and this refuses a crafted request from a basic shop's own owner.
//
// Read-only and single-statement, so it goes through `admin` and not `db.ts`; there is nothing
// to keep atomic. Every sheet is confined to the window, which is why the orders are filtered
// BEFORE the stats run: productRevenue and statusBreakdown carry no window of their own.
const REPORT_DAYS = [12, 30, 60, 90]

app.get('/api/merchants/:id/report.xlsx', requireMerchantOwns, requirePro, async (c) => {
  const days = Number(c.req.query('days'))
  const granularity = c.req.query('granularity')
  // Refused, not clamped: a clamped request hands back a file that quietly answers a different
  // question than the one asked, over a merchant's own accounting.
  if (!REPORT_DAYS.includes(days)) return c.json({ error: 'bad_range' }, 400)
  if (granularity !== 'day' && granularity !== 'week') return c.json({ error: 'bad_granularity' }, 400)

  const m = c.get('merchant')
  const { data, error } = await admin.from('orders').select('*').eq('merchant_id', m.id)
  if (error) return c.json({ error: 'Lookup failed' }, 500)

  const now = new Date()
  const timeZone = m.timezone || 'Asia/Kuala_Lumpur'
  const currency = m.currency || 'MYR'
  const windowed = ordersInWindow(data ?? [], now, days, timeZone)
  const stats = computeMerchantStats(windowed, [], [], [], now, { days, granularity, timeZone })

  const buffer = await buildRevenueWorkbook(
    {
      totalOrders: stats.totalOrders,
      revenue: stats.revenue,
      avgOrder: stats.avgOrder,
      series: stats.series,
      // Uncapped: a spreadsheet lists every product, unlike the six-wedge donut on the dashboard.
      products: productRevenue(windowed),
      statuses: statusBreakdown(windowed),
    },
    { name: m.name, slug: m.slug, currency, timeZone },
    {
      days,
      granularity,
      from: stats.series[0]?.start ?? todayInZone(timeZone, now),
      to: stats.series[stats.series.length - 1]?.end ?? todayInZone(timeZone, now),
      // Stamped in the SHOP's zone, like every other date in the file. A UTC timestamp on a
      // report whose day boundaries are Kuala Lumpur's is the same mismatch this feature spent
      // Task 2 removing.
      generatedAt: new Intl.DateTimeFormat('en-CA', {
        timeZone, dateStyle: 'short', timeStyle: 'short',
      }).format(now),
    },
  )

  const filename = reportFilename(m.slug, todayInZone(timeZone, now), days)
  return c.body(buffer, 200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${filename}"`,
  })
})
```

- [ ] **Step 6: Run the API tests**

```bash
pnpm --filter @bitetime/backend test:db -- report
```

Expected: PASS. If the workbook test fails on `content-type`, check `c.body`'s third argument is the headers object and not a status.

- [ ] **Step 7: Run the whole suite, typecheck and lint**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm --filter @bitetime/backend test:db
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): serve the Pro-only revenue report as XLSX

GET /api/merchants/:id/report.xlsx behind requireMerchantOwns and
requirePro. The gate is the backend, so a basic shop's own owner is
refused whatever the dashboard renders.

Orders are filtered to the window before the stats run, because product
revenue and status breakdown carry no window of their own and every sheet
has to mean what the file's heading says. An unoffered range is refused
rather than clamped: a clamped request returns a file that quietly
answers a different question.

CORS now exposes Content-Disposition — without it the browser can read
the body but not the filename across origins."
```

---

## Task 6: The download button

**Files:**
- Modify: `apps/frontend/src/api.ts`
- Modify: `apps/frontend/src/store.ts`
- Modify: `apps/frontend/src/merchant/Overview.tsx`

**Interfaces:**
- Consumes: the endpoint from Task 5; `useProAccess`, `isRequiresPro` from `../plan`; `ProBadge`, `UpgradeLink` from `./ProLock`; `useUpgradeNav` from `./UpgradeNav`.
- Produces: `apiGetFile(path, opts): Promise<Result<{ blob: Blob; filename: string | null }>>` in `api.ts`; `downloadRevenueReport(merchantId, window)` in `store.ts`.

- [ ] **Step 1: Add the binary GET to `api.ts`**

Insert after `apiGet`:

```ts
/**
 * A GET whose body is a FILE, not JSON.
 *
 * `apiGet` parses the body as JSON and would choke on a workbook. Everything else is shared
 * with it — the same headers, the same `errorFromResponse` (failures are still JSON), and the
 * same Result convention (#122), so a `403 requires_pro` arrives as an `ApiError` that
 * `isRequiresPro` already recognises.
 *
 * The filename comes from `Content-Disposition`, which the backend must EXPOSE via CORS for
 * this to be readable across origins; `null` when the header is missing, and callers pick
 * their own name.
 */
export async function apiGetFile(
  path: string,
  opts?: Opts,
): Promise<Result<{ blob: Blob; filename: string | null }>> {
  const h = await resolveHeaders({}, opts?.auth)
  if ('fail' in h) return { ok: false, error: h.fail }
  try {
    const res = await fetch(`${API_URL}${path}`, { headers: h.headers })
    if (!res.ok) return { ok: false, error: await errorFromResponse(res) }
    const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')
    return { ok: true, data: { blob: await res.blob(), filename: match?.[1] ?? null } }
  } catch {
    return { ok: false, error: NETWORK_ERROR }
  }
}
```

- [ ] **Step 2: Add the store slice**

In `apps/frontend/src/store.ts`, next to `fetchMerchantOrders`, add the import of `apiGetFile` to the existing `./api` import and then:

```ts
/**
 * The Pro-only revenue export. Hands back the workbook and the name the server chose for it.
 *
 * The range and granularity are the ones the merchant is looking at on the Overview chart —
 * the file is that panel, not a second range concept. A plain `<a href>` cannot be used here:
 * the endpoint needs the Authorization header, so the bytes come back through fetch.
 */
export async function downloadRevenueReport(
  merchantId: string,
  window: { days: number; granularity: 'day' | 'week' },
): Promise<Result<{ blob: Blob; filename: string | null }>> {
  return apiGetFile(
    `/api/merchants/${merchantId}/report.xlsx?days=${window.days}&granularity=${window.granularity}`,
    { auth: 'required' },
  )
}
```

- [ ] **Step 3: Add the button to the Overview panel**

In `apps/frontend/src/merchant/Overview.tsx`, extend the imports:

```ts
import { Download, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useProAccess, isRequiresPro } from '../plan'
import { ProBadge } from './ProLock'
import { useUpgradeNav } from './UpgradeNav'
import { downloadRevenueReport } from '../store'
```

(merge `Download`/`Lock` into the existing `lucide-react` import, and `downloadRevenueReport` into the existing `../store` import).

Add this component above `export default function Overview()`:

```tsx
/**
 * Show-but-lock, the same shape every other Pro surface uses (ProLock.tsx): a basic shop SEES
 * the button, because hiding it would read as a missing feature and leave nothing to sell
 * against. Clicking it goes to Settings → Subscription, where the price is — never straight
 * to Stripe.
 */
function DownloadReport({ days, granularity }: { days: number; granularity: 'day' | 'week' }) {
  const { t, merchant } = useSession()
  const isPro = useProAccess()
  const { goToSubscription } = useUpgradeNav()
  const [busy, setBusy] = useState(false)

  async function download() {
    if (!merchant?.id) return
    setBusy(true)
    const r = await downloadRevenueReport(merchant.id, { days, granularity })
    setBusy(false)
    if (!r.ok) {
      // A Pro shop that was downgraded under a long-open tab still reaches here — an upgrade
      // prompt, not the raw code (#110).
      if (isRequiresPro(r.error)) { goToSubscription(); return }
      toast.error(r.error.message || t('Could not build the report', '无法生成报表'))
      return
    }
    const url = URL.createObjectURL(r.data.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = r.data.filename ?? `revenue-${days}d.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={isPro ? download : goToSubscription}
      aria-label={t('Download revenue report', '下载营收报表')}
    >
      {isPro ? <Download size={14} strokeWidth={1.75} /> : <Lock size={14} strokeWidth={1.75} />}
      {busy ? t('Preparing…', '生成中…') : t('Download report', '下载报表')}
      {!isPro && <ProBadge />}
    </Button>
  )
}
```

Then add it to the `ChartPanel`'s `legend`, as the last child of the outer flex row:

```tsx
            <DownloadReport days={rangeDays} granularity={granularity} />
```

- [ ] **Step 4: Typecheck, lint and unit tests**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Expected: PASS.

- [ ] **Step 5: Run and verify in the browser**

UI is verified by running the app, not by component tests (CLAUDE.md). Start the stack:

```bash
cd apps/backend && supabase start && cd ../.. && pnpm dev
```

Then, in the browser preview at `http://localhost:5173`:

1. Sign in as a **basic** merchant. On `/merchant` → Overview, the revenue panel shows a "Download report" button with a padlock and a Pro badge. Click it → lands on Settings → Subscription. No download, no error toast.
2. Set that shop to Pro (`update merchants set plan = 'pro' where slug = '<slug>'` against the local DB) and reload. The padlock becomes a download icon.
3. Pick 30d / Daily, click. A file named `<slug>-revenue-<today>-30d.xlsx` downloads.
4. Open it. Confirm four sheets; that "Revenue over time" sums to the same figure as the Revenue stat card above the chart; and that selecting the revenue column shows a live SUM in the spreadsheet's status bar (proving the cells are numeric, not text).
5. Switch to 90d / Weekly, download again, and confirm the file's bucket count and the chart's bar count match.

Record what you saw. Do not claim this task is done without having opened the file.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(dashboard): let Pro shops download the revenue report

The button sits in the revenue panel beside the range pills, because the
file is that panel's contents — it exports whatever range and
granularity the merchant is currently looking at.

Basic shops see it locked rather than hidden: a hidden feature reads as a
missing one and leaves nothing to sell against. The padlock routes to
Settings → Subscription, where the price is, and never straight to
Stripe. A downgrade under a long-open tab surfaces the same prompt via
the backend's requires_pro.

api.ts gains apiGetFile because apiGet parses JSON and a workbook is
bytes; a plain anchor could not carry the Authorization header."
```

---

## Notes for the implementer

**Known, deliberate, not yours to fix here:**

- `Overview.tsx` fetches products via `lookupProducts` purely to feed `computeMerchantStats`'s `_products` parameter, which is unused. Leaving it is a wasted request. Out of scope — do not remove it in this plan.
- `productRevenue` and `statusBreakdown` are all-time on the Overview while the bar chart above them is ranged. The export ranges all four sheets, so for a shop with history older than the selected range the file will not match the donut. That inconsistency is a pre-existing bug filed separately.

**If a step's output disagrees with this plan, stop and report it** rather than adapting silently — a stats number that moved unexpectedly means the time zone work changed something it should not have.
