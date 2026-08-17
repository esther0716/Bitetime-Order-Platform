// tests/unit/report.test.ts
// The revenue workbook's shape. The load-bearing assertions are that money lands in NUMERIC
// cells — a merchant must be able to SUM the column, and a pre-formatted string cannot be
// summed — that every sheet the spec names exists under the name it names, and that a shop with
// no orders in the range still gets a valid file with headers rather than an error.
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import {
  buildRevenueWorkbook, reportFilename,
  type RevenueReport, type ReportShop, type ReportWindow,
} from '../../src/report.js'

const SHOP: ReportShop = {
  name: 'Sweet Bakes', slug: 'sweet-bakes', currency: 'MYR', timeZone: 'Asia/Kuala_Lumpur',
}

const WINDOW: ReportWindow = {
  kind: 'last-n', days: 30, granularity: 'day', from: '2026-05-29', to: '2026-06-27',
  generatedAt: '2026-06-27, 12:00',
}

// The merchant named their own two dates (#234): the same file, over a window that ended months
// ago. "Last 90 days" would be a false statement about it.
const CUSTOM_WINDOW: ReportWindow = {
  kind: 'custom', days: 90, granularity: 'week', from: '2026-01-01', to: '2026-03-31',
  generatedAt: '2026-06-27, 12:00',
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
  // ExcelJS declares its own `Buffer` type for load(); the bytes are a Node Buffer either way.
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer)
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
    const revenue = wb.getWorksheet('Revenue over time')!.getCell('D2')
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
    expect(ws.getCell('B9').numFmt).toBe('#,##0.00')
  })

  it('states a custom range by its two dates and its span, never as "last N days"', async () => {
    const wb = await readBack(await buildRevenueWorkbook(REPORT, SHOP, CUSTOM_WINDOW))
    const ws = wb.getWorksheet('Summary')!
    expect(ws.getCell('B3').value).toBe('2026-01-01 – 2026-03-31 (90 days)')
    expect(ws.getCell('B4').value).toBe('Weekly')
  })

  // A merchant who opened last month and picked "last 12 days" gets an empty range, and must
  // still get a file — an error here would read as a broken feature rather than a quiet month.
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
    expect(reportFilename('sweet-bakes', '2026-06-27', WINDOW)).toBe('sweet-bakes-revenue-2026-06-27-30d.xlsx')
  })

  // The day it was downloaded is no use for telling two custom exports apart; the range is.
  it('names a custom range by its own two dates, not by the day it was built', () => {
    expect(reportFilename('sweet-bakes', '2026-06-27', CUSTOM_WINDOW))
      .toBe('sweet-bakes-revenue-2026-01-01_2026-03-31.xlsx')
  })
})
