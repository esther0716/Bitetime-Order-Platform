// src/signOutScope.test.ts
// The two rules that make the merchant device limit mean TWO devices rather than one, both of
// which would fail silently: nothing else in the suite would notice either regression, and the
// backend's own tests cannot see them at all.
//
//   1. `signOut` must pass `{ scope: 'local' }`. @supabase/auth-js defaults to `'global'`, which
//      revokes EVERY session the account holds — so signing out on the phone would kill the
//      laptop too, and a two-device account would behave as a one-device account.
//   2. The sign-out INTENT must be consumed by the SIGNED_OUT handler itself. Leaving it for the
//      login screen to clear was a real bug: signing out lands on the marketing page, not on that
//      screen, so a stale flag survived and silenced the notice for a genuine eviction later.
//
// Same reasoning as tests/unit/shopAssistant.test.ts asserting `fallbacks` is absent: pin the
// thing whose absence looks like success.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const signOutMock = vi.fn()
let authHandler: ((event: string, session: unknown) => void) | null = null

vi.mock('./supabase', () => ({
  auth: {
    signOut: (...args: unknown[]) => signOutMock(...args),
    onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
      authHandler = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    },
    getUser: vi.fn(),
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
  },
  storage: { from: vi.fn() },
}))

import { signOut, onAuthChange, SIGNED_OUT_ELSEWHERE_KEY } from './store'

/** A Map-backed sessionStorage — the frontend suite runs on `environment: 'node'`. */
function stubSessionStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  })
  return store
}

let session: Map<string, string>

beforeEach(() => {
  signOutMock.mockReset()
  signOutMock.mockResolvedValue({ error: null })
  authHandler = null
  session = stubSessionStorage()
})

/** Subscribe, then fire one SIGNED_OUT the way auth-js would. */
function fireSignedOut() {
  onAuthChange(() => {})
  authHandler?.('SIGNED_OUT', null)
}

describe('signOut', () => {
  it('signs out THIS device only, never every session on the account', async () => {
    await signOut()
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('never calls signOut with no argument, which would default to global', async () => {
    await signOut()
    expect(signOutMock).not.toHaveBeenCalledWith()
    expect(signOutMock.mock.calls[0][0]).toEqual({ scope: 'local' })
  })
})

describe('an unexpected SIGNED_OUT', () => {
  it('is flagged, so the login screen can explain the device limit', () => {
    fireSignedOut()
    expect(session.get(SIGNED_OUT_ELSEWHERE_KEY)).toBe('yes')
  })

  it('is NOT flagged when the merchant signed out themselves', async () => {
    await signOut()
    fireSignedOut()
    expect(session.get(SIGNED_OUT_ELSEWHERE_KEY)).toBeUndefined()
  })

  it('is still flagged after an earlier intentional sign-out in the same tab', async () => {
    // The regression. Signing out lands on the marketing page, not the login screen, so nothing
    // used to clear the intent — and the NEXT sign-out, a real eviction, was read as intentional
    // and explained to the merchant as nothing at all.
    await signOut()
    fireSignedOut()
    expect(session.get(SIGNED_OUT_ELSEWHERE_KEY)).toBeUndefined()

    fireSignedOut()
    expect(session.get(SIGNED_OUT_ELSEWHERE_KEY)).toBe('yes')
  })
})
