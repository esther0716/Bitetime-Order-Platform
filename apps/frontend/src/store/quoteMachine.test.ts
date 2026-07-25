import { describe, it, expect } from 'vitest'
import {
  requestFor, started, landed, invalidated,
  selectQuote, selectQuoting, selectError,
  type QuoteSlot,
} from './quoteMachine'

const A = 'place-a'
const B = 'place-b'

const ok = (placeId: string, km = 5.2, fee = 12): QuoteSlot => ({ placeId, status: 'ok', km, fee })
const pending = (placeId: string, seq = 1): QuoteSlot => ({ placeId, seq, status: 'pending' })
const failed = (placeId: string): QuoteSlot => ({ placeId, status: 'failed', code: 'out_of_range' })

describe('requestFor', () => {
  it('asks for a place id nothing is known about', () => {
    expect(requestFor(null, A, true)).toBe(A)
    expect(requestFor(ok(B), A, true)).toBe(A)
  })

  it('asks for nothing when express is not the priceable choice', () => {
    // A region-priced order, or an express shop whose distance config cannot price. Every quote
    // is a request the platform pays for; a form that cannot use one must not send one.
    expect(requestFor(null, A, false)).toBeNull()
  })

  it('asks for nothing without a place id', () => {
    // A typed address has no place id and cannot be routed. Both shapes the form can hand over.
    expect(requestFor(null, null, true)).toBeNull()
    expect(requestFor(null, '', true)).toBeNull()
  })

  it('does not re-ask for an id already in flight', () => {
    // The effect re-runs on every render; without this it would fire a second request for the
    // same address before the first came back.
    expect(requestFor(pending(A), A, true)).toBeNull()
  })

  it('does not re-ask for an id already quoted', () => {
    expect(requestFor(ok(A), A, true)).toBeNull()
  })

  it('does not loop on a refusal', () => {
    // A failed id stays known, so the effect stops. The customer must actively pick the address
    // again to retry — the same rule every other quote failure follows.
    expect(requestFor(failed(A), A, true)).toBeNull()
  })

  it('re-asks after an invalidation, and only then', () => {
    // `price_changed`'s recovery: the address has not moved, so nothing else here would ask again.
    expect(requestFor(invalidated(failed(A)), A, true)).toBe(A)
    expect(requestFor(invalidated(ok(A)), A, true)).toBe(A)
  })

  it('offers a refused address again once another has displaced it', () => {
    // The single-slot limit, asserted as the behaviour it buys: A refused, B refused, back to A —
    // A is asked again rather than answered from a cached failure.
    const afterB = started(failed(A), B, 2)
    expect(requestFor(landed(afterB, B, 2, { ok: false, code: 'out_of_range' }), A, true)).toBe(A)
  })
})

describe('landed', () => {
  it('applies a response for the address still on screen', () => {
    expect(landed(pending(A), A, 1, { ok: true, km: 5.2, fee: 12 })).toEqual(ok(A))
    expect(landed(pending(A), A, 1, { ok: false, code: 'out_of_range' })).toEqual(failed(A))
  })

  it('drops a superseded success', () => {
    // Pick A (slow), pick B (fast). A's answer arrives to find the slot stamped B and must not
    // overwrite the fee the customer is looking at.
    const slot = started(pending(A, 1), B, 2)
    expect(landed(slot, A, 1, { ok: true, km: 99, fee: 999 })).toEqual(pending(B, 2))
  })

  it('drops a superseded FAILURE', () => {
    // The half that actually bit (#101 review, Finding 5): the old code wiped the quote and
    // stamped a refusal unconditionally, so a slow refusal for an abandoned address blanked the
    // fee of the address that had just quoted fine.
    const slot = started(ok(A), B, 2)
    const done = landed(slot, B, 2, { ok: true, km: 3, fee: 8 })
    expect(landed(done, A, 1, { ok: false, code: 'out_of_range' })).toEqual(ok(B, 3, 8))
  })

  it('drops the OLD request when one address has been asked about twice', () => {
    // `price_changed` clears and re-asks the SAME place id, so two requests can be open for one
    // address and the place id alone cannot tell them apart. Whichever answered first would win —
    // and if that is the pre-invalidation request, the recovery replaces a stale fee with the
    // same stale fee, and the next Place Order is refused identically.
    const requoted = started(invalidated(pending(A, 1)), A, 2)
    expect(landed(requoted, A, 1, { ok: true, km: 99, fee: 999 })).toEqual(pending(A, 2))
    expect(landed(requoted, A, 2, { ok: true, km: 4, fee: 9 })).toEqual(ok(A, 4, 9))
  })

  it('drops a response that lands on an already-settled slot', () => {
    expect(landed(ok(A), A, 1, { ok: true, km: 1, fee: 1 })).toEqual(ok(A))
    expect(landed(failed(A), A, 1, { ok: true, km: 1, fee: 1 })).toEqual(failed(A))
  })

  it('drops a response that arrives after everything was cleared', () => {
    expect(landed(null, A, 1, { ok: true, km: 5, fee: 10 })).toBeNull()
  })
})

describe('selectors', () => {
  it('shows a quote only for the address in the form', () => {
    expect(selectQuote(ok(A), A)).toEqual({ km: 5.2, fee: 12 })
    expect(selectQuote(ok(A), B)).toBeNull()
    // A typed-over address has no place id at all: there is no fee, and the summary says so.
    expect(selectQuote(ok(A), '')).toBeNull()
    expect(selectQuote(ok(A), null)).toBeNull()
  })

  it('never reports a pending or failed slot as a fee', () => {
    expect(selectQuote(pending(A), A)).toBeNull()
    expect(selectQuote(failed(A), A)).toBeNull()
  })

  it('cannot leave the spinner running past the address it belongs to', () => {
    // #101 review, Finding 1. Typing over an in-flight pick clears the place id, and `quoting`
    // is not a boolean anyone has to switch off — it stops being true because it is derived.
    expect(selectQuoting(pending(A), A)).toBe(true)
    expect(selectQuoting(pending(A), '')).toBe(false)
    expect(selectQuoting(pending(A), B)).toBe(false)
    expect(selectQuoting(ok(A), A)).toBe(false)
  })

  it('shows a refusal only while it still names the address in the form', () => {
    // #101 review, Finding 2 kept it around across a mode flip; what invalidates a refusal is
    // the ADDRESS changing, and nothing else.
    expect(selectError(failed(A), A)).toBe('out_of_range')
    expect(selectError(failed(A), B)).toBeNull()
    expect(selectError(ok(A), A)).toBeNull()
  })
})
