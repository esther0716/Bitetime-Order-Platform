import type Stripe from 'stripe'
import { admin } from './supabase.js'
import { env } from './env.js'
import { cycleFromPriceId } from './pricing.js'

const toIso = (unix: number | null | undefined) =>
  unix ? new Date(unix * 1000).toISOString() : null

/**
 * The `merchant_billing.status` values that mean a subscription is actually running.
 *
 * One list, because two routes read it in opposite directions and they must not disagree:
 * `/api/checkout` refuses these (there is already something to bill, so selling a second
 * subscription would double-charge), while cancel/resume REQUIRE one (there is
 * nothing to change otherwise). Drift between the two copies would open a window where a shop
 * can do neither, or both.
 *
 * `past_due` is deliberately live: the subscription exists and Stripe is still retrying, so a
 * merchant must be able to cancel it. `canceled` and `incomplete` are not.
 */
export const LIVE_STATUSES = ['trialing', 'active', 'past_due']

// Upsert the authoritative billing row for a merchant.
export async function upsertBilling(merchantId: string, fields: Record<string, unknown>) {
  const { error } = await admin
    .from('merchant_billing')
    .upsert(
      { merchant_id: merchantId, updated_at: new Date().toISOString(), ...fields },
      { onConflict: 'merchant_id' }
    )
  if (error) throw error
}

/**
 * Bring `merchants.billing_cycle` into line with the price the shop is ACTUALLY paying on.
 * Called from the two money-moving webhook events — a subscription change
 * (`customer.subscription.updated`) and the paid signup (`checkout.session.completed`).
 *
 * The column stops being the signup body's claim: signup writes a PROVISIONAL cycle, and the
 * first webhook after money moves confirms or corrects it.
 *
 * Reads the price CURRENTLY on the subscription, so a change that has not touched the item yet
 * does not register — no "is a change pending?" branch anywhere.
 *
 * An unrecognised price is a NO-OP: see cycleFromPriceId. The shop keeps the cycle it had and the
 * mismatch is logged for a human.
 */
export async function reconcileBillingCycle(merchantId: string, sub: Stripe.Subscription) {
  const priceId = sub.items?.data?.[0]?.price?.id
  const tier = cycleFromPriceId(env.prices, priceId ?? '')
  if (!tier) {
    console.warn(
      `Subscription ${sub.id} carries price ${priceId ?? '(none)'}, which is not a configured ` +
        `plan price — leaving merchant ${merchantId} on its existing billing cycle.`,
    )
    return
  }

  const { error } = await admin
    .from('merchants')
    .update({ billing_cycle: tier.cycle })
    .eq('id', merchantId)
  if (error) throw error
}

/**
 * Close a shop whose subscription has ended — trial expired unpaid, dunning exhausted, or a
 * cancellation that has finally landed.
 *
 * ONE function, called from BOTH the `customer.subscription.deleted` webhook and the
 * reconciliation sweep, because those two are the same decision reached by different roads and a
 * second copy would eventually disagree about what "closed" means.
 *
 * Suspension is the whole of it (#222). A suspended shop's storefront refuses every order and
 * its dashboard is locked, so there is no entitlement left to revoke and no artifact left to
 * switch off: the shop's own vouchers, promos and menu options are simply unreachable, and they
 * work again the day it resubscribes.
 *
 * Idempotent, and it has to be: the sweep exists precisely to run over shops the webhook may or
 * may not have already handled.
 */
export async function lapseMerchant(merchantId: string) {
  const { error } = await admin
    .from('merchants')
    .update({ status: 'suspended' })
    .eq('id', merchantId)
  if (error) throw error
}

// Flip the merchant's activation status (service role bypasses RLS).
export async function setMerchantStatus(merchantId: string, status: string) {
  const { error } = await admin.from('merchants').update({ status }).eq('id', merchantId)
  if (error) throw error
}

/**
 * When the subscription's CURRENT billing period began, as an ISO timestamp (null if Stripe says
 * nothing). Same item-level/legacy drift handling as `billingFromSubscription`.
 *
 * On a `past_due` subscription this is the day the unpaid invoice was issued and the card first
 * failed — the only date on the object that measures how long dunning has run, which is why
 * `dunningGraceExpired` counts from here and not from `current_period_end`. Not persisted: the
 * one caller reads it off the Stripe object it already holds.
 */
export function subscriptionPeriodStart(sub: Stripe.Subscription): string | null {
  const item0 = sub.items?.data?.[0] as { current_period_start?: number } | undefined
  const start = item0?.current_period_start ?? (sub as { current_period_start?: number }).current_period_start
  return toIso(start)
}

// Derive the billing fields we persist from a Stripe subscription object.
export function billingFromSubscription(sub: Stripe.Subscription) {
  // Stripe moved `current_period_end` from the subscription onto its items
  // (API version 2025-03-31+). Prefer the item-level value, falling back to the
  // legacy top-level field so older API versions keep working.
  const item0 = sub.items?.data?.[0] as { current_period_end?: number } | undefined
  const periodEnd = item0?.current_period_end ?? (sub as { current_period_end?: number }).current_period_end
  return {
    stripe_subscription_id: sub.id,
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
    status: sub.status, // trialing | active | past_due | canceled | incomplete | ...
    trial_ends_at: toIso(sub.trial_end),
    current_period_end: toIso(periodEnd),
    // A subscription winding down looks EXACTLY like a healthy one from `status` alone —
    // Stripe leaves it 'active' until the period actually ends. Without this flag the
    // Subscription tab went on promising "Renews on 1 Sep" to a merchant who had cancelled,
    // and the first they heard of it was their shop being suspended.
    cancel_at_period_end: !!sub.cancel_at_period_end,
    // A card attached to the subscription means the trial will convert on its own —
    // the countdown banner softens from "add a card" to an informational notice.
    // Null here doesn't prove there's no card: it can still live on the customer
    // default, which the webhook resolves as a fallback (see index.ts).
    has_payment_method: !!sub.default_payment_method,
  }
}
