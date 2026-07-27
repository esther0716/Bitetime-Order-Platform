# Merchant revenue report export (XLSX, Pro-only)

**Date:** 2026-07-27
**Status:** Approved design, not yet implemented

## Problem

A merchant can see their revenue on the dashboard Overview but cannot take it anywhere. Bookkeeping,
tax filing and "send last quarter to my accountant" all end in retyping numbers off a chart. They want
a spreadsheet.

This is also a feature worth charging for. Pro today is Telegram notifications, vouchers and product
promos; a revenue report is the first Pro feature aimed at the merchant's back office rather than at
their storefront.

## What is being sold

The numbers, not the file, are already visible to every shop — the Overview chart renders for basic
shops and will keep doing so. What Pro buys is the export. The gate is therefore about the endpoint,
not about secrecy of the data, and the design does not pretend otherwise.

The gate is still enforced on the **backend**, per `CONTEXT.md → Plan entitlement`: the browser's copy
of `merchants.plan` is UX, and a real endpoint must refuse. A browser-side file builder was considered
and rejected — it would make the padlock the only gate, which contradicts the convention every other
Pro feature follows.

## Scope

**In:** a single `.xlsx` of the revenue summary, for the range currently selected on the Overview
chart, downloadable by Pro shops from the Overview panel.

**Out:** order-level and line-item exports, a customer export, CSV, a custom date-range picker,
scheduled or emailed reports. Each is a separate feature; none is blocked by this design.

## The file

One workbook, four sheets. **Every sheet is scoped to the selected range** — see "Range" below for why
this diverges slightly from what the Overview renders today.

### Sheet 1 — Summary

One label/value column pair:

| Field | Source |
|---|---|
| Shop | `merchants.name` |
| Slug | `merchants.slug` |
| Range | e.g. `Last 30 days (2026-06-27 – 2026-07-27)` |
| Granularity | `Daily` \| `Weekly` |
| Time zone | `merchants.timezone` |
| Generated at | ISO timestamp, shop time zone |
| Currency | `merchants.currency` |
| Total orders | `MerchantStats.totalOrders` |
| Revenue | `MerchantStats.revenue` |
| Average order | `MerchantStats.avgOrder` |

No customer count and no vouchers-redeemed figure. Both exist on `MerchantStats` but neither can be
honestly ranged — `customerCount` is the length of an all-time customers list and `vouchers.usedBy`
carries no redemption date. Putting an all-time number on a sheet headed "Last 30 days" is the exact
error this design rejects elsewhere. Dropping them also means the endpoint issues one query.

### Sheet 2 — Revenue over time

One row per bucket, oldest first.

| Column | Notes |
|---|---|
| Bucket start | date cell, shop time zone |
| Bucket end | date cell; equals bucket start on daily granularity |
| Orders | integer |
| Revenue | money |

### Sheet 3 — Revenue by product

One row per product that sold in the range, descending by revenue.

| Column | Notes |
|---|---|
| Product | line item `name`, falling back to `id`, then `—` |
| Units | sum of line item `qty` |
| Revenue | sum of `price × qty` |

No `"Other"` row. `productRevenue()` folds its tail at top-6 for the donut; a spreadsheet must list
every product, so the report calls it with no cap.

`Units` does not exist in `MerchantStats` today and is added — see "Changes to the stats module".

### Sheet 4 — Orders by status

| Column | Notes |
|---|---|
| Status | `new` \| `preparing` \| `ready` \| `completed` \| `cancelled` |
| Orders | integer |
| Share of range | percentage cell |

Status labels are written in **English only**. The workbook is a machine-readable artefact headed for
Excel and accountants; localising column headers and enum values would mean two parsing contracts for
whatever the merchant builds on top of it. The UI around the download stays bilingual via `t()` as
usual.

### Money cells

Numeric cells with number format `#,##0.00`, with the currency code in the column header
(`Revenue (MYR)`). Not pre-formatted strings — a merchant must be able to `SUM()` the column. This
deliberately avoids mapping currency codes to Excel locale format strings.

Aggregating across a shop's orders in one currency is safe: `merchants.currency` locks once the shop
has its first order, so totals never mix units.

### Filename

`<slug>-revenue-<YYYY-MM-DD>-<days>d.xlsx`, e.g. `sweet-bakes-revenue-2026-07-27-30d.xlsx`. Date is
today in the shop's time zone.

## Range

