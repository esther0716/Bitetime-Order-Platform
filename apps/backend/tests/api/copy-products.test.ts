// tests/api/copy-products.test.ts
// POST /api/admin/copy-products — Product copy (CONTEXT.md → Product copy): superadmin-only bulk
// duplication of products from one shop into another. Driven in-process against real Postgres +
// real Storage: the properties under proof — rows landing whole-or-not-at-all, image OBJECTS
// duplicated rather than paths shared, the source shop untouched — are DB and bucket facts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { app } from '../../src/app.js'
import { serviceClient, resetMerchant, seedMerchant, seedProduct, makeUser } from '../rls/helpers.js'

const BUCKET = 'product-images'

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

let superToken = ''
let merchantToken = ''
let sourceId = ''
let targetId = ''

const written: string[] = []
afterAll(async () => {
  if (written.length) await serviceClient().storage.from(BUCKET).remove(written)
})

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return data.session!.access_token
}

function post(body: unknown, token?: string) {
  return app.request('/api/admin/copy-products', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function targetProducts() {
  const { data, error } = await serviceClient()
    .from('products').select('*').eq('merchant_id', targetId)
    .order('sort', { ascending: true })
  if (error) throw new Error(error.message)
  return data!
}

beforeAll(async () => {
  const superUser = await makeUser('copy-super@example.com', 'password123')
  const { data: s } = await superUser.auth.getSession()
  await serviceClient().from('profiles').delete().eq('user_id', s.session!.user.id)
  await serviceClient().from('profiles').insert({
    user_id: s.session!.user.id, name: 'Super', app_role: 'superadmin',
  })
  superToken = s.session!.access_token

  const srcOwner = await makeUser('copy-src-owner@example.com', 'password123')
  const { data: so } = await srcOwner.auth.getSession()
  sourceId = await seedMerchant({ slug: 'copy-src', owner_id: so.session!.user.id })
  merchantToken = await tokenOf(srcOwner)

  const tgtOwner = await makeUser('copy-tgt-owner@example.com', 'password123')
  const { data: to } = await tgtOwner.auth.getSession()
  targetId = await seedMerchant({ slug: 'copy-tgt', owner_id: to.session!.user.id })
}, 60_000)

describe('POST /api/admin/copy-products', () => {
  it('requires a token (401) and refuses a merchant owner and a plain customer (403)', async () => {
    const body = { sourceMerchantId: sourceId, targetMerchantId: targetId, productIds: [crypto.randomUUID()] }
    expect((await post(body)).status).toBe(401)
    expect((await post(body, merchantToken)).status).toBe(403)
    const customer = await makeUser('copy-customer@example.com', 'password123')
    expect((await post(body, await tokenOf(customer))).status).toBe(403)
  })

  it('copies rows, categories, sort and image objects; strips promos; leaves the source untouched', async () => {
    // Source: two sections, three products — one with a real uploaded image, one on promo,
    // one inactive and uncategorized.
    await serviceClient().from('merchants').update({
      product_categories: [
        { id: 'src-cakes', name: 'Cakes', active: true },
        { id: 'src-drinks', name: 'Drinks', name_zh: '饮料', active: true },
      ],
    }).eq('id', sourceId)

    const cake = await seedProduct({
      merchant_id: sourceId, name: 'Burnt Cheesecake', price: 89, sort: 0, category_id: 'src-cakes',
    })
    const imagePath = `${sourceId}/${cake}/u1-cake.png`
    const up = await serviceClient().storage.from(BUCKET).upload(imagePath, PNG_1X1, { contentType: 'image/png' })
    if (up.error) throw new Error(up.error.message)
    written.push(imagePath)
    await serviceClient().from('products').update({
      image_urls: [imagePath], descr_zh: '巴斯克蛋糕',
      option_groups: [{ id: 'g1', name: 'Size', minSelect: 1, maxSelect: 1, maxPerOption: null, active: true, options: [{ id: 'o1', name: 'Whole', delta: 0, active: true }] }],
    }).eq('id', cake)

    const kopi = await seedProduct({
      merchant_id: sourceId, name: 'Kopi', price: 5, sort: 1, category_id: 'src-drinks',
      promo_price: 3.5, promo_limit: 10, promo_end: '2027-01-01T00:00:00Z',
    })
    const retired = await seedProduct({
      merchant_id: sourceId, name: 'Old Special', price: 10, sort: 2, active: false,
    })

    // Target: one existing section whose name matches "Cakes" case-blind, one existing product.
    await serviceClient().from('merchants').update({
      product_categories: [{ id: 'tgt-cakes', name: 'CAKES', active: true }],
    }).eq('id', targetId)
    await seedProduct({ merchant_id: targetId, name: 'House Brownie', price: 12, sort: 0 })

    const res = await post(
      { sourceMerchantId: sourceId, targetMerchantId: targetId, productIds: [cake, kopi, retired] },
      superToken,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, copied: 3 })

    const rows = await targetProducts()
    expect(rows.map((r: any) => [r.name, r.sort])).toEqual([
      ['House Brownie', 0], ['Burnt Cheesecake', 1], ['Kopi', 2], ['Old Special', 3],
    ])

    const copiedCake = rows[1] as any
    // Fresh identity, full field fidelity, descr_zh included.
    expect(copiedCake.id).not.toBe(cake)
    expect(copiedCake.descr_zh).toBe('巴斯克蛋糕')
    expect(copiedCake.option_groups?.[0]?.options?.[0]?.name).toBe('Whole')
    // Remapped into the target's own matching section, not the source's id.
    expect(copiedCake.category_id).toBe('tgt-cakes')
    // The image is a NEW object under the target's own prefix — never the source's path.
    expect(copiedCake.image_urls).toHaveLength(1)
    const newPath = copiedCake.image_urls[0] as string
    expect(newPath.startsWith(`${targetId}/${copiedCake.id}/`)).toBe(true)
    written.push(newPath)
    const dl = await serviceClient().storage.from(BUCKET).download(newPath)
    expect(dl.error).toBeNull()

    const copiedKopi = rows[2] as any
    // Promos are one shop's campaign, never menu data.
    expect(copiedKopi.promo_price).toBeNull()
    expect(copiedKopi.promo_limit).toBeNull()
    expect(copiedKopi.promo_end).toBeNull()
    // Its section had no name match — appended to the target's list, hidden state carried.
    const { data: tgt } = await serviceClient().from('merchants').select('product_categories').eq('id', targetId).single()
    const cats = tgt!.product_categories as any[]
    expect(cats.map(c => c.name)).toEqual(['CAKES', 'Drinks'])
    expect(copiedKopi.category_id).toBe(cats[1].id)

    const copiedRetired = rows[3] as any
    expect(copiedRetired.active).toBe(false)
    expect(copiedRetired.category_id).toBeNull()

    // The source shop is untouched: same rows, same paths, same categories.
    const { data: src } = await serviceClient()
      .from('products').select('id, image_urls').eq('merchant_id', sourceId).order('sort')
    expect(src).toHaveLength(3)
    expect((src![0] as any).image_urls).toEqual([imagePath])
    const { data: srcShop } = await serviceClient()
      .from('merchants').select('product_categories').eq('id', sourceId).single()
    expect((srcShop!.product_categories as any[]).map(c => c.id)).toEqual(['src-cakes', 'src-drinks'])
  }, 30_000)

  it('refuses an id belonging to another shop (product_not_in_source)', async () => {
    const { data: strangerRows } = await serviceClient()
      .from('products').select('id').eq('merchant_id', targetId).limit(1)
    const res = await post(
      { sourceMerchantId: sourceId, targetMerchantId: targetId, productIds: [strangerRows![0].id] },
      superToken,
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'product_not_in_source' })
  })

  it('refuses an unknown merchant with 404', async () => {
    const res = await post(
      { sourceMerchantId: crypto.randomUUID(), targetMerchantId: targetId, productIds: [crypto.randomUUID()] },
      superToken,
    )
    expect(res.status).toBe(404)
  })

  it('refuses a malformed body and a self-copy', async () => {
    expect((await post({ sourceMerchantId: sourceId, targetMerchantId: targetId, productIds: ['x'] }, superToken)).status).toBe(400)
    const self = await post({ sourceMerchantId: sourceId, targetMerchantId: sourceId, productIds: [crypto.randomUUID()] }, superToken)
    expect(self.status).toBe(400)
    expect(await self.json()).toEqual({ error: 'same_shop' })
  })

  it('lands nothing when an image object cannot be copied (whole or not at all)', async () => {
    await resetMerchant('copy-broken')
    const brokenOwner = await makeUser('copy-broken-owner@example.com', 'password123')
    const { data: bo } = await brokenOwner.auth.getSession()
    const brokenId = await seedMerchant({ slug: 'copy-broken', owner_id: bo.session!.user.id })
    const ok = await seedProduct({ merchant_id: brokenId, name: 'Fine', price: 1, sort: 0 })
    const broken = await seedProduct({ merchant_id: brokenId, name: 'Broken', price: 2, sort: 1 })
    // The row claims an object the bucket does not hold — the copy must abort before any insert.
    await serviceClient().from('products')
      .update({ image_urls: [`${brokenId}/${broken}/missing.png`] }).eq('id', broken)

    const before = (await targetProducts()).length
    const res = await post(
      { sourceMerchantId: brokenId, targetMerchantId: targetId, productIds: [ok, broken] },
      superToken,
    )
    expect(res.status).toBe(500)
    expect((await targetProducts()).length).toBe(before)
  }, 30_000)
})
