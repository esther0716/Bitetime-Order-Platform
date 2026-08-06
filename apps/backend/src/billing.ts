import { optionGroupsFromRow, deactivateGroups, hasActiveGroup, hasRequiredGroup } from '@bitetime/shared'
import type Stripe from 'stripe'
import { admin } from './supabase.js'
import { env } from './env.js'
import { planFromPriceId } from './pricing.js'

const toIso = (unix: number | null | undefined) =>
  unix ? new Date(unix * 1000).toISOString() : null

/**
 * The `merchant_billing.status` values that mean a subscription is actually running.
 *
 * One list, because two routes read it in opposite directions and they must not disagree:
 * `/api/checkout` refuses these (there is already something to bill, so selling a second
 * subscription would double-charge), while cancel/downgrade/resume REQUIRE one (there is
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
 * Bring `merchants.plan` / `billing_cycle` into line with the price the shop is ACTUALLY paying
 * for (#112). Called from the two money-moving webhook events — the Customer Portal's plan swap
 * (`customer.subscription.updated`) and the paid signup (`checkout.session.completed`).
 *
 * This is the reconciliation CONTEXT.md's entitlement invariant always named as future work, and
 * it reverses where the tier comes from: signup writes a PROVISIONAL value from the owner's
 * chosen tier, and the first webhook after money moves confirms or corrects it. A shop can no
 * longer end up entitled to a tier it never bought by declaring one at signup.
 *
 * Reads the price CURRENTLY on the subscription, which is what makes period-end downgrades free:
 * a downgrade scheduled in the portal has not touched the item yet, so this keeps returning Pro
 * until the schedule executes — no "is a change pending?" branch anywhere.
 *
 * An unrecognised price is a NO-OP, never a downgrade: see planFromPriceId. The shop keeps the
 * tier it had and the mismatch is logged for a human.
 */
export async function reconcileMerchantPlan(merchantId: string, sub: Stripe.Subscription) {
  const priceId = sub.items?.data?.[0]?.price?.id
  const tier = planFromPriceId(env.prices, priceId ?? '')
  if (!tier) {
    console.warn(
      `Subscription ${sub.id} carries price ${priceId ?? '(none)'}, which is not a configured ` +
        `plan price — leaving merchant ${merchantId} on its existing plan.`,
    )
    return
  }

  // Read before write: the artifact cutoff below has to fire on the TRANSITION, not on the
  // state. Every renewal of a Basic shop replays this event, and a cutoff keyed on "is basic"
  // would deactivate vouchers the merchant had re-enabled, once a month, forever.
  const { data: before } = await admin
    .from('merchants').select('plan').eq('id', merchantId).maybeSingle()

  const { error } = await admin
    .from('merchants')
    .update({ plan: tier.plan, billing_cycle: tier.cycle })
    .eq('id', merchantId)
  if (error) throw error

  // The scheduled change has landed, so the intent is spent. Cleared on any reconcile that
  // reaches the pending tier — whether it arrived by the schedule executing or by the merchant
  // changing their mind through some other route.
  const { data: billing } = await admin
    .from('merchant_billing').select('pending_plan').eq('merchant_id', merchantId).maybeSingle()
  if (billing?.pending_plan === tier.plan) {
    await upsertBilling(merchantId, { pending_plan: null })
  }

  if (before?.plan === 'pro' && tier.plan === 'basic') {
    await revokeProArtifacts(merchantId)
  }
}

/**
 * Stop the Pro artifacts a shop leaves behind when it steps down to Basic.
 *
 * #110 gated only the WRITES — a Basic shop cannot create a voucher or set a promo price — which
 * left the reverse direction open: a shop that had been Pro kept its vouchers redeemable and its
 * promos discounting, indefinitely, because the hot paths are plan-blind by design.
 *
 * They stay plan-blind. This revokes the DATA, once, at the transition, so that neither the
 * priced order transaction nor the storefront ever has to ask what tier a shop is on — the
 * constraint ADR 0004 named as the reason this was deferred rather than bodged. A plan lookup
 * inside `placeOrder`'s transaction would put billing state on the checkout path, where a slow
 * or wrong answer costs an order.
 *
 * Deliberately NOT symmetric with an upgrade. Re-subscribing to Pro does not resurrect old
 * vouchers or restart expired sales: those are decisions with customer-visible money attached,
 * and a merchant who wants them back can say so. Silent resurrection is the worse failure.
 *
 * Telegram is not handled here. The token is a credential, not an artifact — deleting it would
 * make a re-upgrade mean re-doing BotFather. That send is gated at the notify route instead,
 * which is safe precisely because notify is a separate call AFTER the order lands, never part
 * of the order transaction.
 */
