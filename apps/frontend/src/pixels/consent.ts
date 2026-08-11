// What the visitor answered when asked about advertising cookies.
//
// FAILS CLOSED, everywhere and on purpose. Storage missing, storage throwing, stored JSON
// corrupt, stored choice unrecognised — every one of them reads as "no choice made", which shows
// the banner again and leaves the pixels unloaded. The failure mode of the opposite default is a
// third-party script running for someone who never agreed to it, which is the whole thing this
// module exists to prevent.
//
// SCOPED, because the merchant-pixel feature (#220) puts a second, unrelated question in front of
// a different audience: a customer's answer at `shop:kopi-corner` must not be read as an answer to
// TinyOrder's own banner, and vice versa.

export type ConsentChoice = 'accepted' | 'rejected'

/** The scope of TinyOrder's own banner, on its own marketing pages. */
export const PLATFORM_CONSENT_SCOPE = 'platform'

// VERSIONED so that adding a vendor can invalidate stored consent by bumping to v2, rather than
// treating an answer given about Meta as an answer about someone else. Silently reusing it would
// claim the visitor agreed to something they were never shown.
const KEY_PREFIX = 'to_consent_v1'

interface StoredConsent {
  scope: string
  choice: ConsentChoice
  /** Epoch ms. Unused today; here so a future expiry does not need a v2 to become possible. */
  ts: number
}

function keyFor(scope: string): string {
  return `${KEY_PREFIX}.${scope}`
}

export function readConsent(scope: string): ConsentChoice | null {
  try {
    const raw = localStorage.getItem(keyFor(scope))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredConsent
    return parsed.choice === 'accepted' || parsed.choice === 'rejected' ? parsed.choice : null
  } catch {
    return null
  }
}

export function writeConsent(scope: string, choice: ConsentChoice): void {
  try {
    const stored: StoredConsent = { scope, choice, ts: Date.now() }
    localStorage.setItem(keyFor(scope), JSON.stringify(stored))
  } catch {
    // Storage unavailable. The choice still holds for this page's lifetime, because the caller
    // keeps it in React state; it is simply not remembered for the next visit.
  }
}
