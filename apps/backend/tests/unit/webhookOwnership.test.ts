// tests/unit/webhookOwnership.test.ts
// `isOurEvent` / `isOurSubscription` — the filter that keeps another product's Stripe events out
// of the billing webhook.
//
// A webhook endpoint is account-wide: it can be narrowed to event types but never to a product,
// so anything else this Stripe account sells delivers correctly signed subscription and invoice
// events to the same URL. The properties worth pinning are the two directions of the gate — our
// own events must survive every payload shape Stripe emits, and a stranger's must be dropped even
// when it looks exactly like ours minus the markers.
import { describe, it, expect } from 'vitest'
import type Stripe from 'stripe'
import { isOurEvent, isOurSubscription } from '../../src/webhookOwnership.js'
import type { Prices } from '../../src/pricing.js'

const PRICES: Prices = {
  basic_monthly: 'price_basic_m',
  basic_yearly: 'price_basic_y',
  pro_monthly: 'price_pro_m',
  pro_yearly: 'price_pro_y',
}

const FOREIGN_PRICE = 'price_some_other_product'

/** An event as the gate reads one — only `type` and `data.object` are touched. */
function event(type: string, object: unknown): Stripe.Event {
  return { type, data: { object } } as unknown as Stripe.Event
}

function sub(opts: { merchantId?: string; price?: string } = {}) {
  return {
    id: 'sub_1',
    metadata: opts.merchantId ? { merchant_id: opts.merchantId } : {},
    items: { data: [{ price: { id: opts.price ?? FOREIGN_PRICE } }] },
  } as unknown as Stripe.Subscription
}

describe('isOurEvent — our own events pass', () => {
  it('accepts a Checkout session carrying our merchant_id', () => {
    const session = { metadata: { merchant_id: 'm_1' }, client_reference_id: 'm_1' }
    expect(isOurEvent(event('checkout.session.completed', session), PRICES)).toBe(true)
  })

  it('accepts a subscription event on the metadata alone, with no price we know', () => {
    // The trial reminder and the portal's own writes can carry a price we did not configure
    // (a comp, a legacy price); the metadata is what makes the subscription ours.
    const e = event('customer.subscription.trial_will_end', sub({ merchantId: 'm_1' }))
    expect(isOurEvent(e, PRICES)).toBe(true)
  })

  it('accepts a subscription event on the price alone, with the metadata lost', () => {
    const e = event('customer.subscription.deleted', sub({ price: 'price_pro_y' }))
    expect(isOurEvent(e, PRICES)).toBe(true)
  })

  it('reads invoice metadata from the legacy subscription_details', () => {
    const inv = { subscription_details: { metadata: { merchant_id: 'm_1' } }, lines: { data: [] } }
    expect(isOurEvent(event('invoice.paid', inv), PRICES)).toBe(true)
  })

  // Stripe moved `subscription_details` under `parent` in API version 2025-03-31+, and the payload
  // follows the ENDPOINT's registered version — so both shapes have to be understood.
  it('reads invoice metadata from the newer parent.subscription_details', () => {
    const inv = { parent: { subscription_details: { metadata: { merchant_id: 'm_1' } } }, lines: { data: [] } }
    expect(isOurEvent(event('invoice.payment_failed', inv), PRICES)).toBe(true)
  })

  it('accepts an invoice on a line-item price, in either line shape', () => {
    const legacy = { lines: { data: [{ price: { id: 'price_basic_m' } }] } }
    const modern = { lines: { data: [{ pricing: { price_details: { price: 'price_basic_m' } } }] } }
    expect(isOurEvent(event('invoice.paid', legacy), PRICES)).toBe(true)
    expect(isOurEvent(event('invoice.paid', modern), PRICES)).toBe(true)
  })
})

describe('isOurEvent — another product in the same account is dropped', () => {
  // THE case this module exists for. A foreign Checkout that sets `client_reference_id` for its
  // own purposes used to reach upsertBilling, where merchant_id is a uuid foreign-keyed to
  // merchants — an FK violation, a 500, and Stripe retrying it for three days.
  it('drops a Checkout session whose client_reference_id is not ours', () => {
    const session = { metadata: { order_ref: 'abc' }, client_reference_id: 'customer-42' }
    expect(isOurEvent(event('checkout.session.completed', session), PRICES)).toBe(false)
  })

  it('drops a subscription with neither our metadata nor our price', () => {
    expect(isOurEvent(event('customer.subscription.updated', sub()), PRICES)).toBe(false)
    expect(isOurEvent(event('customer.subscription.deleted', sub()), PRICES)).toBe(false)
  })

  it('drops an invoice for a foreign product', () => {
    const inv = { metadata: {}, lines: { data: [{ price: { id: FOREIGN_PRICE } }] } }
    expect(isOurEvent(event('invoice.paid', inv), PRICES)).toBe(false)
  })

  it('treats an empty merchant_id as no marker at all', () => {
    const session = { metadata: { merchant_id: '' } }
    expect(isOurEvent(event('checkout.session.completed', session), PRICES)).toBe(false)
  })

  // Fails closed: a type with no extractor is dropped, so adding a case to the webhook's switch
  // without adding it here means the new case never runs.
  it('drops an event type the webhook does not handle', () => {
    const e = event('payment_intent.succeeded', { metadata: { merchant_id: 'm_1' } })
    expect(isOurEvent(e, PRICES)).toBe(false)
  })
})

describe('isOurSubscription', () => {
  it('keeps a shop plan and rejects another product bought by the same customer', () => {
    expect(isOurSubscription(sub({ merchantId: 'm_1' }), PRICES)).toBe(true)
    expect(isOurSubscription(sub({ price: 'price_basic_y' }), PRICES)).toBe(true)
    expect(isOurSubscription(sub(), PRICES)).toBe(false)
  })
})
