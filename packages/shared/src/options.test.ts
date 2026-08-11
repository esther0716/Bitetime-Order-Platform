import { describe, it, expect } from 'vitest'
import {
  cartLineKey, validateSelections, validateOptionGroups,
  canBeAnswered,
  MAX_PICK_QTY, MAX_GROUPS_PER_PRODUCT, MAX_OPTIONS_PER_GROUP,
} from './options.js'
import type { CartLine, Option, OptionGroup } from './options.js'

const P = '11111111-1111-1111-1111-111111111111'

const option = (id: string, extra: Partial<Option> = {}): Option =>
  ({ id, name: id, delta: 0, active: true, ...extra })

const group = (id: string, extra: Partial<OptionGroup> = {}): OptionGroup => ({
  id, name: id, minSelect: 0, maxSelect: null, maxPerOption: null, active: true,
  options: [option('a'), option('b')], ...extra,
})

/** The muffin box: pick exactly 6, any mix. */
const FLAVOURS = group('flavours', {
  minSelect: 6, maxSelect: 6, maxPerOption: null,
  options: [option('choc'), option('vanilla'), option('banana')],
})

/** The coffee: pick exactly one milk, oat costs more. */
const MILK = group('milk', {
  minSelect: 1, maxSelect: 1, maxPerOption: 1,
  options: [option('regular'), option('oat', { delta: 2 }), option('soy', { delta: 2 })],
})

