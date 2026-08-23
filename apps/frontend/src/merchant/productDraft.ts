/**
 * Has the merchant actually changed anything in the product form?
 *
 * The sheet closes on a press outside, on Escape and on the X, and all three discard the draft.
 * Discarding a form the merchant only opened is fine; discarding one they half-filled is not, so
 * this is what decides whether closing asks first.
 *
 * Pure, and compares the CURRENT draft against the snapshot taken when the sheet seeded itself —
 * which is a `products` row in edit mode and a blank form in add mode, so one comparison covers
 * both. The snapshot is re-taken when an edit-mode photo change writes through, because that
 * write makes the new photos the saved state rather than an unsaved edit.
 */

export interface ProductDraft {
  form: Record<string, unknown>
  images: string[]
  optionGroups: unknown
}

/**
 * The fields the form owns. Listed rather than derived from `Object.keys`, so the comparison
 * cannot depend on the order the two objects happened to be built in — the seed writes them in
 * one order and `BLANK` in another.
 */
const FIELDS = [
  'name', 'name_zh', 'descr', 'price', 'unit', 'unit_quantity', 'active',
  'promo_price', 'promo_limit', 'promo_end', 'category_id',
] as const

/**
 * Compared as strings, because the seed and the inputs disagree about type for the same value:
 * `unit_quantity` arrives from the row as the number 1 and comes back from the input as '1'.
 * Treating those as a change would ask a merchant to confirm discarding a form they never typed
 * into. `active` is the one genuine boolean and survives the same treatment.
 */
const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')

export function draftChanged(current: ProductDraft, seeded: ProductDraft): boolean {
  for (const f of FIELDS) {
    if (!same(current.form[f], seeded.form[f])) return true
  }
  if (current.images.length !== seeded.images.length) return true
  if (current.images.some((p, i) => p !== seeded.images[i])) return true
  // Option groups are nested and are only ever replaced wholesale by the editor, so their own
  // JSON is a fair comparison — unlike `form`, both sides are built by the same code.
  return JSON.stringify(current.optionGroups) !== JSON.stringify(seeded.optionGroups)
}
