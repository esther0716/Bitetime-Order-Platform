// tests/api/webhook-cycle.test.ts
// POST /api/stripe/webhook — billing-cycle reconciliation. It exists for the WIRING, not the
// arithmetic: `cycleFromPriceId` is unit-tested in tests/unit/pricing.test.ts, but nothing there
// can catch reading the wrong field off the subscription, or writing `merchant_billing` where
// `merchants` was meant. So this drives a real signed event through the real route and asserts
// what landed in Postgres.
//
// Network-free by construction: `generateTestHeaderString` signs offline against the stubbed
// webhook secret, and the `customer.subscription.updated` branch only calls Stripe when
// `default_payment_method` is null (the customer-default fallback in app.ts) — so every fixture
// here sets it. `checkout.session.completed` is deliberately NOT covered: it calls
// `stripe.subscriptions.retrieve()`, which is a real API call.
import { describe, it, expect } from 'vitest'
import Stripe from 'stripe'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'

const PRICES = {
  monthly: process.env.STRIPE_PRICE_PRO_MONTHLY!,
  yearly: process.env.STRIPE_PRICE_PRO_YEARLY!,
}

// The webhook is signed, not bearer-authenticated, so these suites need the owner's id to seed
// a merchant and nothing else — no token anywhere in this file.
async function userIdOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return data.session!.user.id
}

/**
 * A `customer.subscription.updated` event carrying one price, signed the way Stripe signs.
 * `default_payment_method` is always set — see the file header.
 */
function subscriptionUpdated(
  merchantId: string,
  priceId: string,
  over: Record<string, unknown> = {},
) {
  return {
    id: 'evt_test_cycle',
    object: 'event',
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_test_cycle',
        object: 'subscription',
        customer: 'cus_test_cycle',
        status: 'active',
        default_payment_method: 'pm_test_card',
        trial_end: null,
        metadata: { merchant_id: merchantId },
        items: {
          object: 'list',
          data: [{ id: 'si_test', price: { id: priceId }, current_period_end: 1893456000 }],
        },
        ...over,
      },
    },
  }
}

function postWebhook(payload: unknown) {
  const body = JSON.stringify(payload)
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  })
  return app.request('/api/stripe/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
    body,
  })
}

async function cycleOf(merchantId: string) {
  const { data } = await serviceClient()
    .from('merchants').select('billing_cycle').eq('id', merchantId).single()
  return data!.billing_cycle
}

describe('POST /api/stripe/webhook — billing-cycle reconciliation', () => {
  // `billing_cycle` was never reconciled before this: a monthly→yearly switch left the column
  // saying monthly forever, and the Subscription tab quoted the wrong price off it.
  it('repairs billing_cycle from the price on the subscription', async () => {
    await resetMerchant('wh-cycle-shop')
    const owner = await makeUser('wh-cycle@example.com', 'password123')
    const userId = await userIdOf(owner)
    const id = await seedMerchant({ slug: 'wh-cycle-shop', owner_id: userId })
    await serviceClient().from('merchants').update({ billing_cycle: 'monthly' }).eq('id', id)

    const res = await postWebhook(subscriptionUpdated(id, PRICES.yearly))
    expect(res.status).toBe(200)

    expect(await cycleOf(id)).toBe('yearly')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('reconciles back the other way just as readily', async () => {
    await resetMerchant('wh-cycle-back-shop')
    const owner = await makeUser('wh-cycle-back@example.com', 'password123')
    const id = await seedMerchant({ slug: 'wh-cycle-back-shop', owner_id: await userIdOf(owner) })
    await serviceClient().from('merchants').update({ billing_cycle: 'yearly' }).eq('id', id)

    expect((await postWebhook(subscriptionUpdated(id, PRICES.monthly))).status).toBe(200)

    expect(await cycleOf(id)).toBe('monthly')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // LOAD-BEARING. An unrecognised price must leave the row ALONE. Guessing here would write a
  // renewal date the shop is not on, off a price we never configured.
  it('leaves the cycle untouched when the price is not one of ours', async () => {
    await resetMerchant('wh-unknown-price-shop')
    const owner = await makeUser('wh-unknown-price@example.com', 'password123')
    const userId = await userIdOf(owner)
    const id = await seedMerchant({ slug: 'wh-unknown-price-shop', owner_id: userId })
    await serviceClient().from('merchants').update({ billing_cycle: 'yearly' }).eq('id', id)

    const res = await postWebhook(subscriptionUpdated(id, 'price_made_by_hand_in_the_dashboard'))
    expect(res.status).toBe(200)

    expect(await cycleOf(id)).toBe('yearly')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // THE bug the cancel work exists for. Stripe leaves `status` on 'active' for a subscription
  // cancelling at period end, so without this flag the Subscription tab went on promising
  // "Renews on 1 Sep" right up to the morning `customer.subscription.deleted` suspended the shop.
  it('records that a subscription is cancelling at period end', async () => {
    await resetMerchant('wh-cancelling-shop')
    const owner = await makeUser('wh-cancelling@example.com', 'password123')
    const id = await seedMerchant({ slug: 'wh-cancelling-shop', owner_id: await userIdOf(owner) })

    const event = subscriptionUpdated(id, PRICES.monthly, { cancel_at_period_end: true })
    expect((await postWebhook(event)).status).toBe(200)

    const { data } = await serviceClient()
      .from('merchant_billing').select('status, cancel_at_period_end').eq('merchant_id', id).single()
    // Status stays 'active' — which is exactly why the flag has to be stored separately.
    expect(data).toMatchObject({ status: 'active', cancel_at_period_end: true })

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // The signature check is the only thing standing between this endpoint and anyone on the
  // internet rewriting a stranger's billing row with a curl.
  it('refuses an unsigned body and changes nothing', async () => {
    await resetMerchant('wh-unsigned-shop')
    const owner = await makeUser('wh-unsigned@example.com', 'password123')
    const userId = await userIdOf(owner)
    const id = await seedMerchant({ slug: 'wh-unsigned-shop', owner_id: userId })
    await serviceClient().from('merchants').update({ billing_cycle: 'monthly' }).eq('id', id)

    const res = await app.request('/api/stripe/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscriptionUpdated(id, PRICES.yearly)),
    })
    expect(res.status).toBe(400)

    expect(await cycleOf(id)).toBe('monthly')

    await serviceClient().from('merchants').delete().eq('id', id)
  })
})
