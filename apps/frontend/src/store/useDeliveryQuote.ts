import { useEffect, useRef, useState } from 'react'
import { quoteDelivery } from '../store'
import {
  requestFor, started, landed, invalidated,
  selectQuote, selectQuoting, selectError,
  type QuoteSlot,
} from './quoteMachine'
import type { QuoteRefusalCode } from './orderRefusal'

/**
 * The distance quote for the address currently in the form — WIRING ONLY.
 *
 * Every decision this flow makes lives in `quoteMachine.ts`, which is pure and tested. What is
 * left here is React: one piece of state, one effect, one fetch. There is deliberately nothing to
 * assert about it that the machine's own tests do not already assert, which is what keeps this
 * file verifiable by running the app (`CLAUDE.md`) rather than by a component test.
 *
 * The fetcher is imported, not injected. An injected port would be a parameter no caller ever
 * varies: the machine is HANDED results and never fetches, so no test needs the seam, and
 * `store.ts` is already the one place every API call goes through.
 */
export interface DeliveryQuote {
  /** The fee for the address on screen, or `null` — a state the UI must SAY, never show as 0. */
  readonly quote: { readonly km: number; readonly fee: number } | null
  /** The refusal for the address on screen, as a CODE. Rendered through `quoteRefusalPlan`. */
  readonly quoteError: QuoteRefusalCode | null
  readonly quoting: boolean
  /**
   * Throw the quote away though the address has not moved — `price_changed`'s `clear_quote`.
   * The re-quote follows on its own via the effect below; `requote` exists so the recovery is
   * still an explicit, ordered step rather than an implied side effect.
   */
  invalidate(): void
  /** `clear_quote` + ask again, in one act. Safe to call alongside the effect — see below. */
  requote(): void
}

/**
 * @param merchantId - The shop being quoted against.
 * @param placeId - The place id the form currently holds. `undefined`/`''` for a typed address,
 *   which cannot be routed and is never asked about.
 * @param enabled - Express is the customer's choice AND the shop can price it. A region-priced
 *   order asks for nothing; every quote is a request the platform pays for.
 */
export function useDeliveryQuote(
  merchantId: string | undefined,
  placeId: string | null | undefined,
  enabled: boolean,
): DeliveryQuote {
  const [slot, setSlot] = useState<QuoteSlot>(null)

  /**
   * The place id an HTTP request is currently open for — a ref, because it must be written
   * SYNCHRONOUSLY, before `ask` yields.
   *
   * It is a COST guard and nothing else: `requestFor` still decides whether to quote, and `seq`
   * below is what keeps the answers straight. This only stops one decision being acted on twice
   * in a single tick, which `setSlot` cannot do on its own — the pending slot is not readable
   * until the next render, and StrictMode invokes the effect twice on mount against the same
   * committed `slot`. Without it a returning customer's auto-quote would spend two billable
   * Google lookups where one was decided.
   */
  const openRef = useRef<string | null>(null)
  /** Monotonic request id. Only ever increments; `landed` uses it to drop an older answer. */
  const seqRef = useRef(0)

  // Closes over THIS render's `merchantId`, which is what makes a request belong to the shop it
  // was started for. The effect below re-runs when that changes, so `ask` is never stale.
  const ask = async (id: string) => {
    const shop = merchantId
    if (!shop) return
    if (openRef.current === id) return
    openRef.current = id
    const seq = ++seqRef.current
    setSlot(prev => started(prev, id, seq))
    const r = await quoteDelivery(shop, id)
    // Cleared before the state write, and unconditionally: this request is over whether or not
    // its answer is still wanted, and leaving the id here would refuse the NEXT one for it.
    if (openRef.current === id) openRef.current = null
    // `landed` decides whether this answer still applies. It is the only guard, and it lives in
    // the machine — there is nothing to clear here if the answer turns out to be stale.
    setSlot(prev => landed(prev, id, seq, r.ok
      ? { ok: true, km: r.data.km, fee: r.data.fee }
      : { ok: false, code: r.error.code }))
  }

  /**
   * Ask for whatever the machine says needs asking.
   *
   * This is the auto-quote — the thing that makes a RETURNING customer's saved, already-routable
   * address price itself on load instead of showing "not calculated yet" until they re-pick it
   * from the list. It is also the re-quote after an `invalidate()`, since an emptied slot is by
   * definition a place id nothing is known about.
   *
   * It cannot loop and it cannot double-fire: `requestFor` answers `null` for any place id the
   * slot already holds in any status, and both `ask` and `requote` write the pending slot before
   * yielding. The whole of that guard is in the machine, where it is tested.
   */
  useEffect(() => {
    const wanted = requestFor(slot, placeId, enabled)
    if (wanted) void ask(wanted)
  }, [slot, placeId, enabled, merchantId])

  return {
    quote: selectQuote(slot, placeId),
    quoteError: selectError(slot, placeId),
    quoting: selectQuoting(slot, placeId),
    // `openRef` is released alongside the slot. It is only a same-tick cost guard, and holding it
    // across an invalidation would refuse the very re-ask the invalidation exists to allow — an
    // answer still in flight for this id is dropped by `seq`, not by being kept out.
    invalidate: () => { openRef.current = null; setSlot(invalidated) },
    // Writes the pending slot synchronously, so the effect's own `requestFor` sees an id already
    // in flight and stands down. One request, not two.
    requote: () => { if (placeId) { openRef.current = null; void ask(placeId) } },
  }
}
