// tests/unit/productOrder.test.ts
// The rules PUT /api/merchants/:id/product-order enforces before it touches Postgres. Pure, so
// this runs in `pnpm --filter @bitetime/backend test` with no Supabase and no env.
import { describe, it, expect } from 'vitest'
import { parseProductOrder, MAX_PRODUCT_ORDER_ITEMS } from '../../src/productOrder.js'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('parseProductOrder', () => {
  it('accepts a well-formed list', () => {
    const r = parseProductOrder({
      items: [
        { id: uuid(1), sort: 0, category_id: 'c1' },
        { id: uuid(2), sort: 1, category_id: null },
      ],
    })
    expect(r).toEqual({
      ok: true,
      items: [
        { id: uuid(1), sort: 0, category_id: 'c1' },
        { id: uuid(2), sort: 1, category_id: null },
      ],
    })
  })

  it('accepts an empty list', () => {
    expect(parseProductOrder({ items: [] })).toEqual({ ok: true, items: [] })
  })

  // A dangling id IS the uncategorized state (ADR 0013), so the shop's own list is never consulted.
  it('accepts a category id that names nothing', () => {
    const r = parseProductOrder({ items: [{ id: uuid(1), sort: 0, category_id: 'long-deleted' }] })
    expect(r.ok).toBe(true)
  })

  // The product form's "no category" is an empty string; the column has no such state.
  it('reads an empty category id as null', () => {
    const r = parseProductOrder({ items: [{ id: uuid(1), sort: 0, category_id: '' }] })
    expect(r).toEqual({ ok: true, items: [{ id: uuid(1), sort: 0, category_id: null }] })
  })

  it('refuses a body that is not an object with an items array', () => {
    expect(parseProductOrder(null)).toEqual({ ok: false, error: 'malformed_body' })
    expect(parseProductOrder({})).toEqual({ ok: false, error: 'malformed_body' })
    expect(parseProductOrder({ items: 'nope' })).toEqual({ ok: false, error: 'malformed_body' })
  })

  it('refuses more items than the cap', () => {
    const items = Array.from({ length: MAX_PRODUCT_ORDER_ITEMS + 1 }, (_, i) => ({
      id: uuid(i), sort: i, category_id: null,
    }))
    expect(parseProductOrder({ items })).toEqual({ ok: false, error: 'too_many_items' })
  })

  // Load-bearing: an id that is not a uuid reaches Postgres as a failing ::uuid cast, which turns
  // a bad request into a 500.
  it('refuses an id that is not a uuid', () => {
    expect(parseProductOrder({ items: [{ id: 'not-a-uuid', sort: 0, category_id: null }] }))
      .toEqual({ ok: false, error: 'malformed_item' })
  })

  it('refuses a sort that is not a non-negative integer', () => {
    for (const sort of [-1, 1.5, '0', null, undefined]) {
      expect(parseProductOrder({ items: [{ id: uuid(1), sort, category_id: null }] }))
        .toEqual({ ok: false, error: 'malformed_item' })
    }
  })

  it('refuses a category id that is neither a string nor null', () => {
    expect(parseProductOrder({ items: [{ id: uuid(1), sort: 0, category_id: 7 }] }))
      .toEqual({ ok: false, error: 'malformed_item' })
  })

  it('refuses an item that is not an object', () => {
    expect(parseProductOrder({ items: ['x'] })).toEqual({ ok: false, error: 'malformed_item' })
  })

  // Two rows naming one product would make the update's result depend on scan order.
  it('refuses the same product twice', () => {
    expect(parseProductOrder({
      items: [{ id: uuid(1), sort: 0, category_id: null }, { id: uuid(1), sort: 1, category_id: null }],
    })).toEqual({ ok: false, error: 'duplicate_item' })
  })
})
