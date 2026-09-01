// tests/unit/productCopy.test.ts
// The pure half of Product copy (CONTEXT.md → Product copy): given the source shop's rows and
// the target shop's rows, what exactly lands. Combinatorial cases live here so the DB-backed
// API suite only has to prove the plan is applied, not re-derive it.
import { describe, it, expect } from 'vitest'
import { planProductCopy, parseProductCopy, dropMissingImages, type CopySourceProduct } from '../../src/productCopy.js'
import type { MenuCategory } from '@bitetime/shared'

const TARGET = 'aaaaaaaa-0000-0000-0000-000000000001'

// Deterministic ids so expected values are literals, not recomputations.
function idGen(prefix = 'new') {
  let n = 0
  return () => `${prefix}-${++n}`
}

function srcProduct(over: Partial<CopySourceProduct> = {}): CopySourceProduct {
  return {
    id: 'bbbbbbbb-0000-0000-0000-000000000001',
    name: 'Matcha Cookie',
    name_zh: '抹茶饼干',
    descr: 'Chewy',
    descr_zh: '有嚼劲',
    price: '12.50',
    unit: 'pcs',
    unit_quantity: 1,
    active: true,
    image_urls: [],
    option_groups: [],
    category_id: null,
    promo_price: null,
    promo_limit: null,
    promo_end: null,
    ...over,
  }
}

function plan(over: {
  requestedIds?: string[]
  sourceProducts?: CopySourceProduct[]
  sourceCategories?: MenuCategory[]
  targetCategories?: MenuCategory[]
  targetMaxSort?: number | null
} = {}) {
  const sourceProducts = over.sourceProducts ?? [srcProduct()]
  return planProductCopy({
    requestedIds: over.requestedIds ?? sourceProducts.map(p => p.id),
    sourceProducts,
    sourceCategories: over.sourceCategories ?? [],
    targetCategories: over.targetCategories ?? [],
    targetMerchantId: TARGET,
    targetMaxSort: over.targetMaxSort ?? null,
    newId: idGen(),
  })
}

