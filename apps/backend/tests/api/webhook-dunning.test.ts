// tests/api/webhook-dunning.test.ts
// POST /api/stripe/webhook — the two events that drive an unpaid renewal, in both directions.
//
// `invoice.payment_failed` starts the clock: the shop is past_due, and the three-day grace counts
// from the start of the period that invoice bills for. `customer.subscription.updated` ends it:
// the money arrived, and the shop the platform closed must open again by itself.
//
// A suite of its own, and network-free like its neighbours: the signing is offline, and every
// case carries `default_payment_method` so the handler never takes the branch that asks Stripe to
// resolve a customer's default card.
import { describe, it, expect } from 'vitest'
import Stripe from 'stripe'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'

const PRICE = process.env.STRIPE_PRICE_PRO_MONTHLY!
const secondsAgoDays = (n: number) => Math.floor(Date.now() / 1000) - n * 24 * 60 * 60

function subscriptionUpdated(merchantId: string, subId: string, status: string) {
  return {
    id: `evt_dunning_${status}`,
    object: 'event',
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: subId,
        object: 'subscription',
        customer: 'cus_test_dunning',
        status,
        trial_end: null,
        cancel_at_period_end: false,
        // Present so the handler never reaches for the customer's default card over the network.
        default_payment_method: 'pm_test',
        metadata: { merchant_id: merchantId },
        items: {
          object: 'list',
          data: [{
            id: 'si_dunning',
            price: { id: PRICE },
            current_period_start: secondsAgoDays(1),
            current_period_end: 1893456000,
          }],
        },
      },
    },
  }
}

function invoicePaymentFailed(merchantId: string, periodStart: number) {
  return {
    id: 'evt_dunning_failed',
    object: 'event',
    type: 'invoice.payment_failed',
    data: {
      object: {
        id: 'in_dunning',
        object: 'invoice',
        period_start: periodStart,
        billing_reason: 'subscription_cycle',
        metadata: { merchant_id: merchantId },
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

async function seedShop(slug: string, email: string, opts: {
  status: 'active' | 'suspended'
  billing: Record<string, unknown>
}) {
  await resetMerchant(slug)
  const owner = await makeUser(email, 'password123')
  const { data } = await owner.auth.getSession()
  const id = await seedMerchant({ slug, owner_id: data.session!.user.id, status: opts.status })
  await serviceClient().from('merchant_billing').upsert({ merchant_id: id, ...opts.billing })
  return id
}

async function statusOf(merchantId: string) {
  const { data } = await serviceClient()
    .from('merchants').select('status').eq('id', merchantId).single()
  return data!.status
}

describe('POST /api/stripe/webhook — an unpaid renewal', () => {
  // Written by this event and not left to `customer.subscription.updated`, whose delivery order
  // against this one is not guaranteed. Until the period advances on the row, the stored start is
  // last month's — and the dashboard would tell a merchant whose card just failed that their shop
  // closes today.
  it('records the unpaid period the grace clock counts from', async () => {
    const start = secondsAgoDays(1)
    const id = await seedShop('dunning-failed-shop', 'dunning-failed@example.com', {
      status: 'active',
      billing: { status: 'active', stripe_subscription_id: 'sub_dunning_failed' },
    })

    expect((await postWebhook(invoicePaymentFailed(id, start))).status).toBe(200)

    const { data: row } = await serviceClient()
      .from('merchant_billing').select('status, current_period_start').eq('merchant_id', id).single()
    expect(row!.status).toBe('past_due')
    expect(new Date(row!.current_period_start as string).getTime()).toBe(start * 1000)

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // The fast path back. The sweep would do this within the hour anyway, but "within the hour" is
  // a merchant watching a paid-for shop stay shut, refreshing.
  it('reopens a shop it closed for non-payment when the subscription goes live again', async () => {
    const id = await seedShop('dunning-paid-shop', 'dunning-paid@example.com', {
      status: 'suspended',
      billing: {
        status: 'past_due',
        stripe_subscription_id: 'sub_dunning_paid',
        dunning_suspended_at: new Date(Date.now() - 3_600_000).toISOString(),
        past_due_notified_at: new Date(Date.now() - 3_600_000).toISOString(),
      },
    })

    expect((await postWebhook(subscriptionUpdated(id, 'sub_dunning_paid', 'active'))).status).toBe(200)

    expect(await statusOf(id)).toBe('active')
    const { data: row } = await serviceClient()
      .from('merchant_billing')
      .select('dunning_suspended_at, past_due_notified_at').eq('merchant_id', id).single()
    expect(row).toEqual({ dunning_suspended_at: null, past_due_notified_at: null })

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // LOAD-BEARING. A shop a superadmin suspended carries no dunning stamp, and a renewal going
  // through on its still-live subscription must not undo the moderation decision — otherwise
  // every suspended merchant has a self-service way out of it.
  it('never reopens a shop a human suspended', async () => {
    const id = await seedShop('dunning-moderated-shop', 'dunning-moderated@example.com', {
      status: 'suspended',
      billing: { status: 'active', stripe_subscription_id: 'sub_dunning_moderated' },
    })

    expect((await postWebhook(subscriptionUpdated(id, 'sub_dunning_moderated', 'active'))).status).toBe(200)

    expect(await statusOf(id)).toBe('suspended')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // A subscription still in dunning is not a payment. Reopening here would put the shop back on
  // sale on the strength of an event that reports the opposite.
  it('leaves a closed shop closed while the subscription is still past_due', async () => {
    const id = await seedShop('dunning-still-shop', 'dunning-still@example.com', {
      status: 'suspended',
      billing: {
        status: 'past_due',
        stripe_subscription_id: 'sub_dunning_still',
        dunning_suspended_at: new Date(Date.now() - 3_600_000).toISOString(),
      },
    })

    expect((await postWebhook(subscriptionUpdated(id, 'sub_dunning_still', 'past_due'))).status).toBe(200)

    expect(await statusOf(id)).toBe('suspended')

    await serviceClient().from('merchants').delete().eq('id', id)
  })
})
