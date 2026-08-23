// tests/api/reads-public.test.ts
// Public (tokenless) reads for the storefront. Two things are load-bearing: the by-slug shape
// must NOT leak owner_id/referred_by_code, and the endpoints must return a clean 200 (so the
// client can tell "shop has none" from "could not ask" — the 5xx path is the client's null).
import { describe, it, expect, beforeAll } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, seedProduct, serviceClient } from '../rls/helpers.js'

function get(path: string) {
  return app.request(path)
}

describe('public reads', () => {
  let shopId: string

  beforeAll(async () => {
    const owner = await makeUser('pub-owner@example.com', 'password123')
    const { data: os } = await owner.auth.getSession()
    shopId = await seedMerchant({ slug: 'pub-shop', owner_id: os.session!.user.id })
    await seedProduct({ merchant_id: shopId, name: 'Latte', price: 12 })
    // Seeded WITH redeemers, because the property under test is that they do not come back out.
    await serviceClient().from('vouchers').insert({
      merchant_id: shopId, code: 'PUBTEN', kind: 'flat', amount: 10, max_uses: 5,
      used_by: ['alice@example.com', 'bob@example.com'],
    })
  })

  it('returns a merchant by slug without owner_id or referred_by_code', async () => {
    const res = await get('/api/merchants/pub-shop')
    expect(res.status).toBe(200)
    const m = (await res.json()) as Record<string, unknown>
    expect(m.slug).toBe('pub-shop')
    expect(m).not.toHaveProperty('owner_id')
    expect(m).not.toHaveProperty('referred_by_code')
  })

  it('returns null (200) for an unknown slug', async () => {
    const res = await get('/api/merchants/no-such-shop')
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it('returns the shop products', async () => {
    const res = await get(`/api/merchants/${shopId}/products`)
    expect(res.status).toBe(200)
    const rows = (await res.json()) as Array<{ name: string }>
    expect(rows.some(p => p.name === 'Latte')).toBe(true)
  })

  it('returns a voucher by code, and null for an unknown code', async () => {
    const hit = await get(`/api/merchants/${shopId}/vouchers/PUBTEN`)
    expect(hit.status).toBe(200)
    expect((await hit.json() as { code: string }).code).toBe('PUBTEN')

    const miss = await get(`/api/merchants/${shopId}/vouchers/NOPE`)
    expect(miss.status).toBe(200)
    expect(await miss.json()).toBeNull()
  })

  // This route takes no token and a voucher code is printed on flyers and posters, so anyone who
  // reads one could ask it a question. It used to answer with `select('*')` — the whole row,
  // `used_by` included, which is the ACCOUNT EMAIL of every customer who has redeemed the code.
  //
  // Asserted by scanning the serialised body rather than by naming `used_by`: the failure mode is
  // a field someone adds back later under another name, or a spread of the row, and neither would
  // trip a `not.toHaveProperty('used_by')`.
  it('never returns a redeemer identity to an anonymous caller', async () => {
    const res = await get(`/api/merchants/${shopId}/vouchers/PUBTEN`)
    const body = await res.text()
    expect(body).not.toContain('@example.com')
    expect(body).not.toContain('used_by')

    // And it still says everything the storefront prices from, plus the derived cap.
    const v = JSON.parse(body) as Record<string, unknown>
    expect(v.code).toBe('PUBTEN')
    expect(v.kind).toBe('flat')
    expect(Number(v.amount)).toBe(10)
    expect(v.fully_used).toBe(false)
    // Absent, not false: an anonymous caller was never asked who they are.
    expect(v).not.toHaveProperty('already_used')
  })

  it('returns 500 when the merchant id is a malformed uuid (could-not-ask, not empty)', async () => {
    const products = await get('/api/merchants/not-a-uuid/products')
    expect(products.status).toBe(500)

    const voucher = await get('/api/merchants/not-a-uuid/vouchers/ANYCODE')
    expect(voucher.status).toBe(500)
  })
})

describe('GET /api/merchants/samples', () => {
  let sampleShopId: string
  let suspendedSampleId: string
  let nonSampleId: string

  beforeAll(async () => {
    async function ownerId(email: string) {
      const client = await makeUser(email, 'password123')
      const { data } = await client.auth.getSession()
      return data.session!.user.id
    }

    sampleShopId = await seedMerchant({
      slug: 'sample-active-shop', owner_id: await ownerId('samples-owner-active@example.com'), is_sample: true,
    })
    await seedProduct({ merchant_id: sampleShopId, name: 'Kaya Toast', price: 6, sort: 2 })
    await seedProduct({ merchant_id: sampleShopId, name: 'Milo Dinosaur', price: 8, sort: 1 })
    await seedProduct({ merchant_id: sampleShopId, name: 'Nasi Lemak', price: 10, sort: 3 })
    await seedProduct({ merchant_id: sampleShopId, name: 'Roti Canai', price: 4, sort: 4 })
    await seedProduct({ merchant_id: sampleShopId, name: 'Inactive Item', price: 99, sort: 0, active: false })

    suspendedSampleId = await seedMerchant({
      slug: 'sample-suspended-shop',
      owner_id: await ownerId('samples-owner-suspended@example.com'),
      is_sample: true,
      status: 'suspended',
    })
    await seedProduct({ merchant_id: suspendedSampleId, name: 'Should Not Appear', price: 1 })

    nonSampleId = await seedMerchant({
      slug: 'not-a-sample-shop', owner_id: await ownerId('samples-owner-nonsample@example.com'), is_sample: false,
    })
    await seedProduct({ merchant_id: nonSampleId, name: 'Also Should Not Appear', price: 1 })
  })

  it('returns only active, is_sample=true shops', async () => {
    const res = await get('/api/merchants/samples')
    expect(res.status).toBe(200)
    const rows = (await res.json()) as Array<{ id: string; slug: string }>
    const ids = rows.map(r => r.id)
    expect(ids).toContain(sampleShopId)
    expect(ids).not.toContain(suspendedSampleId)
    expect(ids).not.toContain(nonSampleId)
  })

  it('caps products at 3, ordered by sort, and excludes inactive products', async () => {
    const res = await get('/api/merchants/samples')
    const rows = (await res.json()) as Array<{ id: string; products: Array<{ name: string; nameZh: string | null; price: number; imagePath: string | null }> }>
    const shop = rows.find(r => r.id === sampleShopId)!
    expect(shop.products).toHaveLength(3)
    expect(shop.products.map(p => p.name)).toEqual(['Milo Dinosaur', 'Kaya Toast', 'Nasi Lemak'])
    expect(shop.products.every(p => p.name !== 'Inactive Item')).toBe(true)
    expect(shop.products[0]).toHaveProperty('nameZh')
    expect(shop.products[0]).toHaveProperty('imagePath')
  })

  it('returns null screenshotPath for a shop with no capture yet', async () => {
    const res = await get('/api/merchants/samples')
    const rows = (await res.json()) as Array<{ id: string; screenshotPath: string | null }>
    const shop = rows.find(r => r.id === sampleShopId)!
    expect(shop.screenshotPath).toBeNull()
  })
})
