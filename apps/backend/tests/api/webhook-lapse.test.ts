// tests/api/webhook-lapse.test.ts
// POST /api/stripe/webhook — `customer.subscription.deleted`, the event that closes a shop whose
// trial ended unpaid or whose dunning ran out.
//
// A suite of its own rather than more cases in webhook-plan.test.ts, because it asserts a
// different thing: not which tier the shop is on, but that the shop STOPS. The two share the
// signing helper by shape only — duplicating six lines beats coupling two suites that will drift
// for unrelated reasons.
//
// Network-free by construction, exactly as webhook-plan.test.ts is: `generateTestHeaderString`
// signs offline, and the one Stripe call this branch makes — "is the customer still paying
// through some other subscription?" — goes through `billingSyncDeps`, which every case here
// answers itself. A suite that let that call reach the network would decide whether it closes a
// shop from whatever a stub key happened to return.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Stripe from 'stripe'
import { app } from '../../src/app.js'
import { billingSyncDeps } from '../../src/billingSync.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'

const REAL_LIST = billingSyncDeps.listSubscriptions

/** Answer "this customer has nothing else running" — the ordinary lapse. */
function noOtherSubscription() {
  billingSyncDeps.listSubscriptions = async () => ({ data: [] }) as never
}

/** Answer with a live subscription alongside the one that just ended. */
function alsoLive(id: string, priceId: string) {
  billingSyncDeps.listSubscriptions = async () => ({
    data: [{
      id,
      object: 'subscription',
      customer: 'cus_test_lapse',
      status: 'active',
      created: 2_000,
      trial_end: null,
      cancel_at_period_end: false,
      default_payment_method: 'pm_test',
      metadata: {},
      items: { object: 'list', data: [{ id: 'si_live', price: { id: priceId }, current_period_end: 1893456000 }] },
    }],
  }) as never
}

async function userIdOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return data.session!.user.id
}

