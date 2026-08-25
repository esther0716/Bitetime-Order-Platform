# Merchant Device Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merchant account holds at most two signed-in devices. A third sign-in succeeds and signs out the device used longest ago.

**Architecture:** One GoTrue session is one device. The backend deletes the surplus row from `auth.sessions` after a sign-in, which GoTrue treats as an immediate revocation of that device's access token and refresh token. The rule is a pure module (`deviceLimit.ts`); the two SQL statements live next to it (`deviceLimitDb.ts`); three routes on `app.ts` expose enforce, list and remove.

**Tech Stack:** Hono, `postgres.js` through `src/db.ts`, Supabase Auth (GoTrue), React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-merchant-device-limit-design.md`

## Global Constraints

- The limit is **2**, and it lives in `apps/backend/src/quotaWindows.ts` as `MERCHANT_DEVICE_LIMIT`.
- The rule applies to **merchants only**. An account that owns no `merchants` row is never touched.
- The session id **always comes from the JWT**, never from a request body or a URL parameter.
- `db.ts` is **RLS-exempt**. Every statement in `deviceLimitDb.ts` carries its own `user_id` predicate.
- Backend relative imports keep `.js` specifiers. They resolve to the `.ts` source. Do not change them.
- Every user-facing string is `t(english, chinese)`. There is no i18n library.
- Never run `db:push` or any `supabase` command that reaches production.
- This feature adds **no migration**. It reads and deletes rows in the `auth` schema. It creates no table, no column and no trigger.

---

### Task 1: Production privilege gate

This task writes no code. It answers one question, and the answer decides whether the rest of the plan is valid.

`db.ts` connects as the database owner on the local stack, where `current_user` is `postgres` and both privileges are present:

```
privs: { current_user: 'postgres', can_select: true, can_delete: true }
```

Production may connect as a different role. If that role cannot delete from `auth.sessions`, this design cannot work, and the team must pick an `auth.sessions` trigger or a check in `mw.ts` instead (see *Rejected approaches* in the spec).

**Files:** none.

**Interfaces:**
- Consumes: nothing.
- Produces: a yes or a no. Every later task depends on the yes.

- [ ] **Step 1: Ask the human to run the probe against production**

You must not run this yourself. Production is the human's call. Give them this exact query and ask them to paste the result:

```sql
select current_user,
       has_table_privilege('auth.sessions', 'select') as can_select,
       has_table_privilege('auth.sessions', 'delete') as can_delete;
```

The query is read-only. It changes nothing.

- [ ] **Step 2: Read the answer**

If `can_delete` is `true`, continue to Task 2.

If `can_delete` is `false`, **stop**. Report the result. Say that approach B in the spec is dead, and that the choice is now the trigger or the `mw.ts` check. Do not pick one yourself. The user decides.

- [ ] **Step 3: Record the answer in the spec**

Replace the *Verify one thing before you write code* paragraph with the result and the date. A later reader must not have to run the probe again.

```bash
git add docs/superpowers/specs/2026-08-25-merchant-device-limit-design.md
git commit -m "docs(spec): production can delete auth.sessions, so the device limit stands"
```

---

### Task 2: The pure rule

**Files:**
- Create: `apps/backend/src/deviceLimit.ts`
- Create: `apps/backend/tests/unit/deviceLimit.test.ts`
- Modify: `apps/backend/src/quotaWindows.ts` (append the constant)

**Interfaces:**
- Consumes: nothing. This module imports no other module in the repo.
- Produces:
  - `export interface SessionRow { id: string; createdAt: Date; refreshedAt: Date | null }`
  - `export function lastSeen(row: SessionRow): number`
  - `export function chooseEvictions(input: { sessions: SessionRow[]; currentSessionId: string; limit: number }): string[]`
  - `export function sessionIdFromToken(token: string): string | null`
  - `MERCHANT_DEVICE_LIMIT` from `quotaWindows.js`, value `2`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/unit/deviceLimit.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bitetime/backend test -- deviceLimit`
Expected: FAIL. The message names `src/deviceLimit.js` as missing.

- [ ] **Step 3: Write the module**

Create `apps/backend/src/deviceLimit.ts`:

```ts
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
```

- [ ] **Step 4: Add the limit to `quotaWindows.ts`**

Append to `apps/backend/src/quotaWindows.ts`:

```ts
// How many devices one MERCHANT account may hold at once. A device is one GoTrue session.
//
// It sits here with the other platform figures rather than in deviceLimit.ts, so the numbers a
// shop is measured against are in one file. Unlike everything else in this module it bounds no
// spend and no request rate: it bounds credential sharing, which is why it is a small number and
// not a generous one.
//
// Customers and superadmins are not bounded at all. See
// docs/superpowers/specs/2026-08-25-merchant-device-limit-design.md.
export const MERCHANT_DEVICE_LIMIT = 2
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm --filter @bitetime/backend test -- deviceLimit`
Expected: PASS, 13 tests.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/deviceLimit.ts apps/backend/tests/unit/deviceLimit.test.ts apps/backend/src/quotaWindows.ts
git commit -m "feat(auth): the device limit rule, pure and pinned to the caller's own session"
```

---

### Task 3: The device label

**Files:**
- Create: `apps/backend/src/deviceLabel.ts`
- Create: `apps/backend/tests/unit/deviceLabel.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function deviceLabel(userAgent: string | null): string`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/unit/deviceLabel.test.ts`:

