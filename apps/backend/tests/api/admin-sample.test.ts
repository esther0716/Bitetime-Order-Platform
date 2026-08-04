// tests/api/admin-sample.test.ts
// POST /api/admin/set-merchant-sample — superadmin toggle for the landing-page sample-shops
// carousel (#107). Persists merchants.is_sample; no other side effects.
import { describe, it, expect, beforeAll } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, serviceClient } from '../rls/helpers.js'

function post(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return data.session!.access_token
}

async function isSampleOf(merchantId: string) {
  const { data } = await serviceClient()
    .from('merchants').select('is_sample').eq('id', merchantId).maybeSingle()
  return data?.is_sample
}

describe('POST /api/admin/set-merchant-sample', () => {
  let superToken: string
  let plainToken: string
  let merchantId: string

  beforeAll(async () => {
    const superClient = await makeUser('super-sample@example.com', 'password123')
    const { data: sess } = await superClient.auth.getSession()
    const svc = serviceClient()
    await svc.from('profiles').delete().eq('user_id', sess.session!.user.id)
    await svc.from('profiles').insert({ user_id: sess.session!.user.id, name: 'Super', app_role: 'superadmin' })
    superToken = await tokenOf(superClient)

    const owner = await makeUser('owner-sample@example.com', 'password123')
    const { data: osess } = await owner.auth.getSession()
    merchantId = await seedMerchant({ slug: 'sample-toggle-shop', owner_id: osess.session!.user.id })
    plainToken = await tokenOf(owner)
  })

  it('refuses an unauthenticated caller', async () => {
    expect((await post('/api/admin/set-merchant-sample', { merchantId, isSample: true })).status).toBe(401)
  })

  it('refuses a non-superadmin', async () => {
    expect((await post('/api/admin/set-merchant-sample', { merchantId, isSample: true }, plainToken)).status).toBe(403)
  })

  it('400s on a missing merchantId', async () => {
    expect((await post('/api/admin/set-merchant-sample', { isSample: true }, superToken)).status).toBe(400)
  })

  it('400s on a non-boolean isSample', async () => {
    expect((await post('/api/admin/set-merchant-sample', { merchantId, isSample: 'yes' }, superToken)).status).toBe(400)
  })

  it('404s on an unknown merchant', async () => {
    const res = await post(
      '/api/admin/set-merchant-sample',
      { merchantId: '00000000-0000-0000-0000-000000000000', isSample: true },
      superToken,
    )
    expect(res.status).toBe(404)
  })

  it('flags and unflags a merchant as a sample shop', async () => {
    expect(await isSampleOf(merchantId)).toBe(false)

    const on = await post('/api/admin/set-merchant-sample', { merchantId, isSample: true }, superToken)
    expect(on.status).toBe(200)
    expect(await isSampleOf(merchantId)).toBe(true)

    const off = await post('/api/admin/set-merchant-sample', { merchantId, isSample: false }, superToken)
    expect(off.status).toBe(200)
    expect(await isSampleOf(merchantId)).toBe(false)
  })
})