function subscriptionDeleted(merchantId: string, subId: string) {
  return {
    id: 'evt_test_lapse',
    object: 'event',
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: subId,
        object: 'subscription',
        customer: 'cus_test_lapse',
        status: 'canceled',
        trial_end: null,
        metadata: { merchant_id: merchantId },
        items: { object: 'list', data: [{ id: 'si_test', price: { id: 'price_stub_pro_monthly' } }] },
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

async function shopOf(merchantId: string) {
  const { data } = await serviceClient()
    .from('merchants').select('status, plan').eq('id', merchantId).single()
  return data!
}

describe('POST /api/stripe/webhook — a subscription ending', () => {
  beforeEach(noOtherSubscription)
  afterEach(() => { billingSyncDeps.listSubscriptions = REAL_LIST })

  it('suspends the shop and returns it to basic', async () => {
    await resetMerchant('lapse-pro-shop')
    const owner = await makeUser('lapse-pro@example.com', 'password123')
    const id = await seedMerchant({ slug: 'lapse-pro-shop', owner_id: await userIdOf(owner), plan: 'pro' })
    const svc = serviceClient()
    await svc.from('merchant_billing').upsert({
      merchant_id: id, status: 'trialing', stripe_subscription_id: 'sub_lapse_pro',
    })

    expect((await postWebhook(subscriptionDeleted(id, 'sub_lapse_pro'))).status).toBe(200)

    // BOTH, and the plan half is the one that was missing: suspension alone left `plan` on 'pro',
    // so a superadmin un-suspending the shop — or any surface reading the column without also
    // reading the status — handed back every Pro feature the merchant had stopped paying for.
    expect(await shopOf(id)).toEqual({ status: 'suspended', plan: 'basic' })

    const { data: billing } = await svc
      .from('merchant_billing').select('status').eq('merchant_id', id).single()
    expect(billing!.status).toBe('canceled')

    await svc.from('merchants').delete().eq('id', id)
  })

  // Same cutoff the portal downgrade already performs (webhook-plan.test.ts), now reached by the
  // other road out of Pro. Without it a lapsed shop's vouchers stay redeemable — and the order
  // path is plan-blind by design, so nothing downstream would ever refuse them.
  it('deactivates vouchers and ends running promos on the way out', async () => {
    await resetMerchant('lapse-artifacts-shop')
    const owner = await makeUser('lapse-artifacts@example.com', 'password123')
    const id = await seedMerchant({ slug: 'lapse-artifacts-shop', owner_id: await userIdOf(owner), plan: 'pro' })
    const svc = serviceClient()
    await svc.from('merchant_billing').upsert({
      merchant_id: id, status: 'trialing', stripe_subscription_id: 'sub_lapse_artifacts',
    })
    await svc.from('vouchers').insert({ merchant_id: id, code: 'LAPSE10', kind: 'percent', amount: 10 })
    await svc.from('products').insert({
      merchant_id: id, name: 'Lapsing Cookie', price: 13, promo_price: 8, promo_end: null,
    })

    expect((await postWebhook(subscriptionDeleted(id, 'sub_lapse_artifacts'))).status).toBe(200)

    const { data: vouchers } = await svc.from('vouchers').select('active').eq('merchant_id', id)
    expect(vouchers!.map(v => v.active)).toEqual([false])
    const { data: products } = await svc.from('products').select('promo_end').eq('merchant_id', id)
    expect(new Date(products![0].promo_end as string).getTime()).toBeLessThanOrEqual(Date.now())

    await svc.from('merchants').delete().eq('id', id)
  })

  // A basic shop has no Pro artifacts to revoke, and the plan write must be a no-op rather than
  // a second, pointless transition — the same read-before-write discipline reconcileMerchantPlan
  // uses so a replayed event cannot re-revoke what a merchant has since restored.
  it('suspends a basic shop without touching its plan', async () => {
    await resetMerchant('lapse-basic-shop')
    const owner = await makeUser('lapse-basic@example.com', 'password123')
    const id = await seedMerchant({ slug: 'lapse-basic-shop', owner_id: await userIdOf(owner), plan: 'basic' })
    const svc = serviceClient()
    await svc.from('merchant_billing').upsert({
      merchant_id: id, status: 'trialing', stripe_subscription_id: 'sub_lapse_basic',
    })
    await svc.from('vouchers').insert({ merchant_id: id, code: 'STILLHERE', kind: 'percent', amount: 10 })

    expect((await postWebhook(subscriptionDeleted(id, 'sub_lapse_basic'))).status).toBe(200)

    expect(await shopOf(id)).toEqual({ status: 'suspended', plan: 'basic' })
    // Untouched: this shop never left Pro, so nothing was revoked. A cutoff keyed on "is basic"
    // rather than on the transition would have switched this off.
    const { data } = await svc.from('vouchers').select('active').eq('merchant_id', id)
    expect(data!.map(v => v.active)).toEqual([true])

    await svc.from('merchants').delete().eq('id', id)
  })

  // LOAD-BEARING, and pre-existing: a stale subscription's cancellation — the old trial arriving
  // after the shop reactivated through Checkout — must not close a shop that is paying again.
  it('ignores the cancellation of a subscription that is no longer the current one', async () => {
    await resetMerchant('lapse-stale-shop')
    const owner = await makeUser('lapse-stale@example.com', 'password123')
    const id = await seedMerchant({ slug: 'lapse-stale-shop', owner_id: await userIdOf(owner), plan: 'pro' })
    const svc = serviceClient()
    await svc.from('merchant_billing').upsert({
      merchant_id: id, status: 'active', stripe_subscription_id: 'sub_lapse_current',
    })

    expect((await postWebhook(subscriptionDeleted(id, 'sub_lapse_old'))).status).toBe(200)

    expect(await shopOf(id)).toEqual({ status: 'active', plan: 'pro' })

    await svc.from('merchants').delete().eq('id', id)
  })

  // The case above only holds while `merchant_billing` is CURRENT, and it is kept current by the
  // activation events. In production those were being POSTed to a path that 404s, so the row
  // still named the old trial when its cancellation arrived — the stored-id check matched, and
  // the shop was suspended on the very day its owner paid for a replacement.
  //
  // Stripe is asked directly for that reason. This is also what makes replaying a backlog safe:
  // whether the cancellation or the new Checkout is redelivered first no longer decides whether
  // the shop ends up open.
  it('does not close a shop whose customer is still paying through a newer subscription', async () => {
    await resetMerchant('lapse-replaced-shop')
    const owner = await makeUser('lapse-replaced@example.com', 'password123')
    const id = await seedMerchant({ slug: 'lapse-replaced-shop', owner_id: await userIdOf(owner), plan: 'basic' })
    const svc = serviceClient()
    // Exactly the shape production was in: the row still names the trial that is ending, because
    // nothing ever recorded the subscription bought to replace it.
    await svc.from('merchant_billing').upsert({
      merchant_id: id, status: 'trialing', stripe_subscription_id: 'sub_lapse_replaced_old',
    })
    alsoLive('sub_lapse_replaced_new', process.env.STRIPE_PRICE_PRO_MONTHLY!)

    expect((await postWebhook(subscriptionDeleted(id, 'sub_lapse_replaced_old'))).status).toBe(200)

    // Open, and reconciled to what it is actually paying for — not merely spared.
    expect(await shopOf(id)).toEqual({ status: 'active', plan: 'pro' })
    const { data: billing } = await svc
      .from('merchant_billing').select('status, stripe_subscription_id').eq('merchant_id', id).single()
    expect(billing).toEqual({ status: 'active', stripe_subscription_id: 'sub_lapse_replaced_new' })

    await svc.from('merchants').delete().eq('id', id)
  })
})