```ts
// tests/unit/deviceLabel.test.ts
// The user-agent string a merchant reads in Settings → Devices. Pure, so it runs under `pnpm test`.
import { describe, it, expect } from 'vitest'
import { deviceLabel } from '../../src/deviceLabel.js'

describe('deviceLabel', () => {
  it('reads Chrome on macOS', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    expect(deviceLabel(ua)).toBe('Chrome on macOS')
  })

  it('reads Safari on iPhone', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
    expect(deviceLabel(ua)).toBe('Safari on iPhone')
  })

  it('reads Chrome on Android', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    expect(deviceLabel(ua)).toBe('Chrome on Android')
  })

  it('reads Edge on Windows, and does not call it Chrome', () => {
    // Edge's agent contains the whole Chrome agent. Order of checks is the entire test.
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
    expect(deviceLabel(ua)).toBe('Edge on Windows')
  })

  it('reads Firefox on Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0'
    expect(deviceLabel(ua)).toBe('Firefox on Windows')
  })

  it('reads Safari on iPad', () => {
    const ua = 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/604.1'
    expect(deviceLabel(ua)).toBe('Safari on iPad')
  })

  it('names the browser alone when the platform is unknown', () => {
    expect(deviceLabel('Mozilla/5.0 (Unknown) Firefox/130.0')).toBe('Firefox')
  })

  it('names the platform alone when the browser is unknown', () => {
    expect(deviceLabel('curl/8.7.1 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macOS')
  })

  it('returns Unknown device rather than guessing', () => {
    expect(deviceLabel('curl/8.7.1')).toBe('Unknown device')
    expect(deviceLabel('')).toBe('Unknown device')
    expect(deviceLabel(null)).toBe('Unknown device')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bitetime/backend test -- deviceLabel`
Expected: FAIL. The message names `src/deviceLabel.js` as missing.

- [ ] **Step 3: Write the module**

Create `apps/backend/src/deviceLabel.ts`:

```ts
// The one line a merchant reads for each of their signed-in devices: "Chrome on macOS".
//
// A user-agent string is a claim the browser makes about itself, not a fact. It is good enough to
// help a merchant recognise their own phone in a list of two, and it is used for nothing else —
// no rule reads it, and no security decision rests on it.
//
// This deliberately does NOT return a best guess. "Unknown device" is honest and a wrong device
// name is not: the merchant is about to decide which session to sign out.

// Order matters twice over. Edge and Opera both carry the full Chrome agent, and Chrome carries
// "Safari", so the more specific name has to be tested first or every browser reads as Chrome.
const BROWSERS: [RegExp, string][] = [
  [/\bEdg[A-Z]?\//, 'Edge'],
  [/\bOPR\/|\bOpera\//, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
]

// iPhone and iPad are tested before Macintosh: an iPad's agent says "like Mac OS X".
const PLATFORMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bMacintosh\b|\bMac OS X\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
]

function firstMatch(table: [RegExp, string][], ua: string): string | null {
  for (const [pattern, name] of table) if (pattern.test(ua)) return name
  return null
}

/** A short human name for a user-agent string, or 'Unknown device' when it cannot be read. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? ''
  const browser = firstMatch(BROWSERS, ua)
  const platform = firstMatch(PLATFORMS, ua)
  if (browser && platform) return `${browser} on ${platform}`
  return browser ?? platform ?? 'Unknown device'
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @bitetime/backend test -- deviceLabel`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/deviceLabel.ts apps/backend/tests/unit/deviceLabel.test.ts
git commit -m "feat(auth): name a session's device from its user agent, or say it is unknown"
```

---

### Task 4: The two statements

**Files:**
- Create: `apps/backend/src/deviceLimitDb.ts`

**Interfaces:**
- Consumes: `SessionRow` from `./deviceLimit.js`; `sql` from `./db.js`.
- Produces:
  - `export interface DeviceSession extends SessionRow { userAgent: string | null }`
  - `export function listSessions(userId: string): Promise<DeviceSession[]>`
  - `export function deleteSessions(userId: string, ids: string[]): Promise<number>`

There is no unit test for this module. It is two statements and nothing else, and the suite that proves them is the database-backed one in Task 5. That matches `aiUsageDb.ts`, which is also proven by `tests/api` rather than by a mock.

- [ ] **Step 1: Write the module**

Create `apps/backend/src/deviceLimitDb.ts`:

```ts
// The persistent half of the merchant device limit: two statements against `auth.sessions`, and
// nothing else. The rule lives next door in `deviceLimit.ts`, which is pure — see the note at the
// top of that file for why the split.
//
// It reads and deletes rows in the `auth` schema. It adds NO trigger and NO column there: that
// schema belongs to Supabase and is upgraded by Supabase, so this module keeps to data
// statements, which survive an upgrade the way any other row does.
//
// Deleting a row here is the whole of "sign this device out". GoTrue rejects that session's
// still-unexpired access token immediately (403 session_not_found) and its refresh token with it,
// on every path — this API, Storage and PostgREST alike.
//
// Goes through `db.ts`, which is RLS-EXEMPT: no policy runs on this connection, so both
// statements carry their own `user_id` predicate and the route's guard is what makes it true.
import { sql } from './db.js'
import type { SessionRow } from './deviceLimit.js'

