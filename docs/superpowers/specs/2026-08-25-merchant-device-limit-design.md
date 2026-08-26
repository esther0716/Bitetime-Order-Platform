# Merchant device limit — two devices, and the oldest one gives way

Date: 2026-08-25
No issue yet. The team brainstormed this directly. File an issue before implementation starts.

## Problem

A merchant account can sign in on an unlimited number of devices. Nothing in the codebase counts
sessions, and nothing removes one.

Supabase Auth permits this by default. A test against the local stack signed one account in three
times and got three live sessions. The `[auth]` block in `apps/backend/supabase/config.toml` sets
`jwt_expiry`, the password floor and the redirect list. It sets no session ceiling. GoTrue offers
only `single_per_user`, which permits one session, not two.

The shop owner shares one login with the staff. Each phone that signs in keeps its session for as
long as it refreshes. The platform charges for one shop and cannot see how many devices hold it.

## Goal

A merchant account holds at most two live sessions. A third sign-in succeeds and removes the least
recently used session. The merchant sees the two devices in Settings and can sign one out.

## Non-goals

- **Customer accounts and superadmin accounts.** They stay unlimited. The rule reads the
  `merchants` table, so an account that owns no shop passes through the endpoint untouched.
- **A hard block on the third device.** The design evicts, it does not refuse. A merchant who
  loses a phone must never lose the shop with it.
- **Device recognition.** One GoTrue session is one device. The platform runs no fingerprint and
  stores no device identifier of its own.
- **Geolocation.** `auth.sessions` holds an IP address. The device list does not show it. See
  *The device list*.
- **An email when a device is evicted.** The evicted device learns it on screen.

## Decisions

| Question | Decision |
|---|---|
| Which accounts | Merchants only |
| The limit | 2 |
| The third sign-in | It succeeds. The least recently used session goes |
| What a device is | One GoTrue session |
| Where the rule runs | The backend, after a sign-in succeeds |
| Where the limit lives | `MERCHANT_DEVICE_LIMIT = 2` in `quotaWindows.ts` |
| What the merchant sees | A Devices panel in Settings |

## Eviction is a row delete, and it takes effect at once

A run against the local stack proved the two facts this design rests on.

Every access token carries a `session_id` claim. The claim names a row in `auth.sessions`.

Delete that row, and GoTrue rejects the device's **unexpired** access token immediately:

```
GET /auth/v1/user   →  403 {"error_code":"session_not_found"}
POST /auth/v1/token?grant_type=refresh_token  →  400 {"error_code":"refresh_token_not_found"}
```

Both the access token and the refresh token die together. The eviction is therefore instant, not
late by up to one hour of `jwt_expiry`. It also holds for every path, not only this platform's API:
Storage and PostgREST verify the same token against the same session.

This is why the design needs no session table of its own. `auth.sessions` already stores
`id`, `user_id`, `created_at`, `refreshed_at`, `user_agent` and `ip`. That is sufficient for the
rule and for the screen.

The backend reads and deletes rows in the `auth` schema. It adds no trigger and no column there.
Supabase owns that schema and upgrades it, so this design keeps its distance: data statements only.

**Production was checked on 2026-08-25, and it permits this.** The backend's own connection
answered `current_user = postgres`, `can_select = true`, `can_delete = true`. The local stack
answers the same. A later reader does not have to run the probe again.

If a future Supabase change moves the backend to a role without that privilege, every eviction
fails and the limit stops applying. The route reports the failure and the merchant stays signed in
on every device, which is the correct direction to fail in. The alternatives are an
`auth.sessions` trigger or a check in `mw.ts`. See *Rejected approaches*.

## The rule is pure

`apps/backend/src/deviceLimit.ts` holds the rule and performs no I/O:

```ts
chooseEvictions({ sessions, currentSessionId, limit }): string[]
```

This splits the same way `aiUsage.ts` and `aiUsageDb.ts` do. The pure half stays reachable from
`pnpm test`, which runs without Supabase.

Recency is `coalesce(refreshed_at, created_at)`. `refreshed_at` stays null until a session refreshes
for the first time, so a rule that read `refreshed_at` alone would rank every new session as the
oldest and evict the merchant's own login.

**The current session is pinned first.** The function keeps the current session, then fills the
remaining `limit - 1` slots by recency, then returns the rest. It does not simply keep the newest
`limit` rows. The two orders agree in the ordinary case and disagree when a clock is wrong, and the
merchant must never lose the device they are holding.

