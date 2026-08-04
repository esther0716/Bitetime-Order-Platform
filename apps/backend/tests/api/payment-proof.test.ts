// tests/api/payment-proof.test.ts
// POST /api/orders/:orderId/payment-proof — unauthenticated, exactly like POST /api/orders
// itself. Driven in-process against real Postgres + real Storage: `admin.storage` is not
// mockable here without also faking the property (a real upload landing in the bucket) this
// suite exists to prove.
import { describe, it, expect, afterAll } from 'vitest'
import { app } from '../../src/app.js'
import { serviceClient, resetMerchant, seedMerchant, makeUser } from '../rls/helpers.js'

const BUCKET = 'payment-proof'

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

// `merchants.owner_id` is UNIQUE and NOT NULL — the POST route itself needs no owner (it's
// unauthenticated), but seeding a valid shop row does. Each shop gets its own throwaway user.
let ownerCounter = 0
async function shopWithOwner(slug: string): Promise<string> {
  await resetMerchant(slug)
  ownerCounter += 1
  const owner = await makeUser(`payment-proof-${ownerCounter}@example.com`, 'password123')
  const { data: session } = await owner.auth.getSession()
  return seedMerchant({ slug, owner_id: session.session!.user.id })
}

async function seedOrder(merchantId: string) {
  const { data, error } = await serviceClient()
    .from('orders')
    .insert({
      merchant_id: merchantId,
      order_number: `PP-${crypto.randomUUID().slice(0, 8)}`,
      status: 'new',
      customer_name: 'Ah Meng',
      customer_wa: '60123456789',
    })
    .select('id')
    .single()
  if (error) throw new Error(`seeding order: ${error.message}`)
  return data!.id as string
}

function post(orderId: string, body: Uint8Array | string, contentType: string) {
  return app.request(`/api/orders/${orderId}/payment-proof`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  })
}

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function get(path: string, token?: string) {
  return app.request(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

const written: string[] = []
afterAll(async () => {
  if (written.length) await serviceClient().storage.from(BUCKET).remove(written)
})

describe('POST /api/orders/:orderId/payment-proof', () => {
  it('uploads the image, stores it under {merchant_id}/{order_id}.png, and stamps the order row', async () => {
    const merchantId = await shopWithOwner('pp-shop')
    const orderId = await seedOrder(merchantId)
    written.push(`${merchantId}/${orderId}.png`)

    const res = await post(orderId, PNG_1X1, 'image/png')
    expect(res.status).toBe(200)

    const { data: order } = await serviceClient().from('orders').select('payment_proof').eq('id', orderId).single()
    expect(order!.payment_proof).toBe(`${merchantId}/${orderId}.png`)

    const { data: file, error } = await serviceClient().storage.from(BUCKET).download(order!.payment_proof)
    expect(error).toBeNull()
    expect(file!.size).toBe(PNG_1X1.byteLength)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('a second upload replaces the first (upsert), not accumulates', async () => {
    const merchantId = await shopWithOwner('pp-replace-shop')
    const orderId = await seedOrder(merchantId)
    written.push(`${merchantId}/${orderId}.png`)

    await post(orderId, PNG_1X1, 'image/png')
    const SECOND = Uint8Array.from([...PNG_1X1, 0, 0, 0, 0])
    const res = await post(orderId, SECOND, 'image/png')
    expect(res.status).toBe(200)

    const { data: order } = await serviceClient().from('orders').select('payment_proof').eq('id', orderId).single()
    const { data: file } = await serviceClient().storage.from(BUCKET).download(order!.payment_proof)
    expect(file!.size).toBe(SECOND.byteLength)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('400s on an unsupported content type and writes nothing', async () => {
    const merchantId = await shopWithOwner('pp-badtype-shop')
    const orderId = await seedOrder(merchantId)

    const res = await post(orderId, 'not an image', 'application/pdf')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('unsupported_type')

    const { data: order } = await serviceClient().from('orders').select('payment_proof').eq('id', orderId).single()
    expect(order!.payment_proof).toBeNull()

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('400s on a body over 2 MiB', async () => {
    const merchantId = await shopWithOwner('pp-toobig-shop')
    const orderId = await seedOrder(merchantId)

    const big = new Uint8Array(2 * 1024 * 1024 + 1)
    const res = await post(orderId, big, 'image/png')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('too_large')

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('404s for an order id that does not exist', async () => {
    const res = await post('00000000-0000-0000-0000-000000000000', PNG_1X1, 'image/png')
    expect(res.status).toBe(404)
  })

  // orderMerchantId swallows exactly one error into "not found": Postgres's own 22P02 for an id
  // that isn't a UUID at all. A hand-typed id in the URL is the same failure as a real one that
  // was never placed — this is not the "fail closed on a real DB error" case.
  it('404s for a malformed (non-UUID) order id, same as a missing one', async () => {
    const res = await post('not-a-uuid', PNG_1X1, 'image/png')
    expect(res.status).toBe(404)
  })
})

// Same ownership chain as PATCH /api/merchants/:id/orders/:orderId (requireMerchantOwns +
// requireOwnsChild('orders', ...)) — 401/403/cross-tenant-404 are already exhaustively proven for
// that chain in tests/api/writes-orders.test.ts. These cases cover only what's new here:
// streaming the image back, and 404 when there's nothing to stream.
describe('GET /api/merchants/:id/orders/:orderId/payment-proof', () => {
  it('streams the image back to the owner after an upload', async () => {
    await resetMerchant('pp-read-shop')
    const owner = await makeUser('pp-read-owner@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'pp-read-shop', owner_id: userId })
    const orderId = await seedOrder(merchantId)
    written.push(`${merchantId}/${orderId}.png`)

    await post(orderId, PNG_1X1, 'image/png')
    const res = await get(`/api/merchants/${merchantId}/orders/${orderId}/payment-proof`, token)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.length).toBe(PNG_1X1.byteLength)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('404s when the order has no proof uploaded', async () => {
    await resetMerchant('pp-none-shop')
    const owner = await makeUser('pp-none-owner@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'pp-none-shop', owner_id: userId })
    const orderId = await seedOrder(merchantId)

    const res = await get(`/api/merchants/${merchantId}/orders/${orderId}/payment-proof`, token)
    expect(res.status).toBe(404)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })
})
