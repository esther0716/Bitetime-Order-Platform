// The pure half of Product copy (CONTEXT.md → Product copy): superadmin-only bulk duplication of
// products from one shop into another. This module decides the WHOLE plan — which rows land,
// with which fields, in which sections, at which sort, and which storage objects must be
// duplicated — from rows alone. The route stays thin: load, plan, copy files, one transaction.
//
// The pure half of a pair, like productOrder.ts / productOrderDb.ts: `pnpm --filter
// @bitetime/backend test` reaches this with no Supabase, no env and no connection, so the
// combinatorial cases (name collisions, dangling category ids, sort continuation) are checked by
// the cheap suite.
//
// See docs (issue #256) and CONTEXT.md → Product copy for the design.

import {
  categoryMatchKey,
  validateMenuCategories,
  type CategoryConfigError,
  type MenuCategory,
} from '@bitetime/shared'

/**
 * The source row, as the products table holds it. `price` stays whatever the driver returned
 * (postgres.js says string, PostgREST says number) — it is carried verbatim into the insert,
 * never arithmetic'd on, so no mapping is owed here.
 */
export interface CopySourceProduct {
  id: string
  name: string
  name_zh: string | null
  descr: string | null
  descr_zh: string | null
  price: unknown
  unit: string | null
  unit_quantity: number | null
  active: boolean
  image_urls: string[]
  option_groups: unknown
  category_id: string | null
  // Present on the row, listed here so a caller cannot forget they exist — the plan STRIPS them.
  promo_price: unknown
  promo_limit: unknown
  promo_end: unknown
}

/** One row the transaction will insert. Promo columns are absent: stripped, never carried. */
export interface CopyProductRow {
  id: string
  merchant_id: string
  name: string
  name_zh: string | null
  descr: string | null
  descr_zh: string | null
  price: unknown
  unit: string | null
  unit_quantity: number | null
  active: boolean
  image_urls: string[]
  option_groups: unknown
  category_id: string | null
  sort: number
}

/** One storage object to duplicate, both paths inside the product-images bucket. */
export interface ImageCopy {
  from: string
  to: string
}

export interface CopyPlan {
  rows: CopyProductRow[]
  /** The target's full merged category list to write, or null when nothing changes. */
  categories: MenuCategory[] | null
  imageCopies: ImageCopy[]
}

export type CopyPlanError =
  | 'no_products'
  | 'too_many_products'
  | 'product_not_in_source'
  | CategoryConfigError

/** The most products one copy may carry — same argument as MAX_PRODUCT_ORDER_ITEMS. */
export const MAX_COPY_PRODUCTS = 500

export type CopyRequestError = 'malformed_body' | 'same_shop' | 'no_products' | 'too_many_products'

// Postgres casts the ids to uuid. A value that is not a uuid raises there — a 500 for what is a
// bad request — so it is refused here instead (productOrder.ts records the same lesson).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Read a copy request into the ids the route needs, or say why it cannot. SHAPE FIRST and
 * unconditionally: this is handed whatever the request contained.
 */
export function parseProductCopy(body: unknown):
  | { ok: true; sourceMerchantId: string; targetMerchantId: string; productIds: string[] }
  | { ok: false; error: CopyRequestError } {
  if (!isObject(body)) return { ok: false, error: 'malformed_body' }
  const { sourceMerchantId, targetMerchantId, productIds } = body
  if (typeof sourceMerchantId !== 'string' || !UUID.test(sourceMerchantId)) return { ok: false, error: 'malformed_body' }
  if (typeof targetMerchantId !== 'string' || !UUID.test(targetMerchantId)) return { ok: false, error: 'malformed_body' }
  if (!Array.isArray(productIds)) return { ok: false, error: 'malformed_body' }
  // Refused HERE, before the route does any I/O — productOrder.ts checks its cap in parse for
  // the same reason. planProductCopy re-checks both, so the pure plan stays safe standalone.
  if (productIds.length === 0) return { ok: false, error: 'no_products' }
  if (productIds.length > MAX_COPY_PRODUCTS) return { ok: false, error: 'too_many_products' }
  const seen = new Set<string>()
  for (const id of productIds as unknown[]) {
    if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, error: 'malformed_body' }
    // Two entries naming one product would land it twice.
    if (seen.has(id)) return { ok: false, error: 'malformed_body' }
    seen.add(id)
  }
  // A shop copied into itself is a duplicate menu, which no one asked this feature for.
  if (sourceMerchantId === targetMerchantId) return { ok: false, error: 'same_shop' }
  return { ok: true, sourceMerchantId, targetMerchantId, productIds: productIds as string[] }
}

