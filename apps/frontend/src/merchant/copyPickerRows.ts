// The rows the Product copy picker shows, and the one decision made for the superadmin: which
// boxes start ticked. The backend's write path does dumb inserts (CONTEXT.md → Product copy), so
// these defaults are the only thing standing between a re-run and a doubled menu.
//
// Pure and split out of the dialog for the same reason menuImportRows.ts is: a dialog cannot be
// unit tested in this repo (UI is verified by running the app), and this is the decision a
// superadmin is least likely to re-check row by row.
import { norm } from './menuImportRows'

/** What the picker needs off a product row, source or target. */
export interface CopyCandidate {
  id: string
  name: string
  name_zh?: string | null
  price?: unknown
  active?: boolean
  [key: string]: unknown
}

export interface CopyPickerRow extends CopyCandidate {
  /** The target already holds a product by this name (case- and space-blind). */
  duplicate: boolean
  /** Ticked by default — except duplicates, which the superadmin must opt back in. */
  include: boolean
}

export function copyPickerRows(
  sourceProducts: CopyCandidate[],
  targetProducts: CopyCandidate[],
): CopyPickerRow[] {
  const taken = new Set(targetProducts.map(p => norm(p.name)))
  return sourceProducts.map(p => {
    const duplicate = taken.has(norm(p.name))
    return { ...p, duplicate, include: !duplicate }
  })
}
