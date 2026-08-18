// What a product-order request must satisfy, and nothing that touches a database.
//
// The pure half of a pair, like aiUsage.ts / aiUsageDb.ts: `pnpm --filter @bitetime/backend test`
// reaches this with no Supabase, no env and no connection, so the rules that decide whether a
// merchant's arrangement is legal are checked by the cheap suite.
//
// See docs/superpowers/specs/2026-08-17-storefront-arrangement-design.md.

/** One product's new place: where it sits, and which section it sits in. */
export interface ProductOrderItem {
  id: string
  sort: number
  category_id: string | null
}

/** Why an arrangement is not a legal arrangement. */
export type ProductOrderError =
  | 'malformed_body' | 'too_many_items' | 'malformed_item' | 'duplicate_item'

/**
 * The most products one request may arrange.
 *
 * A shop with more products than this has a different problem, and the alternative is a statement
 * whose parameter arrays are as long as the body says.
 */
export const MAX_PRODUCT_ORDER_ITEMS = 500

// Postgres casts the id array to uuid[]. A value that is not a uuid raises there — a 500 for what
// is a bad request — so it is refused here instead, where the answer can say why.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Read a request body into the items the write needs, or say why it cannot.
 *
 * SHAPE FIRST and unconditionally: this is handed whatever the request contained, so every read
 * below is on a value nothing has checked. `validateOptionGroups` records the same lesson.
 *
 * `category_id` is deliberately NOT checked against the shop's own list. An id the list no longer
 * holds reads as uncategorized (ADR 0013), so checking it here would turn a stale dashboard into
 * a refused save.
 */
export function parseProductOrder(body: unknown):
  | { ok: true; items: ProductOrderItem[] }
  | { ok: false; error: ProductOrderError } {
  if (!isObject(body) || !Array.isArray(body.items)) return { ok: false, error: 'malformed_body' }
  if (body.items.length > MAX_PRODUCT_ORDER_ITEMS) return { ok: false, error: 'too_many_items' }

  const seen = new Set<string>()
  const items: ProductOrderItem[] = []

  for (const raw of body.items as unknown[]) {
    if (!isObject(raw)) return { ok: false, error: 'malformed_item' }
    if (typeof raw.id !== 'string' || !UUID.test(raw.id)) return { ok: false, error: 'malformed_item' }
    if (typeof raw.sort !== 'number' || !Number.isInteger(raw.sort) || raw.sort < 0) {
      return { ok: false, error: 'malformed_item' }
    }
    if (raw.category_id !== null && typeof raw.category_id !== 'string') {
      return { ok: false, error: 'malformed_item' }
    }
    // Two rows naming one product would leave the outcome to the scan order of the update.
    if (seen.has(raw.id)) return { ok: false, error: 'duplicate_item' }
    seen.add(raw.id)

    // The product form's "no category" is an empty string; the column has only NULL. One state
    // in, one state out — the two must not diverge into "unfiled" and "filed under nothing".
    items.push({
      id: raw.id,
      sort: raw.sort,
      category_id: raw.category_id === '' ? null : raw.category_id,
    })
  }

  return { ok: true, items }
}
