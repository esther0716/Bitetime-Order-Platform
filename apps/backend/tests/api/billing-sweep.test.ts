// tests/api/billing-sweep.test.ts
// POST /api/internal/billing-sweep — the hourly backstop for a lost `customer.subscription.
// deleted`. Not user-authenticated: a shared secret header is the only gate.
//
// What matters here is that the sweep reaches the RIGHT shops and reaches them ONLY when the
// stored state has genuinely gone stale — a sweep that closes a healthy shop is far worse than
// the drift it exists to repair. Stripe's answer is supplied through `billingSweepDeps`, so every
// branch is driven offline; the suite asserts on what landed in Postgres.
import { describe, it, expect, afterEach } from 'vitest'
import { app } from '../../src/app.js'
import { env } from '../../src/env.js'
import { billingSweepDeps } from '../../src/billingSweep.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'

const REAL_FETCH = billingSweepDeps.fetchSubscription

function sweep(secret?: string) {
  return app.request('/api/internal/billing-sweep', {
    method: 'POST',
    headers: secret !== undefined ? { 'x-sweep-secret': secret } : {},
  })
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString()

/**
 * A Stripe subscription as the sweep reads one. Only the fields `billingFromSubscription` and
 * `reconcileMerchantPlan` touch — a full fixture would be a second, wronger copy of Stripe's
 * schema.
 */
function subscription(
  id: string,
  status: string,
  priceId = 'price_stub_basic_monthly',
  // Seconds, Stripe's unit. Defaults to a period that opened an hour ago, which is a shop
  // nothing is wrong with; the dunning cases pass an older one.
  periodStart = Math.floor(Date.now() / 1000) - 3600,
): { id: string } {
  return {
    id,
    object: 'subscription',
    customer: 'cus_sweep',
    status,
    trial_end: null,
    cancel_at_period_end: false,
    default_payment_method: null,
    metadata: {},
    items: {
      object: 'list',
      data: [{
        id: 'si_sweep',
        price: { id: priceId },
        current_period_start: periodStart,
        current_period_end: 1893456000,
      }],
    },
  } as never
}

/** `n` days before now, in Stripe's seconds. */
const secondsAgoDays = (n: number) => Math.floor(Date.now() / 1000) - n * 24 * 60 * 60

/**
 * Answer the lookup for ONE subscription id, recording every id the sweep asked about.
 *
 * Scoped to a single id on purpose, and this is not fastidiousness. The sweep's worklist is the
 * whole database: other suites run in parallel and leave their own elapsed trials behind, as does
 * ordinary local development. A fixture that answered "canceled" to every id would suspend those
 * shops, revoke their vouchers and downgrade their plans — a test that reaches out of its own
 * fixtures and closes real shops. Anything else throws, which the sweep counts as `failed` and
 * leaves untouched, exactly as it would a Stripe outage.
 */
function answerWith(sub: { id: string }, asked: string[] = []) {
  billingSweepDeps.fetchSubscription = async (id: string) => {
    asked.push(id)
    if (id !== sub.id) throw new Error(`out of this suite's scope: ${id}`)
    return sub as never
  }
  return asked
}

async function shopOf(merchantId: string) {
  const { data } = await serviceClient()
    .from('merchants').select('status, billing_cycle').eq('id', merchantId).single()
  return data!
}

async function seedShop(slug: string, email: string, opts: {
  billing: Record<string, unknown>
}) {
  await resetMerchant(slug)
  const owner = await makeUser(email, 'password123')
  const { data } = await owner.auth.getSession()
  const id = await seedMerchant({ slug, owner_id: data.session!.user.id })
  await serviceClient().from('merchant_billing').upsert({ merchant_id: id, ...opts.billing })
  return id
}

describe('POST /api/internal/billing-sweep', () => {
  afterEach(() => { billingSweepDeps.fetchSubscription = REAL_FETCH })

  it('refuses with no secret configured', async () => {
    const saved = env.billingSweepSecret
    env.billingSweepSecret = ''
    try {
      expect((await sweep('anything')).status).toBe(503)
    } finally {
      env.billingSweepSecret = saved
    }
  })

  it('refuses a missing or wrong header', async () => {
    expect((await sweep()).status).toBe(403)
    expect((await sweep('wrong-secret')).status).toBe(403)
  })

  // THE bug this whole file exists for. The trial ended, Stripe cancelled the subscription, and
  // the webhook never arrived — so the shop is still open, still Pro, still selling.
  it('closes a shop whose trial ended while the webhook never arrived', async () => {
    const id = await seedShop('sweep-lapsed-shop', 'sweep-lapsed@example.com', {
      billing: {
        status: 'trialing',
        stripe_subscription_id: 'sub_sweep_lapsed',
        trial_ends_at: ago(3 * 60 * 60_000),
      },
    })
    const svc = serviceClient()
    await svc.from('vouchers').insert({ merchant_id: id, code: 'SWEEP10', kind: 'percent', amount: 10 })
    answerWith(subscription('sub_sweep_lapsed', 'canceled'))

    const res = await sweep(env.billingSweepSecret)
    expect(res.status).toBe(200)
    expect((await res.json() as { lapsed: number }).lapsed).toBeGreaterThanOrEqual(1)

    // Identical outcome to the webhook path (webhook-lapse.test.ts) — the two share lapseMerchant
    // precisely so they cannot mean different things by "closed".
    expect((await shopOf(id)).status).toBe('suspended')
    const { data: billing } = await svc
      .from('merchant_billing').select('status').eq('merchant_id', id).single()
    expect(billing!.status).toBe('canceled')
    // A closed shop refuses every order at the storefront gate, so its vouchers need no revoking
    // — they are simply unreachable, and they work again the day the merchant resubscribes.
    const { data: vouchers } = await svc.from('vouchers').select('active').eq('merchant_id', id)
    expect(vouchers!.map(v => v.active)).toEqual([true])

    await svc.from('merchants').delete().eq('id', id)
  })

  // The renewal half of the same bug, and the one that shipped: a failed renewal goes `past_due`
  // and Stripe's DEFAULT after its final retry is to leave it `past_due` for ever — nothing here
  // configures otherwise, unlike the trial's `missing_payment_method: 'cancel'`. So no status
  // ever moves, `isLapsed` never fires, and the shop sells indefinitely without paying. Note the
  // period end is in the FUTURE, as Stripe leaves it on a subscription in dunning.
  it('closes a shop that has sat past_due beyond the grace window', async () => {
    const id = await seedShop('sweep-dunning-shop', 'sweep-dunning@example.com', {
      billing: {
        status: 'past_due',
        stripe_subscription_id: 'sub_sweep_dunning',
        current_period_end: ahead(20 * 24 * 60 * 60_000),
      },
    })
    answerWith(subscription('sub_sweep_dunning', 'past_due', undefined, secondsAgoDays(30)))

    const res = await sweep(env.billingSweepSecret)
    expect((await res.json() as { lapsed: number }).lapsed).toBeGreaterThanOrEqual(1)
    expect((await shopOf(id)).status).toBe('suspended')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // The half that keeps that safe. Stripe's smart retries run about two weeks, so a shop three
  // days into dunning may still be paid by the next attempt — closing it now would take a live
  // storefront dark over one declined charge.
  it('leaves a shop open while it is still inside the dunning grace window', async () => {
    const id = await seedShop('sweep-dunning-early', 'sweep-dunning-early@example.com', {
      billing: {
        status: 'past_due',
        stripe_subscription_id: 'sub_sweep_early',
        current_period_end: ahead(27 * 24 * 60 * 60_000),
      },
    })
    const asked = answerWith(subscription('sub_sweep_early', 'past_due', undefined, secondsAgoDays(3)))

    await sweep(env.billingSweepSecret)

    // Asked about — a past_due row is always in the worklist, whatever its period end says —
    // and left running.
    expect(asked).toContain('sub_sweep_early')
    expect((await shopOf(id)).status).toBe('active')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // The other half, and the one that makes the sweep safe to run hourly: a trial that CONVERTED
  // is a stale row too, and the repair is to write the truth — not to close the shop.
  it('brings a converted trial up to date without closing the shop', async () => {
    const id = await seedShop('sweep-converted-shop', 'sweep-converted@example.com', {
      billing: {
        status: 'trialing',
        stripe_subscription_id: 'sub_sweep_converted',
        trial_ends_at: ago(3 * 60 * 60_000),
      },
    })
    answerWith(subscription('sub_sweep_converted', 'active', process.env.STRIPE_PRICE_PRO_MONTHLY!))

    const res = await sweep(env.billingSweepSecret)
    expect((await res.json() as { refreshed: number }).refreshed).toBeGreaterThanOrEqual(1)

    // The billing cycle follows the price actually on the subscription, exactly as the updated
    // webhook does — so a cycle change lost with the rest of the events is repaired here too.
    expect(await shopOf(id)).toEqual({ status: 'active', billing_cycle: 'monthly' })
    const { data } = await serviceClient()
      .from('merchant_billing').select('status').eq('merchant_id', id).single()
    expect(data!.status).toBe('active')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // Cost, not correctness — but the cost is one Stripe call per shop per hour forever. A shop
  // mid-trial has demonstrably nothing to reconcile and must not be asked about.
  it('never asks Stripe about a shop still inside its trial', async () => {
    const id = await seedShop('sweep-inside-shop', 'sweep-inside@example.com', {
      billing: {
        status: 'trialing',
        stripe_subscription_id: 'sub_sweep_inside',
        trial_ends_at: ahead(3 * 24 * 60 * 60_000),
      },
    })
    const asked = answerWith(subscription('sub_sweep_inside', 'canceled'))

    await sweep(env.billingSweepSecret)

    expect(asked).not.toContain('sub_sweep_inside')
    expect((await shopOf(id)).status).toBe('active')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // LOAD-BEARING. A comp carries status 'active' with no live Stripe subscription behind it. Ask
  // Stripe about it and the answer is a dead or missing object — which, unguarded, reads as
  // "lapsed" and suspends the shops a superadmin deliberately opened for free.
  it('never touches a comped shop', async () => {
    const id = await seedShop('sweep-comped-shop', 'sweep-comped@example.com', {
      billing: {
        status: 'active',
        comped: true,
        stripe_subscription_id: 'sub_sweep_comped',
        current_period_end: ago(60_000),
      },
    })
    const asked = answerWith(subscription('sub_sweep_comped', 'canceled'))

    await sweep(env.billingSweepSecret)

    expect(asked).not.toContain('sub_sweep_comped')
    expect((await shopOf(id)).status).toBe('active')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // A lookup that throws must leave the shop OPEN and the sweep running. Failing closed here
  // would mean closing a shop on a rate limit or a network blip — the row is unchanged, so the
  // next run picks it up again.
  it('leaves a shop alone when Stripe cannot be read, and still reports success', async () => {
    const id = await seedShop('sweep-error-shop', 'sweep-error@example.com', {
      billing: {
        status: 'trialing',
        stripe_subscription_id: 'sub_sweep_error',
        trial_ends_at: ago(60_000),
      },
    })
    billingSweepDeps.fetchSubscription = async () => { throw new Error('Stripe is down') }

    const res = await sweep(env.billingSweepSecret)
    expect(res.status).toBe(200)
    expect((await res.json() as { failed: number }).failed).toBeGreaterThanOrEqual(1)

    expect((await shopOf(id)).status).toBe('active')

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // Idempotence, which the hourly schedule depends on: on a healthy day this sweep re-reads shops
  // the webhook already closed. A row that already reads canceled is not in the worklist at all.
  it('never re-processes a shop that is already closed', async () => {
    const id = await seedShop('sweep-done-shop', 'sweep-done@example.com', {
      billing: {
        status: 'canceled',
        stripe_subscription_id: 'sub_sweep_done',
        trial_ends_at: ago(7 * 24 * 60 * 60_000),
      },
    })
    const asked = answerWith(subscription('sub_sweep_done', 'canceled'))

    await sweep(env.billingSweepSecret)

    expect(asked).not.toContain('sub_sweep_done')

    await serviceClient().from('merchants').delete().eq('id', id)
  })
})
