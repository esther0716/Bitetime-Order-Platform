// tests/unit/deviceLimit.test.ts
// The pure half of the merchant device limit. No database, no env — this runs under `pnpm test`.
import { describe, it, expect } from 'vitest'
import { chooseEvictions, sessionIdFromToken, type SessionRow } from '../../src/deviceLimit.js'

/** A session row `n` minutes old, never refreshed unless `refreshedMinutesAgo` says otherwise. */
function row(id: string, createdMinutesAgo: number, refreshedMinutesAgo?: number): SessionRow {
  const at = (m: number) => new Date(Date.UTC(2026, 7, 25, 12, 0, 0) - m * 60_000)
  return {
    id,
    createdAt: at(createdMinutesAgo),
    refreshedAt: refreshedMinutesAgo === undefined ? null : at(refreshedMinutesAgo),
  }
}

describe('chooseEvictions', () => {
  it('evicts nothing when the account is under the limit', () => {
    const sessions = [row('a', 10), row('b', 5)]
    expect(chooseEvictions({ sessions, currentSessionId: 'b', limit: 2 })).toEqual([])
  })

  it('evicts nothing when the account is exactly at the limit', () => {
    const sessions = [row('a', 10), row('b', 0)]
    expect(chooseEvictions({ sessions, currentSessionId: 'b', limit: 2 })).toEqual([])
  })

  it('evicts the least recently used session when a third arrives', () => {
    const sessions = [row('old', 500), row('middle', 100), row('new', 0)]
    expect(chooseEvictions({ sessions, currentSessionId: 'new', limit: 2 })).toEqual(['old'])
  })

  it('ranks a refreshed session by its refresh, not by its creation', () => {
    // `old` was created first but refreshed a minute ago, so `middle` is the stale one.
    const sessions = [row('old', 500, 1), row('middle', 100), row('new', 0)]
    expect(chooseEvictions({ sessions, currentSessionId: 'new', limit: 2 })).toEqual(['middle'])
  })

  it('keeps the current session even when it looks like the oldest', () => {
    // A wrong clock on the signing-in device. The merchant must never be evicted by their own
    // sign-in, so the current session is pinned before recency is consulted at all.
    const sessions = [row('current', 9999), row('a', 10), row('b', 5)]
    expect(chooseEvictions({ sessions, currentSessionId: 'current', limit: 2 })).toEqual(['a'])
  })

  it('evicts every surplus session, not only one', () => {
    const sessions = [row('a', 400), row('b', 300), row('c', 200), row('d', 0)]
    const evicted = chooseEvictions({ sessions, currentSessionId: 'd', limit: 2 })
    expect(evicted.sort()).toEqual(['a', 'b'])
  })

  it('is deterministic when two sessions share a timestamp', () => {
    const sessions = [row('a', 100), row('b', 100), row('c', 0)]
    const once = chooseEvictions({ sessions, currentSessionId: 'c', limit: 2 })
    const twice = chooseEvictions({ sessions, currentSessionId: 'c', limit: 2 })
    expect(once).toEqual(twice)
    expect(once).toHaveLength(1)
  })

  it('evicts nothing when the current session is not in the list', () => {
    // The caller's session was already deleted by a concurrent request. Deleting rows on that
    // reading would sign out devices on behalf of a session that no longer exists.
    const sessions = [row('a', 100), row('b', 50)]
    expect(chooseEvictions({ sessions, currentSessionId: 'gone', limit: 2 })).toEqual([])
  })

  it('evicts nothing when the limit is below one', () => {
    const sessions = [row('a', 100), row('b', 50)]
    expect(chooseEvictions({ sessions, currentSessionId: 'b', limit: 0 })).toEqual([])
  })
})

describe('sessionIdFromToken', () => {
  /** Builds a JWT-shaped string. The signature is never checked here — GoTrue already did that. */
  function tokenWith(payload: Record<string, unknown>): string {
    const b64 = (s: string) => Buffer.from(s).toString('base64url')
    return `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify(payload))}.signature`
  }

  it('reads the session_id claim', () => {
    const token = tokenWith({ sub: 'user-1', session_id: '7007d1d1-575f-45f3-9b05-5fed3c5a6961' })
    expect(sessionIdFromToken(token)).toBe('7007d1d1-575f-45f3-9b05-5fed3c5a6961')
  })

  it('returns null when the claim is absent', () => {
    expect(sessionIdFromToken(tokenWith({ sub: 'user-1' }))).toBeNull()
  })

  it('returns null for a malformed token rather than throwing', () => {
    expect(sessionIdFromToken('not-a-jwt')).toBeNull()
    expect(sessionIdFromToken('')).toBeNull()
    expect(sessionIdFromToken('a.b.c')).toBeNull()
  })

  it('returns null when session_id is not a string', () => {
    expect(sessionIdFromToken(tokenWith({ session_id: 42 }))).toBeNull()
  })
})
