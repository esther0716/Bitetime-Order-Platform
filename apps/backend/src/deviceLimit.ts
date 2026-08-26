// The pure half of the merchant device limit: which sessions must go, and which session the
// caller is holding. The statements that actually delete them are in deviceLimitDb.ts, for the
// reason every other `xDb.ts` here exists — this half must stay reachable from `pnpm test`,
// which runs with no env, no database and no Supabase.
//
// A "device" is one GoTrue session. The platform stores no device identifier of its own and runs
// no fingerprint, so a session row IS the device, and deleting the row IS signing it out.

/** The fields of `auth.sessions` this rule reads. `timestamptz` arrives from db.ts as a Date. */
export interface SessionRow {
  id: string
  createdAt: Date
  refreshedAt: Date | null
}

/**
 * When a session was last used.
 *
 * `refreshed_at` stays NULL until a session refreshes for the first time, which is roughly its
 * first hour. A rule that read `refreshed_at` alone would therefore rank every brand-new session
 * as the oldest thing on the account and evict the merchant's own sign-in.
 */
export function lastSeen(row: SessionRow): number {
  return (row.refreshedAt ?? row.createdAt).getTime()
}

/**
 * The sessions to delete so the account is left holding at most `limit` of them.
 *
 * THE CURRENT SESSION IS PINNED FIRST, and only then are the remaining `limit - 1` slots filled
 * by recency. This is deliberately not "keep the newest `limit` rows". The two agree whenever the
 * clocks agree, and when they do not, the merchant must keep the device in their hand — being
 * signed out by one's own successful sign-in is not a failure a merchant can act on.
 *
 * Returns an empty array when there is nothing to do, INCLUDING when `currentSessionId` is not in
 * `sessions`. That case means a concurrent request already deleted the caller's row, and acting
 * on it would sign devices out on behalf of a session that no longer exists.
 */
export function chooseEvictions({
  sessions,
  currentSessionId,
  limit,
}: {
  sessions: SessionRow[]
  currentSessionId: string
  limit: number
}): string[] {
  if (limit < 1) return []
  if (sessions.length <= limit) return []
  if (!sessions.some(s => s.id === currentSessionId)) return []

  // Most recent first. The id breaks a tie, so two sessions sharing a timestamp always produce
  // the same answer rather than one that depends on the order Postgres returned the rows in.
  const others = sessions
    .filter(s => s.id !== currentSessionId)
    .sort((a, b) => lastSeen(b) - lastSeen(a) || a.id.localeCompare(b.id))

  return others.slice(limit - 1).map(s => s.id)
}

/**
 * The `session_id` claim of an access token, or null.
 *
 * This decodes the payload WITHOUT verifying the signature, and that is only safe because of the
 * order the caller runs things in: `getUserFromToken` hands the same string to GoTrue first, and
 * GoTrue rejects it if the signature, the expiry or the session is bad. This function is reading
 * a string that has already been proven. Call it on an unverified token and it tells you whatever
 * the caller wrote.
 */
export function sessionIdFromToken(token: string): string | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
    if (typeof claims !== 'object' || claims === null) return null
    const id = (claims as { session_id?: unknown }).session_id
    return typeof id === 'string' && id.length > 0 ? id : null
  } catch {
    return null
  }
}
