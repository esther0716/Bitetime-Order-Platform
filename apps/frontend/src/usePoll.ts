// The thin wire around `shouldFetch` — a timer, a visibilitychange listener, and cleanup.
// Everything decidable lives in poll.ts, where it is tested; this file exists to hold the
// browser plumbing that a `node` test environment cannot exercise, and is verified by running
// the app.
import { useEffect, useRef } from 'react'
import { POLL_INTERVAL_MS, shouldFetch } from './poll'

/**
 * Runs `fn` in the background while the tab is visible: on an interval, and once immediately on
 * returning to the tab if a full interval has passed while away.
 *
 * `fn` is held in a ref, so a caller may pass a fresh closure on every render without
 * restarting the timer — the common case, since the callbacks this polls are `useCallback`s
 * whose identity changes with the merchant.
 *
 * Does NOT fire on mount. Callers already load their own data once; a mount fire would double
 * every first paint.
 */
export function usePoll(fn: () => void, { enabled = true } = {}) {
  // Written in an effect rather than during render: a ref touched while rendering is a
  // React Compiler error, and the value is only ever read from a timer callback anyway.
  const fnRef = useRef(fn)
  useEffect(() => { fnRef.current = fn })

  const lastFetchedAt = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return

    // Seeded to "now" rather than left null: the caller has just loaded its own data, and a null
    // would make the first visibility check fire a second, duplicate fetch immediately.
    lastFetchedAt.current = Date.now()

    const run = () => {
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible'
      if (!shouldFetch({ visible, lastFetchedAt: lastFetchedAt.current, now: Date.now(), intervalMs: POLL_INTERVAL_MS })) return
      lastFetchedAt.current = Date.now()
      fnRef.current()
    }

    // The interval keeps ticking in a hidden tab (browsers only throttle it), and `run` is what
    // refuses to act — so returning to the tab needs no timer restart, just a check.
    const timer = window.setInterval(run, POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', run)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', run)
    }
  }, [enabled])
}
