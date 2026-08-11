// Menu categories — the sections a merchant arranges their own menu into, and the rules that
// decide whether a submitted list is legal configuration.
//
// Shared because both sides of the wire read the same column: the backend validates it at the
// write endpoints and compares it there to decide a Pro gate, and the storefront maps the same
// row to render its headings. A row mapped on one side and not the other is the failure mode
// `productFromRow` records — here it would be a shop's menu structure silently gone, not a
// refused checkout, but the reason to share the mapper is identical.
//
// GROUPING PRODUCTS INTO SECTIONS IS NOT HERE. That is presentation, it runs in the browser
// only, and the backend has no opinion about it — see `menuGroups.ts` in the frontend.
//
// See CONTEXT.md → Menu category, and ADR 0013.

/**
 * One section of a shop's menu.
 *
 * `name_zh` is optional and falls back to the English string, matching `products.name_zh`.
 * `active` does double duty on purpose: it is the merchant's own Hide toggle AND the flag a
 * downgrade writes, which is what lets a re-upgrade need no resurrection logic — the merchant
 * switches them back on. The storefront reads this flag and never the shop's plan.
 */
export interface MenuCategory {
  id: string
  name: string
  name_zh?: string
  active: boolean
}

/** The most sections one shop may arrange, and the longest a section's name may be. */
export const MAX_MENU_CATEGORIES = 20
export const MENU_CATEGORY_NAME_MAX = 40

/** Why a merchant's own list of sections is not a legal list of sections. */
export type CategoryConfigError =
  | 'malformed_category' | 'blank_name' | 'name_too_long'
  | 'too_many_categories' | 'duplicate_category_id' | 'duplicate_category_name'

/**
 * A category name reduced to what the merchant was *reaching for* — case and punctuation folded.
 *
 * A MATCHING key and nothing else: never stored, never shown. `\p{P}\p{S}\s` rather than "keep
 * [a-z0-9]", because stripping to ASCII would reduce 蛋糕 to the empty string and make every
 * Chinese-named section collide with every other one.
 *
 * A DELIBERATE TWIN of `matchKey` in `apps/frontend/src/merchant/tagSuggestions.ts` — byte for
 * byte the same expression, and not shared with it. `@bitetime/shared` holds rules that must
 * hold identically on both sides of the wire, and that one does not: shop-customer tags are
 * matched in the browser to offer a merchant their own vocabulary back, and no backend rule
 * depends on the fold agreeing. Hoisting it here to save six lines would put a frontend
 * affordance in the package whose whole boundary is "both sides must agree", which is the
 * cheaper-duplicate call CLAUDE.md makes for `notify.ts`'s currency twin.
 *
 * Unlike a customer tag, a collision here is REFUSED rather than surfaced: #150 leaves `VIP` and
 * `V.I.P.` for the merchant to judge because nobody outside the shop sees them, and two headings
 * reading "Cakes" on one storefront is broken in a way no merchant meant.
 */
export const categoryMatchKey = (s: string): string =>
  s.toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')

/**
 * Is this a legal set of sections? `null` when it is.
 *
 * ADR 0013 put the list in a jsonb column, which bought a write path that already existed and
 * cost every `check` constraint Postgres would otherwise have held. THIS FUNCTION IS WHAT STANDS
 * THERE INSTEAD — the database will happily store two categories called "Cakes" if this is
 * wrong. Affordable only because the backend is the sole writer.
 */
export function validateMenuCategories(categories: unknown): CategoryConfigError | null {
  // SHAPE FIRST, and unconditionally. This is handed whatever a request body contained, so
  // every read below is on a value nothing has checked — `[{}]` reaching `.name.trim()` turns a
  // bad request into a 500 from inside the write endpoint, which is `validateOptionGroups`'
  // recorded lesson and not a hypothetical.
  if (!Array.isArray(categories)) return 'malformed_category'
  if (categories.length > MAX_MENU_CATEGORIES) return 'too_many_categories'

  const ids = new Set<string>()
  // Two folded vocabularies, not one: an English collision and a Chinese collision are each a
  // storefront showing one heading twice, but only in that language. Sharing a set would let
  // an English name collide with a Chinese one, which is not a thing that can happen on screen.
  const enNames = new Set<string>()
  const zhNames = new Set<string>()

  for (const c of categories as unknown[]) {
    if (!isObject(c)) return 'malformed_category'
    if (!isId(c.id) || typeof c.name !== 'string' || typeof c.active !== 'boolean') {
      return 'malformed_category'
    }
    // Absent is the "no Chinese name" state. `null` is NOT accepted as a synonym: the dialog
    // omits the key, and taking both would leave two spellings of one thing in the column.
    if (c.name_zh !== undefined && typeof c.name_zh !== 'string') return 'malformed_category'

    const name = c.name.trim()
    if (name === '') return 'blank_name'
    if (name.length > MENU_CATEGORY_NAME_MAX) return 'name_too_long'

    if (ids.has(c.id)) return 'duplicate_category_id'
    ids.add(c.id)

    const enKey = categoryMatchKey(name)
    if (enNames.has(enKey)) return 'duplicate_category_name'
    enNames.add(enKey)

    if (c.name_zh !== undefined) {
      const zh = c.name_zh.trim()
      if (zh === '') return 'blank_name'
      if (zh.length > MENU_CATEGORY_NAME_MAX) return 'name_too_long'
      const zhKey = categoryMatchKey(zh)
      if (zhNames.has(zhKey)) return 'duplicate_category_name'
      zhNames.add(zhKey)
    }
  }
  return null
}

/**
 * A `merchants.product_categories` value → the list the storefront and the gate read.
 *
 * Tolerant on purpose, and in one direction only: anything that is not an array reads as NO
 * categories, which renders the flat menu every shop had before this existed. The alternative —
 * throwing — would take down a storefront over a column, and there is no state this can fail
 * *open* into. `postgres.js` and PostgREST disagree about whether jsonb arrives parsed, hence
 * the string branch; that is the same split `optionGroupsFromRow` handles.
 */
export function menuCategoriesFromRow(value: unknown): MenuCategory[] {
  const raw = typeof value === 'string' ? safeParse(value) : value
  return Array.isArray(raw) ? (raw as MenuCategory[]) : []
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const isId = (v: unknown): v is string => typeof v === 'string' && v !== ''