The function returns an empty array when the account is at or under the limit.

`deviceLimitDb.ts` holds the two statements and reaches Postgres through `db.ts`:

- read the caller's sessions,
- `delete from auth.sessions where id = any($1)`.

`db.ts` is RLS-exempt, so both statements carry their own `user_id` predicate. On the backend's
path, tenancy is a TypeScript invariant.

## The endpoints

The three paths sit under `/api/me/`, beside `/api/me/profile` and `/api/me/merchant`. They are
about the caller's own account and carry no merchant id. A path with a merchant id in it would
invite a handler that trusts one.

### `POST /api/me/devices/enforce`

Guard `requireUser`. The handler returns `200` and does nothing when the caller owns no `merchants`
row, so a customer sign-in costs one no-op call.

`signIn()` in `apps/frontend/src/store.ts` calls it after a sign-in succeeds.

**The session id comes from the JWT. It never comes from the body.** `getUserFromToken` validates
the token against GoTrue first. Only then does the handler decode that same string's payload for
its `session_id` claim. This mirrors order attribution, which reads the JWT and ignores the body. A
body-supplied session id would let any merchant evict any device by guessing an id.

### `GET /api/me/devices`

Guard `requireUser`. Returns the caller's own sessions. It marks the current one.

### `DELETE /api/me/devices/:sessionId`

Guard `requireUser`. Signs one device out. The handler refuses any id that is not in the caller's
own session set. That check is the whole tenancy guard, because `db.ts` runs no policy.

These two endpoints answer `403` for an account that owns no `merchants` row. Only `enforce`
answers `200` for such an account, because the frontend calls it after every sign-in and a customer
must not see an error.

## The device list

Settings gains an eighth entry in the `SettingsMenu` item list. The panel is a small table, one row
per session, in the server's order — which is EVICTION order, so the device that goes next is last:

```
DEVICE                      CREATED               UPDATED
Chrome on macOS [Current]   25/08/2026, 12:14 pm  25/08/2026, 12:14 pm
Safari on iPhone            21/08/2026, 09:02 am  25/08/2026, 07:55 am   [Sign out]
```

The current device is marked by a **badge**, not by a line of text under its name. Timestamps use
`fmtDateTime`, pinned to `en-MY` and deliberately not language-aware: the dashboard is the
merchant's own back office and reads one way whatever the storefront toggle says.

`updatedAt` is `auth.sessions.updated_at`. It is NOT the field the limit ranks on — that is
`lastSeen` (`refreshed_at` falling back to `created_at`), which the response also carries and which
fixes the list's order. The two track each other in practice; the row order is the authority on
which device goes next.

`deviceLabel.ts` is a pure module, and it returns the browser and platform as **parts**, never the
phrase joining them. The join is prose — " on ", and the fallback — and prose is `t(en, zh)`'s job
in the browser. A finished English string from the backend is untranslatable: English reads
"Chrome on macOS" and Chinese reads "macOS 上的 Chrome", which is a different word order, not a
different dictionary.

Either part is null when it cannot be read, and the browser says "Unknown device" in the reader's
own language only when BOTH are. One known name is still worth showing: "Linux" identifies a device
better than "unknown" does.

**The panel shows no IP address and no Location column.** `auth.sessions` stores an IP. An address
tells a merchant nothing they can act on, and turning one into a place name means adding a
geolocation provider — a second bill and a second thing to bound. That stays a non-goal.

**`refreshed_at` is read as UTC, explicitly.** It is `timestamp WITHOUT time zone` while every
other column is `timestamptz`. GoTrue writes UTC into it, but a naive timestamp carries no offset,
so the driver builds the Date in the server's local zone and the instant reads EARLY by that
offset — eight hours on a Malaysian machine. Ranked against a correct `created_at`, a session
refreshed minutes ago then looks half a day stale and the limit evicts the wrong device. The query
casts with `at time zone 'utc'`. It is harmless on a UTC server, which is exactly why it hides, and
`tests/api/devices.test.ts` pins it.

## Sign-out must stop being global

`apps/frontend/src/store.ts:383` calls `auth.signOut()` with no arguments. The default scope in
`@supabase/auth-js` is `global` (`GoTrueClient.js:3319`), which revokes **every** session the
account holds.

