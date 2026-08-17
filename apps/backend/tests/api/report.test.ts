// tests/api/report.test.ts
// GET /api/merchants/:id/report.xlsx — the revenue export. The load-bearing assertions are:
// (1) a shop's own owner gets their file, (2) a superadmin gets it too, (3) tenancy comes from
// requireMerchantOwns, and (4) a range the UI does not offer is REFUSED rather than clamped — a
// silently clamped request hands back a file that quietly answers a different question than the
// one asked, over a merchant's own accounting. See CLAUDE.md → Backend.
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { todayInZone, type MerchantStats } from '@bitetime/shared'
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
const OK_QUERY = '?days=30&granularity=day'

describe('GET /api/merchants/:id/report.xlsx', () => {
  it('returns a workbook to the shop’s owner', async () => {
    await resetMerchant('report-pro-shop')
    const client = await makeUser('report-pro@example.com', 'password123')
    const { token, userId } = await tokenOf(client)
    const id = await seedMerchant({ slug: 'report-pro-shop', owner_id: userId })

    await serviceClient().from('orders').insert({
      merchant_id: id, order_number: 'RE-260627-0050', status: 'completed',
      total: 42, items: [{ id: 'p1', name: 'Cookie', qty: 2, price: 21 }],
    })

    const res = await get(`/api/merchants/${id}/report.xlsx${OK_QUERY}`, token)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(XLSX_TYPE)
    expect(res.headers.get('content-disposition')).toContain('report-pro-shop-revenue-')
    expect(res.headers.get('content-disposition')).toContain('-30d.xlsx')

    // A real xlsx is a zip, and every zip starts "PK".
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(0)
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('lets a superadmin download another shop’s report', async () => {
    await resetMerchant('report-super-shop')
    const owner = await makeUser('report-super-owner@example.com', 'password123')
    const { userId: ownerId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'report-super-shop', owner_id: ownerId })

    const superClient = await makeUser('report-super-admin@example.com', 'password123')
    const { token: superToken, userId: superUserId } = await tokenOf(superClient)
    const svc = serviceClient()
    await svc.from('profiles').delete().eq('user_id', superUserId)
    await svc.from('profiles').insert({ user_id: superUserId, name: 'Super', app_role: 'superadmin' })

    const res = await get(`/api/merchants/${id}/report.xlsx${OK_QUERY}`, superToken)
    expect(res.status).toBe(200)

    await svc.from('profiles').delete().eq('user_id', superUserId)
    await svc.from('merchants').delete().eq('id', id)
  })

  it('403 for a non-owner', async () => {
    await resetMerchant('report-a-shop')
    const owner = await makeUser('report-a@example.com', 'password123')
    const { userId: ownerId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'report-a-shop', owner_id: ownerId })

    const other = await makeUser('report-b@example.com', 'password123')
    const { token: otherToken } = await tokenOf(other)

    const res = await get(`/api/merchants/${id}/report.xlsx${OK_QUERY}`, otherToken)
    expect(res.status).toBe(403)

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('401 without a token', async () => {
    await resetMerchant('report-anon-shop')
    const client = await makeUser('report-anon@example.com', 'password123')
    const { userId } = await tokenOf(client)
    const id = await seedMerchant({ slug: 'report-anon-shop', owner_id: userId })

    const res = await get(`/api/merchants/${id}/report.xlsx${OK_QUERY}`)
    expect(res.status).toBe(401)

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('refuses a range or granularity it does not offer, rather than clamping it', async () => {
    await resetMerchant('report-range-shop')
    const client = await makeUser('report-range@example.com', 'password123')
    const { token, userId } = await tokenOf(client)
    const id = await seedMerchant({ slug: 'report-range-shop', owner_id: userId })

    const url = (q: string) => `/api/merchants/${id}/report.xlsx${q}`
    expect((await get(url('?days=7&granularity=day'), token)).status).toBe(400)
    expect((await get(url('?days=30&granularity=month'), token)).status).toBe(400)
    expect((await get(url('?days=abc&granularity=day'), token)).status).toBe(400)
    expect((await get(url(''), token)).status).toBe(400)

    await serviceClient().from('merchants').delete().eq('id', id)
  })
})

// ── The merchant's own two dates (#234) ──────────────────────────────────────
// A range the pills cannot express: it ends in the PAST. Both endpoints take it, both refuse the
// same bad ones, and the file names the range it actually covers. The shop's zone is the seeded
// default, Asia/Kuala_Lumpur, so "today" here is the shop's today and not the runner's.
const ZONE = 'Asia/Kuala_Lumpur'
const MS_PER_DAY = 86_400_000

/** `YYYY-MM-DD`, `n` days before it. Civil arithmetic, no clock. */
function shift(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) - n * MS_PER_DAY).toISOString().slice(0, 10)
}

describe('a custom revenue range', () => {
  const today = todayInZone(ZONE, new Date())
  // Ten days wide and ending five days ago, so no pill can produce it.
  const to = shift(today, 5)
  const from = shift(today, 14)

  async function seedShop(slug: string, email: string) {
    await resetMerchant(slug)
    const client = await makeUser(email, 'password123')
    const { data } = await client.auth.getSession()
    const token = data.session!.access_token
    const id = await seedMerchant({ slug, owner_id: data.session!.user.id })
    return { id, token }
  }

  const orderAt = (id: string, day: string, total: number, n: string) => ({
    merchant_id: id, order_number: n, status: 'completed', total,
    items: [{ id: 'p1', name: 'Cookie', qty: 1, price: total }],
    // Midday in KL, so the order sits on `day` in the shop's zone whatever the runner's is.
    created_at: `${day}T04:00:00Z`,
  })

  it('reports the figures inside the named range and nothing outside it', async () => {
    const { id, token } = await seedShop('custom-stats-shop', 'custom-stats@example.com')
    await serviceClient().from('orders').insert([
      orderAt(id, to, 30, 'CS-1'),          // the window's last day
      orderAt(id, from, 20, 'CS-2'),        // the window's first day
      orderAt(id, shift(today, 4), 99, 'CS-3'),  // one day after the window
      orderAt(id, shift(today, 15), 99, 'CS-4'), // one day before it
    ])

    const res = await get(`/api/merchants/${id}/stats?from=${from}&to=${to}&granularity=day`, token)
    expect(res.status).toBe(200)
    const stats = (await res.json()) as MerchantStats
    expect(stats.series).toHaveLength(10)
    expect(stats.series[0].start).toBe(from)
    expect(stats.series[stats.series.length - 1].end).toBe(to)
    expect(stats.series.reduce((s, p) => s + p.revenue, 0)).toBe(50)
    expect(stats.productRevenue).toEqual([{ name: 'Cookie', value: 50, units: 2 }])
    // The KPI cards stay all-time, as they do under the pills.
    expect(stats.totalOrders).toBe(4)

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('names the workbook and its Summary sheet by the range, not by today', async () => {
    const { id, token } = await seedShop('custom-report-shop', 'custom-report@example.com')
    await serviceClient().from('orders').insert([orderAt(id, to, 42, 'CR-1')])

    const res = await get(`/api/merchants/${id}/report.xlsx?from=${from}&to=${to}&granularity=day`, token)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(XLSX_TYPE)
    expect(res.headers.get('content-disposition'))
      .toContain(`custom-report-shop-revenue-${from}_${to}.xlsx`)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ExcelJS.Buffer)
    expect(wb.getWorksheet('Summary')!.getCell('B3').value).toBe(`${from} – ${to} (10 days)`)
    const time = wb.getWorksheet('Revenue over time')!
    expect(time.rowCount).toBe(11) // header + ten daily buckets

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('defaults a long custom range to weekly buckets, as the pills do', async () => {
    const { id, token } = await seedShop('custom-gran-shop', 'custom-gran@example.com')
    const wide = shift(today, 100)
    const stats = (await (await get(`/api/merchants/${id}/stats?from=${wide}&to=${today}`, token)).json()) as MerchantStats
    expect(stats.granularity).toBe('week')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('refuses a range it cannot honestly answer, on both endpoints', async () => {
    const { id, token } = await seedShop('custom-refuse-shop', 'custom-refuse@example.com')
    const bad = [
      `?days=30&from=${from}&to=${to}`,        // two windows in one request
      `?from=${from}`,                          // half a range
      `?to=${to}`,
      `?from=${to}&to=${from}`,                 // reversed
      `?from=${today}&to=${shift(today, -1)}`,  // reaches into tomorrow
      `?from=${shift(today, 400)}&to=${today}`, // wider than the cap
      '?from=2026-02-30&to=2026-03-01',         // a day that never happened
      '?from=nonsense&to=2026-03-01',
    ]
    for (const q of bad) {
      for (const path of ['stats', 'report.xlsx']) {
        const res = await get(`/api/merchants/${id}/${path}${q}`, token)
        expect(res.status, `${path}${q}`).toBe(400)
        expect((await res.json()) as { error: string }).toEqual({ error: 'bad_range' })
      }
    }

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('still refuses a granularity it does not offer with a custom range', async () => {
    const { id, token } = await seedShop('custom-badgran-shop', 'custom-badgran@example.com')
    for (const path of ['stats', 'report.xlsx']) {
      const res = await get(`/api/merchants/${id}/${path}?from=${from}&to=${to}&granularity=month`, token)
      expect(res.status).toBe(400)
    }

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('keeps tenancy on the custom path too', async () => {
    const { id } = await seedShop('custom-tenancy-shop', 'custom-tenancy-owner@example.com')
    const other = await makeUser('custom-tenancy-other@example.com', 'password123')
    const { data } = await other.auth.getSession()
    const otherToken = data.session!.access_token
    const q = `?from=${from}&to=${to}`
    expect((await get(`/api/merchants/${id}/stats${q}`, otherToken)).status).toBe(403)
    expect((await get(`/api/merchants/${id}/report.xlsx${q}`, otherToken)).status).toBe(403)
    expect((await get(`/api/merchants/${id}/report.xlsx${q}`)).status).toBe(401)

    await serviceClient().from('merchants').delete().eq('id', id)
  })
})
