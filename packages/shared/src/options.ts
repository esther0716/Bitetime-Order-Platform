/**
 * Menu options — the merchant's question, the customer's answer, and the identity of a cart
 * line that carries one. See `CONTEXT.md` -> *Menu options*, ADR 0008 and ADR 0009.
 *
 * Lives in `@bitetime/shared` for the reason `pricing.ts` does: the browser quotes and the
 * backend charges, and a disagreement between them is a refused checkout rather than a
 * rounding gap.
 */

/** One answer inside a group. `delta` is a COST on top of the unit price, never a discount. */
export interface Option {
  id: string
  name: string
  name_zh?: string | null
  /** Added per selected unit, on top of whichever unit price is in force (promo or base). */
  delta: number
  active: boolean
}

/**
 * A question the merchant attaches to a product.
 *
 * `maxPerOption` is INDEPENDENT of `maxSelect` and cannot be inferred from it: "pick up to 3
 * toppings" is `maxSelect: 3, maxPerOption: 1`, and a customer taking chilli three times is not
 * what the merchant meant. `null` on either means unbounded.
 */
export interface OptionGroup {
  id: string
  name: string
  name_zh?: string | null
  minSelect: number
  maxSelect: number | null
  maxPerOption: number | null
  active: boolean
  options: Option[]
}

/** What the customer chose for ONE group, on ONE unit of the product. */
export interface Selection {
  groupId: string
  /**
   * Option id -> how many of it, per unit. A RECORD and not a list, so "chocolate" cannot
   * appear twice in one answer — a shape that has no meaning and would have to be refused.
   */
  picks: Record<string, number>
}

/** What the customer put in the cart. NOT `ReceiptLine`, which is a priced line for display. */
export interface CartLine {
  productId: string
  qty: number
  selections: Selection[]
}

/**
 * A value serialised so that two structurally equal values produce the same string, whatever
 * order their keys were written in.
 *
 * The primitive under BOTH the cart line key and the Pro write gate's "did the groups change"
 * comparison. One function for both is not tidiness: if it normalises away a real difference a
 * Basic shop can edit its option groups, and if it invents one no Basic shop can save a product
 * at all — so the two uses share a blast radius, and therefore a test.
 */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  const row = v as Record<string, unknown>
  const keys = Object.keys(row).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(row[k])}`).join(',')}}`
}

/**
 * The identity of a cart line: the product plus what was chosen on it.
 *
 * DERIVED, never carried on the wire — the backend re-derives it from a `(productId,
 * selections)` it is validating anyway, where a client-generated id would be one more thing it
 * has to trust. Two adds that produce the same key MERGE, which is why `qty` is not part of it:
 * merging is what sets qty.
 */
export function cartLineKey(line: CartLine): string {
  const selections = [...line.selections]
    .sort((a, b) => (a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0))
    .map(s => ({ groupId: s.groupId, picks: s.picks }))
  return `${line.productId}|${canonicalJson(selections)}`
}

/** Why an answer is not a legal answer to the questions asked. */
export type SelectionError =
  | 'too_few' | 'too_many' | 'too_many_of_option'
  | 'unknown_group' | 'unknown_option' | 'option_unavailable'
  | 'invalid_pick' | 'duplicate_group'

/**
 * The most of one option a single unit may take when the group sets no `maxPerOption`.
 *
 * Deliberately NOT `MAX_CART_QTY`, and not required to agree with it: that one caps a product
 * in a cart, this one caps an answer within a unit of it. They are the same *kind* of ceiling
 * for the same reason — a quantity has no natural ceiling in JSON — but nothing breaks if they
 * differ, so they are not one constant pretending to mean two things.
 */
export const MAX_PICK_QTY = 1000

/** How many units this answer allocates across a group. */
function picked(selections: Selection[], groupId: string): number {
  const s = selections.find(x => x.groupId === groupId)
  return s ? Object.values(s.picks).reduce((a, b) => a + b, 0) : 0
}

/**
 * Is this a legal answer to these questions? `null` when it is.
 *
 * Checked on BOTH sides: the storefront gates Add on it so a customer cannot build an order that
 * is dead on arrival, and the backend refuses on it because a body is not a promise.
 */
export function validateSelections(
  groups: OptionGroup[],
  selections: Selection[],
): SelectionError | null {
  // A SWITCHED-OFF group is not a question, so it is neither enforced nor answerable. That is
  // what makes the Pro downgrade survivable: `active: false` on every group leaves optional ones
  // simply gone, without `priceOrder` ever asking what tier the shop is on (ADR 0010).
  const asked = groups.filter(g => g.active)

  // IDS FIRST, and the order is load-bearing: a stale answer naming a group this product no
  // longer asks would otherwise be reported as `too_few` against a group it was never about.
  const answered = new Set<string>()
  for (const s of selections) {
    // TWO answers to one question is not a bigger answer, it is an unanswerable one — and
    // silently so: every per-group count below reads the FIRST match, so a second answer would
    // walk straight past `maxPerOption`.
    if (answered.has(s.groupId)) return 'duplicate_group'
    answered.add(s.groupId)

    const g = asked.find(x => x.id === s.groupId)
    if (!g) return 'unknown_group'
    for (const [optionId, qty] of Object.entries(s.picks)) {
      const o = g.options.find(x => x.id === optionId)
      if (!o) return 'unknown_option'
      if (!o.active) return 'option_unavailable'
      if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_PICK_QTY) return 'invalid_pick'
    }
  }

  for (const g of asked) {
    const answer = selections.find(s => s.groupId === g.id)
    const total = picked(selections, g.id)
    if (total < g.minSelect) return 'too_few'
    if (g.maxSelect !== null && total > g.maxSelect) return 'too_many'
    if (g.maxPerOption !== null && answer) {
      for (const qty of Object.values(answer.picks)) {
        if (qty > g.maxPerOption) return 'too_many_of_option'
      }
    }
  }
  return null
}