describe('planProductCopy', () => {
  it('plans one uncategorized product into an empty shop: fresh id, carried fields, sort 0', () => {
    const r = plan()
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(r.plan.rows).toEqual([{
      id: 'new-1',
      merchant_id: TARGET,
      name: 'Matcha Cookie',
      name_zh: '抹茶饼干',
      descr: 'Chewy',
      descr_zh: '有嚼劲',
      price: '12.50',
      unit: 'pcs',
      unit_quantity: 1,
      active: true,
      image_urls: [],
      option_groups: [],
      category_id: null,
      sort: 0,
    }])
    expect(r.plan.categories).toBeNull()
    expect(r.plan.imageCopies).toEqual([])
  })

  it('remaps a category to the target section whose name matches, case- and punctuation-blind', () => {
    const r = plan({
      sourceProducts: [srcProduct({ category_id: 'src-cakes' })],
      sourceCategories: [{ id: 'src-cakes', name: 'Cakes', active: true }],
      targetCategories: [{ id: 'tgt-cakes', name: ' CAKES! ', active: true }],
    })
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(r.plan.rows[0].category_id).toBe('tgt-cakes')
    // The target already holds the section — nothing to write.
    expect(r.plan.categories).toBeNull()
  })

  it('appends a missing section with a fresh id and keeps the target list order', () => {
    const r = plan({
      sourceProducts: [srcProduct({ category_id: 'src-drinks' })],
      sourceCategories: [{ id: 'src-drinks', name: 'Drinks', name_zh: '饮料', active: false }],
      targetCategories: [{ id: 'tgt-cakes', name: 'Cakes', active: true }],
    })
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    // new-1 is the product id; the appended section takes the next mint.
    expect(r.plan.rows[0].category_id).toBe('new-2')
    expect(r.plan.categories).toEqual([
      { id: 'tgt-cakes', name: 'Cakes', active: true },
      // Carried whole, hidden state included: a hidden source section copies hidden.
      { id: 'new-2', name: 'Drinks', name_zh: '饮料', active: false },
    ])
  })

  it('reads a dangling source category id as uncategorized', () => {
    const r = plan({
      sourceProducts: [srcProduct({ category_id: 'gone' })],
      sourceCategories: [],
      targetCategories: [{ id: 'tgt-cakes', name: 'Cakes', active: true }],
    })
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(r.plan.rows[0].category_id).toBeNull()
    expect(r.plan.categories).toBeNull()
  })

  it('appends one section once, however many products point at it', () => {
    const r = plan({
      sourceProducts: [
        srcProduct({ id: 'bbbbbbbb-0000-0000-0000-000000000001', category_id: 'src-drinks' }),
        srcProduct({ id: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Kopi', category_id: 'src-drinks' }),
      ],
      sourceCategories: [{ id: 'src-drinks', name: 'Drinks', active: true }],
    })
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    const appended = r.plan.categories!
    expect(appended).toHaveLength(1)
    expect(r.plan.rows[0].category_id).toBe(appended[0].id)
    expect(r.plan.rows[1].category_id).toBe(appended[0].id)
  })

  it('maps each image into the target prefix and points the new row at the mapped paths', () => {
    const r = plan({
      sourceProducts: [srcProduct({
        image_urls: [
          'src-merchant/src-product/u1-front.jpg',
          'src-merchant/src-product/u2-back.png',
        ],
      })],
    })
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(r.plan.imageCopies).toEqual([
      { from: 'src-merchant/src-product/u1-front.jpg', to: `${TARGET}/new-1/u1-front.jpg` },
      { from: 'src-merchant/src-product/u2-back.png', to: `${TARGET}/new-1/u2-back.png` },
    ])
    expect(r.plan.rows[0].image_urls).toEqual([
      `${TARGET}/new-1/u1-front.jpg`,
      `${TARGET}/new-1/u2-back.png`,
    ])
  })

  it('appends after the target menu and keeps the source render order, whatever order was asked', () => {
    const a = srcProduct({ id: 'bbbbbbbb-0000-0000-0000-000000000001', name: 'First' })
    const b = srcProduct({ id: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Second' })
    const r = plan({
      // Source rows arrive in the source's own render order; the request names them backwards.
      sourceProducts: [a, b],
      requestedIds: [b.id, a.id],
      targetMaxSort: 6,
    })
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(r.plan.rows.map(row => [row.name, row.sort])).toEqual([['First', 7], ['Second', 8]])
  })

  it('never carries a promo: the planned row has no promo columns at all', () => {
    const r = plan({
      sourceProducts: [srcProduct({ promo_price: '9.90', promo_limit: 10, promo_end: '2026-09-01T00:00:00Z' })],
    })
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    const row = r.plan.rows[0] as unknown as Record<string, unknown>
    expect('promo_price' in row).toBe(false)
    expect('promo_limit' in row).toBe(false)
    expect('promo_end' in row).toBe(false)
    expect('promo_sold' in row).toBe(false)
  })

  it('refuses an empty selection', () => {
    expect(plan({ requestedIds: [], sourceProducts: [] }))
      .toEqual({ ok: false, error: 'no_products' })
  })

  it('refuses a selection over the cap', () => {
    const ids = Array.from({ length: 501 }, (_, i) => `id-${i}`)
    expect(plan({ requestedIds: ids })).toEqual({ ok: false, error: 'too_many_products' })
  })

  it('refuses an id the source shop does not hold', () => {
    expect(plan({ requestedIds: ['bbbbbbbb-0000-0000-0000-00000000dead'] }))
      .toEqual({ ok: false, error: 'product_not_in_source' })
  })

  it('refuses a copy that would push the target over the section cap', () => {
    const targetCategories = Array.from({ length: 20 }, (_, i) => (
      { id: `tgt-${i}`, name: `Section ${i}`, active: true }
    ))
    const r = plan({
      sourceProducts: [srcProduct({ category_id: 'src-drinks' })],
      sourceCategories: [{ id: 'src-drinks', name: 'Drinks', active: true }],
      targetCategories,
    })
    expect(r).toEqual({ ok: false, error: 'too_many_categories' })
  })
})

describe('dropMissingImages', () => {
  it('strips only the named target paths, leaving other rows and images alone', () => {
    const r = plan({
      sourceProducts: [
        srcProduct({
          id: 'bbbbbbbb-0000-0000-0000-000000000001',
          image_urls: ['src/p1/a.png', 'src/p1/b.png'],
        }),
        srcProduct({
          id: 'bbbbbbbb-0000-0000-0000-000000000002',
          name: 'Kopi',
          image_urls: ['src/p2/c.png'],
        }),
      ],
    })
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    const rows = dropMissingImages(r.plan.rows, new Set([`${TARGET}/new-1/a.png`]))
    expect(rows[0].image_urls).toEqual([`${TARGET}/new-1/b.png`])
    expect(rows[1].image_urls).toEqual([`${TARGET}/new-2/c.png`])
  })

  it('returns the rows untouched for an empty skip set', () => {
    const r = plan({ sourceProducts: [srcProduct({ image_urls: ['src/p1/a.png'] })] })
    if (!r.ok) throw new Error('plan failed')
    expect(dropMissingImages(r.plan.rows, new Set())).toEqual(r.plan.rows)
  })
})

describe('parseProductCopy', () => {
  const SRC = 'cccccccc-0000-0000-0000-000000000001'
  const TGT = 'cccccccc-0000-0000-0000-000000000002'
  const PID = 'bbbbbbbb-0000-0000-0000-000000000001'

  it('accepts a well-formed request', () => {
    expect(parseProductCopy({ sourceMerchantId: SRC, targetMerchantId: TGT, productIds: [PID] }))
      .toEqual({ ok: true, sourceMerchantId: SRC, targetMerchantId: TGT, productIds: [PID] })
  })

  it.each([
    ['not an object', null],
    ['missing ids', {}],
    ['non-uuid merchant', { sourceMerchantId: 'x', targetMerchantId: TGT, productIds: [PID] }],
    ['non-array productIds', { sourceMerchantId: SRC, targetMerchantId: TGT, productIds: PID }],
    ['non-uuid product id', { sourceMerchantId: SRC, targetMerchantId: TGT, productIds: ['x'] }],
    ['duplicate product id', { sourceMerchantId: SRC, targetMerchantId: TGT, productIds: [PID, PID] }],
  ])('refuses %s as malformed', (_label, body) => {
    expect(parseProductCopy(body)).toEqual({ ok: false, error: 'malformed_body' })
  })

  it('refuses an empty selection and one over the cap before any I/O is owed', () => {
    expect(parseProductCopy({ sourceMerchantId: SRC, targetMerchantId: TGT, productIds: [] }))
      .toEqual({ ok: false, error: 'no_products' })
    const ids = Array.from({ length: 501 }, (_, i) =>
      `bbbbbbbb-0000-0000-0000-${String(i).padStart(12, '0')}`)
    expect(parseProductCopy({ sourceMerchantId: SRC, targetMerchantId: TGT, productIds: ids }))
      .toEqual({ ok: false, error: 'too_many_products' })
  })

  it('refuses copying a shop into itself', () => {
    expect(parseProductCopy({ sourceMerchantId: SRC, targetMerchantId: SRC, productIds: [PID] }))
      .toEqual({ ok: false, error: 'same_shop' })
  })
})
