import { describe, it, expect } from 'vitest'
import { MAX_CART_QTY, MAX_CART_LINES, MAX_CART_ENTRIES } from '@bitetime/shared'
import type { OptionGroup } from '@bitetime/shared'
import { pruneCart, pruneMessage, nextCart, repairCart, cartRefusalMessage } from './cartRules'
import type { Cart } from './cartRules'

const en = (e: string) => e
const zh = (_e: string, z?: string) => z ?? _e

const item = (id: string, active = true, optionGroups: OptionGroup[] = []) =>
  ({ id, active, optionGroups })

const line = (productId: string, qty = 1, selections: Cart[number]['selections'] = []) =>
  ({ productId, qty, selections })

/** The coffee: one milk, oat costs more. */
const milk = (opts = [{ id: 'oat', name: 'Oat', delta: 2, active: true }]): OptionGroup => ({
  id: 'milk', name: 'Milk', minSelect: 1, maxSelect: 1, maxPerOption: 1, active: true,
  options: [{ id: 'regular', name: 'Regular', delta: 0, active: true }, ...opts],
})

const oat = [{ groupId: 'milk', picks: { oat: 1 } }]
const soy = [{ groupId: 'milk', picks: { soy: 1 } }]

describe('pruneCart', () => {
  it('keeps a cart the menu still sells', () => {
    const cart = [line('a', 2), line('b')]
    const r = pruneCart(cart, [item('a'), item('b')])
    expect(r.removed).toBe(0)
    // The same object, so a caller can skip the write entirely rather than re-render for nothing.
    expect(r.cart).toBe(cart)
  })

  it('drops a DEACTIVATED product and can still name it', () => {
    // `active` flipped, so the row is still there — the customer gets a name, not an apology.
    const r = pruneCart([line('a', 2), line('b')], [item('a'), item('b', false)])
    expect(r.cart).toEqual([line('a', 2)])
    expect(r.nameableIds).toEqual(['b'])
    expect(r.unnameable).toBe(0)
  })

  it('drops a DELETED product and admits it cannot name it', () => {
    // Gone from the rows entirely. Never invent the name.
    const r = pruneCart([line('a', 2), line('b')], [item('a')])
    expect(r.cart).toEqual([line('a', 2)])
    expect(r.nameableIds).toEqual([])
    expect(r.unnameable).toBe(1)
  })

  it('splits a mixed prune into what it can name and what it cannot', () => {
    const r = pruneCart([line('a'), line('b'), line('c')], [item('a'), item('b', false)])
    expect(r.cart).toEqual([line('a')])
    expect(r.removed).toBe(2)
    expect(r.nameableIds).toEqual(['b'])
    expect(r.unnameable).toBe(1)
  })

  // One product can now hold SEVERAL lines. All of them go, and the customer is told about the
  // product once — they lost "Latte", not "Latte" twice.
  it('drops every line of a product, and names it once', () => {
    const r = pruneCart([line('a', 1, oat), line('a', 1, soy), line('b')], [item('b')])
    expect(r.cart).toEqual([line('b')])
    expect(r.removed).toBe(1)
    expect(r.nameableIds).toEqual([])
    expect(r.unnameable).toBe(1)
  })

  it('prunes everything when the shop really sells nothing', () => {
    // `{ok:true, data:[]}` is an ANSWER. What must never reach here is a menu that failed to
    // FETCH — that is the caller's call, and why the fetchers report failure rather than [].
    expect(pruneCart([line('a'), line('b', 2)], []).cart).toEqual([])
  })

  it('does not mutate the cart it was given', () => {
    const cart = [line('a'), line('b', 2)]
    pruneCart(cart, [item('a')])
    expect(cart).toEqual([line('a'), line('b', 2)])
  })
})