/** The most groups one product may ask, and the most options one group may offer. */
export const MAX_GROUPS_PER_PRODUCT = 10
export const MAX_OPTIONS_PER_GROUP = 50

/** Why a merchant's own configuration is not legal configuration. */
export type GroupConfigError =
  | 'impossible_window' | 'window_too_wide' | 'negative_delta' | 'empty_group'
  | 'duplicate_group_id' | 'duplicate_option_id'
  | 'too_many_groups' | 'too_many_options'

/**
 * Is this a legal set of questions? `null` when it is.
 *
 * ADR 0008 put the groups in a jsonb column, which bought atomic saves and cost every `check`
 * constraint Postgres would otherwise have held. THIS FUNCTION IS WHAT STANDS THERE INSTEAD —
 * the database will happily store `minSelect: 9, maxSelect: 2` if this is wrong. Affordable only
 * because the backend is the sole writer after the browser lost its grants.
 *
 * The caps are not tidiness either: `maxSelect` decides how many picks a customer may legally
 * send, so a merchant's config is now an input to the size of a request body.
 */
export function validateOptionGroups(groups: OptionGroup[]): GroupConfigError | null {
  if (groups.length > MAX_GROUPS_PER_PRODUCT) return 'too_many_groups'

  const groupIds = new Set<string>()
  for (const g of groups) {
    if (groupIds.has(g.id)) return 'duplicate_group_id'
    groupIds.add(g.id)

    if (g.options.length === 0) return 'empty_group'
    if (g.options.length > MAX_OPTIONS_PER_GROUP) return 'too_many_options'
    if (g.maxSelect !== null && g.maxSelect > MAX_PICK_QTY) return 'window_too_wide'
    if (g.maxSelect !== null && g.minSelect > g.maxSelect) return 'impossible_window'

    const optionIds = new Set<string>()
    for (const o of g.options) {
      if (optionIds.has(o.id)) return 'duplicate_option_id'
      optionIds.add(o.id)
      if (o.delta < 0) return 'negative_delta'
    }
  }
  return null
}

/**
 * One option, as the ORDER records it: names and the delta that was actually charged.
 *
 * A snapshot and never a reference. An order is a financial record, not a view of current
 * config — a merchant tidying their menu next month must not rewrite last month's receipts, and
 * ADR 0008 put the groups in a jsonb column, so there is no foreign key that would stop them.
 * The `delta` is stored for the same reason: without it a line's `unitPrice` cannot be
 * reconciled against a menu that has since moved.
 */
export interface PickSnapshot {
  groupId: string
  groupName: string
  groupName_zh?: string | null
  optionId: string
  optionName: string
  optionName_zh?: string | null
  qty: number
  delta: number
}

/**
 * Resolve an answer against the questions, in CONFIG order rather than the order the client
 * wrote its picks — so the same answer always snapshots identically, whoever sent it.
 */
export function snapshotSelections(
  groups: OptionGroup[],
  selections: Selection[],
): PickSnapshot[] {
  const out: PickSnapshot[] = []
  for (const g of groups) {
    const answer = selections.find(s => s.groupId === g.id)
    if (!answer) continue
    for (const o of g.options) {
      const qty = answer.picks[o.id]
      if (!qty) continue
      out.push({
        groupId: g.id, groupName: g.name, groupName_zh: g.name_zh,
        optionId: o.id, optionName: o.name, optionName_zh: o.name_zh,
        qty, delta: o.delta,
      })
    }
  }
  return out
}

/** What one UNIT's answer adds to its price. Per selected unit: three of a +0.50 flavour is +1.50. */
export function picksDelta(picks: PickSnapshot[]): number {
  return picks.reduce((s, p) => s + p.qty * p.delta, 0)
}

/**
 * Switch every group off, destroying nothing.
 *
 * What a step down from Pro to Basic does to a shop's menu (ADR 0010). The voucher move, not a
 * delete: `active: false` and the merchant's configuration survives verbatim, because ADR 0008
 * put the groups in a jsonb column on the product row and there is no history to restore from.
 *
 * `validateSelections` already ignores an inactive group, so nothing downstream has to ask what
 * tier a shop is on — which is the constraint ADR 0004 named and this exists to respect.
 */
export function deactivateGroups(groups: OptionGroup[]): OptionGroup[] {
  return groups.map(g => ({ ...g, active: false }))
}

/**
 * Does any of this ask a question the customer MUST answer?
 *
 * Such a product comes off sale at downgrade. It is unfulfillable rather than degraded: with its
 * group switched off it would sell a six-muffin box with no flavours chosen, leaving the merchant
 * to guess what to pack. A product whose groups are all optional keeps selling and loses an upsell.
 */
export function hasRequiredGroup(groups: OptionGroup[]): boolean {
  return groups.some(g => g.active && g.minSelect >= 1)
}

/** Is there anything left to switch off? The idempotency guard on the revoke. */
export function hasActiveGroup(groups: OptionGroup[]): boolean {
  return groups.some(g => g.active)
}
