// tests/api/invoice.test.ts
// The three invoice doors, driven in-process against real Postgres.
//
// What this suite is really about is the DOORS, not the document — `tests/unit/invoice.test.ts`
// asserts what the page says. Here the questions are: does a stranger get in, does the guest pair
// actually match the way `phoneKey` says it does, and does every refusal look identical to a
// caller probing for real order numbers.
import { describe, it, expect, beforeAll } from 'vitest'
import { app } from '../../src/app.js'
import { serviceClient, resetMerchant, seedMerchant, makeUser } from '../rls/helpers.js'

let ownerCounter = 0
async function shopWithOwner(slug: string): Promise<{ merchantId: string; token: string }> {
  await resetMerchant(slug)
  ownerCounter += 1
  const owner = await makeUser(`invoice-owner-${ownerCounter}@example.com`, 'password123')
  const { data } = await owner.auth.getSession()
  const merchantId = await seedMerchant({ slug, owner_id: data.session!.user.id })
  return { merchantId, token: data.session!.access_token }
}

async function seedOrder(
  merchantId: string,
  over: Record<string, unknown> = {},
): Promise<{ id: string; order_number: string }> {
  const orderNumber = `IN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
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

// Every call gets its OWN address unless the caller names one: the door is rate-limited per IP
// (10/minute), the window is module state shared by the whole file, and a suite that shared one
// address would start failing on its eleventh assertion for a reason unrelated to what it asserts.
let ipCounter = 0
const lookup = (body: Record<string, unknown>, ip?: string) => {
  ipCounter += 1
  return app.request('/api/orders/invoice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip ?? `10.${Math.floor(ipCounter / 250)}.${ipCounter % 250}.1`,
    },
    body: JSON.stringify(body),
  })
}

const get = (path: string, token?: string) =>
  app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })

async function expectPdf(res: Response) {
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toBe('application/pdf')
  expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="Invoice-IN-[A-Z0-9]+\.pdf"$/)
  const bytes = new Uint8Array(await res.arrayBuffer())
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
}

let shop: { merchantId: string; token: string }
let other: { merchantId: string; token: string }

beforeAll(async () => {
  shop = await shopWithOwner('invoice-shop')
  other = await shopWithOwner('invoice-other')
})

describe('GET /api/merchants/:id/orders/:orderId/invoice.pdf', () => {
  it('hands the owner their own order as a PDF', async () => {
    const order = await seedOrder(shop.merchantId)
    await expectPdf(await get(`/api/merchants/${shop.merchantId}/orders/${order.id}/invoice.pdf`, shop.token))
  })

  // requireOwnsChild's rule: nesting a stranger's order id under a shop you DO own must not
  // reach it, and the refusal is a 404 so it does not confirm the row exists elsewhere.
  it('refuses an order belonging to another shop', async () => {
    const strangers = await seedOrder(other.merchantId)
    const res = await get(`/api/merchants/${shop.merchantId}/orders/${strangers.id}/invoice.pdf`, shop.token)
    expect(res.status).toBe(404)
  })

  it('refuses a caller who does not own the shop', async () => {
    const order = await seedOrder(shop.merchantId)
    const res = await get(`/api/merchants/${shop.merchantId}/orders/${order.id}/invoice.pdf`, other.token)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/orders/:orderId/invoice.pdf', () => {
  it('hands a signed-in customer their own order', async () => {
    const customer = await makeUser('invoice-customer@example.com', 'password123')
    const { data } = await customer.auth.getSession()
    const order = await seedOrder(shop.merchantId, { user_id: data.session!.user.id })
    await expectPdf(await get(`/api/orders/${order.id}/invoice.pdf`, data.session!.access_token))
  })

  it('refuses an order belonging to another account', async () => {
    const stranger = await makeUser('invoice-stranger@example.com', 'password123')
    const { data } = await stranger.auth.getSession()
    const guestOrder = await seedOrder(shop.merchantId)
    const res = await get(`/api/orders/${guestOrder.id}/invoice.pdf`, data.session!.access_token)
    expect(res.status).toBe(404)
  })

  it('refuses an unauthenticated caller', async () => {
    const order = await seedOrder(shop.merchantId)
    expect((await get(`/api/orders/${order.id}/invoice.pdf`)).status).toBe(401)
  })
})

describe('POST /api/orders/invoice — the guest door', () => {
  it('accepts the order number with the phone that placed it', async () => {
    const order = await seedOrder(shop.merchantId)
    await expectPdf(await lookup({ shop: 'invoice-shop', orderNumber: order.order_number, phone: '+60 12-345 6789' }))
  })

  // One human types one phone three ways, and all three must reach their own order — that is the
  // whole reason the key is the last eight digits rather than the string.
  it('matches a phone written any way its owner writes it', async () => {
    const order = await seedOrder(shop.merchantId)
    for (const phone of ['0123456789', '60123456789', '012-345 6789']) {
      await expectPdf(await lookup({ shop: 'invoice-shop', orderNumber: order.order_number, phone }))
    }
  })

  it('is case-insensitive about the order number', async () => {
    const order = await seedOrder(shop.merchantId)
    await expectPdf(await lookup({
      shop: 'invoice-shop', orderNumber: order.order_number.toLowerCase(), phone: '0123456789',
    }))
  })

  // A wrong phone and a missing order must be ONE answer. Any difference is an oracle for which
  // order numbers exist.
  it('answers a wrong phone exactly as it answers a missing order', async () => {
    const order = await seedOrder(shop.merchantId)
    const wrongPhone = await lookup({ shop: 'invoice-shop', orderNumber: order.order_number, phone: '0119999999' })
    const noSuchOrder = await lookup({ shop: 'invoice-shop', orderNumber: 'IN-NOTHING', phone: '0123456789' })
    expect(wrongPhone.status).toBe(404)
    expect(await wrongPhone.json()).toEqual(await noSuchOrder.json())
    expect(wrongPhone.status).toBe(noSuchOrder.status)
  })

  // An order number is unique per SHOP — the prefix is two letters of the slug — so the shop is
  // the scope, not decoration.
  it('refuses the right pair at the wrong shop', async () => {
    const order = await seedOrder(shop.merchantId)
    const res = await lookup({ shop: 'invoice-other', orderNumber: order.order_number, phone: '0123456789' })
    expect(res.status).toBe(404)
  })

  // The pair is guessable — a structured order number and a phone — and ADR 0018 accepts that
  // knowingly. THIS is what bounds it, so it is worth an assertion rather than trust.
  it('stops a caller hammering one address', async () => {
    const order = await seedOrder(shop.merchantId)
    const ip = '198.51.100.7'
    const args = { shop: 'invoice-shop', orderNumber: order.order_number, phone: '0119999999' }
    for (let i = 0; i < 10; i += 1) expect((await lookup(args, ip)).status).toBe(404)
    expect((await lookup(args, ip)).status).toBe(429)
    // Another customer behind another address is untouched by their neighbour's flood.
    expect((await lookup(args)).status).toBe(404)
  })

  // '' is what BOTH an absent phone and a phone-less order reduce to; keying on it would match
  // every such order and hand back the enumeration the phone requirement removes.
  it('refuses a phone with no digits in it', async () => {
    const order = await seedOrder(shop.merchantId)
    for (const phone of ['', 'no digits here', undefined]) {
      const res = await lookup({ shop: 'invoice-shop', orderNumber: order.order_number, phone })
      expect(res.status).toBe(404)
    }
  })
})

describe('the status gate', () => {
  it('refuses an order the shop has not confirmed, and one it cancelled', async () => {
    for (const status of ['pending_payment', 'cancelled']) {
      const order = await seedOrder(shop.merchantId, { status })
      expect((await get(`/api/merchants/${shop.merchantId}/orders/${order.id}/invoice.pdf`, shop.token)).status).toBe(404)
      expect((await lookup({ shop: 'invoice-shop', orderNumber: order.order_number, phone: '0123456789' })).status).toBe(404)
    }
  })

  it('issues for every status from new onward', async () => {
    for (const status of ['new', 'preparing', 'ready', 'completed']) {
      const order = await seedOrder(shop.merchantId, { status })
      await expectPdf(await get(`/api/merchants/${shop.merchantId}/orders/${order.id}/invoice.pdf`, shop.token))
    }
  })
})
