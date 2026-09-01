// Whether this browser has already refused the end-of-page signup card.
//
// A module of its own rather than a condition inside the component, for the reason cta.ts gives for
// its own split: a rule reachable only by scrolling a real page in a real browser is a rule nobody
// tests. WHERE the card appears is not here — that is an IntersectionObserver on a sentinel above
// the footer (ScrollCta.tsx), which is a position in the document rather than a number to get
// right. What is left is how long a refusal lasts, which is the part that decides whether the card
// reads as a nudge or as a nuisance.

/** How long a dismissal is remembered, in days. */
export const SCROLL_CTA_DISMISSAL_DAYS = 30

const DISMISSAL_MS = SCROLL_CTA_DISMISSAL_DAYS * 24 * 60 * 60 * 1000

// `bitetime.` to match every other key this app writes (pixels/consent.ts, checkoutGate.ts), so
// the whole namespace stays greppable by one prefix. Versioned so that a card asking something
// different can start from a clean slate instead of inheriting a refusal of the old one.
const KEY = 'bitetime.scroll-cta.v1'

/**
 * Does a dismissal recorded at `dismissedAt` still hold at `now`?
 *
 * A timestamp in the FUTURE holds too — a clock that has moved backwards is not a reason to ask
 * again, and the alternative reads a device's wrong clock as permission to nag.
 */
export function dismissalHolds(dismissedAt: number | null, now: number): boolean {
  if (dismissedAt === null) return false
  return now - dismissedAt < DISMISSAL_MS
}

interface StoredDismissal {
  /** Epoch ms — WHEN the visitor closed the card. */
  ts: number
}

/**
 * When this browser last closed the card, or null.
 *
 * FAILS OPEN, unlike pixels/consent.ts: storage missing, storage throwing or the stored value
 * corrupt all read as "never dismissed", so the card appears. The cost of being wrong here is one
 * card too many; the cost of failing open on consent is a third-party script nobody agreed to.
 */
export function readDismissedAt(): number | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredDismissal
    return typeof parsed.ts === 'number' && Number.isFinite(parsed.ts) ? parsed.ts : null
  } catch {
    return null
  }
}

/** Remember that this browser has closed the card. */
export function writeDismissal(now: number = Date.now()): void {
  try {
    const stored: StoredDismissal = { ts: now }
    localStorage.setItem(KEY, JSON.stringify(stored))
  } catch {
    // Storage unavailable. The card stays closed for this page's lifetime because the caller keeps
    // it in React state; it is simply not remembered for the next visit.
  }
}
