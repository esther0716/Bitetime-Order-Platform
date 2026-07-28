import { describe, it, expect } from 'vitest'
import { shouldFetch, POLL_INTERVAL_MS } from './poll'

// The two rules that ARE the polling feature, isolated from the timer and the DOM so they can
// be stated rather than observed: never work in a hidden tab, and returning to a tab refreshes
// immediately without turning tab-flicking into a request per flick.

const at = (over: Partial<Parameters<typeof shouldFetch>[0]> = {}) =>
  shouldFetch({ visible: true, lastFetchedAt: 0, now: POLL_INTERVAL_MS, intervalMs: POLL_INTERVAL_MS, ...over })

describe('shouldFetch', () => {
  it('never fetches while the tab is hidden, however long it has been', () => {
    expect(at({ visible: false, now: POLL_INTERVAL_MS * 100 })).toBe(false)
  })

  it('fetches on the first run, when nothing has been fetched yet', () => {
    expect(at({ lastFetchedAt: null, now: 0 })).toBe(true)
  })

  it('fetches once a full interval has passed', () => {
    expect(at({ lastFetchedAt: 0, now: POLL_INTERVAL_MS + 1 })).toBe(true)
  })

  it('fetches exactly ON the interval boundary', () => {
    // Inclusive, or a timer firing a hair early would silently skip a whole cycle.
    expect(at({ lastFetchedAt: 0, now: POLL_INTERVAL_MS })).toBe(true)
  })

  it('does not fetch when the last fetch was recent — flicking tabs is not a request each time', () => {
    expect(at({ lastFetchedAt: 0, now: POLL_INTERVAL_MS - 1 })).toBe(false)
  })

  it('does not fetch when the clock appears to run backwards', () => {
    // A machine waking from sleep or a corrected clock must not read as "an interval elapsed".
    expect(at({ lastFetchedAt: POLL_INTERVAL_MS * 10, now: 0 })).toBe(false)
  })

  it('honours a caller-supplied interval rather than the default', () => {
    expect(at({ lastFetchedAt: 0, now: 500, intervalMs: 1000 })).toBe(false)
    expect(at({ lastFetchedAt: 0, now: 1000, intervalMs: 1000 })).toBe(true)
  })
})

describe('POLL_INTERVAL_MS', () => {
  it('is 30 seconds — one value, so changing the load on the API is a one-line change', () => {
    expect(POLL_INTERVAL_MS).toBe(30_000)
  })
})
