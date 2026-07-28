// What the merchant's order list may be asked for — decided before any query runs.
//
// Pure, like `shopCustomers.ts` next door and for the same reason: every rule worth arguing
// about (which columns may be sorted on, how big a page may be, what a search term is allowed to
// contain) is settled here against plain values, and can be tested exhaustively with no database.
//
// The list is PAGED rather than whole (#144). It used to be an unbounded `select *` that
// PostgREST silently cut off at 1000 rows, which made a shop's oldest orders unreachable with
// nothing on screen saying so. A page the caller asked for and can count is not that: `total`
// comes back with every response, so the merchant is told what they are looking at a slice of.

export const ORDER_SORTS = ['created_at', 'order_number', 'fulfil_date', 'total'] as const
export type OrderSort = (typeof ORDER_SORTS)[number]

/**
 * Newest first. The only sort the list has ever had, and the one a merchant opening the tab
 * wants: today's orders are the ones they have to act on.
 */
export const DEFAULT_ORDER_SORT: OrderSort = 'created_at'
export const DEFAULT_ORDER_DIR: OrderDir = 'desc'

export type OrderDir = 'asc' | 'desc'

export const ORDERS_PAGE_SIZE = 25

/**
 * The largest page the endpoint will serve.
 *
 * Comfortably under PostgREST's own `max_rows`, which is the point: a page this endpoint agrees
 * to serve must be one it can serve WHOLE. A page size that could reach the row cap would put
 * the silent truncation straight back, one layer up.
 */
export const MAX_ORDERS_PAGE_SIZE = 100

export interface OrderListQuery {
  page: number
  pageSize: number
  sort: OrderSort
  dir: OrderDir
  /** Blank means "everything" — an absent filter, not a search for the empty string. */
  search: string
}

export type OrderListError =
  | 'invalid_sort'
  | 'invalid_dir'
  | 'invalid_page'
  | 'invalid_page_size'

const isOrderSort = (v: string): v is OrderSort => (ORDER_SORTS as readonly string[]).includes(v)

/**
 * PostgREST's filter grammar is comma-separated and dot-delimited, so a comma or a parenthesis
 * inside a search term does not search FOR that character — it changes the query. The characters
 * that carry meaning there are replaced with spaces rather than escaped: these terms are names,
 * phone numbers and order numbers, none of which contains one meaningfully, and a stripped
 * character searches for slightly less while a mis-escaped one searches for something else.
 *
 * `%` and `*` go too — both are `ilike` wildcards, and a merchant typing one means the literal
 * character, not "match anything".
 */
export function searchTerm(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[,.()"'\\%*:]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Read one request's list parameters, or refuse.
 *
 * Refused rather than clamped, which is the same call the XLSX export makes about its range: a
 * clamped request hands back a list that quietly answers a different question than the one asked
 * — and "quietly answering a different question" is the entire defect this endpoint is being
 * fixed for. An omitted parameter is not a bad one; those take the defaults above.
 */
export function parseOrderList(
  params: URLSearchParams,
): { ok: true; query: OrderListQuery } | { ok: false; error: OrderListError } {
  const sort = params.get('sort') ?? DEFAULT_ORDER_SORT
  if (!isOrderSort(sort)) return { ok: false, error: 'invalid_sort' }

  const dir = params.get('dir') ?? DEFAULT_ORDER_DIR
  if (dir !== 'asc' && dir !== 'desc') return { ok: false, error: 'invalid_dir' }

  const page = numberParam(params.get('page'), 1)
  if (page === null || page < 1) return { ok: false, error: 'invalid_page' }

  const pageSize = numberParam(params.get('pageSize'), ORDERS_PAGE_SIZE)
  if (pageSize === null || pageSize < 1 || pageSize > MAX_ORDERS_PAGE_SIZE) {
    return { ok: false, error: 'invalid_page_size' }
  }

  return { ok: true, query: { page, pageSize, sort, dir, search: searchTerm(params.get('search')) } }
}

/** Absent takes the default; present-but-not-a-whole-number is a caller bug, not a default. */
function numberParam(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === '') return fallback
  const n = Number(raw)
  return Number.isInteger(n) ? n : null
}