describe('pruneMessage', () => {
  it('names what it can', () => {
    expect(pruneMessage(['Cookie'], 0, en)).toBe(
      'Removed from your cart — no longer available: Cookie')
  })

  it('apologises for one it cannot name, and counts more than one', () => {
    expect(pruneMessage([], 1, en)).toBe(
      'An item in your cart is no longer available and has been removed.')
    expect(pruneMessage([], 3, en)).toBe(
      '3 items in your cart are no longer available and have been removed.')
  })

  it('says BOTH halves on a mixed prune', () => {
    // Naming what we can and then discarding those names because one line came back unnameable
    // would tell a customer who lost a cake AND a coffee strictly less than we know.
    const m = pruneMessage(['Cookie'], 1, en)
    expect(m).toContain('Cookie')
    expect(m).toContain('An item in your cart is no longer available')
  })

  it('joins several names in the language the customer is reading', () => {
    expect(pruneMessage(['甲', '乙'], 0, zh)).toContain('甲、乙')
  })

  it('says nothing when nothing went', () => {
    expect(pruneMessage([], 0, en)).toBe('')
  })
})

describe('nextCart', () => {
  it('adds, raises and lowers a line', () => {
    expect(nextCart([], line('a'), 1).cart).toEqual([line('a', 1)])
    expect(nextCart([line('a', 2)], line('a'), 1).cart).toEqual([line('a', 3)])
    expect(nextCart([line('a', 2)], line('a'), -1).cart).toEqual([line('a', 1)])
  })

  it('removes the line rather than storing a zero', () => {
    expect(nextCart([line('a', 1), line('b', 2)], line('a'), -1).cart).toEqual([line('b', 2)])
  })

  it('refuses to go below zero, and calls it a no-op', () => {
    expect(nextCart([], line('a'), -1)).toEqual({ refused: 'noop' })
    expect(nextCart([line('b', 1)], line('a'), -1)).toEqual({ refused: 'noop' })
  })

  // Overshooting downwards lands on zero, which REMOVES the line — it is not a no-op, and the
  // difference matters to a caller deciding whether to write state at all.
  it('removes the line when a decrement overshoots', () => {
    expect(nextCart([line('a', 1)], line('a'), -2).cart).toEqual([])
  })

  // The merge rule (ADR 0009): same product AND same selections is one line, so a second add of
  // an oat latte raises the line the customer already has instead of showing it to them twice.
  it('merges an add whose selections match an existing line', () => {
    const r = nextCart([line('a', 1, oat)], { productId: 'a', selections: oat }, 1)
    expect(r.cart).toEqual([line('a', 2, oat)])
  })

  it('keeps lines of one product apart when their selections differ', () => {
    const r = nextCart([line('a', 1, oat)], { productId: 'a', selections: soy }, 1)
    expect(r.cart).toEqual([line('a', 1, oat), line('a', 1, soy)])
  })

  it('stops at the per-item ceiling', () => {
    expect(nextCart([line('a', MAX_CART_QTY)], line('a'), 1).refused).toBe('qty_cap')
  })

  // MAX_CART_QTY is "the most of any ONE PRODUCT", so it binds across that product's lines —
  // otherwise splitting a cart by option would multiply the ceiling.
  it('counts a product across its lines against the per-item ceiling', () => {
    const half = MAX_CART_QTY / 2
    const cart = [line('a', half, oat), line('a', half, soy)]
    expect(nextCart(cart, { productId: 'a', selections: oat }, 1).refused).toBe('qty_cap')
  })

  it('stops at the line ceiling — but only for a NEW product', () => {
    const full: Cart = Array.from({ length: MAX_CART_LINES }, (_, i) => line(`id-${i}`))
    expect(nextCart(full, line('new'), 1).refused).toBe('line_cap')
    // An existing product is never blocked by it.
    expect(nextCart(full, line('id-0'), 1).cart).toBeDefined()
  })

  // Lines are their own dimension now: one product with many option combinations can exhaust the
  // request without ever touching the distinct-product ceiling.
  it('stops at the entry ceiling', () => {
    const full: Cart = Array.from({ length: MAX_CART_ENTRIES }, (_, i) =>
      line('a', 1, [{ groupId: 'milk', picks: { [`o${i}`]: 1 } }]))
    const fresh = { productId: 'a', selections: [{ groupId: 'milk', picks: { late: 1 } }] }
    expect(nextCart(full, fresh, 1).refused).toBe('entry_cap')
  })

  it('does not mutate the cart it was given', () => {
    const cart = [line('a', 1)]
    nextCart(cart, line('a'), 1)
    expect(cart).toEqual([line('a', 1)])
  })
})

