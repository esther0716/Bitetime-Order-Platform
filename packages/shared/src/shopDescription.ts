// The one line a customer reads under a shop's name on its storefront, and the rule deciding
// whether what a merchant typed is legal configuration.
//
// Shared because the cap is enforced twice and must be the same number both times: the write
// endpoint refuses on it, and the merchant's own card counts against it while they type. A cap
// that disagreed would show a merchant 158/160 and then a 400.
//
// The PICKER — which of the two languages this reader sees — is deliberately NOT here. That is
// presentation, it runs in the browser only, and it lives with its siblings in the frontend's
// `productLabel.ts`, the same split `menuCategories.ts` makes for grouping.

/**
 * The longest blurb a shop may store, counted in characters after trimming.
 *
 * 160 because this is one line under a shop name on a phone, not an About page. A merchant who
 * needs a paragraph is describing products, and every product already has its own description.
 */
export const SHOP_DESCRIPTION_MAX = 160

/** Why a merchant's own blurb is not a legal blurb. */
export type ShopDescriptionError = 'malformed_description' | 'description_too_long'

/**
 * Is this a legal shop description? `null` when it is.
 *
 * `undefined` is "the request did not mention this field"; `null` and a blank string are both
 * the merchant CLEARING it, which is the only way back to a storefront with no blurb. All three
 * pass — the caller turns the blank forms into `null` before writing, so the column never holds
 * two spellings of "no description".
 */
export function validateShopDescription(value: unknown): ShopDescriptionError | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return 'malformed_description'
  // Trimmed BEFORE measuring, because that is what gets stored. Counting the raw string would
  // refuse a blurb at the cap that a trailing newline pushed one character over.
  if (value.trim().length > SHOP_DESCRIPTION_MAX) return 'description_too_long'
  return null
}