export interface CopyPlanInput {
  requestedIds: string[]
  /** The source shop's rows for the requested ids, in the source's own render order. */
  sourceProducts: CopySourceProduct[]
  sourceCategories: MenuCategory[]
  targetCategories: MenuCategory[]
  targetMerchantId: string
  /** Highest `sort` among the target's existing products, or null when it has none. */
  targetMaxSort: number | null
  /** Id mint, injected so tests can be deterministic. */
  newId: () => string
}

export function planProductCopy(input: CopyPlanInput):
  | { ok: true; plan: CopyPlan }
  | { ok: false; error: CopyPlanError } {
  const { requestedIds, sourceProducts, targetMerchantId, newId } = input

  if (requestedIds.length === 0) return { ok: false, error: 'no_products' }
  if (requestedIds.length > MAX_COPY_PRODUCTS) return { ok: false, error: 'too_many_products' }

  const sourceIds = new Set(sourceProducts.map(p => p.id))
  for (const id of requestedIds) {
    if (!sourceIds.has(id)) return { ok: false, error: 'product_not_in_source' }
  }

  // Copy in the SOURCE's render order, not the request's: the picker sends a set, and the order
  // customers will see is the menu's own.
  const requested = new Set(requestedIds)
  const chosen = sourceProducts.filter(p => requested.has(p.id))

  let sort = input.targetMaxSort === null ? 0 : input.targetMaxSort + 1

  const sourceCatById = new Map(input.sourceCategories.map(c => [c.id, c]))
  // Folded name → target section id, the same fold `validateMenuCategories` refuses duplicates
  // under — so "a section by this name already exists" here and "two sections by one name are
  // illegal" there can never disagree. English and Chinese vocabularies stay separate for the
  // reason menuCategories.ts records: an EN name and a ZH name colliding is not a thing on screen.
  const targetByKey = new Map(input.targetCategories.map(c => [categoryMatchKey(c.name), c.id]))
  // Source section id → target section id, filled as sections are first met, so one source
  // section is appended once however many products point at it.
  const remap = new Map<string, string>()
  const appended: MenuCategory[] = []

  const resolveCategory = (categoryId: string | null): string | null => {
    if (categoryId === null) return null
    const hit = remap.get(categoryId)
    if (hit !== undefined) return hit
    const source = sourceCatById.get(categoryId)
    // A dangling id is the load-bearing "uncategorized" reading (ADR 0013), not an error.
    if (!source) return null
    let targetId = targetByKey.get(categoryMatchKey(source.name))
    if (targetId === undefined) {
      targetId = newId()
      // Carried whole, hidden state included: a hidden source section copies hidden.
      appended.push({ ...source, id: targetId })
      targetByKey.set(categoryMatchKey(source.name), targetId)
    }
    remap.set(categoryId, targetId)
    return targetId
  }

  const rows: CopyProductRow[] = []
  const imageCopies: ImageCopy[] = []

  for (const p of chosen) {
    const id = newId()
    const imagePaths: string[] = []
    for (const from of p.image_urls ?? []) {
      const base = from.split('/').pop() || from
      const to = `${targetMerchantId}/${id}/${base}`
      imagePaths.push(to)
      imageCopies.push({ from, to })
    }
    rows.push({
      id,
      merchant_id: targetMerchantId,
      name: p.name,
      name_zh: p.name_zh,
      descr: p.descr,
      descr_zh: p.descr_zh,
      price: p.price,
      unit: p.unit,
      unit_quantity: p.unit_quantity,
      active: p.active,
      image_urls: imagePaths,
      option_groups: p.option_groups,
      category_id: resolveCategory(p.category_id),
      sort: sort++,
    })
  }

  let categories: MenuCategory[] | null = null
  if (appended.length > 0) {
    categories = [...input.targetCategories, ...appended]
    // The write endpoint for the category list enforces these rules; a list this plan builds
    // must clear the same bar, or the copy would store what the Categories dialog refuses.
    const bad = validateMenuCategories(categories)
    if (bad) return { ok: false, error: bad }
  }

  return { ok: true, plan: { rows, categories, imageCopies } }
}
