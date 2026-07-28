import { describe, it, expect } from 'vitest'
import { isCart, MAX_CART_QTY, MAX_CART_LINES, MAX_CART_ENTRIES } from './cart.js'
import type { CartLine } from './options.js'

const ID = '11111111-1111-1111-1111-111111111111'

const line = (productId: string, qty = 1, selections: CartLine['selections'] = []): CartLine =>
  ({ productId, qty, selections })

/** `n` distinct products, one of each. */
const products = (n: number) => Array.from({ length: n }, (_, i) => line(`id-${i}`))

describe('isCart', () => {
  it('accepts lines of positive whole quantities', () => {
    expect(isCart([line(ID)])).toBe(true)
    expect(isCart([line('a', 2), line('b', 3)])).toBe(true)
  })

  it('accepts several lines of ONE product that differ by selections', () => {
    expect(isCart([
      line(ID, 1, [{ groupId: 'milk', picks: { oat: 1 } }]),
      line(ID, 1, [{ groupId: 'milk', picks: { soy: 1 } }]),
    ])).toBe(true)
  })

  it('rejects a cart that is not a list of lines', () => {
    expect(isCart(null)).toBe(false)
    expect(isCart('a')).toBe(false)
    // The OLD shape. A deployed browser is always older than the server, and a map arriving here
    // must be refused outright rather than read as one line called "a".
    expect(isCart({ [ID]: 1 })).toBe(false)
    expect(isCart([{ productId: ID, qty: 1 }])).toBe(false) // no selections
    expect(isCart([{ qty: 1, selections: [] }])).toBe(false) // no productId
  })

  // An empty cart would price to nothing and commit an order for no products.
  it('rejects an empty cart', () => {
    expect(isCart([])).toBe(false)
  })

  it('rejects a quantity that is not a positive whole number', () => {
    for (const qty of ['abc', 1.5, 0, -1, NaN]) {
      expect(isCart([{ productId: ID, qty: qty as number, selections: [] }])).toBe(false)
    }
  })

  // The caps are the whole reason this module is shared: the storefront stops the customer at
  // the same number the backend refuses at, so the UI cannot build a cart that is dead on
  // arrival. Assert the BOUNDARY, not a round number near it.
  describe('the caps', () => {
    it('accepts exactly MAX_CART_QTY of one product and refuses one more', () => {
      expect(isCart([line(ID, MAX_CART_QTY)])).toBe(true)
      expect(isCart([line(ID, MAX_CART_QTY + 1)])).toBe(false)
    })

    // MAX_CART_QTY means "the most of any ONE PRODUCT", and it still does. Reading it per line
    // instead would multiply the guarantee by the line cap and leave that sentence false — a
    // hundred thousand cookies is a smaller number with the same shape as the trillion this
    // module exists to refuse.
    it('sums a product ACROSS its lines against MAX_CART_QTY', () => {
      const half = MAX_CART_QTY / 2
      expect(isCart([
        line(ID, half, [{ groupId: 'milk', picks: { oat: 1 } }]),
        line(ID, half, [{ groupId: 'milk', picks: { soy: 1 } }]),
      ])).toBe(true)
      expect(isCart([
        line(ID, half, [{ groupId: 'milk', picks: { oat: 1 } }]),
        line(ID, half + 1, [{ groupId: 'milk', picks: { soy: 1 } }]),
      ])).toBe(false)
    })

    // `Number.isInteger(1e21)` is TRUE. Without the cap this is an order for a sextillion
    // cookies, and the price check cannot catch it — the client quotes the same absurd total.
    it('refuses an absurd quantity that is nonetheless a whole number', () => {
      expect(Number.isInteger(1e21)).toBe(true)
      expect(isCart([line(ID, 1e21)])).toBe(false)
    })

    it('accepts exactly MAX_CART_LINES distinct products and refuses one more', () => {
      expect(isCart(products(MAX_CART_LINES))).toBe(true)
      expect(isCart(products(MAX_CART_LINES + 1))).toBe(false)
    })

    // Lines are now their own dimension: one product can hold many of them, so bounding
    // distinct products alone no longer bounds the request.
    it('accepts exactly MAX_CART_ENTRIES lines and refuses one more', () => {
      // All ONE product, qty 1 each, so neither MAX_CART_LINES (distinct products) nor
      // MAX_CART_QTY (units of a product) can be what fires — this isolates the line cap.
      const entries = (n: number) => Array.from({ length: n }, (_, i) =>
        line(ID, 1, [{ groupId: 'milk', picks: { [`o${i}`]: 1 } }]))
      expect(MAX_CART_ENTRIES).toBeLessThanOrEqual(MAX_CART_QTY)
      expect(isCart(entries(MAX_CART_ENTRIES))).toBe(true)
      expect(isCart(entries(MAX_CART_ENTRIES + 1))).toBe(false)
    })
  })
})
