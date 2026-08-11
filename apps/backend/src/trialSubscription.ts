// Provisioning a shop's cardless trial: the Stripe customer, the 7-day trialing subscription,
// the persisted billing row and the activation — one step with its own compensation. Three
// callers ask for it (signup, the owner's retry, the superadmin fallback) and none of them may
// be left holding half of it.
//
// This module does I/O. billingLifecycle.ts next door stays pure and decides WHETHER; this
// decides nothing and performs everything.
//
// Two orderings here are load-bearing:
//
//   * The pending→active flip is an ATOMIC CLAIM (`.eq('status', 'pending')`), so two concurrent
//     callers — a double-clicked admin, a retry racing the signup that spawned it — cannot both
//     go on to create a subscription. The loser is told the shop is no longer pending.
//   * Every failure path REVERTS that claim, and a subscription that exists but could not be
//     persisted is CANCELLED. An `active` shop with no subscription is free forever: trial-end
//     suspension is driven entirely by Stripe's subscription.deleted webhook, so for a shop
//     Stripe does not know about there is no event coming, and nothing else looks.
import { stripe, priceFor } from './stripe.js'
import { admin } from './supabase.js'
import { upsertBilling, billingFromSubscription, setMerchantStatus } from './billing.js'
import { canStartTrial, type BillingRow } from './billingLifecycle.js'

/** The free days a trial grants. Pinned here because more than one route grants one. */
export const TRIAL_DAYS = 7

/** The merchant columns a caller must have loaded before asking. */
export interface TrialMerchant {
  id: string
  name: string
  owner_id: string
  billing_cycle?: string | null
}

/**
 * `trial: false` on success is not a failure: it means the shop was activated but had already
 * used its one trial, which is approval's reactivation semantics.
 */
export type TrialOutcome =
  | { ok: true; trial: boolean }
  | { ok: false; error: string; http: 409 | 500 | 502 }

export async function startCardlessTrial(
  merchant: TrialMerchant,
  billing: BillingRow | null | undefined,
): Promise<TrialOutcome> {
  const { data: claimed, error: claimErr } = await admin
    .from('merchants')
    .update({ status: 'active' })
    .eq('id', merchant.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (claimErr) return { ok: false, error: 'Claim failed', http: 500 }
  if (!claimed) return { ok: false, error: 'Merchant is not pending', http: 409 }

  // Had a subscription once already — the activation stands, but a trial is never granted twice.
  if (!canStartTrial(billing)) return { ok: true, trial: false }

  // Owner email comes from Auth, not profiles — the profiles row may not exist (the client-side
  // profile upsert is currently RLS-blocked for new signups).
  const { data: ownerUser } = await admin.auth.admin.getUserById(merchant.owner_id)
  const ownerEmail = ownerUser?.user?.email

  const cycle = merchant.billing_cycle || 'monthly'

  // Undo the claim; never throw from a failure path.
  const revertClaim = async () => {
    try {
      await setMerchantStatus(merchant.id, 'pending')
    } catch (e) {
      console.error('Claim revert failed — merchant left active without a subscription:', e instanceof Error ? e.message : String(e))
    }
  }

  let customerId = billing?.stripe_customer_id
  let sub
  try {
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: ownerEmail || undefined,
        name: merchant.name,
        metadata: { merchant_id: merchant.id },
      })
      customerId = customer.id
    }
    sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceFor(cycle) }],
      trial_period_days: TRIAL_DAYS,
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      metadata: { merchant_id: merchant.id, billing: cycle, region: 'MY' },
    })
  } catch (err) {
    console.error('Trial subscription creation failed:', err instanceof Error ? err.message : String(err))
    await revertClaim()
    return { ok: false, error: 'Subscription creation failed', http: 502 }
  }

  try {
    await upsertBilling(merchant.id, billingFromSubscription(sub))
  } catch (err) {
    // The subscription exists but wasn't persisted — cancel it so a retry can't mint a second
    // trial against an orphaned live one.
    console.error('Billing persist failed — canceling trial subscription', sub.id, err instanceof Error ? err.message : String(err))
    try {
      await stripe.subscriptions.cancel(sub.id)
    } catch (cancelErr) {
      console.error('Cancel failed — ORPHANED Stripe subscription', sub.id, cancelErr instanceof Error ? cancelErr.message : String(cancelErr))
    }
    await revertClaim()
    return { ok: false, error: 'Subscription creation failed', http: 502 }
  }

  return { ok: true, trial: true }
}
