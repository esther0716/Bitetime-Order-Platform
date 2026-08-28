// tests/api/merchant-payment-proof.test.ts
// POST/GET /api/merchants/:id/orders/:orderId/merchant-payment-proof — the SHOP's own copy of a
// receipt, filed when the customer closed the browser and sent the slip over WhatsApp. Driven
// in-process against real Postgres + real Storage, same reason as its customer-side twin
// (tests/api/payment-proof.test.ts): `admin.storage` is not mockable here without also faking
// the property this suite exists to prove.
import { describe, it, expect, afterAll } from 'vitest'
import { app } from '../../src/app.js'
import { serviceClient, resetMerchant, seedMerchant, makeUser } from '../rls/helpers.js'

const BUCKET = 'payment-proof'

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

let ownerCounter = 0

/** A shop, its owner's access token, and the shop id — everything one case needs. */
async function shopWithToken(slug: string): Promise<{ merchantId: string; token: string; userId: string }> {
  await resetMerchant(slug)
  ownerCounter += 1
  const owner = await makeUser(`mpp-${ownerCounter}@example.com`, 'password123')
  const { data } = await owner.auth.getSession()
  const merchantId = await seedMerchant({ slug, owner_id: data.session!.user.id })
  return { merchantId, token: data.session!.access_token, userId: data.session!.user.id }
}

async function seedOrder(merchantId: string, status: string = 'new') {
  const { data, error } = await serviceClient()
    .from('orders')
    .insert({
      merchant_id: merchantId,
      order_number: `MPP-${crypto.randomUUID().slice(0, 8)}`,
      status,
      customer_name: 'Ah Meng',
      customer_wa: '60123456789',
    })
    .select('id')
    .single()
  if (error) throw new Error(`seeding order: ${error.message}`)
  return data!.id as string
}

function url(merchantId: string, orderId: string) {
  return `/api/merchants/${merchantId}/orders/${orderId}/merchant-payment-proof`
}

function post(
  merchantId: string,
  orderId: string,
  token: string,
  body: Uint8Array | string = PNG_1X1,
  contentType = 'image/png',
) {
  return app.request(url(merchantId, orderId), {
    method: 'POST',
    headers: { 'Content-Type': contentType, Authorization: `Bearer ${token}` },
    body,
  })
}

const written: string[] = []
afterAll(async () => {
  if (written.length) await serviceClient().storage.from(BUCKET).remove(written)
})

