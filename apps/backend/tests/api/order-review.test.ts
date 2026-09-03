// tests/api/order-review.test.ts
// The two review doors, driven in-process against real Postgres.
//
// The questions here are the DOORS, not the rating: does a stranger get in, does the guest pair
// match the way `phoneKey` says it does, does every refusal look the same to a caller probing for
// real order numbers, and does a second review replace the first rather than add one.
import { describe, it, expect, beforeAll } from 'vitest'
import { app } from '../../src/app.js'
import { serviceClient, resetMerchant, seedMerchant, makeUser } from '../rls/helpers.js'

let ownerCounter = 0
async function shopWithOwner(slug: string): Promise<{ merchantId: string; token: string }> {
  await resetMerchant(slug)
  ownerCounter += 1
  const owner = await makeUser(`review-owner-${ownerCounter}@example.com`, 'password123')
  const { data } = await owner.auth.getSession()
  const merchantId = await seedMerchant({ slug, owner_id: data.session!.user.id })
  return { merchantId, token: data.session!.access_token }
}

async function seedOrder(
  merchantId: string,
  over: Record<string, unknown> = {},
): Promise<{ id: string; order_number: string }> {
  const orderNumber = `RV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  const { data, error } = await serviceClient()
    .from('orders')
    .insert({
      merchant_id: merchantId,
      order_number: orderNumber,
      status: 'new',
      mode: 'pickup',
      customer_name: 'Ah Meng',
      customer_wa: '+60 12-345 6789',
      customer_phone_key: '23456789',
      currency: 'MYR',
      items: [{ id: 'p1', name: 'Butter cake', qty: 2, price: 18 }],
      total: 36,
      ...over,
    })
    .select('id, order_number')
    .single()
  if (error) throw new Error(`seeding order: ${error.message}`)
  return data as { id: string; order_number: string }
}

// Every guest call gets its OWN address unless the caller names one: the door is rate-limited per
// IP (10/minute), the window is module state shared by the whole file, and a suite sharing one
// address would fail on its eleventh assertion for a reason unrelated to what it asserts.
let ipCounter = 0
const guestReview = (body: Record<string, unknown>, ip?: string) => {
  ipCounter += 1
  return app.request('/api/orders/review', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip ?? `10.${Math.floor(ipCounter / 250)}.${ipCounter % 250}.1`,
    },
    body: JSON.stringify(body),
  })
}

const myReview = (orderId: string, body: Record<string, unknown>, token?: string) =>
  app.request(`/api/orders/${orderId}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

async function readReview(orderId: string) {
  const { data } = await serviceClient()
    .from('orders').select('review_rating, review_comment, review_at').eq('id', orderId).single()
  return data as { review_rating: number | null; review_comment: string | null; review_at: string | null }
}

let shop: { merchantId: string; token: string }
let customer: { id: string; token: string }
let stranger: { id: string; token: string }

beforeAll(async () => {
  shop = await shopWithOwner('review-shop')

  const a = await makeUser('review-customer@example.com', 'password123')
  const aSession = (await a.auth.getSession()).data.session!
  customer = { id: aSession.user.id, token: aSession.access_token }

  const b = await makeUser('review-stranger@example.com', 'password123')
  const bSession = (await b.auth.getSession()).data.session!
  stranger = { id: bSession.user.id, token: bSession.access_token }
})

describe('POST /api/orders/:orderId/review — the signed-in door', () => {
  it('stores the rating and the comment on the caller’s own order', async () => {
    const order = await seedOrder(shop.merchantId, { user_id: customer.id })
    const res = await myReview(order.id, { rating: 5, comment: '  hot and fast  ' }, customer.token)
    expect(res.status).toBe(200)
    const body = await res.json() as { review_rating: number; review_comment: string | null; review_at: string }
    expect(body.review_rating).toBe(5)
    expect(body.review_comment).toBe('hot and fast')
    expect(body.review_at).toBeTruthy()

    const stored = await readReview(order.id)
    expect(stored.review_rating).toBe(5)
    expect(stored.review_comment).toBe('hot and fast')
  })

  it('replaces an earlier review instead of adding one', async () => {
    const order = await seedOrder(shop.merchantId, { user_id: customer.id })
    await myReview(order.id, { rating: 1 }, customer.token)
    const res = await myReview(order.id, { rating: 4, comment: 'they fixed it' }, customer.token)
    expect(res.status).toBe(200)

    const stored = await readReview(order.id)
    expect(stored.review_rating).toBe(4)
    expect(stored.review_comment).toBe('they fixed it')
  })

  it('refuses a stranger’s order with the same 404 a missing order gets', async () => {
    const order = await seedOrder(shop.merchantId, { user_id: customer.id })
    const mine = await myReview(order.id, { rating: 5 }, stranger.token)
    expect(mine.status).toBe(404)
    expect(await mine.json()).toEqual({ error: 'not_found' })

    const missing = await myReview(crypto.randomUUID(), { rating: 5 }, stranger.token)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'not_found' })

    const stored = await readReview(order.id)
    expect(stored.review_rating).toBeNull()
  })

  it('refuses a guest order, which belongs to nobody', async () => {
    const order = await seedOrder(shop.merchantId, { user_id: null })
    const res = await myReview(order.id, { rating: 5 }, customer.token)
    expect(res.status).toBe(404)
  })

  it('refuses a caller with no token', async () => {
    const order = await seedOrder(shop.merchantId, { user_id: customer.id })
    expect((await myReview(order.id, { rating: 5 })).status).toBe(401)
  })

  it('refuses a rating outside 1-5', async () => {
    const order = await seedOrder(shop.merchantId, { user_id: customer.id })
    expect((await myReview(order.id, { rating: 0 }, customer.token)).status).toBe(400)
    expect((await myReview(order.id, { rating: 6 }, customer.token)).status).toBe(400)
    expect((await readReview(order.id)).review_rating).toBeNull()
  })

  it('refuses a cancelled order', async () => {
    const order = await seedOrder(shop.merchantId, { user_id: customer.id, status: 'cancelled' })
    const res = await myReview(order.id, { rating: 5 }, customer.token)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'order_cancelled' })
  })
})

