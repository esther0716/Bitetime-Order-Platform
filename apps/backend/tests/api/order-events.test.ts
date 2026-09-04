// tests/api/order-events.test.ts
// The order log (#268, ADR 0025): every write to an order leaves an event, in the same
// transaction as the write. These cases drive the real routes and read the log back over db.ts
// — `order_events` holds no PostgREST grant for the browser roles, so a REST read would come
// back empty and prove nothing.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { sql } from '../../src/db.js'
import { app } from '../../src/app.js'
import { makeUser, resetMerchant, seedMerchant, seedProduct } from '../rls/helpers.js'
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

type EventRow = { kind: string; actor_kind: string; actor_id: string | null; detail: Record<string, unknown> }

async function eventsOf(orderId: string): Promise<EventRow[]> {
  return await sql<EventRow[]>`
    select kind, actor_kind, actor_id, detail from order_events
    where order_id = ${orderId} order by created_at, id
  `
}

describe('order log', () => {
  let shop: string
  let productId: string
  let customer: { token: string; userId: string }

  beforeAll(async () => {
    await resetMerchant(SLUG)
    const owner = await makeUser('order-events-owner@test.dev', 'password123')
    const cust = await makeUser('order-events-customer@test.dev', 'password123')
    customer = await tokenOf(cust)
    shop = await seedMerchant({ slug: SLUG, owner_id: (await tokenOf(owner)).userId, status: 'active' })
  })

  beforeEach(async () => {
    productId = await seedProduct({ merchant_id: shop, price: 13 })
  })

  describe('created', () => {
    it('is recorded for a signed-in customer, with their id and the birth status', async () => {
      const res = await placeOrder(shop, productId, customer.token)
      expect(res.status).toBe(200)
      const { id } = await res.json()

      expect(await eventsOf(id)).toEqual([
        { kind: 'created', actor_kind: 'customer', actor_id: customer.userId, detail: { status: 'new' } },
      ])
    })

    it('is recorded for a guest as a customer with no id', async () => {
      const res = await placeOrder(shop, productId)
      expect(res.status).toBe(200)
      const { id } = await res.json()

      expect(await eventsOf(id)).toEqual([
        { kind: 'created', actor_kind: 'customer', actor_id: null, detail: { status: 'new' } },
      ])
    })
  })
})
