import { MAX_CART_QTY, MAX_CART_LINES } from '@bitetime/shared'
import type { Translate } from '../types'

/**
 * The two rules that decide what a cart may contain — what a refreshed menu takes OUT of it, and
 * what the customer may put IN.
 *
 * Both were closures over `Storefront`'s own state, so the only way to ask either question was to
 * mount the component and drive a checkout. Neither is a rendering decision:
 *
 *  - the PRUNE is what turns a `product_unavailable` refusal into a recovery instead of a second
 *    identical refusal, and its message is the only account the customer ever gets of why their
 *    basket shrank;
 *  - the CAPS are a mirror of the backend's own, and the whole point of mirroring them is that
 *    the browser cannot build a basket the door will reject.
 *
 * Follows `submitGate.ts` and `quoteMachine.ts` (#121): decisions returned as data, side effects
 * — `setCart`, `setProducts`, the toast — left to the component.
 */

/** Only what these rules read. The menu row type itself belongs to the caller. */
export interface MenuItem {
  id: string
  active?: boolean
}

export type Cart = Record<string, number>

export interface PruneResult {
  /** The cart with every entry the menu no longer sells removed. Same object when nothing went. */
  readonly cart: Cart
  /** How many entries were dropped. `0` means nothing changed and there is nothing to say. */
  readonly removed: number
  /** The ids that went, in cart order — useful to a caller that wants to name them itself. */
  readonly removedIds: readonly string[]
  /**
   * The ids that went AND are still in the fresh menu, so a name can be read off them.
   *
   * A DEACTIVATED product is still in the rows with `active` flipped, so it can be named. A
   * DELETED one is not, and this is the split that decides whether the customer is told a name or
   * an apology. Never invent the name.
   */
  readonly nameableIds: readonly string[]
  /** How many of the dropped ids the fresh menu could not name. */
  readonly unnameable: number
}

/**
 * Take a freshly loaded menu and drop the cart entries it no longer sells.
 *
 * The load-bearing half of adopting a menu. The cart is what the browser POSTs, but the menu, the
 * summary and the quote are all built from the ACTIVE products — so a product deactivated or
 * deleted mid-session leaves a cart entry that is invisible, has no −/+ control to remove it
 * with, and prices at nothing (`priceOrder` skips an id it cannot find). The backend refuses the
 * whole cart for it (`product_unavailable`), and without this prune the customer is trapped:
 * every retry re-sends the same unremovable id and is refused identically, forever, and only a
 * page reload gets them out.
 *
 * An empty `fresh` prunes EVERYTHING, and that is correct — a shop really can sell nothing. What
 * must never reach here is a menu the app failed to FETCH: `{ok:false}` is the absence of an
 * answer, not an answer of none, and adopting it would empty the cart and blame the shop for a
 * dropped packet. That call is the caller's (see `refreshQuoteSources`), and it is why the
 * fetchers report failure rather than returning `[]`.
 */
export function pruneCart(cart: Cart, fresh: readonly MenuItem[]): PruneResult {
  const removedIds = Object.keys(cart).filter(id => !fresh.some(p => p.id === id && p.active))
  if (removedIds.length === 0) {
    return { cart, removed: 0, removedIds: [], nameableIds: [], unnameable: 0 }
  }

  const next = { ...cart }
  for (const id of removedIds) delete next[id]

  const nameableIds = removedIds.filter(id => fresh.some(p => p.id === id))
  return {
    cart: next,
    removed: removedIds.length,
    removedIds,
    nameableIds,
    unnameable: removedIds.length - nameableIds.length,
  }
}

/**
 * What the customer is told when their basket shrank underneath them.
 *
 * A vanishing line is told, never silent — silence would be the same bug wearing a nicer face.
 *
 * A MIXED prune says BOTH halves. Naming what we can and then throwing those names away because
 * one line came back unnameable would tell a customer who lost a cake and a coffee strictly less
 * than we know — and less than either of them alone would have been told. That is the rule this
 * function exists to make assertable; it was previously three interacting ternaries inside a
 * component.
 *
 * @param names Display names for `nameableIds`, already localised by the caller — only it knows
 *   whether this customer reads `name` or `name_zh`.
 */
export function pruneMessage(names: readonly string[], unnameable: number, t: Translate): string {
  const named = names.length > 0
    ? t(`Removed from your cart — no longer available: ${names.join(', ')}`,
        `已从购物车移除（已下架）：${names.join('、')}`)
    : ''
  const rest = unnameable > 0
    ? (unnameable === 1
        ? t('An item in your cart is no longer available and has been removed.',
            '购物车中有商品已下架，已为你移除。')
        : t(`${unnameable} items in your cart are no longer available and have been removed.`,
            `购物车中有 ${unnameable} 件商品已下架，已为你移除。`))
    : ''
  return [named, rest].filter(Boolean).join(' ')
}

/** Why a quantity change was refused. The caller turns this into an instruction. */
export type CartRefusal = 'qty_cap' | 'line_cap'

export type CartChange =
  /** Apply this cart. */
  | { readonly cart: Cart; readonly refused?: undefined }
  /** Nothing changes — either the ceiling binds, or the change was a no-op. */
  | { readonly cart?: undefined; readonly refused: CartRefusal | 'noop' }

/**
 * Raise or lower one line, against the cart's ceilings.
 *
 * The ceilings are MIRRORED from the backend — the same `MAX_CART_QTY` / `MAX_CART_LINES` the
 * intake route refuses on, imported from `@bitetime/shared` rather than retyped. They are
 * enforced at the only place a cart can grow, so the UI cannot build a basket the door will
 * reject: an over-cap cart is refused with `invalid_body`, and a 400 at Place Order is a dead end
 * the customer cannot reason their way out of. Stopping them at the ceiling, and SAYING so, turns
 * a refusal into an instruction.
 *
 * A refusal is returned rather than performed, which is also what keeps the caller's `setCart`
 * updater pure — the toast is a side effect, and React may run an updater twice.
 */
export function nextCart(cart: Cart, productId: string, delta: number): CartChange {
  const current = cart[productId] || 0
  const next = Math.max(0, current + delta)
  if (next === current) return { refused: 'noop' }

  if (next > MAX_CART_QTY) return { refused: 'qty_cap' }
  // A new LINE, not a bigger one: only an id that is not in the cart yet can breach the line cap,
  // so raising an existing line is never blocked by it.
  if (current === 0 && Object.keys(cart).length >= MAX_CART_LINES) return { refused: 'line_cap' }

  if (next === 0) {
    const { [productId]: _removed, ...rest } = cart
    return { cart: rest }
  }
  return { cart: { ...cart, [productId]: next } }
}

/** What a refused quantity change tells the customer. Empty for a no-op, which says nothing. */
export function cartRefusalMessage(refusal: CartRefusal | 'noop', t: Translate): string {
  switch (refusal) {
    case 'qty_cap':
      return t(`You can order at most ${MAX_CART_QTY} of one item.`,
               `每种商品每单最多 ${MAX_CART_QTY} 件。`)
    case 'line_cap':
      return t(`You can order at most ${MAX_CART_LINES} different items in one order.`,
               `每单最多 ${MAX_CART_LINES} 种不同商品。`)
    case 'noop':
      return ''
  }
}
