// tests/api/billing-sync.test.ts
// POST /api/billing/sync — the merchant's own pull of their subscription state.
//
// This is the route that ends "Setting up your subscription…" as a permanent screen: before it,
// the only thing that could open a shop after a paid Checkout was one delivery of
// `checkout.session.completed`, and a lost delivery left a charged merchant on a page that
// polled forever. So the suite is about two properties in tension — it must OPEN a shop whose
// webhook never came, and it must not open one a human deliberately closed.
//
// Stripe's answer is supplied through `billingSyncDeps`, so every branch runs offline; the suite
// asserts on what landed in Postgres.
import { describe, it, expect, afterEach } from 'vitest'
import { app } from '../../src/app.js'
import { billingSyncDeps } from '../../src/billingSync.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'

const REAL_LIST = billingSyncDeps.listSubscriptions
const REAL_FETCH = billingSyncDeps.fetchSubscription

const BASIC_MONTHLY = process.env.STRIPE_PRICE_BASIC_MONTHLY!
const PRO_MONTHLY = process.env.STRIPE_PRICE_PRO_MONTHLY!

function post(token?: string) {
  return app.request('/api/billing/sync', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

/**
 * A Stripe subscription as this route reads one — only the fields `pickSubscription`,
 * `billingFromSubscription` and `reconcileMerchantPlan` touch.
 */
function subscription(id: string, status: string, opts: { price?: string; created?: number } = {}) {
  return {
    id,
    object: 'subscription',
    customer: 'cus_sync',
    status,
    created: opts.created ?? 1_000,
    trial_end: null,
    cancel_at_period_end: false,
    default_payment_method: 'pm_sync',
    metadata: {},
    items: {
      object: 'list',
      data: [{ id: 'si_sync', price: { id: opts.price ?? BASIC_MONTHLY }, current_period_end: 1893456000 }],
    },
  } as never
}

/**
 * Answer for ONE customer id, recording every id asked about.
 *
 * Scoped for the same reason billing-sweep.test.ts scopes its stub: other suites and ordinary
 * local development leave their own shops in this database, and a fixture that answered for every
 * customer would reconcile shops this suite never created.
 */
function answerWith(customerId: string, subs: unknown[], asked: string[] = []) {
  billingSyncDeps.listSubscriptions = async (id: string) => {
    asked.push(id)
    if (id !== customerId) throw new Error(`out of this suite's scope: ${id}`)
    return { data: subs } as never
  }
  billingSyncDeps.fetchSubscription = async (id: string) => {
    asked.push(id)
    throw new Error(`the stored id must not be consulted while a customer is known: ${id}`)
  }
  return asked
}

async function seedShop(slug: string, email: string, opts: {
  status?: 'pending' | 'active' | 'suspended'
  plan?: 'basic' | 'pro'
  billing?: Record<string, unknown>
}) {
  await resetMerchant(slug)
  const owner = await makeUser(email, 'password123')
  const { data } = await owner.auth.getSession()
  const id = await seedMerchant({
    slug,
    owner_id: data.session!.user.id,
    status: opts.status ?? 'pending',
    plan: opts.plan ?? 'basic',
  })
  if (opts.billing) {
    await serviceClient().from('merchant_billing').upsert({ merchant_id: id, ...opts.billing })
  }
  return { id, token: data.session!.access_token }
}

async function shopOf(merchantId: string) {
  const { data } = await serviceClient()
    .from('merchants').select('status, plan').eq('id', merchantId).single()
  return data!
}

async function billingOf(merchantId: string) {
  const { data } = await serviceClient()
    .from('merchant_billing').select('status, stripe_subscription_id').eq('merchant_id', merchantId).single()
  return data!
}

describe('POST /api/billing/sync', () => {
  afterEach(() => {
    billingSyncDeps.listSubscriptions = REAL_LIST
    billingSyncDeps.fetchSubscription = REAL_FETCH
  })

  // This route writes `merchants.status` and `merchants.plan`. An unauthenticated caller reaching
  // it would be an entitlement change with no one attached to it.
  it('refuses an unauthenticated caller and a bad token', async () => {
    expect((await post()).status).toBe(401)
    expect((await post('not-a-jwt')).status).toBe(401)
  })

  it('refuses a signed-in user who owns no shop', async () => {
    const user = await makeUser('sync-no-shop@example.com', 'password123')
    const { data } = await user.auth.getSession()
    expect((await post(data.session!.access_token)).status).toBe(404)
  })

  // THE bug this whole file exists for. Checkout completed, the merchant was charged, and
  // `checkout.session.completed` never arrived — so the shop sat at `pending` with only the
  // `stripe_customer_id` that /api/checkout wrote before redirecting.
  it('opens a paid shop whose webhook never arrived', async () => {
    const { id, token } = await seedShop('sync-lost-webhook', 'sync-lost@example.com', {
      status: 'pending',
      billing: { stripe_customer_id: 'cus_sync' },
    })
    answerWith('cus_sync', [subscription('sub_sync_paid', 'active', { price: PRO_MONTHLY })])

    const res = await post(token)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ merchantStatus: 'active', activated: true })

    // Identical outcome to the webhook path — the tier follows the price actually paid (#112),
    // not what signup wrote.
    expect(await shopOf(id)).toEqual({ status: 'active', plan: 'pro' })
    expect(await billingOf(id)).toEqual({ status: 'active', stripe_subscription_id: 'sub_sync_paid' })

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // The reactivation half. A lapsed shop's billing row still names the CANCELED subscription that
  // closed it; the one it just paid for is only in Stripe. Consulting the stored id would read
  // "canceled" and leave a paying merchant suspended — so the stub above throws if it is asked.
  it('opens a reactivating shop whose stored subscription is the stale canceled one', async () => {
    const { id, token } = await seedShop('sync-reactivating', 'sync-reactivating@example.com', {
      status: 'suspended',
      billing: {
        stripe_customer_id: 'cus_sync',
        stripe_subscription_id: 'sub_sync_dead',
        status: 'canceled',
      },
    })
    answerWith('cus_sync', [
      subscription('sub_sync_dead', 'canceled', { created: 1_000 }),
      subscription('sub_sync_fresh', 'active', { created: 2_000 }),
    ])

    const res = await post(token)
    expect(await res.json()).toMatchObject({ merchantStatus: 'active', activated: true })
    expect((await shopOf(id)).status).toBe('active')
    expect((await billingOf(id)).stripe_subscription_id).toBe('sub_sync_fresh')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // LOAD-BEARING, and the reason this route's activation is narrower than the webhook's. A shop a
  // superadmin suspended still has a live subscription behind it. "Live subscription ⇒ open the
  // shop" would hand every suspended merchant a self-service undo of their suspension.
  it('never reopens a shop suspended while its subscription is still running', async () => {
    const { id, token } = await seedShop('sync-moderated', 'sync-moderated@example.com', {
      status: 'suspended',
      plan: 'pro',
      billing: {
        stripe_customer_id: 'cus_sync',
        stripe_subscription_id: 'sub_sync_moderated',
        status: 'active',
      },
    })
    answerWith('cus_sync', [subscription('sub_sync_moderated', 'active', { price: PRO_MONTHLY })])

    const res = await post(token)
    expect(await res.json()).toMatchObject({ merchantStatus: 'suspended', activated: false, reason: 'suspended_by_admin' })
    expect((await shopOf(id)).status).toBe('suspended')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // Checkout abandoned rather than completed: there is a customer but nothing was ever bought.
  // The shop must stay shut, and the merchant must be told which of the two it was.
  it('leaves a shop shut when the customer has no subscription', async () => {
    const { id, token } = await seedShop('sync-abandoned', 'sync-abandoned@example.com', {
      status: 'pending',
      billing: { stripe_customer_id: 'cus_sync' },
    })
    answerWith('cus_sync', [])

    const res = await post(token)
    expect(await res.json()).toMatchObject({ merchantStatus: 'pending', activated: false, reason: 'no_subscription' })
    expect((await shopOf(id)).status).toBe('pending')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // A payment that has not cleared is not a payment. `incomplete` means Stripe is still waiting.
  it('leaves a shop shut when the subscription is not running', async () => {
    const { id, token } = await seedShop('sync-incomplete', 'sync-incomplete@example.com', {
      status: 'pending',
      billing: { stripe_customer_id: 'cus_sync' },
    })
    answerWith('cus_sync', [subscription('sub_sync_incomplete', 'incomplete')])

    const res = await post(token)
    expect(await res.json()).toMatchObject({ merchantStatus: 'pending', activated: false, reason: 'not_live' })
    expect((await shopOf(id)).status).toBe('pending')
    // The row is still brought up to date — the merchant's state is now knowable from the database.
    expect((await billingOf(id)).status).toBe('incomplete')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // A comped row carries status 'active' with no Stripe customer behind it. Asking Stripe about
  // it finds nothing; the guard is what stops that reading as a broken shop.
  it('never asks Stripe about a comped shop', async () => {
    const { id, token } = await seedShop('sync-comped', 'sync-comped@example.com', {
      status: 'active',
      plan: 'pro',
      billing: { comped: true, status: 'active', stripe_customer_id: 'cus_sync_comped' },
    })
    const asked = answerWith('cus_sync', [])

    const res = await post(token)
    expect(await res.json()).toMatchObject({ activated: false, reason: 'comped' })
    expect(asked).toEqual([])
    expect(await shopOf(id)).toEqual({ status: 'active', plan: 'pro' })

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // Idempotent by construction: on a healthy day this runs over a shop the webhook already
  // opened. It must reconcile without claiming to have opened anything.
  it('reports no activation for a shop that is already open', async () => {
    const { id, token } = await seedShop('sync-already-open', 'sync-open@example.com', {
      status: 'active',
      billing: { stripe_customer_id: 'cus_sync', stripe_subscription_id: 'sub_sync_open', status: 'active' },
    })
    answerWith('cus_sync', [subscription('sub_sync_open', 'active')])

    const res = await post(token)
    expect(await res.json()).toMatchObject({ merchantStatus: 'active', activated: false })
    expect((await shopOf(id)).status).toBe('active')

    await serviceClient().from('merchants').delete().eq('id', id)
  })
})
