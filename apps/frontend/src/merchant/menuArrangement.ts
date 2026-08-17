// The merchant arranging their own menu — every rule the Storefront tab obeys, with no React in
// it (docs/superpowers/specs/2026-08-17-storefront-arrangement-design.md).
//
// NOT in `@bitetime/shared`, for `menuGroups.ts`'s reason: order is presentation, it runs in the
// browser only, and the backend has no opinion about the order of headings on a page. What is
// shared is the category type and its validator, because both sides read that column.
//
// A DELIBERATE SIBLING of `menuGroups.ts`, not a replacement for it. That module answers the
// STOREFRONT's question — what does a customer see — so it drops hidden categories, drops empty
// sections, and reads a dangling id as uncategorized. This one answers the MERCHANT's question —
// where is everything filed — so it keeps all three, or the merchant cannot drop anything into
// them. Two questions, two functions; folding them together is how one of the two answers ends up
// wrong.

import type { MenuCategory } from '@bitetime/shared'

/** One block of the draft: a section and its products, or the trailing un-headed block. */
export interface ArrangedBlock<T> {
  category: MenuCategory | null
  products: T[]
}

/** A position in the draft: which block, and which index inside it. */
export interface Slot {
  block: number
  index: number
}

/** The two fields this module reads off a product. The screen hands it whole rows. */
interface Categorized {
  id: string
  category_id?: string | null
}

// The ids dnd-kit drags. A product's own uuid is its drag id, so anything else has to be prefixed
// or a category could collide with a product.
const CATEGORY_PREFIX = 'cat:'
const BLOCK_PREFIX = 'drop:'

/** The drag id of a section's heading. */
export const categoryDragId = (categoryId: string): string => `${CATEGORY_PREFIX}${categoryId}`

/**
 * The trailing block's sortable id.
 *
 * It carries its own id rather than `categoryDragId('trailing')` so that no sentinel ever sits in
 * the category-id namespace, where a shop could in principle hold a category with that id. It is
 * in the sortable context only because dnd-kit warns about a sortable whose id its context does
 * not hold; the block itself is never draggable, and this id resolves to no section.
 */
export const TRAILING_SORTABLE_ID = 'block:trailing'

/** The droppable id of a block's list, which is what an EMPTY block offers as a target. */
export const blockDropId = (index: number): string => `${BLOCK_PREFIX}${index}`

/**
 * Build the draft from the two stored things.
 *
 * The trailing block is ALWAYS present, even when empty: it is where a merchant drops a product to
 * take it out of every section, so it cannot appear only once something is already in it.
 */
export function arrangeMenu<T extends Categorized>(
  products: T[],
  categories: MenuCategory[],
): ArrangedBlock<T>[] {
  const ids = new Set(categories.map(c => c.id))
  const byCategory = new Map<string, T[]>(categories.map(c => [c.id, []]))
  const trailing: T[] = []

  for (const p of products) {
    const id = p.category_id
    if (id && ids.has(id)) byCategory.get(id)!.push(p)
    else trailing.push(p)
  }

  return [
    ...categories.map(c => ({ category: c, products: byCategory.get(c.id)! })),
    { category: null, products: trailing },
  ]
}

/**
 * Apply an edited category list to a draft, keeping every product where the draft put it.
 *
 * Called after the categories dialog saves. Rebuilding with `arrangeMenu` instead would read the
 * products' STORED `category_id` and their stored order — that is, it would throw away every drag
 * the merchant has not saved yet, behind a success toast.
 */
export function reseedCategories<T extends Categorized>(
  blocks: ArrangedBlock<T>[],
  categories: MenuCategory[],
): ArrangedBlock<T>[] {
  const held = new Map<string, T[]>()
  for (const b of blocks) if (b.category) held.set(b.category.id, b.products)

  const kept = new Set(categories.map(c => c.id))
  // A deleted section's products APPEND to the trailing block, after whatever was already there:
  // they are the newly unfiled ones, and the merchant's own trailing order is not disturbed.
  const trailing = [...(blocks.find(b => b.category === null)?.products ?? [])]
  for (const b of blocks) {
    if (b.category && !kept.has(b.category.id)) trailing.push(...b.products)
  }

  return [
    ...categories.map(c => ({ category: c, products: held.get(c.id) ?? [] })),
    { category: null, products: trailing },
  ]
}

