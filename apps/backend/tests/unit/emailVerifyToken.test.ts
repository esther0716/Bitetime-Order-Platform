// The signed link that proves a merchant's address. Pure — no env, no Supabase.
import { describe, it, expect } from 'vitest'
import {
  makeEmailVerifyToken, readEmailVerifyToken, EMAIL_VERIFY_TTL_SECONDS,
} from '../../src/emailVerifyToken.js'

const SECRET = 'a-secret-that-only-the-backend-knows'
const NOW = 1_756_000_000_000
const CLAIMS = { userId: 'user-1', email: 'owner@example.com' }

describe('emailVerifyToken', () => {
  it('reads back exactly what it was given', () => {
    const token = makeEmailVerifyToken(CLAIMS, SECRET, NOW)
    expect(readEmailVerifyToken(token, SECRET, NOW)).toEqual({ ok: true, claims: CLAIMS })
  })

  it('refuses a token minted with a different secret', () => {
    const token = makeEmailVerifyToken(CLAIMS, 'someone-elses-secret', NOW)
    expect(readEmailVerifyToken(token, SECRET, NOW)).toEqual({ ok: false, error: 'bad_signature' })
  })

  it('refuses a payload edited after signing — the whole point of the signature', () => {
    const token = makeEmailVerifyToken(CLAIMS, SECRET, NOW)
    const [, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({
      u: 'somebody-else', e: 'attacker@example.com', x: Math.floor(NOW / 1000) + 3600,
    }), 'utf8').toString('base64url')
    expect(readEmailVerifyToken(`${forged}.${signature}`, SECRET, NOW))
      .toEqual({ ok: false, error: 'bad_signature' })
  })

  it('expires, and expiry is not a signature failure', () => {
    const token = makeEmailVerifyToken(CLAIMS, SECRET, NOW)
    const justInside = NOW + (EMAIL_VERIFY_TTL_SECONDS - 1) * 1000
    expect(readEmailVerifyToken(token, SECRET, justInside).ok).toBe(true)
    const justOutside = NOW + EMAIL_VERIFY_TTL_SECONDS * 1000
    expect(readEmailVerifyToken(token, SECRET, justOutside)).toEqual({ ok: false, error: 'expired' })
  })

  it('calls anything that is not a two-part string malformed, without throwing', () => {
    for (const bad of [undefined, null, 42, '', 'nodot', 'a.b.c', {}]) {
      expect(readEmailVerifyToken(bad, SECRET, NOW)).toEqual({ ok: false, error: 'malformed' })
    }
  })

  it('rejects a correctly signed payload that is not the shape we mint', async () => {
    // Signed with OUR secret, so the signature passes — the field checks are what stop it.
    const payload = Buffer.from(JSON.stringify({ u: 'user-1' }), 'utf8').toString('base64url')
    const { createHmac } = await import('node:crypto')
    const signature = createHmac('sha256', SECRET).update(payload).digest('base64url')
    expect(readEmailVerifyToken(`${payload}.${signature}`, SECRET, NOW))
      .toEqual({ ok: false, error: 'malformed' })
  })
})
