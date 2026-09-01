import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  dismissalHolds, readDismissedAt, writeDismissal, SCROLL_CTA_DISMISSAL_DAYS,
} from './scrollCtaState'

const DAY = 24 * 60 * 60 * 1000

const store = new Map<string, string>()
const fake = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}

beforeEach(() => {
  store.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = fake
})
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('dismissalHolds', () => {
  const now = Date.UTC(2026, 8, 1)

  it('does not hold when the card has never been closed', () => {
    expect(dismissalHolds(null, now)).toBe(false)
  })

  it('holds the day after it was closed', () => {
    expect(dismissalHolds(now - DAY, now)).toBe(true)
  })

  it('holds up to the last day of the window', () => {
    expect(dismissalHolds(now - (SCROLL_CTA_DISMISSAL_DAYS * DAY - 1), now)).toBe(true)
  })

  it('lapses once the window is over', () => {
    expect(dismissalHolds(now - SCROLL_CTA_DISMISSAL_DAYS * DAY, now)).toBe(false)
  })

  // A device whose clock has moved backwards is not a reason to ask again.
  it('holds for a timestamp in the future', () => {
    expect(dismissalHolds(now + DAY, now)).toBe(true)
  })
})

describe('the stored dismissal', () => {
  it('reads as never dismissed until one is written', () => {
    expect(readDismissedAt()).toBeNull()
  })

  it('round-trips the moment the card was closed', () => {
    const now = Date.UTC(2026, 8, 1)
    writeDismissal(now)
    expect(readDismissedAt()).toBe(now)
  })

  // Fails OPEN, unlike consent: the worst case is one card too many.
  it('reads as never dismissed when the stored value is not a record', () => {
    store.set('bitetime.scroll-cta.v1', 'not json')
    expect(readDismissedAt()).toBeNull()
  })

  it('reads as never dismissed when the timestamp is not a number', () => {
    store.set('bitetime.scroll-cta.v1', JSON.stringify({ ts: 'yesterday' }))
    expect(readDismissedAt()).toBeNull()
  })

  it('survives storage being unavailable, on the read and on the write', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    expect(() => writeDismissal()).not.toThrow()
    expect(readDismissedAt()).toBeNull()
  })
})
