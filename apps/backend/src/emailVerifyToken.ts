// The link a merchant clicks to prove an email address is theirs.
//
// A SIGNED token rather than a row in a table, and the reason is what the feature is for: it
// catches a typo. A typo'd address never receives the mail, so nothing is ever clicked and a
// stored token would sit there for ever — a table whose rows are, by design, mostly garbage.
// Nothing here needs to be revoked, counted or listed; it needs to be unforgeable and to expire.
//
// The payload carries the ADDRESS as well as the user, and that is not redundancy: a merchant
// who corrects a typo gets a new address, and a link minted for the old one must not verify the
// new one. The verifier compares the address in the token against the account's address now.
//
// Pure: the secret is a parameter, never read from env.ts, so `pnpm test` drives every branch
// with no environment at all — the same posture the Claude adapters take.

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Seven days, matching the trial. A merchant who lets it lapse asks for another. */
export const EMAIL_VERIFY_TTL_SECONDS = 7 * 24 * 60 * 60

export interface EmailVerifyClaims {
  userId: string
  email: string
}

export type EmailVerifyFailure = 'malformed' | 'bad_signature' | 'expired'

export type EmailVerifyResult =
  | { ok: true; claims: EmailVerifyClaims }
  | { ok: false; error: EmailVerifyFailure }

function b64url(value: Buffer): string {
  return value.toString('base64url')
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payload).digest())
}

/**
 * Mint a token for one address, expiring `ttlSeconds` from `nowMs`.
 *
 * `nowMs` is a parameter for the reason every clock in this codebase is: a test that has to wait
 * seven days to prove expiry is a test nobody runs.
 */
export function makeEmailVerifyToken(
  claims: EmailVerifyClaims,
  secret: string,
  nowMs: number,
  ttlSeconds: number = EMAIL_VERIFY_TTL_SECONDS,
): string {
  const body = JSON.stringify({
    u: claims.userId,
    e: claims.email,
    x: Math.floor(nowMs / 1000) + ttlSeconds,
  })
  const payload = b64url(Buffer.from(body, 'utf8'))
  return `${payload}.${sign(payload, secret)}`
}

/**
 * Read a token back, or say why it cannot be trusted.
 *
 * The signature is checked BEFORE the payload is parsed as anything meaningful, because the
 * payload is attacker-controlled until it is. Comparison is timing-safe, and the lengths are
 * equalised first — `timingSafeEqual` throws on a length mismatch, which would itself be a
 * signal.
 */
export function readEmailVerifyToken(
  token: unknown,
  secret: string,
  nowMs: number,
): EmailVerifyResult {
  if (typeof token !== 'string' || !token) return { ok: false, error: 'malformed' }
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, error: 'malformed' }
  const [payload, signature] = parts

  const expected = Buffer.from(sign(payload, secret), 'utf8')
  const given = Buffer.from(signature, 'utf8')
  if (expected.length !== given.length) return { ok: false, error: 'bad_signature' }
  if (!timingSafeEqual(expected, given)) return { ok: false, error: 'bad_signature' }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, error: 'malformed' }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'malformed' }
  const { u, e, x } = parsed as Record<string, unknown>
  if (typeof u !== 'string' || !u) return { ok: false, error: 'malformed' }
  if (typeof e !== 'string' || !e) return { ok: false, error: 'malformed' }
  if (typeof x !== 'number' || !Number.isFinite(x)) return { ok: false, error: 'malformed' }

  if (Math.floor(nowMs / 1000) >= x) return { ok: false, error: 'expired' }
  return { ok: true, claims: { userId: u, email: e } }
}
