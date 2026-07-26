// When a background refresh may run. Pure, so the rules can be tested in this workspace's
// `node` test environment — the hook that wires them to a timer and the document is `usePoll`,
// and it is verified by running the app (see CLAUDE.md).

/**
 * How often a polled view refreshes. One value for every caller, so changing the load the
 * dashboard puts on the API is a one-line change.
 */
export const POLL_INTERVAL_MS = 30_000

export interface PollState {
  /** Is the document currently visible? A hidden tab never fetches. */
  visible: boolean
  /** When the last fetch STARTED, or null if none has. */
  lastFetchedAt: number | null
  now: number
  intervalMs: number
}

/**
 * Two rules, and they are the whole feature:
 *
 * 1. A hidden tab never fetches — a dashboard left open in a background tab must not spend a
 *    merchant's battery or data all day.
 * 2. A visible tab fetches once an interval has elapsed. This covers BOTH the ordinary tick and
 *    the return-to-tab refresh, which is why returning does not need a rule of its own: coming
 *    back after a while fetches at once, and flicking away and straight back does not, because
 *    the elapsed check has not moved.
 *
 * The boundary is inclusive — a timer that fires a hair early would otherwise skip a whole
 * cycle. A `now` earlier than the last fetch (a machine waking from sleep, a corrected clock)
 * reads as "no time has passed", never as an elapsed interval.
 */
export function shouldFetch({ visible, lastFetchedAt, now, intervalMs }: PollState): boolean {
  if (!visible) return false
  if (lastFetchedAt === null) return true
  return now - lastFetchedAt >= intervalMs
}
