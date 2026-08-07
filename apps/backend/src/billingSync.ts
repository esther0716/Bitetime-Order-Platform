// The merchant's own pull of their subscription state — the reason a paid Checkout can no longer
// end at "Setting up your subscription…" forever.
//
// WHY THIS EXISTS. Everything that makes a paid shop OPEN was carried by one delivery of
// `checkout.session.completed`: the billing row, the tier reconciliation, and the flip of
// `merchants.status` to 'active'. Miss that request — an endpoint subscribed to the wrong events,
// a deploy mid-delivery, five 500s exhausting Stripe's retries — and the merchant is left on a
// screen that polls a status nothing will ever change, having already been charged. The hourly
// billing sweep does not close this: it only ever looks at shops whose stored deadline has PASSED
// while their stored status still reads running (billingSweep.ts), which is the lapse direction.
// A shop stuck at `pending` has no deadline and no running status, so nothing looks at it at all.
//
// Same posture as billingSweep.ts, one scope narrower: Stripe stays authoritative, the webhook
// stays the fast path, and this re-asks about ONE shop when its owner is standing in front of the
// consequence. Every action is idempotent — on a healthy day this runs over a shop the webhook
// already opened and changes nothing.
import type Stripe from 'stripe'
import { stripe } from './stripe.js'
import { admin } from './supabase.js'
import {
  LIVE_STATUSES, upsertBilling, billingFromSubscription, reconcileMerchantPlan, setMerchantStatus,
} from './billing.js'
import { pickSubscription } from './billingLifecycle.js'

/**
 * The outbound adapter, held mutable so tests drive every branch offline — the same seam as
 * `billingSweepDeps`. Reconciliation is defined by what Stripe answers, so a suite that cannot
 * choose the answer cannot test it.
 */
export const billingSyncDeps = {
  fetchSubscription: (id: string): Promise<Stripe.Subscription> => stripe.subscriptions.retrieve(id),
  listSubscriptions: (customerId: string): Promise<Stripe.ApiList<Stripe.Subscription>> =>
    stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 }),
}

/** Why a sync changed nothing. Reported so the merchant is told which of these it was. */
export type SyncReason =
  /** No billing row at all — this shop never reached Checkout. */
  | 'no_billing'
  /** Comped by a superadmin: there is no subscription behind it and none is wanted. */
  | 'comped'
  /** A customer exists but carries no subscription — Checkout was abandoned, or never completed. */
  | 'no_subscription'
  /** A subscription exists but is not running (canceled, incomplete, unpaid). */
  | 'not_live'
  /** Live subscription, but the shop is closed for a reason money does not reopen — see below. */
  | 'suspended_by_admin'

export interface SyncResult {
  /** The shop's status AFTER this call — what the caller should render on. */
  merchantStatus: string
  /** Stripe's own word for the subscription, or null when there is none. */
  subscriptionStatus: string | null
  /** True only when this call opened the shop. A shop already open reports false. */
  activated: boolean
  reason?: SyncReason
}

interface BillingRow {
  status: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  comped: boolean | null
}

/**
 * Re-read one shop's subscription from Stripe and make the database agree with it.
 *
 * `merchantStatus` is the caller's CURRENT `merchants.status`; it is returned unchanged whenever
 * this finds no reason to open the shop, so the caller never has to re-read the row.
 *
 * ACTIVATION IS NARROWER THAN THE WEBHOOK'S, deliberately. `checkout.session.completed` flips any
 * shop to 'active' because it fires only in response to a Checkout that just completed — it has
 * the event as evidence. This has no event, only a live subscription, and a moderation-suspended
 * shop has one of those too. Reading "live subscription ⇒ open the shop" here would hand every
 * suspended merchant a self-service undo of their suspension.
 *
 * So the shop opens only when the STORED billing status says it was closed for billing reasons
 * (or was never open at all). A shop suspended while its subscription is still running was closed
 * by a human, and money is not the thing that reopens it.
 */
export async function syncMerchantBilling(
  merchantId: string,
  merchantStatus: string,
): Promise<SyncResult> {
  const { data, error } = await admin
    .from('merchant_billing')
    .select('status, stripe_customer_id, stripe_subscription_id, comped')
    .eq('merchant_id', merchantId)
    .maybeSingle()
  if (error) throw new Error(error.message)

  const row = data as BillingRow | null
  if (!row) return { merchantStatus, subscriptionStatus: null, activated: false, reason: 'no_billing' }
  // A comped row carries status 'active' with nothing behind it — asking Stripe about it would
  // find nothing and report the shop broken. Same precedence as /api/checkout's own comp check.
  if (row.comped) return { merchantStatus, subscriptionStatus: null, activated: false, reason: 'comped' }

  const sub = await resolveSubscription(row)
  if (!sub) {
    return { merchantStatus, subscriptionStatus: null, activated: false, reason: 'no_subscription' }
  }

  // Written before the status decision, and unconditionally: `billingFromSubscription` is the
  // same derivation the webhook and the sweep use, and a row reconciled by any of the three must
  // not be distinguishable from the others.
  await upsertBilling(merchantId, billingFromSubscription(sub))

  if (!LIVE_STATUSES.includes(sub.status)) {
    return { merchantStatus, subscriptionStatus: sub.status, activated: false, reason: 'not_live' }
  }

  // See the note above: only a shop closed for billing reasons is reopened by a payment.
  const closedByHuman = merchantStatus === 'suspended' && LIVE_STATUSES.includes(row.status ?? '')
  if (closedByHuman) {
    return { merchantStatus, subscriptionStatus: sub.status, activated: false, reason: 'suspended_by_admin' }
  }

  // The tier follows the money, exactly as it does in the webhook (#112) — a shop that checked
  // out at the basic price lands on basic whatever signup wrote.
  await reconcileMerchantPlan(merchantId, sub)
  if (merchantStatus === 'active') {
    return { merchantStatus, subscriptionStatus: sub.status, activated: false }
  }
  await setMerchantStatus(merchantId, 'active')
  return { merchantStatus: 'active', subscriptionStatus: sub.status, activated: true }
}

/**
 * Everything Stripe holds for this shop's customer, narrowed by `pickSubscription`.
 *
 * The customer list is asked FIRST and the stored id is only the fallback, for the reason
 * `pickSubscription` gives: on the path this file exists for, the stored id is the stale one.
 * The fallback still matters for a row written before a customer id was stored.
 */
async function resolveSubscription(row: BillingRow): Promise<Stripe.Subscription | null> {
  if (row.stripe_customer_id) {
    const list = await billingSyncDeps.listSubscriptions(row.stripe_customer_id)
    const picked = pickSubscription(list.data ?? [])
    if (picked) return picked
  }
  if (row.stripe_subscription_id) return billingSyncDeps.fetchSubscription(row.stripe_subscription_id)
  return null
}
