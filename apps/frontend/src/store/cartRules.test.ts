import { describe, it, expect } from 'vitest'
import { MAX_CART_QTY, MAX_CART_LINES } from '@bitetime/shared'
import { pruneCart, pruneMessage, nextCart, cartRefusalMessage } from './cartRules'

const en = (e: string) => e
const zh = (_e: string, z?: string) => z ?? _e

const item = (id: string, active = true) => ({ id, active })

describe('pruneCart', () => {
  it('keeps a cart the menu still sells', () => {
    const cart = { a: 2, b: 1 }
    const r = pruneCart(cart, [item('a'), item('b')])
    expect(r.removed).toBe(0)
    // The same object, so a caller can skip the write entirely rather than re-render for nothing.
    expect(r.cart).toBe(cart)
  })

  it('drops a DEACTIVATED product and can still name it', () => {
    // `active` flipped, so the row is still there — the customer gets a name, not an apology.
    const r = pruneCart({ a: 2, b: 1 }, [item('a'), item('b', false)])
    expect(r.cart).toEqual({ a: 2 })
    expect(r.nameableIds).toEqual(['b'])
    expect(r.unnameable).toBe(0)
  })

  it('drops a DELETED product and admits it cannot name it', () => {
    // Gone from the rows entirely. Never invent the name.
    const r = pruneCart({ a: 2, b: 1 }, [item('a')])
    expect(r.cart).toEqual({ a: 2 })
    expect(r.nameableIds).toEqual([])
    expect(r.unnameable).toBe(1)
  })

  it('splits a mixed prune into what it can name and what it cannot', () => {
    const r = pruneCart({ a: 1, b: 1, c: 1 }, [item('a'), item('b', false)])
    expect(r.cart).toEqual({ a: 1 })
    expect(r.removed).toBe(2)
    expect(r.nameableIds).toEqual(['b'])
    expect(r.unnameable).toBe(1)
  })

  it('prunes everything when the shop really sells nothing', () => {
    // `{ok:true, data:[]}` is an ANSWER. What must never reach here is a menu that failed to
    // FETCH — that is the caller's call, and why the fetchers report failure rather than [].
    expect(pruneCart({ a: 1, b: 2 }, []).cart).toEqual({})
  })

  it('does not mutate the cart it was given', () => {
    const cart = { a: 1, b: 2 }
    pruneCart(cart, [item('a')])
    expect(cart).toEqual({ a: 1, b: 2 })
  })
})

describe('pruneMessage', () => {
  it('names what it can', () => {
    expect(pruneMessage(['Kopi O'], 0, en))
      .toBe('Removed from your cart — no longer available: Kopi O')
    expect(pruneMessage(['Kopi O'], 0, zh))
      .toBe('已从购物车移除（已下架）：Kopi O')
  })

  it('apologises for one it cannot name, and counts more than one', () => {
    expect(pruneMessage([], 1, en))
      .toBe('An item in your cart is no longer available and has been removed.')
    expect(pruneMessage([], 3, en))
      .toBe('3 items in your cart are no longer available and have been removed.')
  })

  it('says BOTH halves on a mixed prune', () => {
    // The rule this module exists to make assertable. Naming what we can and then throwing those
    // names away because one line came back unnameable would tell a customer who lost a cake and
    // a coffee strictly less than we know — and less than either alone would have been told.
    const msg = pruneMessage(['Cake'], 1, en)
    expect(msg).toContain('Cake')
    expect(msg).toContain('An item in your cart is no longer available')
  })

  it('joins several names in the language the customer is reading', () => {
    expect(pruneMessage(['Kopi O', 'Kaya Toast'], 0, en)).toContain('Kopi O, Kaya Toast')
    // A Chinese enumeration comma, not an ASCII one.
    expect(pruneMessage(['咖啡乌', '咖椰吐司'], 0, zh)).toContain('咖啡乌、咖椰吐司')
  })

  it('says nothing when nothing went', () => {
    expect(pruneMessage([], 0, en)).toBe('')
  })
})

describe('nextCart', () => {
  it('adds, raises and lowers a line', () => {
    expect(nextCart({}, 'a', 1)).toEqual({ cart: { a: 1 } })
    expect(nextCart({ a: 1 }, 'a', 1)).toEqual({ cart: { a: 2 } })
    expect(nextCart({ a: 2 }, 'a', -1)).toEqual({ cart: { a: 1 } })
  })

  it('removes the line rather than storing a zero', () => {
    // A `0` entry would be POSTed, and the backend refuses a cart with one (`invalid_body`).
    expect(nextCart({ a: 1, b: 1 }, 'a', -1)).toEqual({ cart: { b: 1 } })
  })

  it('refuses to go below zero, and calls it a no-op', () => {
    expect(nextCart({}, 'a', -1)).toEqual({ refused: 'noop' })
    expect(nextCart({ a: 0 }, 'a', -1)).toEqual({ refused: 'noop' })
  })

  it('stops at the per-item ceiling', () => {
    expect(nextCart({ a: MAX_CART_QTY - 1 }, 'a', 1)).toEqual({ cart: { a: MAX_CART_QTY } })
    expect(nextCart({ a: MAX_CART_QTY }, 'a', 1)).toEqual({ refused: 'qty_cap' })
  })

  it('stops at the line ceiling — but only for a NEW line', () => {
    // The subtlety worth pinning: only an id that is not in the cart yet can breach the LINE cap,
    // so a full cart can still have its existing lines raised and lowered.
    const full: Record<string, number> = {}
    for (let i = 0; i < MAX_CART_LINES; i++) full[`p${i}`] = 1

    expect(nextCart(full, 'new', 1)).toEqual({ refused: 'line_cap' })
    expect(nextCart(full, 'p0', 1)).toEqual({ cart: { ...full, p0: 2 } })
    expect(nextCart(full, 'p0', -1).cart).not.toHaveProperty('p0')
  })

  it('does not mutate the cart it was given', () => {
    const cart = { a: 1 }
    nextCart(cart, 'b', 1)
    nextCart(cart, 'a', -1)
    expect(cart).toEqual({ a: 1 })
  })
})

describe('cartRefusalMessage', () => {
  it('turns each ceiling into an instruction naming the number', () => {
    expect(cartRefusalMessage('qty_cap', en)).toContain(String(MAX_CART_QTY))
    expect(cartRefusalMessage('line_cap', en)).toContain(String(MAX_CART_LINES))
    expect(cartRefusalMessage('qty_cap', zh)).toContain(String(MAX_CART_QTY))
  })

  it('says nothing for a no-op', () => {
    // Refusing to go below zero is not something the customer did wrong.
    expect(cartRefusalMessage('noop', en)).toBe('')
  })
})
