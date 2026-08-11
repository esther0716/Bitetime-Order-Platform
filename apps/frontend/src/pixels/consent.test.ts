import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readConsent, writeConsent, PLATFORM_CONSENT_SCOPE } from './consent'

const store = new Map<string, string>()
const fake = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}

beforeEach(() => {
  store.clear()
  ;(globalThis as any).localStorage = fake
})
afterEach(() => {
  delete (globalThis as any).localStorage
})

describe('consent', () => {
  it('has made no choice until one is made', () => {
    expect(readConsent(PLATFORM_CONSENT_SCOPE)).toBeNull()
  })

  it('round-trips an acceptance', () => {
    writeConsent(PLATFORM_CONSENT_SCOPE, 'accepted')
    expect(readConsent(PLATFORM_CONSENT_SCOPE)).toBe('accepted')
  })

  it('round-trips a rejection, which is a real answer and not an absent one', () => {
    writeConsent(PLATFORM_CONSENT_SCOPE, 'rejected')
    expect(readConsent(PLATFORM_CONSENT_SCOPE)).toBe('rejected')
  })

  it('keeps scopes apart, so a shop’s banner is not answered by the platform’s', () => {
    writeConsent(PLATFORM_CONSENT_SCOPE, 'accepted')
    expect(readConsent('shop:kopi-corner')).toBeNull()
  })

  it('records when the choice was made, so a future version can expire it', () => {
    writeConsent(PLATFORM_CONSENT_SCOPE, 'accepted')
    const raw = JSON.parse(store.get('to_consent_v1.platform')!)
    expect(raw).toMatchObject({ scope: 'platform', choice: 'accepted' })
    expect(typeof raw.ts).toBe('number')
  })

  it('reads corrupt storage as no choice, never as consent', () => {
    store.set('to_consent_v1.platform', 'not json')
    expect(readConsent(PLATFORM_CONSENT_SCOPE)).toBeNull()
  })

  it('reads an unrecognised choice as no choice, never as consent', () => {
    store.set('to_consent_v1.platform', JSON.stringify({ scope: 'platform', choice: 'maybe', ts: 1 }))
    expect(readConsent(PLATFORM_CONSENT_SCOPE)).toBeNull()
  })

  it('fails closed when storage is unavailable, and never throws', () => {
    // Private-mode Safari throws on write; node/SSR has no localStorage at all. Either way the
    // honest answer is "no choice made" — the banner asks again and the pixels stay unloaded.
    delete (globalThis as any).localStorage
    expect(readConsent(PLATFORM_CONSENT_SCOPE)).toBeNull()
    expect(() => writeConsent(PLATFORM_CONSENT_SCOPE, 'accepted')).not.toThrow()

    ;(globalThis as any).localStorage = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    expect(readConsent(PLATFORM_CONSENT_SCOPE)).toBeNull()
    expect(() => writeConsent(PLATFORM_CONSENT_SCOPE, 'accepted')).not.toThrow()
  })
})
