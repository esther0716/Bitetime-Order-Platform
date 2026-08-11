// tests/api/checkout.test.ts
// POST /api/checkout — the guards in front of it.
//
// Scope is deliberate, and matches billing-actions.test.ts: everything PAST the guard creates a
// Stripe customer and a Checkout Session, and these suites are network-free. What is asserted
// here is the half that can be — who is allowed to ask.
//
// This route resolves the caller's OWN shop from the JWT's user id; there is no id in the path
// or body to point somewhere else. A missing auth check would let anyone start a purchase
// against a stranger's account, and would write a stripe_customer_id onto their billing row.
import { describe, it, expect } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, serviceClient } from '../rls/helpers.js'

function post(token?: string) {
  return app.request('/api/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ plan: 'basic', billing: 'monthly' }),
  })
}

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return data.session!.access_token
}

describe('POST /api/checkout', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await post()).status).toBe(401)
  })

  it('refuses a bad token', async () => {
    expect((await post('not-a-jwt')).status).toBe(401)
  })

  // Nothing to buy a subscription FOR. 404 rather than 403: the caller is who they say they are,
  // there is simply no shop of theirs to bill.
  it('refuses a signed-in user who owns no shop', async () => {
    const user = await makeUser('checkout-no-shop@example.com', 'password123')
    expect((await post(await tokenOf(user))).status).toBe(404)
  })

  // WHO IS CALLING IS ASKED FIRST, and an anonymous caller is refused before the body is looked
  // at. This reversed when the guard became middleware: the hand-rolled version validated the
  // body first, so an unauthenticated caller could tell a valid plan name from an invalid one by
  // the status alone. Nothing legitimate reaches here with a bad plan — the dashboard sends only
  // the two it renders — so the enumeration was the only thing the old order bought anyone.
  it('refuses an anonymous caller before it looks at the plan', async () => {
    const res = await app.request('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billing: 'fortnightly' }),
    })
    expect(res.status).toBe(401)
  })

  // Still a 400 for a signed-in caller: the cycle really is the thing wrong with the request, and
  // by this point saying so tells them nothing they could not already read on the pricing page.
  it('refuses an invalid billing cycle for a signed-in caller who owns a shop', async () => {
    const user = await makeUser('checkout-bad-plan@example.com', 'password123')
    const { data } = await user.auth.getSession()
    await seedMerchant({ slug: 'checkout-bad-plan', owner_id: data.session!.user.id })
    const res = await app.request('/api/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await tokenOf(user)}`,
      },
      body: JSON.stringify({ billing: 'fortnightly' }),
    })
    expect(res.status).toBe(400)
  })

  // Comp is terminal until a superadmin revokes it: a comped shop cannot buy its way out. The
  // refusal comes before the Stripe customer is created, so a comped shop can never acquire a
  // new customer id — the thing this whole change exists to stop accumulating.
  it('refuses a comped shop', async () => {
    const owner = await makeUser('comped-checkout@example.com', 'password123')
    const { data } = await owner.auth.getSession()
    const merchantId = await seedMerchant({ slug: 'comped-checkout-shop', owner_id: data.session!.user.id })
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId,
      comped: true,
      status: 'active',
    }, { onConflict: 'merchant_id' })

    const res = await post(await tokenOf(owner))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'shop_is_comped' })
  })
})
