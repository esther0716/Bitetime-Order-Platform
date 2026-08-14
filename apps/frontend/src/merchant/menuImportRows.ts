// Turns the reader's drafts into the rows the import review screen edits.
//
// Pure on purpose, and split out of MenuImportDialog.tsx for the same reason onboardingSteps.ts
// is: the two decisions made here — which section a draft lands in, and which missing sections are
// created — are the ones a merchant is least likely to re-check row by row, and a dialog cannot be
// unit tested in this repo (UI is verified by running the app).
import { MAX_MENU_CATEGORIES, type MenuCategory } from '@bitetime/shared'
import type { MenuDraftItem } from '../store'

/** A draft the merchant is editing, plus the decisions they make about it. */
export interface Row extends MenuDraftItem {
  /** Local key. Not the product id — that is minted at save, like the add form's draftId. */
  key: string
  /** Unchecked rows are not saved. Checked by default: the common case is "keep them all". */
  include: boolean
  /** An existing section's id, or '' . Set from `category_label` when the shop holds a match. */
  category_id: string
  /**
   * The name of a section to CREATE at save and file this row into, or ''.
   *
   * Mutually exclusive with `category_id`: a row lands in a section that exists or in one that is
   * about to, never both. Holding the name rather than a `create: boolean` is what lets the
   * Category dropdown offer the new sections as ordinary choices — a row can be moved into a
   * heading printed elsewhere on the menu, which a per-row tick could never express.
   */
  newCategory: string
}

export const norm = (s: string) => s.trim().toLowerCase()

/**
 * Matches a printed section heading to one of the shop's own sections, case- and space-blind.
 *
 * Returns the category id, or '' for no match. A near-miss is deliberately NOT accepted: filing a
 * product into the wrong section silently is worse than leaving it uncategorized, which the
 * products table already shows plainly in its Category column.
 */
export function matchCategory(categories: MenuCategory[], label: string | undefined): string {
  if (!label) return ''
  const hit = categories.find(c => norm(c.name) === norm(label) || (c.name_zh && norm(c.name_zh) === norm(label)))
  return hit?.id ?? ''
}

/**
 * The headings this menu printed that the shop does not already hold, in the order they were read.
 *
 * One entry per heading, not per row: it is the list the merchant decides about, and the same
 * heading over eight items is one decision, not eight.
 */
export function newCategoryLabels(rows: Row[], categories: MenuCategory[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of rows) {
    const label = row.category_label?.trim()
    if (!label || matchCategory(categories, label) || seen.has(norm(label))) continue
    seen.add(norm(label))
    out.push(label)
  }
  return out
}

/**
 * Builds the review rows, filing every draft under the heading the menu printed for it.
 *
 * A heading the shop does not hold is queued for creation rather than dropped: the sections are
 * the shape the merchant already chose in print, and importing a photograph of that shape only to
 * file forty products as uncategorized leaves them to rebuild it by hand. Nothing is written until
 * they press Add, and one panel above the rows lists every section this will create.
 *
 * The cap is respected. `MAX_MENU_CATEGORIES` is enforced at save, so a menu with more headings
 * than the shop has room for would otherwise open with the Add button already disabled and an
 * error the merchant did not cause. Headings past the cap arrive unqueued.
 */
export function buildRows(items: MenuDraftItem[], categories: MenuCategory[]): Row[] {
  // Headings this pass has already queued, keyed on the normalised form and holding the FIRST
  // spelling read. One heading printed twice in two casings is one section, and carrying both
  // spellings would create it twice.
  const queued = new Map<string, string>()

  return items.map((item, i) => {
    const category_id = matchCategory(categories, item.category_label)
    const label = item.category_label?.trim() ?? ''

    let newCategory = ''
    if (!category_id && label) {
      const held = queued.get(norm(label))
      if (held !== undefined) newCategory = held
      else if (categories.length + queued.size < MAX_MENU_CATEGORIES) {
        queued.set(norm(label), label)
        newCategory = label
      }
    }

    return { ...item, key: `${i}-${item.name}`, include: true, category_id, newCategory }
  })
}
