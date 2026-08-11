// Arranging a shop's menu into the sections the storefront renders (ADR 0013).
//
// NOT in `@bitetime/shared`, deliberately. That package holds rules that must hold identically on
// BOTH sides of the wire — pricing, the fulfilment window, the cart caps — and this is none of
// them: grouping is presentation, it runs in the browser only, and the backend has no opinion
// about the order of headings on a page. What IS shared is the category type, its validator and
// its row mapper, because both sides read that column.
//
// It lives in a module rather than inline in `Storefront.tsx` because the rules have real edges —
// a hidden category, an id whose category was deleted, a section that emptied out — and each of
// them is a way a shop's menu can silently lose products. UI is verified by running the app here,
// so logic worth arguing about has to sit somewhere a test can reach it.
//
// See CONTEXT.md → Menu category.

import type { MenuCategory } from '@bitetime/shared'

/** One rendered block: a heading and its products, or the trailing block with no heading. */
export interface MenuSection<T> {
  category: MenuCategory | null
  products: T[]
}

/** The one field this module reads off a product. The storefront hands it whole `Product`s. */
interface Categorized {
  category_id?: string | null
}

/**
 * Arrange products into sections, in the order the storefront renders them.
 *
 * Takes the products it is GIVEN and filters none of them — the storefront passes
 * `activeProducts`, and deciding what is on sale is that caller's job, not this one's.
 *
 * Three rules, and each exists to stop a product disappearing:
 *
 *   * **Only ACTIVE categories get a heading.** A hidden category is not a hole in the menu:
 *     its products fall to the trailing block and keep selling. Hiding a heading must never
 *     quietly pull items off sale: all categories hidden is exactly the flat menu the shop had
 *     before it authored any.
 *   * **An unresolvable `category_id` is uncategorized, never an error.** Deleting a category
 *     rewrites no product row, so its products are left pointing at an id the list no longer
 *     holds. That is the whole reason the delete is one write.
 *   * **A section holding nothing is not rendered.** A heading with no products under it is a
 *     blemish on someone's shop — the seasonal category made in advance, the one whose items are
 *     all deactivated, the orphan left behind by a save that failed after creating it inline.
 *
 * A shop with no categories therefore gets back one un-headed section holding its whole menu in
 * the order it was handed: byte-for-byte the storefront that existed before this feature.
 */
export function menuSections<T extends Categorized>(
  products: T[],
  categories: MenuCategory[],
): MenuSection<T>[] {
  const active = categories.filter(c => c.active)
  // Membership is decided against the ACTIVE ids only, so a hidden category's products fall
  // through to the trailing block by the same path a deleted category's do — one rule, not two.
  const activeIds = new Set(active.map(c => c.id))

  const byCategory = new Map<string, T[]>(active.map(c => [c.id, []]))
  const trailing: T[] = []
  for (const p of products) {
    const id = p.category_id
    if (id && activeIds.has(id)) byCategory.get(id)!.push(p)
    else trailing.push(p)
  }

  const sections: MenuSection<T>[] = []
  for (const c of active) {
    const items = byCategory.get(c.id)!
    if (items.length > 0) sections.push({ category: c, products: items })
  }
  if (trailing.length > 0) sections.push({ category: null, products: trailing })
  return sections
}

/**
 * The category a product is filed under, hidden ones included, or `null`.
 *
 * Hidden ones included on purpose: this names a section in the merchant's own product table, and
 * a merchant looking at their menu needs to see where an item is filed even while that section is
 * switched off. The storefront never uses this — it goes through `menuSections`, which is where
 * "hidden means uncategorized" belongs.
 */
export function findCategory(
  categories: MenuCategory[],
  id: string | null | undefined,
): MenuCategory | null {
  if (!id) return null
  return categories.find(c => c.id === id) ?? null
}