That default contradicts this feature. The merchant signs out on the phone, the laptop dies too,
and a two-device account behaves as a one-device account.

Change it to `auth.signOut({ scope: 'local' })`. This is part of the feature, not a separate
cleanup.

## What the evicted merchant sees

**A revoked session does not announce itself, and this was wrong in the first draft of this spec.**
The draft said the evicted device's next call returns `403` and `auth-js` emits `SIGNED_OUT`.
Running the app showed otherwise. `auth-js` keeps the access token in `localStorage` and
`getSession()` returns it without asking anyone until it expires, so the evicted device believes it
is signed in for up to `jwt_expiry` — one hour. Meanwhile this platform's API answers `401`, and
the dashboard reported it as:

> We couldn't reach the server to load your shop. You are still signed in — this is on our side,
> not yours.

Wrong on both counts, and shown for an hour. GoTrue *does* answer `403 session_not_found`, but only
to whoever asks it, and nothing was asking.

So `api.ts` asks. `errorFromResponse` is the one funnel every non-2xx passes through, and on a
`401` it calls `forgetRevokedSession()`: if a local session exists, it hands that token to
`auth.getUser()` — a real round trip to GoTrue — and drops the session **only** when GoTrue itself
rejects it. That fires `SIGNED_OUT`, and the merchant reaches the login screen at once.

Both guards are load-bearing. Without the local-session check, a `401` for any other reason would
sign out a caller whose token is perfectly good, and would fire `SIGNED_OUT` for a guest who was
never signed in. Without GoTrue as the arbiter, an ordinary permission `401` would read as a
revocation.

The login screen then shows one message: the account permits two devices, and a newer sign-in took
the slot. It is read once and cleared. An **intentional** sign-out sets a flag first, so a merchant
who simply clicked Sign out is told nothing.

## Tests

**Pure, under `pnpm test`, no Supabase:**

- `deviceLimit.test.ts` — the function keeps the current session; it evicts the least recently used
  row; it returns nothing under the limit; it handles a null `refreshed_at`; it handles two equal
  timestamps.
- `deviceLabel.test.ts` — the parser reads the common agents and returns `Unknown device` for the
  rest.

**Database-backed, under `pnpm --filter @bitetime/backend test:db`:**

- `tests/api/devices.test.ts` — three real sign-ins leave two sessions. The evicted token is
  refused: **`401` from this API**, which is what the browser sees, since `getUserFromToken` maps
  GoTrue's own `403 session_not_found` onto Unauthorized. The current token still works. `DELETE`
  with a stranger's session id is refused. A customer account keeps all three sessions. The device
  list sends parts and no `label`.
- `src/signOutScope.test.ts` — pins the two rules whose regression looks like success: `signOut`
  passes `{ scope: 'local' }`, and the sign-out intent is consumed by the `SIGNED_OUT` handler so a
  later eviction in the same tab is still announced.

Never mock the database in that suite. It exists to prove that Postgres and GoTrue behave this way.

**The Settings panel is verified by running the app**, per `CLAUDE.md`.

## Rejected approaches

**A trigger on `auth.sessions`.** An after-insert trigger would fire on every login, whatever the
client, and would cost nothing per request. It was rejected because it writes into the `auth`
schema, which Supabase owns and upgrades, and because it hides the rule from anyone who reads
`apps/backend/src`. The control here deters credential sharing. It does not defend against an
attacker, so it does not need to survive a caller that skips the endpoint.

**A check in `mw.ts` on every request.** This needs no client cooperation. It was rejected because
it adds a query to every authenticated merchant request, permanently, to enforce a condition that
changes only at sign-in.

## Documentation to update

- `CLAUDE.md` — a short entry under Auth & roles. Record the limit, the LRU rule, and the fact that
  eviction is a delete from `auth.sessions`.
- `CONTEXT.md` — the term *device*, defined as one GoTrue session.

## Known limits

- **The rule is client-cooperative.** A sign-in that never calls the endpoint keeps a third session
  until the next sign-in that does call it. Accepted, for the reason under *Rejected approaches*.
- **Two browsers on one computer count as two devices.** Chrome and Safari on one laptop hold two
  sessions, so they fill the account.
- **A cleared browser store burns a slot.** The old session stays as an idle row until a later
  sign-in evicts it. It is always the least recently used row, so it goes first.
