// tests/api/writes-products.test.ts
// PUT/DELETE /api/merchants/:id/products/:productId — product upsert/delete. The load-bearing
// assertion is tenancy: requireMerchantOwns only proves the caller owns :id — it says nothing
// about whether :productId actually belongs to that shop. An owner of shop A nesting shop B's
// product under :id = A must be refused, not silently allowed to touch (or delete) a stranger's
// row. See CLAUDE.md → Backend, Global Constraint 2.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { app } from '../../src/app.js'
import { revokeProArtifacts } from '../../src/billing.js'
import { makeUser, seedMerchant, seedProduct, serviceClient, resetMerchant } from '../rls/helpers.js'

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function patch(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
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

function del(path: string, token?: string) {
  return app.request(path, {
    method: 'DELETE',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

type ProductRow = { id: string; merchant_id: string; name: string; price: number }

describe('PUT /api/merchants/:id/products/:productId', () => {
  it('upserts a product for the owner, forcing merchant_id from the route', async () => {
    await resetMerchant('prod-owner-shop')
    const owner = await makeUser('prod-owner@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'prod-owner-shop', owner_id: userId })
    const productId = crypto.randomUUID()

    const res = await put(`/api/merchants/${id}/products/${productId}`, {
      name: 'Brown Butter Cookie',
      price: 12.5,
      unit: 'pcs',
      active: true,
    }, token)

    expect(res.status).toBe(200)
    const row = (await res.json()) as ProductRow
    expect(row.id).toBe(productId)
    expect(row.merchant_id).toBe(id)
    expect(row.name).toBe('Brown Butter Cookie')

    await serviceClient().from('products').delete().eq('id', productId)
    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('ignores a client-supplied merchant_id (forced from :id)', async () => {
    await resetMerchant('prod-evil-shop')
    const owner = await makeUser('prod-evil-owner@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'prod-evil-shop', owner_id: userId })
    const productId = crypto.randomUUID()

    const res = await put(`/api/merchants/${id}/products/${productId}`, {
      name: 'Sneaky Item',
      price: 1,
      merchant_id: '00000000-0000-0000-0000-000000000000',
    }, token)

    expect(res.status).toBe(200)
    const row = (await res.json()) as ProductRow
    expect(row.merchant_id).toBe(id)

    await serviceClient().from('products').delete().eq('id', productId)
    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('403 for a non-owner', async () => {
    await resetMerchant('prod-a-shop')
    const owner = await makeUser('prod-a-owner@example.com', 'password123')
    const { userId: ownerId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'prod-a-shop', owner_id: ownerId })

    const other = await makeUser('prod-a-other@example.com', 'password123')
    const { token: otherToken } = await tokenOf(other)

    const res = await put(`/api/merchants/${id}/products/${crypto.randomUUID()}`, { name: 'x', price: 1 }, otherToken)
    expect(res.status).toBe(403)

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('401 without a token', async () => {
    await resetMerchant('prod-anon-shop')
    const owner = await makeUser('prod-anon-owner@example.com', 'password123')
    const { userId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'prod-anon-shop', owner_id: userId })

    const res = await put(`/api/merchants/${id}/products/${crypto.randomUUID()}`, { name: 'x', price: 1 })
    expect(res.status).toBe(401)

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // The other half: over-blocking the shared endpoint would break ordinary product management
  // for every basic shop, which is user story 4. An edit that touches no promo field succeeds.
  it('lets a basic shop edit non-promo fields', async () => {
    await resetMerchant('prod-basic-plain-shop')
    const owner = await makeUser('prod-basic-plain@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'prod-basic-plain-shop', owner_id: userId })
    const productId = crypto.randomUUID()

    const res = await put(`/api/merchants/${id}/products/${productId}`, {
      name: 'Plain Cookie', price: 9, unit: 'pcs', active: true,
    }, token)

    expect(res.status).toBe(200)
    const row = (await res.json()) as ProductRow
    expect(row.name).toBe('Plain Cookie')

    // An explicit promo_price: null is "no promo" — the shape the frontend sends when a Pro
    // shop clears a sale — and must not be mistaken for an attempt to set one.
    const clearing = await put(`/api/merchants/${id}/products/${productId}`, {
      name: 'Plain Cookie', price: 9, promo_price: null,
    }, token)
    expect(clearing.status).toBe(200)

    await serviceClient().from('products').delete().eq('id', productId)
    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // The gate compares against the STORED row, so an ex-Pro shop — one that dropped to basic with a
  // promo still set — can keep managing that product. Renaming it resubmits the promo columns
  // unchanged (the dashboard spreads the whole row), and unchanged is not a request for a Pro
  // feature. Refusing here, or letting the client omit the columns to get past a presence check,
  // is how a shop's live sale ends up silently gone behind a success toast (#145).
  it('lets a basic shop rename a product without losing its promo', async () => {
    await resetMerchant('prod-expro-rename-shop')
    const owner = await makeUser('prod-expro-rename@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'prod-expro-rename-shop', owner_id: userId })
    const promoEnd = '2030-01-01T15:59:59.999Z'
    const productId = await seedProduct({
      merchant_id: id, name: 'Legacy Promo Cookie', price: 12,
      promo_price: 8, promo_limit: 10, promo_end: promoEnd,
    })

    const res = await put(`/api/merchants/${id}/products/${productId}`, {
      name: 'Renamed Cookie', price: 12,
      promo_price: 8, promo_limit: 10, promo_end: promoEnd,
    }, token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient()
      .from('products').select('name, promo_price, promo_limit, promo_end').eq('id', productId).single()
    expect(data!.name).toBe('Renamed Cookie')
    expect(Number(data!.promo_price)).toBe(8)
    expect(data!.promo_limit).toBe(10)
    expect(Date.parse(data!.promo_end)).toBe(Date.parse(promoEnd))

    await serviceClient().from('products').delete().eq('id', productId)
    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('lets a pro shop set a promo', async () => {
    await resetMerchant('prod-pro-promo-shop')
    const owner = await makeUser('prod-pro-promo@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'prod-pro-promo-shop', owner_id: userId })
    const productId = crypto.randomUUID()

    const res = await put(`/api/merchants/${id}/products/${productId}`, {
      name: 'Discounted Cookie', price: 12, promo_price: 8, promo_limit: 10,
    }, token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient()
      .from('products').select('promo_price').eq('id', productId).single()
    expect(Number(data!.promo_price)).toBe(8)

    await serviceClient().from('products').delete().eq('id', productId)
    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // Load-bearing: .upsert() conflict-resolves on the primary key (id), so without a tenancy
  // check an owner of shop A could nest shop B's productId under :id = A and have it UPDATEd
  // in place — including merchant_id reassigned to A, a cross-tenant takeover. Product ids are
  // enumerable via the public GET /api/merchants/:id/products. See CLAUDE.md → Global Constraint 2.
  it('404s and leaves the row intact when the product belongs to a different shop', async () => {
    await resetMerchant('prod-put-tenant-a')
    await resetMerchant('prod-put-tenant-b')
    const ownerA = await makeUser('prod-put-tenant-a-owner@example.com', 'password123')
    const { token: tokenA, userId: ownerAId } = await tokenOf(ownerA)
    const shopA = await seedMerchant({ slug: 'prod-put-tenant-a', owner_id: ownerAId })

    const ownerB = await makeUser('prod-put-tenant-b-owner@example.com', 'password123')
    const { userId: ownerBId } = await tokenOf(ownerB)
    const shopB = await seedMerchant({ slug: 'prod-put-tenant-b', owner_id: ownerBId })
    const productB = await seedProduct({ merchant_id: shopB, name: 'Shop B Cookie', price: 7 })

    const res = await put(`/api/merchants/${shopA}/products/${productB}`, { name: 'Hijacked', price: 999 }, tokenA)
    expect(res.status).toBe(404)

    const { data } = await serviceClient()
      .from('products').select('id, merchant_id, name, price').eq('id', productB).single()
    expect(data!.merchant_id).toBe(shopB)
    expect(data!.name).toBe('Shop B Cookie')
    expect(data!.price).toBe(7)

    await serviceClient().from('products').delete().eq('id', productB)
    await serviceClient().from('merchants').delete().eq('id', shopA)
    await serviceClient().from('merchants').delete().eq('id', shopB)
  })
})

describe('DELETE /api/merchants/:id/products/:productId', () => {
  it('deletes the owner’s own product', async () => {
    await resetMerchant('prod-del-shop')
    const owner = await makeUser('prod-del-owner@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'prod-del-shop', owner_id: userId })
    const productId = await seedProduct({ merchant_id: id, name: 'Doomed Cookie', price: 5 })

    const res = await del(`/api/merchants/${id}/products/${productId}`, token)
    expect(res.status).toBe(200)

    const { data } = await serviceClient().from('products').select('id').eq('id', productId).maybeSingle()
    expect(data).toBeNull()

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // Load-bearing: an owner of shop A cannot delete shop B's product by nesting it under
  // :id = A. requireMerchantOwns only proves ownership of :id; the handler must separately
  // verify the product's own merchant_id before deleting it.
  it('404s and leaves the row intact when the product belongs to a different shop', async () => {
    await resetMerchant('prod-tenant-a')
    await resetMerchant('prod-tenant-b')
    const ownerA = await makeUser('prod-tenant-a-owner@example.com', 'password123')
    const { token: tokenA, userId: ownerAId } = await tokenOf(ownerA)
    const shopA = await seedMerchant({ slug: 'prod-tenant-a', owner_id: ownerAId })

    const ownerB = await makeUser('prod-tenant-b-owner@example.com', 'password123')
    const { userId: ownerBId } = await tokenOf(ownerB)
    const shopB = await seedMerchant({ slug: 'prod-tenant-b', owner_id: ownerBId })
    const productB = await seedProduct({ merchant_id: shopB, name: 'Shop B Cookie', price: 7 })

    const res = await del(`/api/merchants/${shopA}/products/${productB}`, tokenA)
    expect(res.status).toBe(404)

    const { data } = await serviceClient().from('products').select('id, merchant_id').eq('id', productB).single()
    expect(data!.merchant_id).toBe(shopB)

    await serviceClient().from('products').delete().eq('id', productB)
    await serviceClient().from('merchants').delete().eq('id', shopA)
    await serviceClient().from('merchants').delete().eq('id', shopB)
  })

  it('403 for a non-owner', async () => {
    await resetMerchant('prod-del-a-shop')
    const owner = await makeUser('prod-del-a-owner@example.com', 'password123')
    const { userId: ownerId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'prod-del-a-shop', owner_id: ownerId })
    const productId = await seedProduct({ merchant_id: id, name: 'Guarded Cookie', price: 3 })

    const other = await makeUser('prod-del-a-other@example.com', 'password123')
    const { token: otherToken } = await tokenOf(other)

    const res = await del(`/api/merchants/${id}/products/${productId}`, otherToken)
    expect(res.status).toBe(403)

    await serviceClient().from('products').delete().eq('id', productId)
    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('401 without a token', async () => {
    await resetMerchant('prod-del-anon-shop')
    const owner = await makeUser('prod-del-anon-owner@example.com', 'password123')
    const { userId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'prod-del-anon-shop', owner_id: userId })
    const productId = await seedProduct({ merchant_id: id, name: 'Anon Cookie', price: 3 })

    const res = await del(`/api/merchants/${id}/products/${productId}`)
    expect(res.status).toBe(401)

    await serviceClient().from('products').delete().eq('id', productId)
    await serviceClient().from('merchants').delete().eq('id', id)
  })
})

// Menu options ride the same shared endpoint as promos and are gated the same way (#145,
// ADR 0010). The gate asks whether the groups CHANGED, never whether the column is present —
// a shop that dropped to basic still has groups on its rows and the dashboard resubmits the
// whole row, so presence would refuse an ordinary rename.
describe('PUT /api/merchants/:id/products/:productId — option groups', () => {
  const MILK = [{
    id: 'milk', name: 'Milk', minSelect: 1, maxSelect: 1, maxPerOption: 1, active: true,
    options: [
      { id: 'regular', name: 'Regular', delta: 0, active: true },
      { id: 'oat', name: 'Oat', delta: 2, active: true },
    ],
  }]

  // TWO shops, made once. `merchants_owner_id_key` makes a shop's owner unique (one owner, one shop), so a shop per
  // test is an auth account per test; and `makeUser` lists every user before creating one, so
  // each account a suite adds permanently widens that race for the suites vitest runs beside it.
  let basic: { id: string; token: string }
  let pro: { id: string; token: string }

  async function makeShop(slug: string, email: string) {
    await resetMerchant(slug)
    const owner = await makeUser(email, 'password123')
    const { token, userId } = await tokenOf(owner)
    return { id: await seedMerchant({ slug, owner_id: userId }), token }
  }

  beforeAll(async () => {
    basic = await makeShop('opt-basic-shop', 'opt-basic@example.com')
    pro = await makeShop('opt-pro-shop', 'opt-pro@example.com')
  })

  afterAll(async () => {
    await resetMerchant('opt-basic-shop')
    await resetMerchant('opt-pro-shop')
  })

  /** Seeded straight into the row, without going through the route. */
  async function seedWithGroups(merchantId: string, productId: string) {
    await serviceClient().from('products')
      .insert({ id: productId, merchant_id: merchantId, name: 'Latte', price: 10, option_groups: MILK })
  }

  it('lets a shop add option groups', async () => {
    const productId = crypto.randomUUID()
    const res = await put(`/api/merchants/${basic.id}/products/${productId}`, {
      name: 'Latte', price: 10, option_groups: MILK,
    }, basic.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient()
      .from('products').select('option_groups').eq('id', productId).single()
    expect(data!.option_groups).toEqual(MILK)
  })

  it('lets a shop rename a product while resubmitting its unchanged groups', async () => {
    const productId = crypto.randomUUID()
    await seedWithGroups(basic.id, productId)

    const res = await put(`/api/merchants/${basic.id}/products/${productId}`, {
      name: 'Flat White', price: 10, option_groups: MILK,
    }, basic.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient()
      .from('products').select('name, option_groups').eq('id', productId).single()
    expect(data!.name).toBe('Flat White')
    expect(data!.option_groups).toEqual(MILK)
  })

  it('lets a shop clear its groups', async () => {
    const productId = crypto.randomUUID()
    await seedWithGroups(basic.id, productId)

    const res = await put(`/api/merchants/${basic.id}/products/${productId}`, {
      name: 'Latte', price: 10, option_groups: [],
    }, basic.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient()
      .from('products').select('option_groups').eq('id', productId).single()
    expect(data!.option_groups).toEqual([])
  })

  // ADR 0008 traded every check constraint for the atomic save and appointed
  // `validateOptionGroups` as the sole replacement. It must ANSWER, not throw, on a body
  // nothing has checked.
  it('400s a Pro shop’s impossible or malformed groups instead of storing them', async () => {
    const productId = crypto.randomUUID()

    const impossible = await put(`/api/merchants/${pro.id}/products/${productId}`, {
      name: 'Box', price: 30, option_groups: [{ ...MILK[0], minSelect: 9, maxSelect: 2 }],
    }, pro.token)
    expect(impossible.status).toBe(400)
    expect(await impossible.json()).toEqual({ error: 'impossible_window' })

    const malformed = await put(`/api/merchants/${pro.id}/products/${productId}`, {
      name: 'Box', price: 30, option_groups: [{}],
    }, pro.token)
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({ error: 'malformed_group' })

    const { data } = await serviceClient().from('products').select('id').eq('id', productId).maybeSingle()
    expect(data).toBeNull()
  })

  it('lets a Pro shop save a legal set of groups', async () => {
    const productId = crypto.randomUUID()
    const res = await put(`/api/merchants/${pro.id}/products/${productId}`, {
      name: 'Latte', price: 10, option_groups: MILK,
    }, pro.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient()
      .from('products').select('option_groups').eq('id', productId).single()
    expect(data!.option_groups).toEqual(MILK)
  })
})

// Menu categories (ADR 0013) are Pro on BOTH endpoints they touch, and the gate is the same
// shape as the option-groups one above: it asks whether the value CHANGED, never whether the
// body contained it. The two are tested together because they are one feature — a merchant can
// only file a product into a section their shop is allowed to have.
describe('menu categories — both endpoints', () => {
  const CAKES = [{ id: 'c1', name: 'Cakes', name_zh: '蛋糕', active: true }]

  let basic: { id: string; token: string }
  let pro: { id: string; token: string }

  async function makeShop(slug: string, email: string) {
    await resetMerchant(slug)
    const owner = await makeUser(email, 'password123')
    const { token, userId } = await tokenOf(owner)
    return { id: await seedMerchant({ slug, owner_id: userId }), token }
  }

  beforeAll(async () => {
    basic = await makeShop('cat-basic-shop', 'cat-basic@example.com')
    pro = await makeShop('cat-pro-shop', 'cat-pro@example.com')
  })

  afterAll(async () => {
    await resetMerchant('cat-basic-shop')
    await resetMerchant('cat-pro-shop')
  })

  /** Seeded straight into the row, without going through the route. */
  async function seedCategories(merchantId: string) {
    await serviceClient().from('merchants').update({ product_categories: CAKES }).eq('id', merchantId)
  }

  it('lets a shop author its categories', async () => {
    const res = await patch(`/api/merchants/${basic.id}`, { product_categories: CAKES }, basic.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient()
      .from('merchants').select('product_categories').eq('id', basic.id).single()
    expect(data!.product_categories).toEqual(CAKES)
  })

  // ShopSettings resubmits a whole config bag, so an unchanged category list must ride along with
  // an ordinary shipping or tax edit without disturbing anything.
  it('lets a shop edit its config while resubmitting unchanged categories', async () => {
    await seedCategories(basic.id)

    const res = await patch(`/api/merchants/${basic.id}`, {
      product_categories: CAKES, tax_rate: 6, tax_enabled: true,
    }, basic.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient()
      .from('merchants').select('product_categories, tax_rate').eq('id', basic.id).single()
    expect(data!.product_categories).toEqual(CAKES)
    expect(Number(data!.tax_rate)).toBe(6)
  })

  it('lets a shop clear its categories', async () => {
    await seedCategories(basic.id)

    const res = await patch(`/api/merchants/${basic.id}`, { product_categories: [] }, basic.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient()
      .from('merchants').select('product_categories').eq('id', basic.id).single()
    expect(data!.product_categories).toEqual([])
  })

  // ADR 0013 traded every check constraint for a write path that already existed and appointed
  // `validateMenuCategories` as the sole replacement. It must ANSWER, not throw, on a body
  // nothing has checked.
  it('400s a Pro shop’s duplicate or malformed categories instead of storing them', async () => {
    const dupe = await patch(`/api/merchants/${pro.id}`, {
      product_categories: [...CAKES, { id: 'c2', name: 'CAKES', active: true }],
    }, pro.token)
    expect(dupe.status).toBe(400)
    expect(await dupe.json()).toEqual({ error: expect.stringContaining('duplicate_category_name') })

    const malformed = await patch(`/api/merchants/${pro.id}`, {
      product_categories: [{}],
    }, pro.token)
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({ error: expect.stringContaining('malformed_category') })

    const { data } = await serviceClient()
      .from('merchants').select('product_categories').eq('id', pro.id).single()
    expect(data!.product_categories).toEqual([])
  })

  it('lets a Pro shop save, reorder and hide its categories', async () => {
    const two = [...CAKES, { id: 'c2', name: 'Tea', active: true }]
    expect((await patch(`/api/merchants/${pro.id}`, { product_categories: two }, pro.token)).status).toBe(200)

    // Array order IS display order, so a reorder is a real write and must land as sent.
    const reordered = [two[1], two[0]]
    expect((await patch(`/api/merchants/${pro.id}`, { product_categories: reordered }, pro.token)).status).toBe(200)

    const { data } = await serviceClient()
      .from('merchants').select('product_categories').eq('id', pro.id).single()
    expect(data!.product_categories).toEqual(reordered)
  })

  it('lets a shop file a product into a category', async () => {
    const productId = crypto.randomUUID()
    const res = await put(`/api/merchants/${basic.id}/products/${productId}`, {
      name: 'Roll', price: 10, category_id: 'c1',
    }, basic.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient()
      .from('products').select('category_id').eq('id', productId).single()
    expect(data!.category_id).toBe('c1')
  })

  // `null` and an absent column are ONE state — uncategorized — so an ordinary unfiled product
  // still saves.
  it('lets a shop save an uncategorized product', async () => {
    const productId = crypto.randomUUID()
    const res = await put(`/api/merchants/${basic.id}/products/${productId}`, {
      name: 'Roll', price: 10, category_id: null,
    }, basic.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient()
      .from('products').select('category_id').eq('id', productId).single()
    expect(data!.category_id).toBeNull()
  })

  it('lets a shop rename a product while resubmitting its unchanged category', async () => {
    const productId = crypto.randomUUID()
    await serviceClient().from('products')
      .insert({ id: productId, merchant_id: basic.id, name: 'Roll', price: 10, category_id: 'c1' })

    const res = await put(`/api/merchants/${basic.id}/products/${productId}`, {
      name: 'Swiss Roll', price: 10, category_id: 'c1',
    }, basic.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient()
      .from('products').select('name, category_id').eq('id', productId).single()
    expect(data!.name).toBe('Swiss Roll')
    expect(data!.category_id).toBe('c1')
  })

  // A shop deletes a category; its products keep the dead id. Renaming one of those products
  // must save, dangling id and all — a dangling id IS the uncategorized state, not an error.
  it('lets a shop rename a product carrying a DANGLING category id', async () => {
    const productId = crypto.randomUUID()
    await serviceClient().from('products')
      .insert({ id: productId, merchant_id: basic.id, name: 'Roll', price: 10, category_id: 'deleted-cat' })

    const res = await put(`/api/merchants/${basic.id}/products/${productId}`, {
      name: 'Swiss Roll', price: 10, category_id: 'deleted-cat',
    }, basic.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient()
      .from('products').select('name, category_id').eq('id', productId).single()
    expect(data!.name).toBe('Swiss Roll')
    expect(data!.category_id).toBe('deleted-cat')
  })

  it('lets a shop unfile a product carrying a dangling category id', async () => {
    const productId = crypto.randomUUID()
    await serviceClient().from('products')
      .insert({ id: productId, merchant_id: basic.id, name: 'Roll', price: 10, category_id: 'deleted-cat' })

    const res = await put(`/api/merchants/${basic.id}/products/${productId}`, {
      name: 'Swiss Roll', price: 10, category_id: null,
    }, basic.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient()
      .from('products').select('name, category_id').eq('id', productId).single()
    expect(data!.name).toBe('Swiss Roll')
    expect(data!.category_id).toBeNull()
  })

  // Nothing checks a product's category id against the shop's list, on purpose: a stale
  // dashboard filing into a just-deleted category must save, because a dangling id IS the
  // uncategorized state rather than an error. Refusing it would turn the delete story inside out.
  it('accepts a category id the shop no longer holds', async () => {
    const productId = crypto.randomUUID()
    const res = await put(`/api/merchants/${pro.id}/products/${productId}`, {
      name: 'Ghost', price: 10, category_id: 'long-deleted',
    }, pro.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient()
      .from('products').select('category_id').eq('id', productId).single()
    expect(data!.category_id).toBe('long-deleted')
  })
})

// The downgrade half of ADR 0013, which nothing else exercises: `revokeProArtifacts` is what a
// step down to Basic runs, and its category clause is the one that must HIDE without dismantling.
describe('revokeProArtifacts — menu categories', () => {
  let shop: string
  let productId: string

  beforeAll(async () => {
    await resetMerchant('cat-revoke-shop')
    const owner = await makeUser('cat-revoke@example.com', 'password123')
    const { userId } = await tokenOf(owner)
    shop = await seedMerchant({ slug: 'cat-revoke-shop', owner_id: userId })
    productId = crypto.randomUUID()
    await serviceClient().from('products')
      .insert({ id: productId, merchant_id: shop, name: 'Roll', price: 10, active: true, category_id: 'c1' })
  })

  afterAll(async () => { await resetMerchant('cat-revoke-shop') })

  it('hides every category, keeps the list, and takes NO product off sale', async () => {
    await serviceClient().from('merchants').update({
      product_categories: [
        { id: 'c1', name: 'Cakes', name_zh: '蛋糕', active: true },
        { id: 'c2', name: 'Tea', active: true },
      ],
    }).eq('id', shop)

    await revokeProArtifacts(shop)

    const { data } = await serviceClient()
      .from('merchants').select('product_categories').eq('id', shop).single()
    // Hidden, never deleted — names, Chinese names and ORDER all survive, because a shop that
    // stopped paying must be downgraded rather than dismantled.
    expect(data!.product_categories).toEqual([
      { id: 'c1', name: 'Cakes', name_zh: '蛋糕', active: false },
      { id: 'c2', name: 'Tea', active: false },
    ])

    // A category is decoration, not a fulfilment requirement — unlike a required option group,
    // it takes nothing off sale. The product keeps its id and falls to the trailing block.
    const { data: p } = await serviceClient()
      .from('products').select('active, category_id').eq('id', productId).single()
    expect(p!.active).toBe(true)
    expect(p!.category_id).toBe('c1')
  })

  // A replayed webhook must not re-hide a category the merchant has since switched back on —
  // the same property the voucher revoke gets from filtering on `active = true`.
  it('is idempotent: a replay leaves a re-shown category alone', async () => {
    await serviceClient().from('merchants').update({
      product_categories: [{ id: 'c1', name: 'Cakes', active: false }],
    }).eq('id', shop)
    // The merchant is Basic and switches one back on (they cannot, but a re-upgrade then a
    // second lapse reaches the same state — this asserts the filter, not the UI).
    await serviceClient().from('merchants').update({
      product_categories: [{ id: 'c1', name: 'Cakes', active: false }, { id: 'c2', name: 'Tea', active: true }],
    }).eq('id', shop)

    await revokeProArtifacts(shop)
    await revokeProArtifacts(shop)

    const { data } = await serviceClient()
      .from('merchants').select('product_categories').eq('id', shop).single()
    expect(data!.product_categories).toEqual([
      { id: 'c1', name: 'Cakes', active: false },
      { id: 'c2', name: 'Tea', active: false },
    ])
  })

  it('does nothing to a shop that never authored a category', async () => {
    await serviceClient().from('merchants').update({ product_categories: [] }).eq('id', shop)
    await revokeProArtifacts(shop)
    const { data } = await serviceClient()
      .from('merchants').select('product_categories').eq('id', shop).single()
    expect(data!.product_categories).toEqual([])
  })
})
