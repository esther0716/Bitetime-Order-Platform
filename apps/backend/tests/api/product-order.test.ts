// tests/api/product-order.test.ts
// PUT /api/merchants/:id/product-order — the merchant's own arrangement of their own menu.
//
// The load-bearing assertion is tenancy. This route writes through `db.ts`, which is RLS-EXEMPT:
// no policy runs on that connection, so the `p.merchant_id = :id` predicate inside the statement
// is the whole guard. A body naming a stranger's product must change nothing, anywhere.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, seedProduct, serviceClient, resetMerchant } from '../rls/helpers.js'

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function put(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('PUT /api/merchants/:id/product-order', () => {
  let shop: { id: string; token: string }

  beforeAll(async () => {
    await resetMerchant('arrange-shop')
    const owner = await makeUser('arrange-owner@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    shop = { id: await seedMerchant({ slug: 'arrange-shop', owner_id: userId }), token }
  })

  afterAll(async () => {
    await resetMerchant('arrange-shop')
  })

  it('writes sort and category_id, and the public read returns the new order', async () => {
    const first = await seedProduct({ merchant_id: shop.id, name: 'Tea', price: 5 })
    const second = await seedProduct({ merchant_id: shop.id, name: 'Cake', price: 9 })

    const res = await put(`/api/merchants/${shop.id}/product-order`, {
      items: [
        { id: second, sort: 0, category_id: 'c1' },
        { id: first, sort: 1, category_id: null },
      ],
    }, shop.token)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, updated: 2 })

    const list = await app.request(`/api/merchants/${shop.id}/products`)
    const rows = (await list.json()) as { id: string; sort: number; category_id: string | null }[]
    expect(rows.map(r => r.id)).toEqual([second, first])
    expect(rows[0]!.category_id).toBe('c1')
    expect(rows[1]!.category_id).toBeNull()

    await serviceClient().from('products').delete().in('id', [first, second])
  })

  // The merchant deleted the section but not the products in it. The arrangement drops them into
  // the trailing block, and the save is what finally clears the dangling id.
  it('clears a dangling category id when the product moves to the trailing block', async () => {
    const id = await seedProduct({ merchant_id: shop.id, name: 'Orphan', price: 3, category_id: 'long-deleted' })

    const res = await put(`/api/merchants/${shop.id}/product-order`, {
      items: [{ id, sort: 0, category_id: null }],
    }, shop.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient().from('products').select('category_id').eq('id', id).single()
    expect(data!.category_id).toBeNull()

    await serviceClient().from('products').delete().eq('id', id)
  })

  // ADR 0013: the shop's own list is never consulted, so filing into a just-deleted section from a
  // stale dashboard saves rather than 400s.
  it('accepts a category id the shop does not hold', async () => {
    const id = await seedProduct({ merchant_id: shop.id, name: 'Ghost', price: 3 })

    const res = await put(`/api/merchants/${shop.id}/product-order`, {
      items: [{ id, sort: 0, category_id: 'never-existed' }],
    }, shop.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient().from('products').select('category_id').eq('id', id).single()
    expect(data!.category_id).toBe('never-existed')

    await serviceClient().from('products').delete().eq('id', id)
  })

  // THE tenancy test. `db.ts` runs as the database owner and no policy stops this write; only the
  // predicate inside the statement does. Product ids are enumerable from the public product read.
  it('changes nothing when the body names another shop’s product', async () => {
    await resetMerchant('arrange-tenant-b')
    const ownerB = await makeUser('arrange-tenant-b@example.com', 'password123')
    const { userId: ownerBId } = await tokenOf(ownerB)
    const shopB = await seedMerchant({ slug: 'arrange-tenant-b', owner_id: ownerBId })
    const productB = await seedProduct({ merchant_id: shopB, name: 'Shop B Cake', price: 7, sort: 4 })

    const res = await put(`/api/merchants/${shop.id}/product-order`, {
      items: [{ id: productB, sort: 0, category_id: 'hijacked' }],
    }, shop.token)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, updated: 0 })

    const { data } = await serviceClient()
      .from('products').select('merchant_id, sort, category_id').eq('id', productB).single()
    expect(data!.merchant_id).toBe(shopB)
    expect(data!.sort).toBe(4)
    expect(data!.category_id).toBeNull()

    await serviceClient().from('products').delete().eq('id', productB)
    await resetMerchant('arrange-tenant-b')
  })

  it('400s a malformed body without touching a row', async () => {
    const id = await seedProduct({ merchant_id: shop.id, name: 'Safe', price: 3, sort: 2 })

    const res = await put(`/api/merchants/${shop.id}/product-order`, {
      items: [{ id: 'not-a-uuid', sort: 0, category_id: null }],
    }, shop.token)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'malformed_item' })

    const { data } = await serviceClient().from('products').select('sort').eq('id', id).single()
    expect(data!.sort).toBe(2)

    await serviceClient().from('products').delete().eq('id', id)
  })

  it('400s more than 500 items', async () => {
    const items = Array.from({ length: 501 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, sort: i, category_id: null,
    }))
    const res = await put(`/api/merchants/${shop.id}/product-order`, { items }, shop.token)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'too_many_items' })
  })

  it('403 for a non-owner', async () => {
    const other = await makeUser('arrange-other@example.com', 'password123')
    const { token } = await tokenOf(other)
    const res = await put(`/api/merchants/${shop.id}/product-order`, { items: [] }, token)
    expect(res.status).toBe(403)
  })

  it('401 without a token', async () => {
    const res = await put(`/api/merchants/${shop.id}/product-order`, { items: [] })
    expect(res.status).toBe(401)
  })
})
