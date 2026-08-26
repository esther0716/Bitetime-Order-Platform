// tests/api/admin-sample.test.ts
// POST /api/admin/set-merchant-sample — superadmin toggle for the landing-page sample-shops
// carousel (#107). Persists merchants.is_sample, and on the ON edge asks GitHub Actions to
// capture that one shop's storefront now rather than waiting for the weekly cron.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { app, githubDeps } from '../../src/app.js'
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
  let dispatched: (string | undefined)[]
  let dispatchResult: boolean | Error

  beforeEach(() => {
    dispatched = []
    dispatchResult = true
    githubDeps.dispatchSampleScreenshot = async (_token: string, id?: string) => {
      dispatched.push(id)
      if (dispatchResult instanceof Error) throw dispatchResult
      return dispatchResult
    }
  })

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

  // The screenshot the carousel shows is captured by a weekly cron, so a shop flagged on a
  // Tuesday had no card until the following Monday. Flagging now asks for its capture.
  it('asks for a capture of that one shop when the flag goes on', async () => {
    const res = await post('/api/admin/set-merchant-sample', { merchantId, isSample: true }, superToken)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, isSample: true, captureQueued: true })
    expect(dispatched).toEqual([merchantId])
  })

  it('asks for no capture when the flag goes off', async () => {
    const res = await post('/api/admin/set-merchant-sample', { merchantId, isSample: false }, superToken)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, isSample: false, captureQueued: false })
    expect(dispatched).toEqual([])
  })

  // The toggle is the superadmin's decision; the capture is a convenience on top of it. A
  // GitHub outage must not make the shop look un-flaggable — the weekly cron still covers it.
  it('still flags the shop when the capture request fails', async () => {
    dispatchResult = false

    const res = await post('/api/admin/set-merchant-sample', { merchantId, isSample: true }, superToken)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, isSample: true, captureQueued: false })
    expect(await isSampleOf(merchantId)).toBe(true)
  })

  it('still flags the shop when the capture request throws', async () => {
    dispatchResult = new Error('network down')

    const res = await post('/api/admin/set-merchant-sample', { merchantId, isSample: true }, superToken)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, isSample: true, captureQueued: false })
    expect(await isSampleOf(merchantId)).toBe(true)
  })
})

// A storefront redesign makes every stored screenshot stale at once, and the shops themselves
// changed nothing — so there is no per-shop toggle to flip and nothing to wait for except the
// weekly cron. This is the button that says "take all the photographs again, now".
describe('POST /api/admin/recapture-samples', () => {
  let superToken: string
  let plainToken: string
  let dispatched: (string | undefined)[]
  let dispatchResult: boolean | Error

  beforeAll(async () => {
    const superClient = await makeUser('super-recapture@example.com', 'password123')
    const { data: sess } = await superClient.auth.getSession()
    const svc = serviceClient()
    await svc.from('profiles').delete().eq('user_id', sess.session!.user.id)
    await svc.from('profiles').insert({ user_id: sess.session!.user.id, name: 'Super', app_role: 'superadmin' })
    superToken = await tokenOf(superClient)

    const plain = await makeUser('plain-recapture@example.com', 'password123')
    plainToken = await tokenOf(plain)
  })

  beforeEach(() => {
    dispatched = []
    dispatchResult = true
    githubDeps.dispatchSampleScreenshot = async (_token: string, id?: string) => {
      dispatched.push(id)
      if (dispatchResult instanceof Error) throw dispatchResult
      return dispatchResult
    }
  })

  it('refuses an unauthenticated caller', async () => {
    expect((await post('/api/admin/recapture-samples', {})).status).toBe(401)
  })

  it('refuses a non-superadmin', async () => {
    expect((await post('/api/admin/recapture-samples', {}, plainToken)).status).toBe(403)
  })

  // No merchant id: the sweep captures every sample shop, which is the whole point of the route.
  it('asks for a sweep of every sample shop', async () => {
    const res = await post('/api/admin/recapture-samples', {}, superToken)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, captureQueued: true })
    expect(dispatched).toEqual([undefined])
  })

  it('reports a refused request rather than failing', async () => {
    dispatchResult = false

    const res = await post('/api/admin/recapture-samples', {}, superToken)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, captureQueued: false })
  })

  it('reports a thrown request rather than failing', async () => {
    dispatchResult = new Error('network down')

    const res = await post('/api/admin/recapture-samples', {}, superToken)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, captureQueued: false })
  })
})