describe('POST /api/orders/review — the guest door', () => {
  it('stores a review for the order number and phone the guest proves', async () => {
    const order = await seedOrder(shop.merchantId)
    const res = await guestReview({
      shop: 'review-shop',
      orderNumber: order.order_number,
      phone: '+60 12-345 6789',
      rating: 4,
      comment: 'good',
    })
    expect(res.status).toBe(200)
    const stored = await readReview(order.id)
    expect(stored.review_rating).toBe(4)
    expect(stored.review_comment).toBe('good')
  })

  it('matches the phone on the last eight digits, however it is written', async () => {
    const order = await seedOrder(shop.merchantId)
    const res = await guestReview({
      shop: 'REVIEW-SHOP',
      orderNumber: order.order_number.toLowerCase(),
      phone: '012 345 6789',
      rating: 3,
    })
    expect(res.status).toBe(200)
    expect((await readReview(order.id)).review_rating).toBe(3)
  })

  it('refuses a wrong phone, an unknown order and an unknown shop with the same 404', async () => {
    const order = await seedOrder(shop.merchantId)
    const base = { shop: 'review-shop', orderNumber: order.order_number, phone: '+60 12-345 6789', rating: 5 }

    const wrongPhone = await guestReview({ ...base, phone: '+60 19-999 8888' })
    expect(wrongPhone.status).toBe(404)
    expect(await wrongPhone.json()).toEqual({ error: 'not_found' })

    const wrongOrder = await guestReview({ ...base, orderNumber: 'RV-DOESNOTEXIST' })
    expect(wrongOrder.status).toBe(404)
    expect(await wrongOrder.json()).toEqual({ error: 'not_found' })

    const wrongShop = await guestReview({ ...base, shop: 'no-such-shop' })
    expect(wrongShop.status).toBe(404)
    expect(await wrongShop.json()).toEqual({ error: 'not_found' })

    const noPhone = await guestReview({ ...base, phone: '' })
    expect(noPhone.status).toBe(404)

    expect((await readReview(order.id)).review_rating).toBeNull()
  })

  // The guest door WRITES, unlike its invoice twin, so it must not reach an order that has an
  // owner: a guessed number-and-phone pair would otherwise overwrite a signed-in customer's own
  // rating. That customer has their own door and loses nothing.
  it('refuses an order that belongs to a signed-in customer', async () => {
    const order = await seedOrder(shop.merchantId, { user_id: customer.id })
    const res = await guestReview({
      shop: 'review-shop', orderNumber: order.order_number, phone: '+60 12-345 6789', rating: 1,
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    expect((await readReview(order.id)).review_rating).toBeNull()
  })

  it('refuses a cancelled order', async () => {
    const order = await seedOrder(shop.merchantId, { status: 'cancelled' })
    const res = await guestReview({
      shop: 'review-shop', orderNumber: order.order_number, phone: '+60 12-345 6789', rating: 5,
    })
    expect(res.status).toBe(409)
  })

  it('rate-limits one address after ten calls in a minute', async () => {
    const order = await seedOrder(shop.merchantId)
    const ip = '203.0.113.77'
    const body = {
      shop: 'review-shop', orderNumber: order.order_number, phone: '+60 12-345 6789', rating: 5,
    }
    for (let i = 0; i < 10; i++) {
      expect((await guestReview(body, ip)).status).toBe(200)
    }
    const res = await guestReview(body, ip)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
  })
})
