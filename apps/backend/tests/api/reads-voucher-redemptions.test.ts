// tests/api/reads-voucher-redemptions.test.ts
// GET /api/merchants/:id/vouchers/:voucherId/redemptions — a voucher's history for its owner.
//
// The load-bearing assertion is an ABSENCE: `voucher_redemptions.customer_key` is the redeemer's
// platform account email, and CONTEXT.md → Shop customer says a shop never sees one. Every row
// here comes from a REAL redemption through `POST /api/orders`, so the key is really in the table
// and the test proves the route leaves it there.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { app } from '../../src/app.js'
import { sql } from '../../src/db.js'
import { makeUser, resetMerchant, seedMerchant, seedProduct, serviceClient } from '../rls/helpers.js'
import { todayInZone, DEFAULT_TIMEZONE } from '@bitetime/shared'

const SLUG = 'vr-shop'
const svc = () => serviceClient()

function tomorrowInShopZone(): string {
  const today = todayInZone(DEFAULT_TIMEZONE, new Date())
  return new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
}

/** 2 × RM13 = 26, less the RM5 voucher = 21. */
function placeOrder(merchantId: string, productId: string, code: string, token: string) {
  return app.request('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      merchantId, customerName: 'Ah Meng', customerWa: '60123456789', mode: 'pickup',
      cart: [{ productId, qty: 2, selections: [] }], quotedTotal: 21,
      fulfilDate: tomorrowInShopZone(), voucherCode: code,
    }),
  })
}

function get(path: string, token?: string) {
  return app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
}

async function seedVoucher(merchantId: string, code: string) {
  const { data, error } = await svc().from('vouchers')
    .insert({ merchant_id: merchantId, code, kind: 'fixed', amount: 5, max_uses: 100, per_customer_limit: null, used_by: [] })
    .select('id').single()
  if (error) throw new Error(`seeding voucher ${code}: ${error.message}`)
  return data!.id as string
}

describe('GET /api/merchants/:id/vouchers/:voucherId/redemptions', () => {
  let shop: string
  let productId: string
  let ownerToken: string
  let customerToken: string
  let strangerToken: string
  let strangerShop: string

  beforeAll(async () => {
    await resetMerchant(SLUG)
    await resetMerchant(`${SLUG}-b`)
    const owner = await makeUser('vr-owner@test.dev', 'password123')
    const customer = await makeUser('vr-customer@test.dev', 'password123')
    const stranger = await makeUser('vr-stranger@test.dev', 'password123')
    ownerToken = (await owner.auth.getSession()).data.session!.access_token
    customerToken = (await customer.auth.getSession()).data.session!.access_token
    strangerToken = (await stranger.auth.getSession()).data.session!.access_token
    shop = await seedMerchant({ slug: SLUG, order_prefix: 'VR', owner_id: (await owner.auth.getUser()).data.user!.id })
    strangerShop = await seedMerchant({ slug: `${SLUG}-b`, owner_id: (await stranger.auth.getUser()).data.user!.id })
  }, 60_000)

  beforeEach(async () => {
    await svc().from('orders').delete().eq('merchant_id', shop)
    await svc().from('order_counters').delete().eq('merchant_id', shop)
    await svc().from('vouchers').delete().eq('merchant_id', shop)
    await svc().from('products').delete().eq('merchant_id', shop)
    productId = await seedProduct({ merchant_id: shop, price: 13 })
  })

  afterAll(async () => {
    await resetMerchant(SLUG)
    await resetMerchant(`${SLUG}-b`)
  })

  it('lists each redemption with its order, newest first, and never the redeemer’s email', async () => {
    const voucherId = await seedVoucher(shop, 'HIST')
    const first = await placeOrder(shop, productId, 'HIST', customerToken)
    expect(first.status).toBe(200)
    const second = await placeOrder(shop, productId, 'HIST', customerToken)
    expect(second.status).toBe(200)
    const secondId = ((await second.json()) as { id: string }).id

    const res = await get(`/api/merchants/${shop}/vouchers/${voucherId}/redemptions`, ownerToken)
    expect(res.status).toBe(200)
    const rows = (await res.json()) as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows[0].order_id).toBe(secondId)
    expect(rows[0].order_number).toMatch(/^VR-/)
    expect(rows[0].customer_name).toBe('Ah Meng')
    expect(Number(rows[0].discount)).toBe(5)
    expect(rows[0].order_status).toBe('new')
    expect(rows[0].voided_at).toBeNull()
    expect(typeof rows[0].redeemed_at).toBe('string')

    // The key IS in the table — this is what the route must leave behind.
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from voucher_redemptions where voucher_id = ${voucherId} and customer_key = 'vr-customer@test.dev'
    `
    expect(n).toBe(2)
    for (const row of rows) {
      expect(row).not.toHaveProperty('customer_key')
      expect(JSON.stringify(row)).not.toMatch(/@/)
    }
  })

  it('marks a cancelled order’s redemption as returned', async () => {
    const voucherId = await seedVoucher(shop, 'CXL')
    const placed = await placeOrder(shop, productId, 'CXL', customerToken)
    const orderId = ((await placed.json()) as { id: string }).id
    await app.request(`/api/merchants/${shop}/orders/${orderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ status: 'cancelled' }),
    })

    const rows = (await (await get(`/api/merchants/${shop}/vouchers/${voucherId}/redemptions`, ownerToken)).json()) as Record<string, unknown>[]
    expect(rows).toHaveLength(1)
    expect(typeof rows[0].voided_at).toBe('string')
    expect(rows[0].order_status).toBe('cancelled')
  })

  it('carries a backfilled row with no order and no timestamp', async () => {
    const voucherId = await seedVoucher(shop, 'OLD')
    await sql`insert into voucher_redemptions (voucher_id, customer_key) values (${voucherId}, '60129999999')`

    const rows = (await (await get(`/api/merchants/${shop}/vouchers/${voucherId}/redemptions`, ownerToken)).json()) as Record<string, unknown>[]
    expect(rows).toHaveLength(1)
    expect(rows[0].order_id).toBeNull()
    expect(rows[0].redeemed_at).toBeNull()
    expect(rows[0]).not.toHaveProperty('customer_key')
  })

  it('404s a voucher nested under a shop that does not own it, 403 a non-owner, 401 anonymous', async () => {
    const voucherId = await seedVoucher(shop, 'GUARD')
    expect((await get(`/api/merchants/${strangerShop}/vouchers/${voucherId}/redemptions`, strangerToken)).status).toBe(404)
    expect((await get(`/api/merchants/${shop}/vouchers/${voucherId}/redemptions`, strangerToken)).status).toBe(403)
    expect((await get(`/api/merchants/${shop}/vouchers/${voucherId}/redemptions`)).status).toBe(401)
  })
})
