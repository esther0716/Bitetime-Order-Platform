/**
 * What a cart is allowed to be — the ONE rule, held by both sides of the wire.
 *
 * The backend refuses a cart that breaks these caps (`invalid_body`, 400), and it must: a
 * quantity has no natural ceiling in JSON, `Number.isInteger(1e21)` is TRUE, and the quote
 * check cannot save us because the client quotes the same astronomical total it asked for. The
 * cap is the only thing standing in front of an order for a trillion cookies.
 *
 * They live HERE, and not as a `1000` in the backend and another `1000` in the storefront,
 * because the frontend has to STOP the customer at the same ceiling the backend refuses at. A
 * cart the UI happily builds and the server then rejects is a dead checkout — the customer is
 * told `invalid_body` and given nothing to do about it. Two magic numbers that must agree are
 * the same class of bug the shared pricing module exists to kill.
 */
import type { CartLine } from './options.js'

/**
 * The most of any ONE PRODUCT a single order may carry — summed ACROSS its lines.
 *
 * Menu options let one product occupy several lines, and reading this per line instead would
 * multiply the guarantee by the line cap and leave this sentence false. A hundred thousand
 * cookies is a smaller number with the same shape as the trillion above.
 */
export const MAX_CART_QTY = 1000

/** The most DISTINCT products a single order may carry. */
export const MAX_CART_LINES = 100

/**
 * The most LINES a single order may carry.
 *
 * Its own dimension since ADR 0009: one product can hold many lines when its options differ, so
 * bounding distinct products no longer bounds the size of the request.
 */
export const MAX_CART_ENTRIES = 200

/**
 * The most selections one line may carry — one per group it answers.
 *
 * The merchant's own config is an input to the size of a request body (`maxSelect` and the group
 * count are theirs to type), so the door needs its own ceiling rather than trusting whatever
 * arrives. Comfortably above `MAX_GROUPS_PER_PRODUCT`, which is the honest maximum.
 */
export const MAX_SELECTIONS_PER_LINE = 20

const isPositiveWhole = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_CART_QTY

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * A selection, checked as a SHAPE and not merely as "something in an array".
 *
 * `Array.isArray(selections)` was not enough, and the gap was the exact failure this module's
 * header warns about: a `null` entry passed the door, reached `validateSelections` inside
 * `placeOrder`'s TRANSACTION, and threw on `s.groupId` — a crafted body answered with a 500,
 * a bad request dressed up as a server fault. The picks are checked here too, because a
 * non-numeric quantity coerces to NaN and prices a line at nothing.
 */
function isSelection(v: unknown): boolean {
  if (!isPlainObject(v)) return false
  if (typeof v.groupId !== 'string' || v.groupId === '') return false
  if (!isPlainObject(v.picks)) return false
  return Object.values(v.picks).every(n => typeof n === 'number' && Number.isFinite(n))
}

/**
 * A cart is a LIST of lines, each a product id, a positive whole quantity and its selections.
 *
 * The shape check is not tidiness: a non-numeric quantity coerces to NaN, sails past
 * TypeScript, reaches Postgres and comes back a 500 — a bad request dressed up as a server
 * fault. Reject it at the door instead. The pre-options MAP shape is refused outright rather
 * than read as a one-line cart: a deployed browser is always older than the server.
 */
export function isCart(v: unknown): v is CartLine[] {
  if (!Array.isArray(v)) return false
  if (v.length === 0 || v.length > MAX_CART_ENTRIES) return false

  const perProduct = new Map<string, number>()
  for (const line of v) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return false
    const { productId, qty, selections } = line as Partial<CartLine>
    if (typeof productId !== 'string' || productId === '') return false
    if (!isPositiveWhole(qty)) return false
    if (!Array.isArray(selections)) return false
    if (selections.length > MAX_SELECTIONS_PER_LINE) return false
    if (!selections.every(isSelection)) return false

    const sum = (perProduct.get(productId) ?? 0) + qty
    if (sum > MAX_CART_QTY) return false
    perProduct.set(productId, sum)
  }
  return perProduct.size <= MAX_CART_LINES
}