/** Move one product from one slot to another. Returns the SAME array when the move is impossible. */
export function moveProduct<T>(
  blocks: ArrangedBlock<T>[],
  from: Slot,
  to: Slot,
): ArrangedBlock<T>[] {
  const source = blocks[from.block]
  const target = blocks[to.block]
  if (!source || !target) return blocks
  const item = source.products[from.index]
  if (item === undefined) return blocks

  const next = blocks.map(b => ({ ...b, products: [...b.products] }))
  next[from.block]!.products.splice(from.index, 1)
  const list = next[to.block]!.products
  // Clamped: dnd-kit reports an index against the list BEFORE the removal, so a move to the end of
  // the same block arrives one past it.
  list.splice(Math.max(0, Math.min(to.index, list.length)), 0, item)
  return next
}

/**
 * Move one section, carrying its products.
 *
 * Indices count SECTIONS, not blocks, and the trailing block is put back last however the sections
 * move: the storefront draws it last, so there is no arrangement in which it sits above a heading.
 */
export function moveCategory<T>(
  blocks: ArrangedBlock<T>[],
  from: number,
  to: number,
): ArrangedBlock<T>[] {
  const named = blocks.filter(b => b.category !== null)
  const trailing = blocks.filter(b => b.category === null)
  if (from < 0 || from >= named.length || to < 0 || to >= named.length) return blocks

  const next = [...named]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return [...next, ...trailing]
}

/** Where a product currently sits, or null. */
export function findProduct<T extends Categorized>(
  blocks: ArrangedBlock<T>[],
  productId: string,
): Slot | null {
  for (let block = 0; block < blocks.length; block++) {
    const index = blocks[block]!.products.findIndex(p => p.id === productId)
    if (index !== -1) return { block, index }
  }
  return null
}

/**
 * The slot a dnd-kit `over.id` names.
 *
 * Three kinds of target, because a merchant drops onto three kinds of thing: another product, an
 * empty block's list, or a section's heading. The last two both mean "the end of that block".
 */
export function resolveDropTarget<T extends Categorized>(
  blocks: ArrangedBlock<T>[],
  overId: string,
): Slot | null {
  if (overId.startsWith(BLOCK_PREFIX)) {
    const block = Number(overId.slice(BLOCK_PREFIX.length))
    return blocks[block] ? { block, index: blocks[block]!.products.length } : null
  }
  if (overId.startsWith(CATEGORY_PREFIX)) {
    const id = overId.slice(CATEGORY_PREFIX.length)
    const block = blocks.findIndex(b => b.category?.id === id)
    return block === -1 ? null : { block, index: blocks[block]!.products.length }
  }
  return findProduct(blocks, overId)
}

/** The category list in draft order, which is what the merchant row is patched with. */
export function categoriesOf<T>(blocks: ArrangedBlock<T>[]): MenuCategory[] {
  return blocks.map(b => b.category).filter((c): c is MenuCategory => c !== null)
}

/**
 * The request body: every product, its global position, and the section it now sits in.
 *
 * The section comes from the BLOCK, never from the product's stored `category_id` — that is what
 * makes dragging a product out of a deleted section finally clear the dangling id.
 *
 * Every product, never a diff. A diff is smaller and is wrong the moment two browsers arrange one
 * shop: the second save would carry only its own changes and interleave them with the first's.
 */
export function productOrderPatch<T extends Categorized>(
  blocks: ArrangedBlock<T>[],
): { id: string; sort: number; category_id: string | null }[] {
  const out: { id: string; sort: number; category_id: string | null }[] = []
  let sort = 0
  for (const b of blocks) {
    for (const p of b.products) out.push({ id: p.id, sort: sort++, category_id: b.category?.id ?? null })
  }
  return out
}

/**
 * What the screen compares against what it last saved.
 *
 * TWO keys, not one. The categories dialog saves on its own, so after a rename the stored category
 * list has moved on while the product order has not. One key would leave the screen dirty for ever
 * after any rename.
 */
export function arrangementKeys<T extends Categorized>(blocks: ArrangedBlock<T>[]): {
  categories: string
  products: string
} {
  return {
    categories: JSON.stringify(categoriesOf(blocks)),
    products: JSON.stringify(productOrderPatch(blocks)),
  }
}
