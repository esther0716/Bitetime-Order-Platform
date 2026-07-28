import type { QuoteRefusalCode } from './orderRefusal'

/**
 * The delivery quote, as a state machine that nothing has to remember to clear.
 *
 * This used to be three independent pieces of component state — `quote`, `quoteError` and a
 * `quoting` boolean — plus a `useRef` holding the last requested place id, all private to
 * `Storefront.tsx`. Three of the fixed bugs in that file came from the same shape: a value that
 * was correct when it was written and had to be un-written by hand at some later moment, by a
 * caller who might not be there.
 *
 * Here there is ONE slot, stamped with the place id it belongs to, and the three things the form
 * renders are SELECTORS over it — `selectQuote`, `selectQuoting`, `selectError` — each asked
 * against the place id currently on screen. A quote for an address the customer has left is not
 * cleared; it simply stops being selected. Two bugs become unrepresentable rather than fixed:
 *
 * - The stuck spinner (#101 review, Finding 1). `quoting` was a boolean that a superseded request
 *   could not clear (its own guard saw a mismatched token and returned early), so typing over an
 *   in-flight pick left "Calculating delivery fee…" on screen forever. `selectQuoting` cannot
 *   outlive its place id, because it is not stored.
 * - The stale refusal (Finding 5). A failure landing for an address the customer had already
 *   replaced wiped the good quote and stamped a refusal onto it. `landed` drops any response
 *   whose place id is not the slot's own.
 *
 * SINGLE SLOT, not a per-place-id cache. That is a deliberate limit, and it preserves a retry
 * the customer relies on: pick A (refused), pick B (refused), come back to A — A is no longer
 * remembered, so it is asked again. A cache would answer from A's stored failure and silently
 * withhold the retry.
 */
export type QuoteSlot =
  | { readonly placeId: string; readonly seq: number; readonly status: 'pending' }
  | { readonly placeId: string; readonly status: 'ok'; readonly km: number; readonly fee: number }
  | { readonly placeId: string; readonly status: 'failed'; readonly code: QuoteRefusalCode }
  | null

/** What a request came back with. The machine is HANDED this; it never fetches. */
export type QuoteResult =
  | { readonly ok: true; readonly km: number; readonly fee: number }
  | { readonly ok: false; readonly code: QuoteRefusalCode }

/**
 * Should a quote be asked for, and for which place id? `null` means no.
 *
 * The auto-quote guard, and the whole of it. It answers no for a place id the slot already holds
 * in ANY status — in flight, quoted, or refused. That one rule does three jobs the old `useRef`
 * did separately: it stops the effect re-firing on every render, it stops it looping after a
 * failure (a refused address is re-asked only when the customer actively picks it again, which
 * clears the slot by moving it to a different place id — or by `invalidated`), and it stops it
 * racing a manual pick, since the pick writes the pending slot first.
 *
 * `enabled` is the shop's own answer to whether a distance quote is meaningful at all — express
 * chosen AND priceable. A region-priced order asks for nothing.
 */
export function requestFor(slot: QuoteSlot, placeId: string | null | undefined, enabled: boolean): string | null {
  if (!enabled) return null
  if (!placeId) return null
  if (slot && slot.placeId === placeId) return null
  return placeId
}

/**
 * A request has gone out. Supersedes whatever the slot held — including another place id's quote.
 *
 * `seq` is the caller's own monotonic counter, and the pending slot carries it so `landed` can
 * tell two requests for the SAME address apart. That is not hypothetical: `invalidated` exists
 * precisely to re-ask an unchanged address, so a place id alone cannot say which request an
 * answer belongs to.
 */
export function started(_slot: QuoteSlot, placeId: string, seq: number): QuoteSlot {
  return { placeId, seq, status: 'pending' }
}

/**
 * A response has come back. Applied ONLY if the slot is still waiting for THIS request.
 *
 * All three parts of that test earn their place:
 *
 * - The place id drops a superseded pick — A (slow), then B (fast), and A's answer arrives to
 *   find the slot stamped B (#101 review, Finding 5).
 * - `pending` drops an answer to a slot that has since been cleared outright.
 * - `seq` drops the OLD request when the same address has been asked about twice: an invalidate
 *   plus a re-quote leaves two requests in flight for one place id, and without this whichever
 *   answered first would win — which on a `price_changed` recovery is exactly the stale fee the
 *   recovery exists to replace.
 */
export function landed(slot: QuoteSlot, placeId: string, seq: number, result: QuoteResult): QuoteSlot {
  if (!slot || slot.status !== 'pending' || slot.placeId !== placeId || slot.seq !== seq) return slot
  return result.ok
    ? { placeId, status: 'ok', km: result.km, fee: result.fee }
    : { placeId, status: 'failed', code: result.code }
}

/**
 * Throw the slot away though the address has not moved.
 *
 * The one invalidation derivation cannot make for itself. Every OTHER way a quote stops applying
 * is a change of place id, which the selectors already handle by not selecting it. This is the
 * case where the address is the same and the ANSWER moved underneath it: a merchant editing
 * `distance_base` or `distance_rate_per_km` mid-checkout prices exactly like an edited product
 * price, and the backend refuses the order (`price_changed`). See `orderRefusal.ts`, whose
 * `clear_quote` action is this function and nothing else.
 */
export function invalidated(_slot: QuoteSlot): QuoteSlot {
  return null
}

/**
 * The quote for the address on screen, or `null` — which the summary must SAY ("not calculated
 * yet"), never show as a fee of 0.
 */
export function selectQuote(slot: QuoteSlot, placeId: string | null | undefined): { km: number; fee: number } | null {
  if (!slot || !placeId || slot.placeId !== placeId || slot.status !== 'ok') return null
  return { km: slot.km, fee: slot.fee }
}

/** Is a quote in flight FOR THE ADDRESS ON SCREEN? Derived, so it cannot be left switched on. */
export function selectQuoting(slot: QuoteSlot, placeId: string | null | undefined): boolean {
  return !!slot && !!placeId && slot.placeId === placeId && slot.status === 'pending'
}

/**
 * The refusal for the address on screen, as a CODE — not a sentence.
 *
 * The component renders it through `quoteRefusalPlan` at the moment it paints. Storing the
 * rendered string instead (as this flow used to) froze two things that can still move while it
 * sits on screen: the language, which `LanguageSelect` switches from the storefront's own header,
 * and `pickupEscape`, which a merchant refresh can turn on. A refusal that keeps speaking English
 * to a customer who has switched to Chinese is the whole page disagreeing with one line of it.
 */
export function selectError(slot: QuoteSlot, placeId: string | null | undefined): QuoteRefusalCode | null {
  if (!slot || !placeId || slot.placeId !== placeId || slot.status !== 'failed') return null
  return slot.code
}
