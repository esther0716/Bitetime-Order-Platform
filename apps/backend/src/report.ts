// The merchant revenue report, as an XLSX workbook (CONTEXT.md → Plan entitlement).
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

/** `YYYY-MM-DD` → a Date at UTC midnight, which is what ExcelJS serialises to that same date. */
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
  // window (one is an all-time list length, the other carries no redemption date), and an
  // all-time number under a "Last 30 days" heading is the error this report exists to avoid.
  const summary = wb.addWorksheet('Summary')
  summary.columns = [{ width: 18 }, { width: 42 }]
  summary.addRows([
    ['Shop', shop.name],
    ['Slug', shop.slug],
    ['Range', `Last ${window.days} days (${window.from} – ${window.to})`],
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
    const row = time.addRow({
      start: dateCell(p.start), end: dateCell(p.end), orders: p.orders, revenue: p.revenue,
    })
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
    products.addRow({ name: p.name, units: p.units, revenue: p.value })
      .getCell('revenue').numFmt = MONEY_FMT
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
    statuses.addRow({ status: s.status, count: s.count, share: s.pct / 100 })
      .getCell('share').numFmt = PCT_FMT
  }

  for (const ws of [time, products, statuses]) ws.getRow(1).font = { bold: true }

  return Buffer.from(await wb.xlsx.writeBuffer())
}
