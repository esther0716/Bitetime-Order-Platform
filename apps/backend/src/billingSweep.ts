// The billing reconciliation sweep — the backstop that makes subscription state survive a
// webhook that never arrives.
//
// WHY THIS EXISTS. Every consequence of a subscription ending was, until this file, carried by a
// single `customer.subscription.deleted` delivery: the shop's suspension, the return to Basic,
// the revocation of Pro artifacts. Miss that one HTTP request — an endpoint subscribed to the
// wrong events, a deploy mid-delivery, five 500s exhausting Stripe's retries — and the shop stays
// open and entitled FOREVER, because nothing else ever looks. That is not a hypothetical: a
// production endpoint subscribed only to `checkout.session.completed` left expired trials
// selling, with no trace anywhere in the app that anything had gone wrong.
//
// So state stops being push-only. Stripe remains authoritative; this just re-asks it, on a
// schedule, about the shops whose stored deadline has passed while their stored status still
// says they are running. Same posture as ADR 0011's argument for the trial-feedback cron: some
// facts have no single event that reliably reports them, and a pull is what closes that.
//
// It is NOT a mirror of the webhook. The webhook is still the fast path and still does the work
// within seconds; this runs hourly and only ever repairs what the fast path missed. Every action
// it takes is idempotent, because on a healthy day it re-reads shops the webhook already handled.
import type Stripe from 'stripe'
import { stripe } from './stripe.js'
import { admin } from './supabase.js'
import {
  upsertBilling, billingFromSubscription, reconcileMerchantPlan, lapseMerchant,
} from './billing.js'
import { isLapsed, needsReconcile, type BillingRow } from './billingLifecycle.js'

/**
 * The one outbound adapter, held in a mutable object so tests can drive every branch without a
 * live network — same seam as `notifyDeps` and `trialFeedbackDeps` in app.ts. Reconciliation is
 * defined by what Stripe answers, so a suite that cannot choose the answer cannot test it.
 */
export const billingSweepDeps = {
  fetchSubscription: (id: string): Promise<Stripe.Subscription> => stripe.subscriptions.retrieve(id),
}

interface StaleRow extends BillingRow {
  merchant_id: string
}

/** A page size comfortably under any PostgREST `max_rows` this could meet. */
const PAGE = 200

/**
 * The shops worth asking Stripe about: status still reads running, deadline has passed.
 *
 * PAGED, for the reason CONTEXT.md → *Merchant order reads* gives: PostgREST caps a response at
 * `max_rows` and reports the truncation only in a header, so an unbounded read would silently
 * skip the tail of the worklist — leaving those shops open with nothing to show it happened,
 * which is the exact failure this file exists to end.
 *
 * The SQL filter is a cheap pre-narrowing; `needsReconcile` is the authority, and it is pure and
 * unit-tested. Anything the query lets through that the predicate refuses is dropped here.
 */
export async function findStaleBilling(now: Date): Promise<StaleRow[]> {
  const iso = now.toISOString()
  const out: StaleRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('merchant_billing')
      .select('merchant_id, status, stripe_subscription_id, trial_ends_at, current_period_end, comped')
      .in('status', ['trialing', 'active', 'past_due'])
      .not('stripe_subscription_id', 'is', null)
      // `not comped is true` rather than `comped is false`: the column is nullable, and a null
      // there means an ordinary paying shop, which must stay in the worklist.
      .not('comped', 'is', true)
      .or(`trial_ends_at.lte.${iso},current_period_end.lte.${iso}`)
      .order('merchant_id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as StaleRow[]
    out.push(...rows.filter(row => needsReconcile(row, now)))
    if (rows.length < PAGE) return out
  }
}

export interface SweepResult {
  /** Rows whose deadline had passed while their status still read running. */
  checked: number
  /** Shops closed by this run — Stripe had finished with their subscription. */
  lapsed: number
  /** Shops whose subscription was alive after all; their row was brought up to date. */
  refreshed: number
  /** Rows whose lookup or write failed. Logged, left for the next run. */
  failed: number
}

/**
 * Re-read one shop's subscription from Stripe and make the database agree with it.
 *
 * Both outcomes write the billing row first, because `billingFromSubscription` is the same
 * derivation the webhook uses and the row must end up identical either way — a shop reconciled
 * by the sweep and one reconciled by the webhook are not allowed to look different.
 */
async function reconcileOne(row: StaleRow): Promise<'lapsed' | 'refreshed'> {
  const sub = await billingSweepDeps.fetchSubscription(row.stripe_subscription_id!)
  await upsertBilling(row.merchant_id, billingFromSubscription(sub))

  if (isLapsed(sub.status)) {
    await lapseMerchant(row.merchant_id)
    return 'lapsed'
  }

  // Alive after all — a trial that converted, or a period that renewed. Reconcile the tier for
  // the same reason `customer.subscription.updated` does: the price on the subscription is what
  // the shop is actually paying for, and a missed portal swap leaves the column lying.
  await reconcileMerchantPlan(row.merchant_id, sub)
  return 'refreshed'
}

/**
 * One pass over the worklist.
 *
 * A row that throws is COUNTED AND SKIPPED, never fatal: one shop whose Stripe lookup fails —
 * a deleted subscription object, a rate limit, a network blip — must not stop the sweep from
 * reaching the rest. Failing closed here would mean the opposite of what it usually means: the
 * shop stays open, which is the safe direction. It will be picked up again next hour, because
 * nothing about the row has changed.
 */
export async function runBillingSweep(now: Date): Promise<SweepResult> {
  const stale = await findStaleBilling(now)
  const result: SweepResult = { checked: stale.length, lapsed: 0, refreshed: 0, failed: 0 }

  for (const row of stale) {
    try {
      const outcome = await reconcileOne(row)
      result[outcome]++
    } catch (err) {
      result.failed++
      console.error(
        `billing sweep: could not reconcile merchant ${row.merchant_id} ` +
          `(subscription ${row.stripe_subscription_id}):`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  return result
}
