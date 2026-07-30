// tests/api/start-trial.test.ts
// POST /api/merchants/:id/start-trial — the owner-side retry for a shop whose trial
// provisioning failed at signup.
//
// Network-free, like checkout.test.ts and comp.test.ts: everything PAST the guards calls Stripe.
// What is asserted here is every refusal — which is the whole reason the guards are ordered
// before the first Stripe call. The success path needs a real key and is covered by
// run-and-verify.
//
// The refusals are the security surface: this endpoint activates a shop and creates a
// subscription, so "who may ask" and "for which shop" are the questions that matter.
import { describe, it, expect } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, serviceClient } from '../rls/helpers.js'

function post(id: string, token?: string) {
  return app.request(`/api/merchants/${id}/start-trial`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000'

describe('POST /api/merchants/:id/start-trial', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await post(UNKNOWN_ID)).status).toBe(401)
  })

  it('refuses a bad token', async () => {
    expect((await post(UNKNOWN_ID, 'not-a-jwt')).status).toBe(401)
  })

  it('404s an id that is no shop', async () => {
    const { token } = await tokenOf(await makeUser('trial-no-shop@example.com', 'password123'))
    expect((await post(UNKNOWN_ID, token)).status).toBe(404)
  })

  // A stranger's pending shop is exactly what this must not open — activation and a subscription
  // on someone else's account.
  it('refuses a shop the caller does not own', async () => {
    const owner = await makeUser('trial-owner@example.com', 'password123')
    const { userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'retry-owned', owner_id: userId, status: 'pending', plan: 'basic' })

    const stranger = await makeUser('trial-stranger@example.com', 'password123')
    const { token } = await tokenOf(stranger)

    expect((await post(merchantId, token)).status).toBe(403)
  })

  it('refuses a shop that is already active', async () => {
    const owner = await makeUser('trial-active@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'retry-active', owner_id: userId, status: 'active', plan: 'basic' })

    const res = await post(merchantId, token)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('Merchant is not pending')
  })

  it('refuses a pending pro shop — Pro pays upfront', async () => {
    const owner = await makeUser('trial-pro@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'retry-pro', owner_id: userId, status: 'pending', plan: 'pro' })

    const res = await post(merchantId, token)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('Pro shops activate via payment, not approval')
  })

  // One trial ever. Without this an owner could park a shop at pending and re-trial it forever.
  it('refuses a shop that has already had a subscription', async () => {
    const owner = await makeUser('trial-used@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'retry-used', owner_id: userId, status: 'pending', plan: 'basic' })
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId,
      stripe_customer_id: 'cus_test_used',
      stripe_subscription_id: 'sub_test_used',
      status: 'canceled',
    }, { onConflict: 'merchant_id' })

    const res = await post(merchantId, token)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toMatch(/already used its free trial/)

    // Refused BEFORE Stripe: the shop is untouched.
    const { data: row } = await serviceClient()
      .from('merchants').select('status').eq('id', merchantId).maybeSingle()
    expect(row!.status).toBe('pending')
  })
})