export async function revokeProArtifacts(merchantId: string) {
  const at = new Date().toISOString()

  // Vouchers already handed to customers keep existing — the row, its redemption history and
  // its code all survive — they simply stop being redeemable. Filtering on `active` means only
  // live ones are touched, so this is idempotent.
  const { error: voucherErr } = await admin
    .from('vouchers').update({ active: false }).eq('merchant_id', merchantId).eq('active', true)
  if (voucherErr) throw voucherErr

  // A running sale is ended by moving its end date to now rather than by clearing `promo_price`:
  // the merchant's configured price survives for reference, the product reads as "promo ended
  // <date>", which is true, and `promoState` already treats a past end date as no promo. Sales
  // that had already finished are excluded so their historical end dates are not rewritten.
  const { error: promoErr } = await admin
    .from('products')
    .update({ promo_end: at })
    .eq('merchant_id', merchantId)
    .not('promo_price', 'is', null)
    .or(`promo_end.is.null,promo_end.gt.${at}`)
  if (promoErr) throw promoErr

  await revokeOptionGroups(merchantId)
}

/**
 * Switch a shop's menu options off, and take the products that cannot be sold without them off
 * sale with it (#145, ADR 0010).
 *
 * The same shape as the two revocations above and for the same reason: NOTHING is destroyed. The
 * groups keep their windows, their options and their deltas, and `validateSelections` already
 * ignores an inactive group — so the storefront and the order transaction never ask what tier
 * this shop is on. ADR 0008 put the groups in a jsonb column, so a delete here would be
 * unrecoverable: a shop that stopped paying would not be downgraded, it would be dismantled.
 *
 * A product carrying a REQUIRED group also goes inactive. With its question switched off it would
 * otherwise sell a six-muffin box with no flavours chosen, leaving the merchant guessing what to
 * pack — unfulfillable rather than degraded. A product whose groups are all optional keeps
 * selling and simply loses the upsell.
 *
 * Idempotent by filtering on there still being an ACTIVE group, exactly as the voucher update
 * filters `active = true`: a replayed webhook must not switch off a product the merchant has
 * since switched back on. Not symmetric either — re-subscribing resurrects nothing.
 */
async function revokeOptionGroups(merchantId: string) {
  // PAGED, because "give me all of this shop's products" is the request shape CONTEXT.md ->
  // *Merchant order reads* rules out: PostgREST caps a response at `max_rows` and reports the
  // truncation only in a header, so an unbounded read here would silently skip a large menu's
  // tail — leaving those products selling questions the shop no longer pays for, with nothing
  // to show it happened. The rule is about the shape of the request, not about the number.
  for (let from = 0; ; from += REVOKE_PAGE) {
    const { data, error } = await admin
      .from('products').select('id, active, option_groups')
      .eq('merchant_id', merchantId)
      .order('id')
      .range(from, from + REVOKE_PAGE - 1)
    if (error) throw error
    const rows = data ?? []
    if (rows.length === 0) return
    await revokePage(rows)
    if (rows.length < REVOKE_PAGE) return
  }
}

/** One page of products, at a size comfortably under any `max_rows` this could meet. */
const REVOKE_PAGE = 200

async function revokePage(rows: { id: string; active: boolean; option_groups: unknown }[]) {
  for (const row of rows) {
    const groups = optionGroupsFromRow(row.option_groups)
    if (!hasActiveGroup(groups)) continue
    const patch: Record<string, unknown> = { option_groups: deactivateGroups(groups) }
    // Read from the groups as they stand NOW, before they are switched off.
    if (hasRequiredGroup(groups)) patch.active = false
    const { error: err } = await admin.from('products').update(patch).eq('id', row.id)
    if (err) throw err
  }
}

/**
 * Close a shop whose subscription has ended — trial expired unpaid, dunning exhausted, or a
 * cancellation that has finally landed.
 *
 * ONE function, called from BOTH the `customer.subscription.deleted` webhook and the
 * reconciliation sweep, because those two are the same decision reached by different roads and a
 * second copy would eventually disagree about what "closed" means.
 *
 * It does two things the suspension alone never did:
 *
 *   * Returns `merchants.plan` to basic. `hasProAccess` reads that column and nothing else — it
 *     is status-blind on purpose, so that no hot path has to ask about billing — which left a
 *     lapsed Pro shop still entitled. Suspension hid that behind a closed storefront rather than
 *     fixing it: un-suspend the shop and every Pro feature came back.
 *   * Revokes the Pro artifacts, on the TRANSITION only, exactly as `reconcileMerchantPlan` does
 *     for a portal downgrade. Read before write for the same reason: a replayed webhook, or a
 *     sweep re-reading a shop that is already closed, must not switch off vouchers the merchant
 *     has since restored.
 *
 * Idempotent, and it has to be: the sweep exists precisely to run over shops the webhook may or
 * may not have already handled.
 */
export async function lapseMerchant(merchantId: string) {
  const { data: before } = await admin
    .from('merchants').select('plan').eq('id', merchantId).maybeSingle()

  const { error } = await admin
    .from('merchants')
    .update({ status: 'suspended', plan: 'basic' })
    .eq('id', merchantId)
  if (error) throw error

  if (before?.plan === 'pro') await revokeProArtifacts(merchantId)
}

// Flip the merchant's activation status (service role bypasses RLS).
export async function setMerchantStatus(merchantId: string, status: string) {
  const { error } = await admin.from('merchants').update({ status }).eq('id', merchantId)
  if (error) throw error
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