The export mirrors the Overview chart's controls: the current `days` (12 | 30 | 60 | 90) and
`granularity` (`day` | `week`) ride along as query parameters. The merchant downloads the thing they
are looking at; no second range concept is introduced into the dashboard.

**Resolved before implementation.** This design was written when `productRevenue()` and
`statusBreakdown()` ignored the range entirely — they were all-time while the bar chart above them was
ranged, so the Overview's donut and status list disagreed with their own panel heading. That was filed
separately and fixed in `dda6ba3`, which narrows the orders once inside `computeMerchantStats` and
feeds the same window to all three panels.

So the report and the dashboard now range identically, and the divergence this section used to warn
about does not exist. Two consequences for the design below:

- The report does not need to pre-filter for its **sheets** — `computeMerchantStats` already does.
- It does still need `ordersInWindow`, for its **Summary totals**: `MerchantStats`'s KPI block
  (`totalOrders`, `revenue`, `avgOrder`) is all-time on purpose, because those cards sit *above* the
  range pills on the dashboard. A Summary sheet headed "Last 30 days" cannot use them.

## Architecture

### Backend endpoint

```
GET /api/merchants/:id/report.xlsx?days=<12|30|60|90>&granularity=<day|week>
    requireMerchantOwns → requirePro
```

- `200` → `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  `Content-Disposition: attachment; filename="<name>"`, body is the workbook.
- `403 requires_pro` for a basic shop, from the existing `requirePro` middleware — no new error code.
- `400` for a `days` or `granularity` outside the allowlist. Reject, do not silently clamp: a clamped
  request returns a file that quietly answers a different question than the one asked.

Read-only, single-statement, no transaction — so `supabase.ts`'s `admin` client, not `db.ts`.

Handler responsibilities, in order:

1. Validate `days` and `granularity`.
2. Fetch orders — `admin.from('orders').select('*').eq('merchant_id', m.id)`, one query and no others.
   Products are not fetched: `computeMerchantStats`'s `_products` parameter is already unused, and
   product names come from the `items` jsonb on each order. Customers and vouchers are not fetched
   because the Summary sheet no longer reports them.
3. Narrow the orders to the window with `ordersInWindow`, take the Summary figures from
   `windowTotals` on that list, and call `computeMerchantStats` with it, `[]` for customers and
   vouchers, and `{ days, granularity, timeZone, productTop: Infinity }`.

   `windowTotals` exists so "revenue excludes cancelled orders" is stated once in
   `@bitetime/shared` rather than restated on the backend. The `customerCount`, `vouchersRedeemed`,
   `ordersDelta` and `revenueDelta` fields of the returned `MerchantStats` are meaningless on
   pre-narrowed orders, and the report reads none of them.
4. Hand the stats plus shop metadata to `buildRevenueWorkbook`.

### `apps/backend/src/report.ts`

```ts
buildRevenueWorkbook(stats: MerchantStats, shop: ReportShop, window: ReportWindow): Promise<Buffer>
```

Pure in the sense that matters: no database, no network, no `env`. Takes already-computed numbers and
returns bytes. Testable without a Supabase stack.

**Library: `exceljs`.** Produces valid workbooks, is widely used, and writes to a Buffer without
temp files. Per `CLAUDE.md`, adding a backend runtime dependency means adding its esbuild flag —
`--external:exceljs` joins the existing five in `apps/backend/package.json`'s `build` script. Omitting
the flag silently bundles it.

Hand-rolling OOXML over a small zip library was considered: roughly 150 lines and Excel is unforgiving
about malformed parts. Not worth it for four sheets.

### Changes to the stats module

`apps/frontend/src/merchant/overviewStats.ts` moves to `packages/shared/src/merchantStats.ts`. It
qualifies for `@bitetime/shared` under the workspace's own rule — it now has to produce identical
numbers on both sides of the wire, or the file disagrees with the chart. It is pure and imports only
types, so the move is mechanical. `overviewStats.ts` stays as a re-export so `Overview.tsx` and the
existing tests do not churn.

Three changes travel with it:

1. **Time zone.** `SeriesWindow` gains `timeZone?: string`. Day bucketing currently uses local
   `new Date().getFullYear()/getMonth()/getDate()`, which on Railway is UTC while the shop is
   `Asia/Kuala_Lumpur` (the `merchants.timezone` default) — a 20:00 order would land on the wrong day
   in a server-built file. Bucketing switches to `Intl.DateTimeFormat('en-CA', { timeZone })`, which
   yields `YYYY-MM-DD` and needs no dependency in either runtime. The same substitution applies to
   `monthKey()`, which drives the month-over-month deltas.

   **`Overview.tsx` passes `merchant.timezone` too.** Both sides then bucket in shop time, so chart and
   file agree. This is a visible behaviour change for any merchant whose browser time zone differs from
   their shop's — their chart's day boundaries shift. That is a correctness fix, and it is the only way
   the two artefacts can be made to agree. Falls back to local time when `timezone` is absent.

2. **Uncapped product revenue.** `SeriesWindow` gains `productTop`, defaulting to the donut's 6. The
   report passes `Infinity` and gets every product with no `Other` row.

3. **Units per product.** `Slice` gains `units: number` (sum of line item `qty`). The donut ignores it;
   the report's product sheet needs it.

4. **Window helpers.** `ordersInWindow` and `windowTotals` are exported, for the ranged Summary
   figures described in the endpoint's step 3.

### Frontend

**`api.ts` — new `apiGetFile(path, opts): Promise<Result<Blob>>`.** `apiGet` parses JSON and cannot
carry a workbook. The new helper reuses `resolveHeaders`, `errorFromResponse` and `NETWORK_ERROR`
unchanged, differing only in reading `res.blob()` on success. It stays on the Result convention (#122),
so the `403 requires_pro` arrives as `{ code: 'requires_pro' }` and `isRequiresPro()` already
recognises it.

A plain `<a href>` cannot be used: the endpoint requires an `Authorization` header. The download is
blob → `URL.createObjectURL` → synthetic anchor → click → `revokeObjectURL`.

**`store.ts` — `downloadRevenueReport(merchantId, window)`**, following the existing per-slice pattern,
returning the `Result<Blob>` and the server-supplied filename.

**`Overview.tsx` — a "Download report" button** in the revenue `ChartPanel`'s legend area, beside the
range and granularity pills. It is the panel those controls belong to, and the file is that panel's
contents.

Gating follows the established show-but-lock pattern (`ProLock.tsx`): a basic shop sees the button with
a `ProBadge` and a padlock, and clicking it routes to Settings → Subscription via `UpgradeLink`, not to
Stripe. Hiding it would read as a missing feature and there would be nothing to sell against.

Failure handling on the Pro path: `isRequiresPro(r.error)` → the same upgrade prompt, covering the
stale-plan-in-a-long-open-tab case; anything else → `toast.error`. Button shows a busy state while the
request is in flight.

## Testing

**`packages/shared`** — extends the moved `merchantStats.test.ts`:
- Day bucketing across a midnight boundary in a non-UTC `timeZone`, proving an order at 23:30
  `Asia/Kuala_Lumpur` lands on its local day and not the UTC one.
- Uncapped `productRevenue` returns every product with no `Other` row; capped keeps existing behaviour.
- `units` accumulates across multiple orders of the same product.

**`apps/backend/tests/unit`** — `buildRevenueWorkbook` with a fixed `MerchantStats`: four sheets with
the expected names, headers present, money cells numeric rather than strings, empty stats produce a
valid workbook with headers and no data rows.

**`apps/backend/tests/api`** — through `app.request()` against real Postgres:
- basic shop → `403` with `requires_pro`
- Pro shop → `200`, correct content-type, `Content-Disposition` filename, body begins `PK` (a valid zip)
- superadmin on a basic shop → `200`, mirroring `requirePro`'s bypass
- a shop owner requesting another shop's id → the existing `requireMerchantOwns` refusal
- `days=7` and `granularity=month` → `400`

**UI** — run-and-verify per `CLAUDE.md`: a basic shop sees the padlock and lands on the Subscription
tab; a Pro shop downloads a workbook that opens and whose totals match the chart on screen.

## Risks

- **`exceljs` bundle size.** ~10 MB installed with its dependency tree. Acceptable for a Railway
  backend; it is not in the frontend bundle. The `--external:` flag is the thing that must not be
  forgotten.
- **Time zone change is visible.** Merchants whose browser time zone differs from their shop's will see
  their chart's day boundaries move. Correct, but it is a change to something they already look at.
- **Large shops.** The endpoint pulls every order for the shop and filters in memory, exactly as the
  dashboard already does. Fine at current volumes; if it stops being fine, the fix is a date-bounded
  query, not a change to this design.

## Out of scope, deliberately

- CSV, and legacy `.xls`
- Order-level, line-item and customer exports
- A custom date-range picker
- Scheduled or emailed reports