/** A row of `auth.sessions`, with the agent string the device list shows. */
export interface DeviceSession extends SessionRow {
  userAgent: string | null
}

/** Every live session for one account. */
export async function listSessions(userId: string): Promise<DeviceSession[]> {
  const rows = await sql<{ id: string; created_at: Date; refreshed_at: Date | null; user_agent: string | null }[]>`
    select id, created_at, refreshed_at, user_agent
    from auth.sessions
    where user_id = ${userId}
  `
  // Mapped explicitly rather than handed to c.json(): db.ts returns timestamptz as a Date, and
  // the rule wants a Date, not the ISO string a JSON serialisation would silently produce.
  return rows.map(r => ({
    id: r.id,
    createdAt: r.created_at,
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/deviceLimitDb.ts
git commit -m "feat(auth): read and delete a merchant's own sessions"
```

---

### Task 5: The three routes

**Files:**
- Modify: `apps/backend/src/app.ts` (add three routes and their imports)
- Create: `apps/backend/tests/api/devices.test.ts`

**Interfaces:**
- Consumes: `chooseEvictions`, `sessionIdFromToken` from `./deviceLimit.js`; `listSessions`, `deleteSessions` from `./deviceLimitDb.js`; `deviceLabel` from `./deviceLabel.js`; `MERCHANT_DEVICE_LIMIT` from `./quotaWindows.js`; `requireUser`, `bearer` from `./mw.js`; `admin` from `./supabase.js`.
- Produces three routes:
  - `POST /api/me/devices/enforce` → `200 { evicted: number }`
  - `GET /api/me/devices` → `200 { devices: [{ id, label, current, lastSeen }] }`
  - `DELETE /api/me/devices/:sessionId` → `200 { ok: true }`

The paths sit under `/api/me/`, beside `/api/me/profile` and `/api/me/merchant`, because they are about the caller's own account and carry no merchant id. A path with a merchant id would invite a handler that trusts one.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/api/devices.test.ts`:

```ts
// tests/api/devices.test.ts
// The merchant device limit, end to end against real GoTrue and real Postgres.
//
// The load-bearing assertions are that a third sign-in really removes the least recently used
// session, and that the removed session's UNEXPIRED access token stops working at once. Neither
// can be proven with a mock: they are properties of GoTrue and of `auth.sessions`, which is why
// this suite is here and not in tests/unit.
import { describe, it, expect, beforeEach } from 'vitest'
import { app } from '../../src/app.js'
import { sql } from '../../src/db.js'
import { makeUser, seedMerchant, resetMerchant, SUPABASE_URL, ANON_KEY } from '../rls/helpers.js'

/** A fresh sign-in for an existing account. Each call creates one more GoTrue session. */
async function signInAgain(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json() as { access_token?: string }
  if (!body.access_token) throw new Error(`sign-in failed: ${JSON.stringify(body)}`)
  return body.access_token
}

function call(path: string, method: 'GET' | 'POST' | 'DELETE', token?: string) {
  return app.request(path, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

async function sessionCount(userId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`select count(*)::int as n from auth.sessions where user_id = ${userId}`
  return rows[0].n
}

const PASSWORD = 'password123'

/** A merchant who owns an active shop, plus one signed-in session. */
async function merchantOwner(slug: string) {
  await resetMerchant(slug)
  const email = `${slug}@example.com`
  const client = await makeUser(email, PASSWORD)
  const { data } = await client.auth.getSession()
  const userId = data.session!.user.id
  await seedMerchant({ slug, owner_id: userId, status: 'active' })
  return { email, userId, token: data.session!.access_token }
}

beforeEach(async () => {
  // Sessions outlive a test unless they are cleared, and this suite counts them.
  await sql`delete from auth.sessions where user_id in (select id from auth.users where email like 'devices-%@example.com')`
})

describe('POST /api/me/devices/enforce', () => {
  it('evicts the least recently used session when a merchant signs in a third time', async () => {
    const owner = await merchantOwner('devices-lru')
    await signInAgain(owner.email, PASSWORD)
    const third = await signInAgain(owner.email, PASSWORD)
    expect(await sessionCount(owner.userId)).toBe(3)

    const res = await call('/api/me/devices/enforce', 'POST', third)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ evicted: 1 })
    expect(await sessionCount(owner.userId)).toBe(2)

    // The FIRST session is the one that went: it is the least recently used.
    const stillWorks = await call('/api/me/devices', 'GET', owner.token)
    expect(stillWorks.status).toBe(401)
  })

  it('leaves the calling session working after it evicts another', async () => {
    const owner = await merchantOwner('devices-keeps-current')
    await signInAgain(owner.email, PASSWORD)
    const third = await signInAgain(owner.email, PASSWORD)

    await call('/api/me/devices/enforce', 'POST', third)

    const res = await call('/api/me/devices', 'GET', third)
    expect(res.status).toBe(200)
  })

  it('evicts nothing when the merchant holds two sessions', async () => {
    const owner = await merchantOwner('devices-under-limit')
    const second = await signInAgain(owner.email, PASSWORD)

    const res = await call('/api/me/devices/enforce', 'POST', second)
    expect(await res.json()).toEqual({ evicted: 0 })
    expect(await sessionCount(owner.userId)).toBe(2)
  })

  it('leaves a customer account alone', async () => {
    // No merchants row. The limit is a merchant rule and a customer must pass through untouched.
    const email = 'devices-customer@example.com'
    const client = await makeUser(email, PASSWORD)
    const { data } = await client.auth.getSession()
    const userId = data.session!.user.id
    await signInAgain(email, PASSWORD)
    const third = await signInAgain(email, PASSWORD)

    const res = await call('/api/me/devices/enforce', 'POST', third)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ evicted: 0 })
    expect(await sessionCount(userId)).toBe(3)
  })

  it('refuses a caller with no token', async () => {
    const res = await call('/api/me/devices/enforce', 'POST')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/me/devices', () => {
  it('lists the caller’s own sessions and marks the current one', async () => {
    const owner = await merchantOwner('devices-list')
    const second = await signInAgain(owner.email, PASSWORD)

    const res = await call('/api/me/devices', 'GET', second)
    expect(res.status).toBe(200)
    const body = await res.json() as { devices: { id: string; label: string; current: boolean; lastSeen: string }[] }
    expect(body.devices).toHaveLength(2)
    expect(body.devices.filter(d => d.current)).toHaveLength(1)
    expect(typeof body.devices[0].label).toBe('string')
    expect(new Date(body.devices[0].lastSeen).toString()).not.toBe('Invalid Date')
  })

  it('refuses an account that owns no shop', async () => {
    const client = await makeUser('devices-nolist@example.com', PASSWORD)
    const { data } = await client.auth.getSession()
    const res = await call('/api/me/devices', 'GET', data.session!.access_token)
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/me/devices/:sessionId', () => {
  it('signs the named device out', async () => {
    const owner = await merchantOwner('devices-remove')
    const second = await signInAgain(owner.email, PASSWORD)

    const list = await (await call('/api/me/devices', 'GET', second)).json() as {
      devices: { id: string; current: boolean }[]
    }
    const other = list.devices.find(d => !d.current)!

    const res = await call(`/api/me/devices/${other.id}`, 'DELETE', second)
    expect(res.status).toBe(200)
    expect(await sessionCount(owner.userId)).toBe(1)

    // The signed-out device's own token is dead immediately, not at the next refresh.
    expect((await call('/api/me/devices', 'GET', owner.token)).status).toBe(401)
  })

  it('refuses a session id belonging to another account', async () => {
    // `db.ts` runs no policy, so this refusal IS the tenancy boundary.
    const a = await merchantOwner('devices-owner-a')
    const b = await merchantOwner('devices-owner-b')

    const res = await call(`/api/me/devices/${(await sessionIdOf(b.userId))}`, 'DELETE', a.token)
    expect(res.status).toBe(404)
    expect(await sessionCount(b.userId)).toBe(1)
  })

  it('refuses a session id that is not a uuid without a 500', async () => {
    const owner = await merchantOwner('devices-bad-id')
    const res = await call('/api/me/devices/not-a-uuid', 'DELETE', owner.token)
    expect(res.status).toBe(400)
  })
})

async function sessionIdOf(userId: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`select id from auth.sessions where user_id = ${userId} limit 1`
  return rows[0].id
}
```

- [ ] **Step 2: Run the test to verify it fails**

The local Supabase stack must be running. From `apps/backend`, run `supabase status` first; if it is down, run `supabase start`.

Run: `pnpm --filter @bitetime/backend test:db -- devices`
Expected: FAIL. Every request answers 404, because the routes do not exist.

- [ ] **Step 3: Add the imports to `app.ts`**

Add beside the other `./` imports near the top of `apps/backend/src/app.ts`:

```ts
import { chooseEvictions, sessionIdFromToken } from './deviceLimit.js'
import { listSessions, deleteSessions } from './deviceLimitDb.js'
import { deviceLabel } from './deviceLabel.js'
import { MERCHANT_DEVICE_LIMIT } from './quotaWindows.js'
```

`quotaWindows.js` may already be imported for the Google and Claude windows. If it is, add `MERCHANT_DEVICE_LIMIT` to that existing import rather than writing a second one.

- [ ] **Step 4: Write the routes**

Add to `apps/backend/src/app.ts`, next to the other `/api/me/` routes (near `app.get('/api/me/merchant', …)`):

```ts
// ── Device limit ──────────────────────────────────────────────────────────────
//
// A merchant account holds at most MERCHANT_DEVICE_LIMIT signed-in devices, and one device is one
// GoTrue session. See docs/superpowers/specs/2026-08-25-merchant-device-limit-design.md.
//
// THE SESSION ID COMES FROM THE JWT, never from a body or a path. `requireUser` has already handed
// the token to GoTrue, which rejects a bad signature, a stale expiry or a deleted session, so the
// claim below is read from a string that is already proven. A body-supplied id would let any
// merchant sign out any device by guessing a uuid.

/** The caller's own user id and session id, or null when the token carries no session claim. */
function callerSession(c: Context<AppEnv>): { userId: string; sessionId: string } | null {
  const sessionId = sessionIdFromToken(bearer(c))
  return sessionId ? { userId: c.get('user').id, sessionId } : null
}

/** True when this account owns a shop. The limit is a merchant rule and applies to nobody else. */
async function ownsAShop(userId: string): Promise<boolean> {
  const { data } = await admin.from('merchants').select('id').eq('owner_id', userId).limit(1)
  return (data?.length ?? 0) > 0
}

// Called by the browser right after a sign-in succeeds.
//
// It answers 200 for a customer rather than 403, unlike the two routes below: every sign-in calls
// this, and a customer signing in must not see an error in their console for a rule that is not
// about them.
app.post('/api/me/devices/enforce', requireUser, async (c) => {
  const caller = callerSession(c)
  if (!caller) return c.json({ evicted: 0 })
  if (!(await ownsAShop(caller.userId))) return c.json({ evicted: 0 })

  const sessions = await listSessions(caller.userId)
  const doomed = chooseEvictions({
    sessions,
    currentSessionId: caller.sessionId,
    limit: MERCHANT_DEVICE_LIMIT,
  })
  const evicted = await deleteSessions(caller.userId, doomed)
  return c.json({ evicted })
})

app.get('/api/me/devices', requireUser, async (c) => {
  const caller = callerSession(c)
  if (!caller) return c.json({ error: 'no_session_claim' }, 401)
  if (!(await ownsAShop(caller.userId))) return c.json({ error: 'Forbidden' }, 403)

  const sessions = await listSessions(caller.userId)
  // Most recently used first, so the merchant reads the list in the order they expect.
  const devices = sessions
    .map(s => ({
      id: s.id,
      label: deviceLabel(s.userAgent),
      current: s.id === caller.sessionId,
      lastSeen: (s.refreshedAt ?? s.createdAt).toISOString(),
    }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
  return c.json({ devices })
})

app.delete('/api/me/devices/:sessionId', requireUser, async (c) => {
  const caller = callerSession(c)
  if (!caller) return c.json({ error: 'no_session_claim' }, 401)
  if (!(await ownsAShop(caller.userId))) return c.json({ error: 'Forbidden' }, 403)

  const id = c.req.param('sessionId')
  // Checked here rather than left to Postgres: `id = any('{not-a-uuid}'::uuid[])` is a 22P02 and
  // would reach the merchant as a 500 for what is an ordinary bad request.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return c.json({ error: 'bad_session_id' }, 400)
  }

  // The caller's own sessions, and only those. `db.ts` runs no policy, so this membership test is
  // the whole tenancy guard — a stranger's session id must read as absent, not as deletable.
  const sessions = await listSessions(caller.userId)
  if (!sessions.some(s => s.id === id)) return c.json({ error: 'not_found' }, 404)

  await deleteSessions(caller.userId, [id])
  return c.json({ ok: true })
})
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @bitetime/backend test:db -- devices`
Expected: PASS, 10 tests.

If every test fails with a `makeUser` timeout, the machine is loaded rather than the code being wrong. Time one signup before debugging.

- [ ] **Step 6: Run the whole backend suite and the typecheck**

Run: `pnpm --filter @bitetime/backend test`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/app.ts apps/backend/tests/api/devices.test.ts
git commit -m "feat(auth): enforce, list and sign out a merchant's devices"
```

---

### Task 6: The browser calls it, and stops signing out globally

**Files:**
- Modify: `apps/frontend/src/store.ts` (`signIn`, `signOut`, and three new functions)

**Interfaces:**
- Consumes: `apiGet`, `apiSend` from `./api`; `auth` from `./supabase`.
- Produces:
  - `export interface Device { id: string; label: string; current: boolean; lastSeen: string }`
  - `export async function fetchMyDevices(): Promise<Result<Device[]>>`
  - `export async function signOutDevice(sessionId: string): Promise<Result<void>>`
  - `SIGNED_OUT_ELSEWHERE_KEY` — the `sessionStorage` key Task 8 reads

- [ ] **Step 1: Make `signIn` enforce the limit**

Replace `signIn` in `apps/frontend/src/store.ts`:

```ts
export async function signIn(email: string, password: string) {
  const { data, error } = await auth.signInWithPassword({ email, password });
  if (error) throw error;
  // The device limit, enforced by the backend against the session this sign-in just created.
  // Deliberately NOT awaited for its result and never thrown from: a merchant whose sign-in
  // worked must reach their dashboard even if this call did not land. The worst outcome of a
  // missed call is a third live session until the next sign-in, and the worst outcome of a
  // throw here is a merchant who cannot get in at all.
  void enforceDeviceLimit();
  return data.user;
}

/** Ask the backend to trim this account to its device limit. Failures are swallowed by design. */
async function enforceDeviceLimit() {
  const r = await apiSend<{ evicted: number }>('/api/me/devices/enforce', 'POST', undefined, { auth: 'required' });
  if (!r.ok) console.error('Device limit not enforced:', r.error.message);
}
```

Add `apiSend` to the existing `./api` import at the top of the file if it is not already there.

- [ ] **Step 2: Make sign-out local**

Replace `signOut` in `apps/frontend/src/store.ts`:

```ts
/**
 * The key that tells the login screen this sign-out was the merchant's own doing.
 *
 * Without it, an intentional sign-out and an eviction are the same `SIGNED_OUT` event, and the
 * login screen would explain the device limit to someone who simply clicked Sign out.
 */
export const SIGNED_OUT_ELSEWHERE_KEY = 'bt.signed_out_elsewhere';

export async function signOut() {
  // `scope: 'local'`, and the default is NOT that. `@supabase/auth-js` defaults `signOut()` to
  // `scope: 'global'`, which revokes EVERY session the account holds — so a merchant who signed
  // out on their phone lost the laptop too, and a two-device account behaved as a one-device
  // account. This line is what makes the device limit mean two devices.
  try { sessionStorage.setItem(SIGNED_OUT_ELSEWHERE_KEY, 'no'); } catch { /* private mode */ }
  await auth.signOut({ scope: 'local' });
}
```

- [ ] **Step 3: Flag an eviction on the way out**

In `onAuthChange` in `apps/frontend/src/store.ts`, inside the `auth.onAuthStateChange` callback and **before** `callback(user, event)`, add:

```ts
    // A SIGNED_OUT that this tab did not ask for means the session row is gone: either a third
    // device took the slot, or the merchant signed this device out from another one. Both read
    // the same way to the person holding it, and the login screen says so.
    if (event === 'SIGNED_OUT') {
      try {
        const mine = sessionStorage.getItem(SIGNED_OUT_ELSEWHERE_KEY) === 'no';
        sessionStorage.setItem(SIGNED_OUT_ELSEWHERE_KEY, mine ? 'no' : 'yes');
      } catch { /* private mode: the login screen simply says nothing */ }
    }
```

- [ ] **Step 4: Add the two device calls**

Add to `apps/frontend/src/store.ts`, in the auth section:

```ts
/** One signed-in device, as the Devices panel shows it. */
export interface Device {
  id: string;
  /** "Chrome on macOS", or "Unknown device". Read from the user agent, so it is a claim, not a fact. */
  label: string;
  current: boolean;
  /** ISO 8601. When the session was last used. */
  lastSeen: string;
}

export async function fetchMyDevices(): Promise<Result<Device[]>> {
  return mapOk(
    await apiGet<{ devices: Device[] }>('/api/me/devices', { auth: 'required' }),
    (d) => d.devices,
  );
}

export async function signOutDevice(sessionId: string): Promise<Result<void>> {
  return toVoid(await apiSend(`/api/me/devices/${sessionId}`, 'DELETE', undefined, { auth: 'required' }));
}
```

Add `mapOk` and `toVoid` to the existing `./api` import if they are not already there.

- [ ] **Step 5: Run the frontend tests and the typecheck**

Run: `pnpm --filter @bitetime/frontend test`
Expected: PASS. `store.test.ts` mocks `auth`; if it asserts on `signOut`, update the assertion to expect `{ scope: 'local' }`.

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/store.ts
git commit -m "feat(auth): the browser enforces the device limit, and signs out only itself"
```

---

### Task 7: The Devices panel

**Files:**
- Create: `apps/frontend/src/merchant/DevicesTab.tsx`
- Modify: `apps/frontend/src/merchant/ShopSettings.tsx` (add the tab)

**Interfaces:**
- Consumes: `fetchMyDevices`, `signOutDevice`, `type Device` from `../store`; `useSession` from `../SessionContext`.
- Produces: `export default function DevicesTab()`

- [ ] **Step 1: Write the panel**

Create `apps/frontend/src/merchant/DevicesTab.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useSession } from '../SessionContext'
import { fetchMyDevices, signOutDevice, type Device } from '../store'
import { Button } from '../components/ui/button'

// Settings → Devices. The merchant reads which two devices hold their account, and signs one out.
//
// It shows no IP address. `auth.sessions` stores one, but an address tells a merchant nothing they
// can act on, and making it useful means adding a geolocation provider — a second bill and a
// second thing to bound. The device name and when it was last used are what identify a phone.
//
// This tab has no Save and no dirty state, so unlike its neighbours it takes no `onDirtyChange`.
export default function DevicesTab() {
  const { t } = useSession()
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetchMyDevices()
    if (r.ok) { setDevices(r.data); setFailed(false) }
    else { setFailed(true) }
  }, [])

  useEffect(() => { void load() }, [load])

  const remove = async (id: string) => {
    setBusy(id)
    const r = await signOutDevice(id)
    setBusy(null)
    if (r.ok) { toast.success(t('Device signed out', '已登出该设备')); await load() }
    else toast.error(t('Could not sign that device out', '无法登出该设备'))
  }

  // A failed read and an empty list are different news, and only one of them is true at a time.
  if (failed) {
    return (
      <p className="text-[14px] text-muted-foreground">
        {t('We could not load your devices. Please try again.', '无法加载设备列表，请重试。')}
      </p>
    )
  }
  if (devices === null) {
    return <p className="text-[14px] text-muted-foreground">{t('Loading…', '加载中…')}</p>
  }

  return (
    <div className="max-w-[520px]">
      <p className="text-[14px] text-muted-foreground mb-5">
        {t(
          'Your account can be signed in on 2 devices. Signing in on a third signs out the one you used longest ago.',
          '您的账号最多可在 2 台设备上登录。在第三台设备登录后，最久未使用的设备会被登出。',
        )}
      </p>

      <ul className="flex flex-col">
        {devices.map(d => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-4 py-3 [border-bottom:0.5px_solid_var(--color-border)] last:border-b-0"
          >
            <div className="min-w-0">
              <div className="text-[14px] font-medium truncate">{d.label}</div>
              <div className="text-[13px] text-muted-foreground">
                {d.current
                  ? t('This device', '当前设备')
                  : t(`Last used ${formatLastSeen(d.lastSeen, 'en')}`, `最后使用：${formatLastSeen(d.lastSeen, 'zh')}`)}
              </div>
            </div>
            {!d.current && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy === d.id}
                onClick={() => remove(d.id)}
              >
                {t('Sign out', '登出')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A short "3 hours ago" for a session's last use. Falls back to the date past a week. */
function formatLastSeen(iso: string, lang: 'en' | 'zh'): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return lang === 'zh' ? '未知' : 'unknown'
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000))
  if (minutes < 2) return lang === 'zh' ? '刚刚' : 'just now'
  if (minutes < 60) return lang === 'zh' ? `${minutes} 分钟前` : `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return lang === 'zh' ? `${hours} 小时前` : `${hours} hours ago`
  const days = Math.round(hours / 24)
  if (days <= 7) return lang === 'zh' ? `${days} 天前` : `${days} days ago`
  return new Date(iso).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-GB')
}
```

- [ ] **Step 2: Add the tab to Settings**

Three edits in `apps/frontend/src/merchant/ShopSettings.tsx`:

Add the import beside the other tab imports:

```ts
import DevicesTab from './DevicesTab'
```

Add `'devices'` to the `TabKey` union:

```ts
type TabKey = 'shipping' | 'fulfilment' | 'payment' | 'brand' | 'marketing' | 'notifications' | 'subscription' | 'referral' | 'devices'
```

Add the entry at the END of the `TABS` array, after `referral`:

```ts
    { key: 'devices', label: t('Devices', '设备') },
```

Add the panel at the end of the render list, after the `referral` line:

```tsx
        {tab === 'devices' && <DevicesTab />}
```

`DevicesTab` takes no `onDirtyChange`. It has no Save, so it can never be dirty, and the NavGuard has nothing to block.

- [ ] **Step 3: Verify by running the app**

UI is verified by running the app, not by component tests. Use the `verify` skill, or run it by hand:

1. Run `pnpm dev`.
2. Sign in as a merchant. Open Settings → Devices.
3. Confirm one row appears, labelled *This device*, with no Sign out button.
4. Sign in as the same merchant in a private window. Reload the first window's Devices panel.
5. Confirm two rows appear, and that the private window's row has a Sign out button.
6. Sign in a third time in a second private window. Reload the first window.
7. Confirm the first window is signed out, because it is now the least recently used device.

- [ ] **Step 4: Typecheck, lint and build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/merchant/DevicesTab.tsx apps/frontend/src/merchant/ShopSettings.tsx
git commit -m "feat(merchant): Settings shows the devices holding the account"
```

---

### Task 8: The login screen says what happened

**Files:**
- Modify: `apps/frontend/src/merchant/LoginScreen.tsx`

**Interfaces:**
- Consumes: `SIGNED_OUT_ELSEWHERE_KEY` from `../store` (Task 6).
- Produces: nothing other tasks read.

Today an evicted merchant arrives at the login screen with no explanation, which reads as a fault in the app.

- [ ] **Step 1: Read the flag and show the notice**

`LoginScreen.tsx` already holds a `notice` state at line 23 and renders it. Add the import:

```ts
import { signIn, requestPasswordReset, SIGNED_OUT_ELSEWHERE_KEY } from '../store'
```

Add this effect beside the component's other hooks:

```tsx
  // Set by onAuthChange when a SIGNED_OUT arrives that this tab did not ask for — the session row
  // is gone. Either a third device took the slot, or the merchant signed this one out from
  // another device. Both are the same news to the person reading it.
  //
  // Read once and cleared, so a later visit to this screen does not repeat old news.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SIGNED_OUT_ELSEWHERE_KEY) !== 'yes') return
      sessionStorage.removeItem(SIGNED_OUT_ELSEWHERE_KEY)
      setNotice(t(
        'You were signed out. Your account allows 2 devices, so signing in on another one signs out the device used longest ago.',
        '您已被登出。您的账号最多支持 2 台设备，在其他设备登录后，最久未使用的设备会被登出。',
      ))
    } catch { /* private mode: no notice, and nothing breaks */ }
  }, [t])
```

Add `useEffect` to the `react` import at line 1 if it is not already there. If the component does not already read `t`, add `const { t } = useSession()` and the `useSession` import.

- [ ] **Step 2: Verify by running the app**

1. Run `pnpm dev`.
2. Sign in as a merchant in three browser profiles, one after another.
3. Watch the first profile. Confirm it lands on the login screen and shows the notice.
4. Sign in again in that profile, then click Sign out.
5. Confirm the login screen shows **no** notice. An intentional sign-out must not explain the limit.

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/merchant/LoginScreen.tsx
git commit -m "feat(merchant): tell an evicted merchant why they were signed out"
```

---

### Task 9: The documentation

**Files:**
- Modify: `CLAUDE.md` (the *Auth & roles* section)
- Modify: `CONTEXT.md` (the domain vocabulary)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code reads.

- [ ] **Step 1: Add the rule to `CLAUDE.md`**

Append to the *Auth & roles* bullet list in `CLAUDE.md`:

```markdown
- A **merchant** account holds at most `MERCHANT_DEVICE_LIMIT` (2) signed-in devices, and one
  device is one GoTrue session. `POST /api/me/devices/enforce`, which the browser calls after
  every sign-in, deletes the surplus rows from `auth.sessions` — least recently used first, and
  never the caller's own session. That delete is the whole mechanism: GoTrue then rejects the
  removed device's still-unexpired access token with `403 session_not_found`, on this API,
  Storage and PostgREST alike, so eviction is instant rather than one `jwt_expiry` late. The rule
  is `deviceLimit.ts` (pure) over `deviceLimitDb.ts` (two statements); the session id is read from
  the JWT's `session_id` claim and never from a body. Customers and superadmins are not bounded.
  `store.ts`'s `signOut` MUST keep `{ scope: 'local' }` — `@supabase/auth-js` defaults to
  `global`, which revokes every session and makes the limit behave as one device. See
  `docs/superpowers/specs/2026-08-25-merchant-device-limit-design.md`.
```

- [ ] **Step 2: Add the term to `CONTEXT.md`**

Add to the domain vocabulary:

```markdown
**Device** — one GoTrue session, and nothing more. The platform stores no device identifier and
runs no fingerprint, so two browsers on one computer are two devices, and clearing a browser's
storage yields a new one. A merchant account holds two at a time.
```

- [ ] **Step 3: Run every check**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: PASS.

Run: `pnpm --filter @bitetime/backend test:db`
Expected: PASS. The local Supabase stack must be running.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CONTEXT.md
git commit -m "docs: a merchant account holds two devices"
```

---

## Notes for the executor

**No migration.** If you find yourself writing SQL into `apps/backend/supabase/migrations/`, stop and re-read the spec. This feature adds no table and no column, and it must add no trigger to the `auth` schema.

**Task 1 is a gate, not a formality.** Do not start Task 2 until a human has confirmed that production can delete from `auth.sessions`.

**One known imprecision, accepted.** The login-screen notice in Task 8 fires for any sign-out this tab did not start. Eviction and a remote sign-out are the ordinary causes and read the same way. A password change made on another device would produce the same notice, and the wording is true enough there too.
