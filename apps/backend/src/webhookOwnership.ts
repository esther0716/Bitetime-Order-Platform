// Which Stripe events are OURS.
//
// A Stripe webhook endpoint is account-wide: it cannot be scoped to a product or a price, only to
// event types. So the moment the same Stripe account sells anything else — another product, a
// second app, a one-off invoice raised by hand in the dashboard — every subscription and invoice
// event it produces is delivered here too, with a valid signature. `constructEvent` proves the
// event came from our ACCOUNT; it says nothing about which product made it.
//
// That is not merely noise. `checkout.session.completed` used to fall back to
// `client_reference_id` for the merchant id, so a foreign Checkout that set that field for its own
// purposes reached `upsertBilling`, where `merchant_id` is a uuid foreign-keyed to `merchants` —
// a type error or an FK violation, thrown, 500, and Stripe retrying the same doomed event for
// three days. Filtering to our own products is the fix, and this module is the filter.
//
// TWO markers, either sufficient:
//   * `metadata.merchant_id` — written by every subscription and every Checkout session we create
//     (see /api/checkout and startCardlessTrial), and by nothing else in the account.
//   * a configured plan price id — the four `STRIPE_PRICE_*` ids, which are ours by definition.
//
// Either alone is conclusive, so this asks for one, not both: the metadata survives on payloads
// that carry no price (a trial reminder), and the price survives if metadata is ever lost.
//
// FAILS CLOSED. An event type with no extractor below is "not ours" and is dropped, so ADDING A
// HANDLER TO THE WEBHOOK MEANS ADDING ITS EXTRACTOR HERE — otherwise the new case never runs. The
// closed direction is the safe one: the cost of dropping our own event is a reconciliation the
// hourly sweep or the merchant's own sync will redo, and the cost of accepting a stranger's is a
// write against a shop that has nothing to do with it.
import type Stripe from 'stripe'
import { planFromPriceId, type Prices } from './pricing.js'

/** What an event offers as evidence of being ours. */
interface OwnershipProof {
  merchantId?: string | null
  priceIds: string[]
}

/** `metadata.merchant_id` off a subscription-carrying payload, tolerating either payload shape. */
function metadataMerchantId(meta: Stripe.Metadata | null | undefined): string | null {
  const id = meta?.merchant_id
  return typeof id === 'string' && id.length > 0 ? id : null
}

function subscriptionProof(sub: Stripe.Subscription): OwnershipProof {
  return {
    merchantId: metadataMerchantId(sub.metadata),
    priceIds: (sub.items?.data ?? []).map(i => i.price?.id).filter((id): id is string => !!id),
  }
}

function sessionProof(session: Stripe.Checkout.Session): OwnershipProof {
  // A Checkout session payload carries no line items unless they are expanded, and a webhook
  // payload cannot be expanded — so the metadata is the only marker available here. It is enough:
  // we set it on every session we create, which is what retires the `client_reference_id` fallback.
  return { merchantId: metadataMerchantId(session.metadata), priceIds: [] }
}

function invoiceProof(inv: Stripe.Invoice): OwnershipProof {
  // Stripe moved `subscription_details` under `invoice.parent` (API version 2025-03-31+), and the
  // payload follows the ENDPOINT's registered version — so read both places, same drift-hardening
  // as the invoice handlers in app.ts.
  const legacy = (inv as { subscription_details?: { metadata?: Stripe.Metadata } }).subscription_details
  const parent = (inv as { parent?: { subscription_details?: { metadata?: Stripe.Metadata } } }).parent
  const merchantId =
    metadataMerchantId(legacy?.metadata) ||
    metadataMerchantId(parent?.subscription_details?.metadata) ||
    metadataMerchantId(inv.metadata)

  const priceIds = (inv.lines?.data ?? []).flatMap(line => {
    // Same version split on the line item: `price` was replaced by `pricing.price_details.price`.
    const legacyPrice = (line as { price?: { id?: string } }).price?.id
    const priced = (line as { pricing?: { price_details?: { price?: string } } }).pricing?.price_details?.price
    return [legacyPrice, priced].filter((id): id is string => !!id)
  })

  return { merchantId, priceIds }
}

/**
 * The evidence this event type offers, or null when it is a type we never act on.
 *
 * Keyed on the event types the webhook actually handles. Keep it in step with that switch.
 */
function ownershipProof(event: Stripe.Event): OwnershipProof | null {
  switch (event.type) {
    case 'checkout.session.completed':
      return sessionProof(event.data.object)
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.trial_will_end':
      return subscriptionProof(event.data.object)
    case 'invoice.paid':
    case 'invoice.payment_failed':
      return invoiceProof(event.data.object)
    default:
      return null
  }
}

/** Is this price one of the four plan prices we sell? */
function isOurPrice(prices: Prices, id: string): boolean {
  return planFromPriceId(prices, id) !== null
}

/**
 * Should the webhook act on this event at all?
 *
 * False for anything another product in the same Stripe account produced, and for any event type
 * the webhook does not handle. The caller answers a rejected event with 200 — it is a decision,
 * not a failure, and a non-2xx would put a stranger's event into Stripe's retry queue.
 */
export function isOurEvent(event: Stripe.Event, prices: Prices): boolean {
  const proof = ownershipProof(event)
  if (!proof) return false
  if (proof.merchantId) return true
  return proof.priceIds.some(id => isOurPrice(prices, id))
}

/**
 * Is this subscription one of ours?
 *
 * The list-a-customer's-subscriptions calls in billingSync.ts need the same filter for the same
 * reason: a merchant who also buys something else from this account has more than one live
 * subscription, and picking the wrong one lets a foreign purchase decide whether their shop stays
 * open (`liveSubscriptionBesides`) or which subscription the billing row names.
 */
export function isOurSubscription(sub: Stripe.Subscription, prices: Prices): boolean {
  const proof = subscriptionProof(sub)
  return Boolean(proof.merchantId) || proof.priceIds.some(id => isOurPrice(prices, id))
}
