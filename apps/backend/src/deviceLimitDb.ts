// The persistent half of the merchant device limit: two statements against `auth.sessions`, and
// nothing else. The rule lives next door in `deviceLimit.ts`, which is pure — see the note at the
// top of that file for why the split.
//
// It reads and deletes rows in the `auth` schema. It adds NO trigger and NO column there: that
// schema belongs to Supabase and is upgraded by Supabase, so this module keeps to data
// statements, which survive an upgrade the way any other row does. Production was checked on
// 2026-08-25 and connects as `postgres`, which holds both privileges.
//
// Deleting a row here is the whole of "sign this device out". GoTrue rejects that session's
// still-unexpired access token immediately (403 session_not_found) and its refresh token with it,
// on every path — this API, Storage and PostgREST alike.
//
// Goes through `db.ts`, which is RLS-EXEMPT: no policy runs on this connection, so both
// statements carry their own `user_id` predicate and the route's guard is what makes it true.
import { sql } from './db.js'
import type { SessionRow } from './deviceLimit.js'

/** A row of `auth.sessions`, with the agent string and the timestamps the device list shows. */
export interface DeviceSession extends SessionRow {
  updatedAt: Date
  userAgent: string | null
}

/**
 * Every live session for one account.
 *
 * NOTE the cast on `refreshed_at`. It is `timestamp WITHOUT time zone`, while every other column
 * here is `timestamptz`. GoTrue writes UTC into it, but a naive timestamp carries no offset, so
 * the driver builds the Date in the SERVER's local zone and the instant reads EARLY by exactly
 * that offset — eight hours, on a machine in Malaysia. Ranked against a correct `created_at`, that
 * makes a session refreshed minutes ago look half a day stale, and the device limit then evicts
 * the wrong one. `at time zone 'utc'` reads the column as what it actually is.
 *
 * It is harmless on a UTC server, which is exactly why it hides.
 */
export async function listSessions(userId: string): Promise<DeviceSession[]> {
  const rows = await sql<{
    id: string; created_at: Date; updated_at: Date; refreshed_at: Date | null; user_agent: string | null
  }[]>`
    select id,
           created_at,
           updated_at,
           -- naive UTC column; see the note above this function
           (refreshed_at at time zone 'utc') as refreshed_at,
           user_agent
    from auth.sessions
    where user_id = ${userId}
  `
  // Mapped explicitly rather than handed to c.json(): db.ts returns timestamptz as a Date, and
  // the rule wants a Date, not the ISO string a JSON serialisation would silently produce.
  return rows.map(r => ({
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    refreshedAt: r.refreshed_at,
    userAgent: r.user_agent,
  }))
}

/**
 * Sign the named sessions out. Returns how many rows went.
 *
 * The `user_id` predicate is redundant against a caller that passes ids it read from
 * `listSessions`, and it stays anyway: this connection runs no policy, so it is the only thing
 * standing between a future caller's bug and one merchant deleting another's session.
 *
 * No transaction. It is one statement, and a partial delete is not a state this feature can be
 * left in.
 */
export async function deleteSessions(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const rows = await sql<{ id: string }[]>`
    delete from auth.sessions
    where user_id = ${userId}
      and id = any(${ids}::uuid[])
    returning id
  `
  return rows.length
}
