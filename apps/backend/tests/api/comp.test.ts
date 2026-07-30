// tests/api/comp.test.ts
// POST /api/admin/{comp,uncomp}-merchant — the superadmin grant and its reverse.
//
// Network-free like the other API suites: neither route calls Stripe, which is what makes the
// whole of both assertable here rather than just their guards.
//
// The precondition is the point. Comping a shop that already pays would leave Stripe billing a
// card while the local row claims the shop is free, and comp clears the customer id — the very
// pointer back to that subscription. So it refuses instead.
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

async function billingRow(merchantId: string) {
  const { data } = await serviceClient()
    .from('merchant_billing')
    .select('comped, status, stripe_customer_id, stripe_subscription_id')
    .eq('merchant_id', merchantId)
    .maybeSingle()
  return data
}

async function merchantRow(merchantId: string) {
  const { data } = await serviceClient()
    .from('merchants').select('status, plan').eq('id', merchantId).maybeSingle()
  return data
}

describe('comp / uncomp', () => {
  let superToken: string
  let plainToken: string
  let merchantId: string

  beforeAll(async () => {
    const superClient = await makeUser('super-comp@example.com', 'password123')
    const { data: sess } = await superClient.auth.getSession()
    const svc = serviceClient()
    await svc.from('profiles').delete().eq('user_id', sess.session!.user.id)
    await svc.from('profiles').insert({ user_id: sess.session!.user.id, name: 'Super', app_role: 'superadmin' })
    superToken = await tokenOf(superClient)

    const owner = await makeUser('owner-comp@example.com', 'password123')
    const { data: osess } = await owner.auth.getSession()
    merchantId = await seedMerchant({ slug: 'comp-shop', owner_id: osess.session!.user.id })
    plainToken = await tokenOf(owner)
  })

  it('refuses an unauthenticated caller', async () => {
    expect((await post('/api/admin/comp-merchant', { merchantId })).status).toBe(401)
    expect((await post('/api/admin/uncomp-merchant', { merchantId })).status).toBe(401)
  })

  it('refuses a non-superadmin', async () => {
    expect((await post('/api/admin/comp-merchant', { merchantId }, plainToken)).status).toBe(403)
    expect((await post('/api/admin/uncomp-merchant', { merchantId }, plainToken)).status).toBe(403)
  })

  it('comps a shop: flag on, customer id gone, pro and active', async () => {
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId,
      stripe_customer_id: 'cus_stale_from_test_mode',
      status: null,
    }, { onConflict: 'merchant_id' })

    const res = await post('/api/admin/comp-merchant', { merchantId }, superToken)
    expect(res.status).toBe(200)

    const billing = await billingRow(merchantId)
    expect(billing).toMatchObject({ comped: true, status: 'active', stripe_customer_id: null })
    expect(await merchantRow(merchantId)).toMatchObject({ status: 'active', plan: 'pro' })
  })

  // The one-trial-ever record (canStartTrial reads this id). Clearing it would hand a shop that
  // has already had a trial a fresh one, so comp leaves it exactly where it is.
  it('keeps the subscription id when comping', async () => {
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId,
      stripe_subscription_id: 'sub_old',
      status: 'canceled',
    }, { onConflict: 'merchant_id' })

    expect((await post('/api/admin/comp-merchant', { merchantId }, superToken)).status).toBe(200)
    expect(await billingRow(merchantId)).toMatchObject({
      comped: true,
      stripe_subscription_id: 'sub_old',
    })
  })

  it('refuses to comp a shop with a live subscription', async () => {
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId,
      stripe_subscription_id: 'sub_live',
      status: 'active',
      comped: false,
    }, { onConflict: 'merchant_id' })

    const res = await post('/api/admin/comp-merchant', { merchantId }, superToken)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'has_live_subscription' })
    expect(await billingRow(merchantId)).toMatchObject({ comped: false })
  })

  // Revoking a comp is not the same as suspending a shop, and must not do it by accident: a
  // suspended comped shop that gets reactivated would otherwise silently hand back free Pro.
  it('un-comps: flag off, plan basic, shop status untouched', async () => {
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId,
      comped: true,
      status: 'active',
      stripe_subscription_id: null,
    }, { onConflict: 'merchant_id' })
    await serviceClient().from('merchants').update({ status: 'active', plan: 'pro' }).eq('id', merchantId)

    expect((await post('/api/admin/uncomp-merchant', { merchantId }, superToken)).status).toBe(200)
    expect(await billingRow(merchantId)).toMatchObject({ comped: false })
    expect(await merchantRow(merchantId)).toMatchObject({ status: 'active', plan: 'basic' })
  })

  it('answers 404 for a merchant that does not exist', async () => {
    const res = await post(
      '/api/admin/uncomp-merchant',
      { merchantId: '00000000-0000-0000-0000-000000000000' },
      superToken,
    )
    expect(res.status).toBe(404)
  })
})