describe('repairCart', () => {
  // The `option_unavailable` recovery. `pruneCart` cannot do this: the PRODUCT is still on sale,
  // so nothing is dropped, and without repair the dead pick survives every refresh and every
  // retry is refused identically — the loop the refusal vocabulary exists to prevent.
  // The stale answer always goes. What differs is whether the customer is offered the product
  // again — here Regular is still on the menu, so losing the coffee entirely would be wrong.
  it('takes out a line whose chosen option was switched off, leaving valid ones', () => {
    const withoutOat = milk([{ id: 'oat', name: 'Oat', delta: 2, active: false }])
    const r = repairCart([line('a', 1, oat), line('a', 1, [{ groupId: 'milk', picks: { regular: 1 } }])],
      [item('a', true, [withoutOat])])
    expect(r.cart).toEqual([line('a', 1, [{ groupId: 'milk', picks: { regular: 1 } }])])
    expect(r.reask).toEqual(['a'])
    expect(r.removed).toBe(0)
  })

  it('takes out a line whose chosen option was deleted outright', () => {
    const r = repairCart([line('a', 1, soy)], [item('a', true, [milk()])])
    expect(r.cart).toEqual([])
    expect(r.reask).toEqual(['a'])
  })

  it('takes out a line the merchant made impossible by widening the question', () => {
    const stricter: OptionGroup = { ...milk(), minSelect: 2, maxSelect: 2, maxPerOption: 2 }
    const r = repairCart([line('a', 1, oat)], [item('a', true, [stricter])])
    expect(r.cart).toEqual([])
    // Two milks, cap of two each — the wider question can still be answered.
    expect(r.reask).toEqual(['a'])
  })

  it('leaves a cart the menu still answers', () => {
    const cart = [line('a', 1, oat)]
    const r = repairCart(cart, [item('a', true, [milk()])])
    expect(r.removed).toBe(0)
    expect(r.reask).toEqual([])
    expect(r.cart).toBe(cart)
  })

  // A product that asks nothing cannot have a broken answer, and must survive untouched — most
  // shops on the platform are this shop.
  it('leaves a plain product alone', () => {
    const cart = [line('a', 3)]
    expect(repairCart(cart, [item('a')]).cart).toBe(cart)
  })

  // Spec: the recovery REPAIRS the line by reopening the picker, and falls back to dropping it
  // only when the whole group is dead. Dropping a customer's coffee because one milk ran out —
  // when Regular is still there — is the wrong answer to a menu that merely moved.
  it('asks again for a product that can still be answered', () => {
    const r = repairCart([line('a', 1, soy)], [item('a', true, [milk()])])
    expect(r.cart).toEqual([])   // the stale answer goes either way
    expect(r.reask).toEqual(['a'])
    expect(r.removed).toBe(0)
  })

  // The terminating case. Every milk withdrawn: there is nothing to reopen the picker FOR.
  it('drops, and does not re-ask, when nothing can be picked', () => {
    const dead = { ...milk([]), options: [{ id: 'regular', name: 'Regular', delta: 0, active: false }] }
    const r = repairCart([line('a', 1, oat)], [item('a', true, [dead])])
    expect(r.cart).toEqual([])
    expect(r.reask).toEqual([])
    expect(r.removed).toBe(1)
  })

  it('re-asks each product once, however many of its lines broke', () => {
    const r = repairCart(
      [line('a', 1, soy), line('a', 1, [{ groupId: 'milk', picks: { almond: 1 } }])],
      [item('a', true, [milk()])],
    )
    expect(r.reask).toEqual(['a'])
  })
})

describe('cartRefusalMessage', () => {
  it('turns each ceiling into an instruction naming the number', () => {
    expect(cartRefusalMessage('qty_cap', en)).toContain(String(MAX_CART_QTY))
    expect(cartRefusalMessage('line_cap', en)).toContain(String(MAX_CART_LINES))
    expect(cartRefusalMessage('entry_cap', en)).toContain(String(MAX_CART_ENTRIES))
  })

  it('says nothing for a no-op', () => {
    expect(cartRefusalMessage('noop', en)).toBe('')
  })
})
