// Which of a shop's own tags to offer back while the merchant is typing one (#150).
//
// Extracted rather than inlined in the drawer because the matching has real edges — case,
// punctuation, a second script, and what a merchant has already applied — and the repo's rule is
// that UI is verified by running the app, so logic worth arguing about has to live somewhere a
// test can reach it. See CONTEXT.md → Shop customer.

/**
 * A tag reduced to what the merchant was *reaching for* — case and punctuation folded away.
 *
 * This is a MATCHING key and nothing else. It is never stored and never shown: `V.I.P.` is
 * offered back exactly as it was typed, and the merchant decides whether it and `VIP` are the
 * same thing. Folding here is what surfaces the collision; folding on write would settle it for
 * them, which is the thing #150 exists to refuse.
 *
 * `\p{P}\p{S}\s` rather than "keep [a-z0-9]": a Chinese tag survives it. Stripping to ASCII
 * would reduce 熟客 to the empty string and quietly stop matching for half the shops on the
 * platform, which is exactly the kind of silent, cumulative failure this issue is about.
 */
const matchKey = (s: string) => s.toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')

/**
 * What to offer beneath the tag input.
 *
 * Already-applied tags are dropped — offering a merchant a tag this customer visibly carries is
 * an action that does nothing. A blank draft offers the whole vocabulary rather than nothing:
 * the merchant who cannot remember what they used needs to see the list *before* they start
 * guessing at it, which is the story the issue tells.
 *
 * Order is the caller's — the backend already sorts so two spellings of one tag land side by
 * side, and re-sorting here would be a second opinion about the same question.
 */
export function tagSuggestions(shopTags: string[], applied: string[], draft: string): string[] {
  const q = matchKey(draft)
  return shopTags.filter(s => !applied.includes(s) && (!q || matchKey(s).includes(q)))
}

/**
 * Fold a just-saved customer's tags back into the shop's vocabulary, in the backend's order.
 *
 * The comparator mirrors `shopTags` in the backend's `shopCustomers.ts` — case-insensitive so
 * `vip` and `VIP` sit side by side, raw as the tiebreak so the row does not reshuffle. A
 * deliberate duplicate rather than a shared module, on CLAUDE.md's own terms: this is chip
 * ORDER, not a rule that has to hold on both sides of the wire.
 *
 * It is additive, so the vocabulary can only run AHEAD of the server, never behind it: a tag
 * whose last holder just lost it keeps being offered until the next list load (which happens on
 * any sort, search, tag or page change — not on a write). Harmless in the direction that
 * matters, and the alternative is a refetch of the whole list to redraw one row of chips.
 */
export function mergeShopTags(known: string[], added: string[]): string[] {
  const next = [...new Set([...known, ...added])]
  return next.length === known.length ? known : next.sort(
    (a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || (a < b ? -1 : a > b ? 1 : 0),
  )
}