describe('cartLineKey', () => {
  // Merging is the whole point: two adds of the same drink with the same milk must land on one
  // line, and the customer never sees "Latte (oat) ×1" twice. The key therefore cannot depend on
  // the order a picker happened to write the groups in, nor on `qty` — merging is what SETS qty.
  it('ignores the order groups and picks were written in, and ignores qty', () => {
    const a: CartLine = {
      productId: P,
      qty: 1,
      selections: [
        { groupId: 'flavours', picks: { choc: 3, vanilla: 3 } },
        { groupId: 'wrap', picks: { gift: 1 } },
      ],
    }
    const b: CartLine = {
      productId: P,
      qty: 2,
      selections: [
        { groupId: 'wrap', picks: { gift: 1 } },
        { groupId: 'flavours', picks: { vanilla: 3, choc: 3 } },
      ],
    }
    expect(cartLineKey(a)).toBe(cartLineKey(b))
  })

  // The other half, and the reason slice 1 alone proves nothing: a key that returned a constant
  // would satisfy it, and would silently merge an oat latte into a soy one.
  it('separates lines that differ by product, by option, or by how many of an option', () => {
    const line = (productId: string, picks: Record<string, number>): CartLine => ({
      productId, qty: 1, selections: [{ groupId: 'milk', picks }],
    })
    const keys = [
      line(P, { oat: 1 }),
      line(P, { soy: 1 }),
      line(P, { oat: 2 }),
      line(P, { oat: 1, soy: 1 }),
      line('22222222-2222-2222-2222-222222222222', { oat: 1 }),
    ].map(cartLineKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  // A product with no groups still needs a key, and it must be the one every other plain add of
  // that product produces — otherwise the ordinary cart stops merging the moment this ships.
  it('gives a product with no selections one stable key', () => {
    const plain: CartLine = { productId: P, qty: 1, selections: [] }
    const same: CartLine = { productId: P, qty: 7, selections: [] }
    expect(cartLineKey(plain)).toBe(cartLineKey(same))
    expect(cartLineKey(plain)).not.toBe(cartLineKey({ ...plain, productId: 'other' }))
  })
})

describe('validateSelections', () => {
  // The box holds six. Five is not a smaller box, it is an order the merchant cannot pack.
  it('refuses an allocation that falls short of minSelect', () => {
    expect(validateSelections([FLAVOURS], [
      { groupId: 'flavours', picks: { choc: 3, vanilla: 2 } },
    ])).toBe('too_few')
  })
})

describe('validateSelections — a legal answer', () => {
  it('accepts an allocation that fills the box exactly, in any mix', () => {
    expect(validateSelections([FLAVOURS], [
      { groupId: 'flavours', picks: { choc: 6 } },
    ])).toBeNull()
    expect(validateSelections([FLAVOURS], [
      { groupId: 'flavours', picks: { choc: 3, vanilla: 2, banana: 1 } },
    ])).toBeNull()
  })

  it('accepts one milk', () => {
    expect(validateSelections([MILK], [{ groupId: 'milk', picks: { oat: 1 } }])).toBeNull()
  })

  it('accepts an empty answer to a group nothing is required from', () => {
    const extras = group('extras', { minSelect: 0, maxSelect: 3, maxPerOption: 1 })
    expect(validateSelections([extras], [])).toBeNull()
  })
})

describe('validateSelections — the ceilings', () => {
  it('refuses an allocation past maxSelect', () => {
    expect(validateSelections([FLAVOURS], [
      { groupId: 'flavours', picks: { choc: 4, vanilla: 3 } },
    ])).toBe('too_many')
  })

  // maxSelect and maxPerOption are independent: "up to 3 toppings" must not become
  // "chilli three times", which is a different order and not what the merchant offered.
  it('refuses too many of ONE option even when the group total is legal', () => {
    const toppings = group('toppings', {
      minSelect: 0, maxSelect: 3, maxPerOption: 1,
      options: [option('chilli'), option('cheese'), option('onion')],
    })
    expect(validateSelections([toppings], [
      { groupId: 'toppings', picks: { chilli: 3 } },
    ])).toBe('too_many_of_option')
  })
})

describe('validateSelections — ids that do not resolve', () => {
  it('refuses a pick naming an option the group does not offer', () => {
    expect(validateSelections([MILK], [
      { groupId: 'milk', picks: { almond: 1 } },
    ])).toBe('unknown_option')
  })

  it('refuses an answer to a group the product does not ask', () => {
    expect(validateSelections([MILK], [
      { groupId: 'sauce', picks: { chilli: 1 } },
    ])).toBe('unknown_group')
  })

  // The 3pm case: a merchant switches oat off while a cart holds one. This is the refusal that
  // becomes `option_unavailable` on the wire — NOT `product_unavailable`, whose recovery is to
  // refetch the menu so a vanished id drops out of the cart. The product id still exists here,
  // so a refetch drops nothing and every retry would be refused identically.
  it('refuses a pick naming an option that is switched off', () => {
    const milk = group('milk', {
      minSelect: 1, maxSelect: 1, maxPerOption: 1,
      options: [option('regular'), option('oat', { delta: 2, active: false })],
    })
    expect(validateSelections([milk], [
      { groupId: 'milk', picks: { oat: 1 } },
    ])).toBe('option_unavailable')
  })
})

describe('validateSelections — malformed answers', () => {
  const unbounded = group('flavours', {
    minSelect: 0, maxSelect: null, maxPerOption: null,
    options: [option('choc'), option('vanilla')],
  })

  // The `isCart` lesson, one level down: a quantity has no natural ceiling in JSON, and
  // `Number.isInteger(1e21)` is TRUE.
  it('refuses a pick quantity that is not a positive whole number', () => {
    for (const qty of [1.5, 0, -1, NaN, 1e21]) {
      expect(validateSelections([unbounded], [
        { groupId: 'flavours', picks: { choc: qty } },
      ])).toBe('invalid_pick')
    }
  })

  // Two answers to one question: each passes maxPerOption on its own, and a `find`-based count
  // sees only the first — so a cap of 1 would sell 2 with nothing on screen to say so.
  it('refuses two answers to the same group', () => {
    expect(validateSelections([MILK], [
      { groupId: 'milk', picks: { oat: 1 } },
      { groupId: 'milk', picks: { soy: 1 } },
    ])).toBe('duplicate_group')
  })
})

describe('validateOptionGroups', () => {
  it('accepts the two shapes the feature exists for', () => {
    expect(validateOptionGroups([FLAVOURS])).toBeNull()
    expect(validateOptionGroups([MILK])).toBeNull()
    expect(validateOptionGroups([])).toBeNull()
  })

  it('refuses a window no answer can satisfy', () => {
    expect(validateOptionGroups([
      group('g', { minSelect: 9, maxSelect: 2 }),
    ])).toBe('impossible_window')
  })

  // A negative delta is a discount wearing an option's clothes. The honest model for "small -2"
  // is a cheaper product or a promo, both of which already exist.
  it('refuses a negative delta', () => {
    expect(validateOptionGroups([
      group('g', { options: [option('a', { delta: -2 })] }),
    ])).toBe('negative_delta')
  })

  it('refuses a group that offers nothing to pick', () => {
    expect(validateOptionGroups([group('g', { options: [] })])).toBe('empty_group')
  })

  it('refuses ids that repeat, within a group and across them', () => {
    expect(validateOptionGroups([
      group('g', { options: [option('a'), option('a')] }),
    ])).toBe('duplicate_option_id')
    expect(validateOptionGroups([group('g'), group('g')])).toBe('duplicate_group_id')
  })

  // The merchant's own config is a cart input now: `maxSelect` decides how many picks a customer
  // may send, so an unbounded one is an unbounded request body.
  it('refuses config past the caps', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => group(`g${i}`))
    expect(validateOptionGroups(many(MAX_GROUPS_PER_PRODUCT))).toBeNull()
    expect(validateOptionGroups(many(MAX_GROUPS_PER_PRODUCT + 1))).toBe('too_many_groups')

    const opts = (n: number) => Array.from({ length: n }, (_, i) => option(`o${i}`))
    expect(validateOptionGroups([
      group('g', { options: opts(MAX_OPTIONS_PER_GROUP + 1) }),
    ])).toBe('too_many_options')

    expect(validateOptionGroups([
      group('g', { maxSelect: MAX_PICK_QTY + 1 }),
    ])).toBe('window_too_wide')
  })
})

// Found in review. ADR 0008 traded away every check constraint and made this function the sole
// replacement, so it is handed whatever a request body contained — and `[{}]` threw on
// `g.options.length`, answering a bad request with a 500 from inside the write endpoint.
describe('validateOptionGroups — malformed input', () => {
  it('refuses a value that is not a group, instead of throwing', () => {
    for (const bad of [[null], [undefined], ['milk'], [42], [[]], [{}]]) {
      expect(() => validateOptionGroups(bad as never)).not.toThrow()
      expect(validateOptionGroups(bad as never)).toBe('malformed_group')
    }
  })

  it('refuses a group whose numbers are not numbers', () => {
    expect(validateOptionGroups([{ ...MILK, minSelect: 'one' as never }])).toBe('malformed_group')
    expect(validateOptionGroups([{ ...MILK, id: '' }])).toBe('malformed_group')
  })

  it('refuses an option that is not an option', () => {
    expect(validateOptionGroups([{ ...MILK, options: [null as never] }])).toBe('malformed_option')
    expect(validateOptionGroups([{ ...MILK, options: [{ id: 'a', name: 'A', delta: 'free' as never, active: true }] }]))
      .toBe('malformed_option')
  })

  // Two choices a customer cannot tell apart are two choices the merchant cannot pack against,
  // and the order snapshot records the NAME — so an unnamed or repeated one is unreadable later.
  it('refuses blank and repeated names', () => {
    expect(validateOptionGroups([{ ...MILK, name: '  ' }])).toBe('blank_name')
    expect(validateOptionGroups([{
      ...MILK, options: [
        { id: 'a', name: 'Oat', delta: 0, active: true },
        { id: 'b', name: 'Oat', delta: 0, active: true },
      ],
    }])).toBe('duplicate_option_name')
  })
})

describe('validateSelections — malformed input', () => {
  it('refuses junk instead of throwing', () => {
    for (const bad of [[null], [undefined], ['milk'], [42], [{ groupId: 'milk' }]]) {
      expect(() => validateSelections([MILK], bad as never)).not.toThrow()
      expect(validateSelections([MILK], bad as never)).not.toBeNull()
    }
  })
})

describe('canBeAnswered', () => {
  // The split that decides whether `option_unavailable` REPAIRS (reopen the picker) or falls
  // back to dropping the line. Dropping is the terminating case, not the whole recovery — but
  // reopening a picker with nothing valid to pick is the same trap with nicer manners.
  it('is true while every required group can still be satisfied', () => {
    expect(canBeAnswered([FLAVOURS])).toBe(true)
    expect(canBeAnswered([MILK])).toBe(true)
    expect(canBeAnswered([])).toBe(true)
  })

  it('is false when a required group has no options left to pick', () => {
    const dead = group('milk', {
      minSelect: 1, maxSelect: 1, maxPerOption: 1,
      options: [option('oat', { active: false }), option('soy', { active: false })],
    })
    expect(canBeAnswered([dead])).toBe(false)
  })

  // The muffin box with two flavours withdrawn: one flavour, capped at one each, cannot fill six.
  it('is false when what is left cannot reach minSelect', () => {
    const thin = group('flavours', {
      minSelect: 6, maxSelect: 6, maxPerOption: 1,
      options: [option('choc'), option('vanilla', { active: false })],
    })
    expect(canBeAnswered([thin])).toBe(false)
    // Uncapped per option, one flavour CAN fill six.
    expect(canBeAnswered([{ ...thin, maxPerOption: null }])).toBe(true)
  })

  // An OPTIONAL group losing every option costs an upsell, not the product.
  it('ignores a group nothing is required from', () => {
    const extras = group('extras', {
      minSelect: 0, maxSelect: 3, maxPerOption: 1,
      options: [option('a', { active: false })],
    })
    expect(canBeAnswered([extras])).toBe(true)
  })

  // A switched-off group is not a question — the Pro downgrade must not make a product
  // unanswerable, it makes it unasked.
  it('ignores a switched-off group', () => {
    expect(canBeAnswered([{ ...FLAVOURS, active: false, options: [] }])).toBe(true)
  })
})
