// Pure referral-code helpers — format validation + self-referral guard. DOM/DB-free and
// unit-testable. A referral code is the first 8 hex chars of a user id, uppercased
// (see referralCodeOf in store.ts). The self-referral guard takes the owner's code as a
// parameter rather than importing referralCodeOf, to avoid a store.ts ↔ referralCode.ts
// import cycle.

export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const code = (raw ?? '').trim().toUpperCase()
  return /^[0-9A-F]{8}$/.test(code) ? code : null
}

// The code to store on a new merchant: normalized, but never the owner's own code.
export function resolveReferredByCode(
  raw: string | null | undefined,
  ownerCode: string,
): string | null {
  const code = normalizeReferralCode(raw)
  if (!code) return null
  return code === ownerCode ? null : code
}

/**
 * What the signup field should show for whatever the merchant typed or pasted.
 *
 * A referrer shares their invite LINK at least as often as the bare code (that is what
 * `referralSignupUrl` builds), so a pasted URL is read for its `ref` parameter instead of being
 * rejected as a line of nonsense. Everything else is trimmed and uppercased — the stored code is
 * uppercase hex, and a merchant typing lower case is not making a mistake.
 *
 * Nothing is truncated: a value of the wrong length must reach the format check and be SAID, not
 * be quietly cut down to eight characters that look correct and match nobody.
 */
export function referralCodeFromInput(raw: string): string {
  const text = (raw ?? '').trim()
  const fromUrl = /[?&]ref=([^&\s]+)/i.exec(text)
  const value = fromUrl ? decodeURIComponent(fromUrl[1]) : text
  return value.trim().toUpperCase()
}
