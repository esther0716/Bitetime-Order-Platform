// tests/api/order-events.test.ts
// The order log (#268, ADR 0025): every write to an order leaves an event, in the same
// transaction as the write. These cases drive the real routes and read the log back over db.ts
// — `order_events` holds no PostgREST grant for the browser roles, so a REST read would come
// back empty and prove nothing.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { sql } from '../../src/db.js'
import { app } from '../../src/app.js'
import { makeUser, resetMerchant, seedMerchant, seedProduct, serviceClient } from '../rls/helpers.js'
import { todayInZone, DEFAULT_TIMEZONE } from '@bitetime/shared'

const SLUG = 'order-events-shop'

function tomorrowInShopZone(): string {
  const today = todayInZone(DEFAULT_TIMEZONE, new Date())
  return new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
}

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function placeOrder(merchantId: string, productId: string, token?: string) {
  return app.request('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({
      merchantId,
      customerName: 'Ah Meng',
      customerWa: '60123456789',
      mode: 'pickup',
      cart: [{ productId, qty: 1, selections: [] }],
      quotedTotal: 13,
      fulfilDate: tomorrowInShopZone(),
    }),
  })
}

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

/** An order seeded straight into the table — no `created` event, like every order before #268. */
async function seedOrder(merchantId: string, status: string, userId?: string) {
  const { data, error } = await serviceClient()
    .from('orders')
    .insert({
      merchant_id: merchantId,
      order_number: `OE-${crypto.randomUUID().slice(0, 8)}`,
      status,
      customer_name: 'Ah Meng',
      customer_wa: '60123456789',
      ...(userId ? { user_id: userId } : {}),
    })
    .select('id')
    .single()
  if (error) throw new Error(`seeding order: ${error.message}`)
  return data!.id as string
}

type EventRow = { kind: string; actor_kind: string; actor_id: string | null; detail: Record<string, unknown> }

async function eventsOf(orderId: string): Promise<EventRow[]> {
  return await sql<EventRow[]>`
    select kind, actor_kind, actor_id, detail from order_events
    where order_id = ${orderId} order by id
  `
}

describe('order log', () => {
  let shop: string
  let productId: string
  let customer: { token: string; userId: string }
  let owner: { token: string; userId: string }

  beforeAll(async () => {
    await resetMerchant(SLUG)
    const own = await makeUser('order-events-owner@test.dev', 'password123')
    const cust = await makeUser('order-events-customer@test.dev', 'password123')
    customer = await tokenOf(cust)
    owner = await tokenOf(own)
    shop = await seedMerchant({ slug: SLUG, owner_id: owner.userId, status: 'active' })
  })

  beforeEach(async () => {
    productId = await seedProduct({ merchant_id: shop, price: 13 })
  })

  describe('created', () => {
    it('is recorded for a signed-in customer, with their id and the birth status', async () => {
      const res = await placeOrder(shop, productId, customer.token)
      expect(res.status).toBe(200)
      const { id } = (await res.json()) as { id: string }

      expect(await eventsOf(id)).toEqual([
        { kind: 'created', actor_kind: 'customer', actor_id: customer.userId, detail: { status: 'new' } },
      ])
    })

    it('is recorded for a guest as a customer with no id', async () => {
      const res = await placeOrder(shop, productId)
      expect(res.status).toBe(200)
      const { id } = (await res.json()) as { id: string }

      expect(await eventsOf(id)).toEqual([
        { kind: 'created', actor_kind: 'customer', actor_id: null, detail: { status: 'new' } },
      ])
    })
  })

  describe('payment proof', () => {
    it('records the customer upload, and the status move it caused as the system', async () => {
      const orderId = await seedOrder(shop, 'pending_payment', customer.userId)
      const res = await app.request(`/api/orders/${orderId}/payment-proof`, {
        method: 'POST', headers: { 'Content-Type': 'image/png' }, body: PNG_1X1,
      })
      expect(res.status).toBe(200)

      expect(await eventsOf(orderId)).toEqual([
        { kind: 'payment_proof_uploaded', actor_kind: 'customer', actor_id: customer.userId, detail: {} },
        { kind: 'status_changed', actor_kind: 'system', actor_id: null, detail: { from: 'pending_payment', to: 'new' } },
      ])
    })

    it('records a guest upload with no actor id, and no status move when there was none', async () => {
      const orderId = await seedOrder(shop, 'new')
      const res = await app.request(`/api/orders/${orderId}/payment-proof`, {
        method: 'POST', headers: { 'Content-Type': 'image/png' }, body: PNG_1X1,
      })
      expect(res.status).toBe(200)

      expect(await eventsOf(orderId)).toEqual([
        { kind: 'payment_proof_uploaded', actor_kind: 'customer', actor_id: null, detail: {} },
      ])
      // The customer's response carries no log — the customer does not see it.
      expect(await res.json()).not.toHaveProperty('events')
    })

    it("records the shop's own receipt as the merchant, and hands the events back", async () => {
      const orderId = await seedOrder(shop, 'pending_payment')
      const res = await app.request(`/api/merchants/${shop}/orders/${orderId}/merchant-payment-proof`, {
        method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${owner.token}` }, body: PNG_1X1,
      })
      expect(res.status).toBe(200)

      const expected = [
        { kind: 'merchant_payment_proof_uploaded', actor_kind: 'merchant', actor_id: owner.userId, detail: {} },
        { kind: 'status_changed', actor_kind: 'system', actor_id: null, detail: { from: 'pending_payment', to: 'new' } },
      ]
      expect(await eventsOf(orderId)).toEqual(expected)
      const body = (await res.json()) as { events: (EventRow & { created_at: string })[] }
      expect(body.events.map((e: EventRow) => ({ kind: e.kind, actor_kind: e.actor_kind, actor_id: e.actor_id, detail: e.detail }))).toEqual(expected)
      expect(typeof body.events[0].created_at).toBe('string')
    })
  })
})
