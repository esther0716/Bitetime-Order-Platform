// The billing reconciliation sweep — the backstop that makes subscription state survive a
// webhook that never arrives.
//
// WHY THIS EXISTS. Every consequence of a subscription ending was, until this file, carried by a
// single `customer.subscription.deleted` delivery: the shop's suspension. Miss that one HTTP
// request — an endpoint subscribed to the wrong events, a deploy mid-delivery, five 500s
// exhausting Stripe's retries — and the shop stays OPEN AND SELLING forever, because nothing else
// ever looks. That is not a hypothetical: a
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
  upsertBilling, billingFromSubscription, reconcileBillingCycle, lapseMerchant,
  markDunningSuspended, reopenAfterPayment, LIVE_STATUSES,
} from './billing.js'
import {
  isLapsed, needsReconcile, needsPastDueReminder,
  buildPastDueReminderEmail, buildShopClosedEmail, type BillingRow,
} from './billingLifecycle.js'
import { pastDueDeadline, pastDueDaysLeft, pastDueGraceExpired } from '@bitetime/shared'
import { resendSend } from './email.js'
import { env } from './env.js'

/**
 * The one outbound adapter, held in a mutable object so tests can drive every branch without a
 * live network — same seam as `notifyDeps` and `trialFeedbackDeps` in app.ts. Reconciliation is
 * defined by what Stripe answers, so a suite that cannot choose the answer cannot test it.
 */
export const billingSweepDeps = {
  fetchSubscription: (id: string): Promise<Stripe.Subscription> => stripe.subscriptions.retrieve(id),
  // The dunning notices. Held here for the same reason the lookup is: a suite that cannot choose
  // what the outside world does cannot test what this file decides.
  sendEmail: resendSend,
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
      // One string literal, long: a concatenation defeats supabase-js's column typing.
      .select('merchant_id, status, stripe_subscription_id, trial_ends_at, current_period_end, current_period_start, past_due_notified_at, dunning_suspended_at, comped')
      .in('status', ['trialing', 'active', 'past_due'])
      .not('stripe_subscription_id', 'is', null)
      // `not comped is true` rather than `comped is false`: the column is nullable, and a null
      // there means an ordinary paying shop, which must stay in the worklist.
      .not('comped', 'is', true)
      // `status.eq.past_due` is a third disjunct, not a deadline: a shop in dunning carries a
      // period end in the FUTURE (Stripe advances the period when it issues the unpaid invoice),
      // so the two deadline tests alone would never select it. `dunning_suspended_at` is a
      // fourth. A shop closed for non-payment carries a status Stripe may already call `active`
      // again — it is in the list so the sweep can REOPEN it when the payment lands and the
      // webhook that says so went missing.
      .or(
        `trial_ends_at.lte.${iso},current_period_end.lte.${iso},status.eq.past_due,` +
        `dunning_suspended_at.not.is.null`,
      )
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
async function reconcileOne(row: StaleRow, now: Date): Promise<'lapsed' | 'refreshed'> {
  const sub = await billingSweepDeps.fetchSubscription(row.stripe_subscription_id!)
  const fields = billingFromSubscription(sub)
  await upsertBilling(row.merchant_id, fields)

  // TWO ways a subscription stops paying for the shop, and only the first is a status. The second
  // is a `past_due` one past its grace: Stripe's default after its final retry is to leave the
  // status `past_due` for ever, so waiting for `canceled` is waiting for something that may never
  // come — and meanwhile the shop sells on credit.
  const graceExpired = pastDueGraceExpired(sub.status, fields.current_period_start, now)
  if (isLapsed(sub.status) || graceExpired) {
    await lapseMerchant(row.merchant_id)
    if (graceExpired) {
      // Stamped before the email, so a send that throws cannot leave the shop closed with the
      // reason unrecorded — the row is what tells a later payment this closure may be undone.
      await markDunningSuspended(row.merchant_id, now)
      // Only on the run that actually closes it: `dunning_suspended_at` already set means this
      // shop was closed on an earlier sweep and the merchant has been told once already.
      if (!row.dunning_suspended_at) {
        await notify(row.merchant_id, shop => buildShopClosedEmail({
          shopName: shop, billingUrl: `${env.frontendUrl}/merchant#settings/subscription`,
        }))
      }
    }
    return 'lapsed'
  }

  // Alive after all — a trial that converted, or a period that renewed. Reconcile the tier for
  // the same reason `customer.subscription.updated` does: the price on the subscription is what
  // the shop is actually paying for, and a missed portal swap leaves the column lying.
  await reconcileBillingCycle(row.merchant_id, sub)

  if (sub.status === 'past_due') {
    await remindPastDue(row, fields.current_period_start ?? null, now)
  } else if (row.dunning_suspended_at && LIVE_STATUSES.includes(sub.status)) {
    // The payment landed and the shop is still shut — the backstop for a
    // `customer.subscription.updated` that never arrived, which is the same lost-webhook failure
    // this whole file exists for, in the direction that costs the merchant money rather than us.
    await reopenAfterPayment(row.merchant_id)
    console.log(`billing sweep: merchant ${row.merchant_id} paid — storefront reopened.`)
  }

  return 'refreshed'
}

/**
 * Tell the merchant, once a day, that their shop closes on a date — and stamp that we did.
 *
 * Not fatal. A shop must not be left un-reconciled because Resend was down: the reconciliation is
 * already written, and an unstamped row simply tries again on the next hourly run.
 */
async function remindPastDue(row: StaleRow, periodStart: string | null, now: Date) {
  if (!needsPastDueReminder(row.past_due_notified_at, now)) return
  const closesAt = pastDueDeadline(periodStart)
  if (!closesAt) return // no deadline to quote, and quoting the wrong one is worse than silence

  try {
    const sent = await notify(row.merchant_id, shop => buildPastDueReminderEmail({
      shopName: shop,
      closesAt,
      daysLeft: pastDueDaysLeft(periodStart, now),
      billingUrl: `${env.frontendUrl}/merchant#settings/subscription`,
    }))
    if (sent) await upsertBilling(row.merchant_id, { past_due_notified_at: now.toISOString() })
  } catch (err) {
    console.error(
      `billing sweep: past-due reminder failed for merchant ${row.merchant_id}:`,
      err instanceof Error ? err.message : String(err),
    )
  }
}

/**
 * Send one merchant-facing notice, addressed to the shop OWNER.
 *
 * The address comes from Auth rather than `profiles`, for the reason the trial reminder gives:
 * the profile row may not exist. Returns false when there is nobody to write to, so the caller
 * does not record a reminder that was never sent.
 */
async function notify(
  merchantId: string,
  build: (shopName: string) => { subject: string; text: string },
): Promise<boolean> {
  const { data: merchant } = await admin
    .from('merchants').select('name, owner_id').eq('id', merchantId).maybeSingle()
  if (!merchant?.owner_id) return false
  const { data: ownerUser } = await admin.auth.admin.getUserById(merchant.owner_id)
  const email = ownerUser?.user?.email
  if (!email) return false

  const { subject, text } = build(merchant.name || 'your shop')
  await billingSweepDeps.sendEmail(email, subject, { text })
  return true
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
      const outcome = await reconcileOne(row, now)
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