describe('POST /api/merchants/:id/orders/:orderId/merchant-payment-proof', () => {
  it('stores the image under {merchant_id}/{order_id}-merchant.png and stamps the order row', async () => {
    const { merchantId, token } = await shopWithToken('mpp-shop')
    const orderId = await seedOrder(merchantId)
    written.push(`${merchantId}/${orderId}-merchant.png`)

    const res = await post(merchantId, orderId, token)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      payment_proof_merchant: `${merchantId}/${orderId}-merchant.png`,
      status: 'new',
    })

    const { data: order } = await serviceClient()
      .from('orders').select('payment_proof_merchant').eq('id', orderId).single()
    expect(order!.payment_proof_merchant).toBe(`${merchantId}/${orderId}-merchant.png`)

    const { data: file, error } = await serviceClient()
      .storage.from(BUCKET).download(order!.payment_proof_merchant)
    expect(error).toBeNull()
    expect(file!.size).toBe(PNG_1X1.byteLength)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  // The whole reason for the second column: the shop files ITS copy beside the customer's, never
  // over it. Two distinct object names, two distinct columns, both readable afterwards.
  it('leaves the customer\'s own proof untouched — separate column, separate object', async () => {
    const { merchantId, token } = await shopWithToken('mpp-beside-shop')
    const orderId = await seedOrder(merchantId)
    written.push(`${merchantId}/${orderId}.png`, `${merchantId}/${orderId}-merchant.png`)

    // The customer's upload first, through its own unauthenticated door.
    const customerRes = await app.request(`/api/orders/${orderId}/payment-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: PNG_1X1,
    })
    expect(customerRes.status).toBe(200)

    expect((await post(merchantId, orderId, token)).status).toBe(200)

    const { data: order } = await serviceClient()
      .from('orders').select('payment_proof, payment_proof_merchant').eq('id', orderId).single()
    expect(order!.payment_proof).toBe(`${merchantId}/${orderId}.png`)
    expect(order!.payment_proof_merchant).toBe(`${merchantId}/${orderId}-merchant.png`)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('a second upload replaces the first (upsert), not accumulates', async () => {
    const { merchantId, token } = await shopWithToken('mpp-replace-shop')
    const orderId = await seedOrder(merchantId)
    written.push(`${merchantId}/${orderId}-merchant.png`)

    await post(merchantId, orderId, token)
    const SECOND = Uint8Array.from([...PNG_1X1, 0, 0, 0, 0])
    expect((await post(merchantId, orderId, token, SECOND)).status).toBe(200)

    const { data: order } = await serviceClient()
      .from('orders').select('payment_proof_merchant').eq('id', orderId).single()
    const { data: file } = await serviceClient()
      .storage.from(BUCKET).download(order!.payment_proof_merchant)
    expect(file!.size).toBe(SECOND.byteLength)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('flips a pending_payment order to new — filing the receipt clears the payment gate', async () => {
    const { merchantId, token } = await shopWithToken('mpp-flip-shop')
    const orderId = await seedOrder(merchantId, 'pending_payment')
    written.push(`${merchantId}/${orderId}-merchant.png`)

    const res = await post(merchantId, orderId, token)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'new' })

    const { data: order } = await serviceClient().from('orders').select('status').eq('id', orderId).single()
    expect(order!.status).toBe('new')

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('leaves every other status alone — the CASE guard only ever fires from pending_payment', async () => {
    for (const status of ['new', 'completed', 'cancelled']) {
      const { merchantId, token } = await shopWithToken(`mpp-untouched-${status}`)
      const orderId = await seedOrder(merchantId, status)
      written.push(`${merchantId}/${orderId}-merchant.png`)

      expect((await post(merchantId, orderId, token)).status).toBe(200)

      const { data: order } = await serviceClient().from('orders').select('status').eq('id', orderId).single()
      expect(order!.status).toBe(status)

      await serviceClient().from('merchants').delete().eq('id', merchantId)
    }
  })

  it('400s on an unsupported content type and writes nothing', async () => {
    const { merchantId, token } = await shopWithToken('mpp-badtype-shop')
    const orderId = await seedOrder(merchantId)

    const res = await post(merchantId, orderId, token, 'not an image', 'application/pdf')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('unsupported_type')

    const { data: order } = await serviceClient()
      .from('orders').select('payment_proof_merchant').eq('id', orderId).single()
    expect(order!.payment_proof_merchant).toBeNull()

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('400s on a body over 2 MiB', async () => {
    const { merchantId, token } = await shopWithToken('mpp-toobig-shop')
    const orderId = await seedOrder(merchantId)

    const res = await post(merchantId, orderId, token, new Uint8Array(2 * 1024 * 1024 + 1))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('too_large')

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('401 without a token', async () => {
    const { merchantId } = await shopWithToken('mpp-noauth-shop')
    const orderId = await seedOrder(merchantId)

    const res = await app.request(url(merchantId, orderId), {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: PNG_1X1,
    })
    expect(res.status).toBe(401)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  // requireMerchantOwns proves the caller owns :id; it says nothing about :orderId. Nesting a
  // stranger's order under one's OWN shop is what requireOwnsChild closes — and it must look
  // exactly like an order that never existed.
  it('404s when the order belongs to a different shop, even nested under one the caller owns', async () => {
    const mine = await shopWithToken('mpp-mine-shop')
    const theirs = await shopWithToken('mpp-theirs-shop')
    const strangerOrder = await seedOrder(theirs.merchantId)

    const res = await post(mine.merchantId, strangerOrder, mine.token)
    expect(res.status).toBe(404)

    const { data: order } = await serviceClient()
      .from('orders').select('payment_proof_merchant').eq('id', strangerOrder).single()
    expect(order!.payment_proof_merchant).toBeNull()

    await serviceClient().from('merchants').delete().eq('id', mine.merchantId)
    await serviceClient().from('merchants').delete().eq('id', theirs.merchantId)
  })
})

describe('GET /api/merchants/:id/orders/:orderId/merchant-payment-proof', () => {
  it('streams the filed receipt back to the owner', async () => {
    const { merchantId, token } = await shopWithToken('mpp-read-shop')
    const orderId = await seedOrder(merchantId)
    written.push(`${merchantId}/${orderId}-merchant.png`)

    await post(merchantId, orderId, token)
    const res = await app.request(url(merchantId, orderId), {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(PNG_1X1.byteLength)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  // A row naming an object Storage no longer holds. The two are restored separately and objects
  // can be removed by hand, so this is reachable in production — and it is a 404, not a 500: the
  // image is gone, the backend is fine.
  it('404s when the row names an object Storage no longer holds', async () => {
    const { merchantId, token } = await shopWithToken('mpp-gone-shop')
    const orderId = await seedOrder(merchantId)

    await post(merchantId, orderId, token)
    await serviceClient().storage.from(BUCKET).remove([`${merchantId}/${orderId}-merchant.png`])

    const res = await app.request(url(merchantId, orderId), {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toBe('not_found')

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('404s when the shop filed nothing — a customer-side proof is not this slot', async () => {
    const { merchantId, token } = await shopWithToken('mpp-none-shop')
    const orderId = await seedOrder(merchantId)
    written.push(`${merchantId}/${orderId}.png`)

    await app.request(`/api/orders/${orderId}/payment-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: PNG_1X1,
    })

    const res = await app.request(url(merchantId, orderId), {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })
})

// The customer's own door to the same bytes — how a customer who sent their slip over WhatsApp
// sees that the shop has it. Scoped by the order's user_id, never by merchant ownership.
describe('GET /api/orders/:orderId/merchant-payment-proof (customer)', () => {
  async function customerToken(email: string) {
    const client = await makeUser(email, 'password123')
    const { data } = await client.auth.getSession()
    return { token: data.session!.access_token, userId: data.session!.user.id }
  }

  async function seedOwnedOrder(merchantId: string, userId: string) {
    const { data, error } = await serviceClient()
      .from('orders')
      .insert({
        merchant_id: merchantId,
        order_number: `MPPC-${crypto.randomUUID().slice(0, 8)}`,
        status: 'pending_payment',
        customer_name: 'May Chan',
        customer_wa: '60123456789',
        user_id: userId,
      })
      .select('id')
      .single()
    if (error) throw new Error(`seeding order: ${error.message}`)
    return data!.id as string
  }

  function getAs(orderId: string, token?: string) {
    return app.request(`/api/orders/${orderId}/merchant-payment-proof`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  }

  it('streams the shop-filed receipt back to the customer who placed the order', async () => {
    const { merchantId, token: ownerToken } = await shopWithToken('mppc-read-shop')
    const { token, userId } = await customerToken('mppc-read-customer@example.com')
    const orderId = await seedOwnedOrder(merchantId, userId)
    written.push(`${merchantId}/${orderId}-merchant.png`)

    expect((await post(merchantId, orderId, ownerToken)).status).toBe(200)

    const res = await getAs(orderId, token)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(PNG_1X1.byteLength)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('404s for a stranger — the order exists but belongs to someone else', async () => {
    const { merchantId, token: ownerToken } = await shopWithToken('mppc-stranger-shop')
    const { userId } = await customerToken('mppc-owner-customer@example.com')
    const orderId = await seedOwnedOrder(merchantId, userId)
    written.push(`${merchantId}/${orderId}-merchant.png`)
    await post(merchantId, orderId, ownerToken)

    const { token: strangerToken } = await customerToken('mppc-stranger@example.com')
    expect((await getAs(orderId, strangerToken)).status).toBe(404)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('404s for a guest order — no user_id to match against at all', async () => {
    const { merchantId, token: ownerToken } = await shopWithToken('mppc-guest-shop')
    const orderId = await seedOrder(merchantId)
    written.push(`${merchantId}/${orderId}-merchant.png`)
    await post(merchantId, orderId, ownerToken)

    const { token } = await customerToken('mppc-guest-customer@example.com')
    expect((await getAs(orderId, token)).status).toBe(404)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('404s when the shop filed nothing', async () => {
    const { merchantId } = await shopWithToken('mppc-none-shop')
    const { token, userId } = await customerToken('mppc-none-customer@example.com')
    const orderId = await seedOwnedOrder(merchantId, userId)

    expect((await getAs(orderId, token)).status).toBe(404)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('404s when the row names an object Storage no longer holds', async () => {
    const { merchantId, token: ownerToken } = await shopWithToken('mppc-gone-shop')
    const { token, userId } = await customerToken('mppc-gone-customer@example.com')
    const orderId = await seedOwnedOrder(merchantId, userId)

    await post(merchantId, orderId, ownerToken)
    await serviceClient().storage.from(BUCKET).remove([`${merchantId}/${orderId}-merchant.png`])

    const res = await getAs(orderId, token)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toBe('not_found')

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('401 without a token', async () => {
    expect((await getAs('00000000-0000-0000-0000-000000000000')).status).toBe(401)
  })
})
