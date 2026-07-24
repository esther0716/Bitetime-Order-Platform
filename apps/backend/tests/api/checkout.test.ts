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
import { makeUser } from '../rls/helpers.js'

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

  // The body is validated BEFORE the caller is resolved, so a nonsense plan is a 400 even
  // unauthenticated. Pinned because the guard consolidation must not reorder these two: turning
  // this into a 401 would tell an anonymous caller nothing, but turning the 401 above into a 400
  // would let an unauthenticated caller probe which plans exist.
  it('refuses an invalid plan before it asks who is calling', async () => {
    const res = await app.request('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'enterprise', billing: 'monthly' }),
    })
    expect(res.status).toBe(400)
  })
})
