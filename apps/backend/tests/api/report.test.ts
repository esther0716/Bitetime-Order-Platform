// tests/api/report.test.ts
// GET /api/merchants/:id/report.xlsx — the Pro-gated revenue export. The load-bearing
// assertions are: (1) the gate is the BACKEND, so a basic shop's own owner is refused with
// `requires_pro` no matter what the browser renders, (2) a superadmin passes it, mirroring
// requirePro everywhere else, (3) tenancy still comes from requireMerchantOwns, and (4) a range
// the UI does not offer is REFUSED rather than clamped — a silently clamped request hands back a
// file that quietly answers a different question than the one asked, over a merchant's own
// accounting. See CLAUDE.md → Backend, CONTEXT.md → Plan entitlement.
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
const OK_QUERY = '?days=30&granularity=day'

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

  it('403 requires_pro for a basic shop’s owner', async () => {
    await resetMerchant('report-basic-shop')
    const client = await makeUser('report-basic@example.com', 'password123')
    const { token, userId } = await tokenOf(client)
    const id = await seedMerchant({ slug: 'report-basic-shop', owner_id: userId, plan: 'basic' })

    const res = await get(`/api/merchants/${id}/report.xlsx${OK_QUERY}`, token)
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

    const res = await get(`/api/merchants/${id}/report.xlsx${OK_QUERY}`, token)
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

    const res = await get(`/api/merchants/${id}/report.xlsx${OK_QUERY}`, superToken)
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

    const res = await get(`/api/merchants/${id}/report.xlsx${OK_QUERY}`, otherToken)
    expect(res.status).toBe(403)

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('401 without a token', async () => {
    await resetMerchant('report-anon-shop')
    const client = await makeUser('report-anon@example.com', 'password123')
    const { userId } = await tokenOf(client)
    const id = await seedMerchant({ slug: 'report-anon-shop', owner_id: userId, plan: 'pro' })

    const res = await get(`/api/merchants/${id}/report.xlsx${OK_QUERY}`)
    expect(res.status).toBe(401)

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('refuses a range or granularity it does not offer, rather than clamping it', async () => {
    await resetMerchant('report-range-shop')
    const client = await makeUser('report-range@example.com', 'password123')
    const { token, userId } = await tokenOf(client)
    const id = await seedMerchant({ slug: 'report-range-shop', owner_id: userId, plan: 'pro' })

    const url = (q: string) => `/api/merchants/${id}/report.xlsx${q}`
    expect((await get(url('?days=7&granularity=day'), token)).status).toBe(400)
    expect((await get(url('?days=30&granularity=month'), token)).status).toBe(400)
    expect((await get(url('?days=abc&granularity=day'), token)).status).toBe(400)
    expect((await get(url(''), token)).status).toBe(400)

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // The plan gate runs BEFORE the range check: a basic shop probing the endpoint learns only
  // that it needs Pro, not which ranges the paid feature accepts.
  it('answers requires_pro before it validates the range', async () => {
    await resetMerchant('report-gate-first-shop')
    const client = await makeUser('report-gate-first@example.com', 'password123')
    const { token, userId } = await tokenOf(client)
    const id = await seedMerchant({ slug: 'report-gate-first-shop', owner_id: userId, plan: 'basic' })

    const res = await get(`/api/merchants/${id}/report.xlsx?days=7&granularity=month`, token)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'requires_pro' })

    await serviceClient().from('merchants').delete().eq('id', id)
  })
})
