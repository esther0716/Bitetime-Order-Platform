# Trial Feedback Survey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask every merchant, once, how their 7-day trial went — regardless of whether it converted, is still trialing, or ended in suspension — via a daily cron-driven email that links to a rating+comment form on the dashboard.

**Architecture:** A new `trial_feedback` table (one row per merchant, state machine: sent → answered XOR skipped) is the single source of truth for "have we asked and what did they say." A daily GitHub Actions workflow calls a secret-gated backend sweep endpoint that finds merchants whose trial just ended and emails them once (claim-before-send, mirroring `orderEmails.ts`'s pattern, so a failed send is retried the next day rather than lost). The merchant answers or dismisses from whichever dashboard shell their shop's status routes them to (`Dashboard` or `SuspendedScreen`) — both require login, same as the existing trial reminder email. Superadmins read answered responses on a new admin page.

**Tech Stack:** Hono (backend routes), `postgres.js`/Supabase REST via the existing `admin` service-role client, Resend (email, existing `resendSend` adapter), React + `@bitetime/shared` (rating/comment validation shared both sides of the wire), GitHub Actions (`schedule` trigger).

## Global Constraints

- Rating is 1–5 stars, **required**; comment is free text, **optional**, capped at 2000 characters — enforced identically in `@bitetime/shared` (browser) and by a DB `CHECK` (final authority), mirroring `packages/shared/src/feedback.ts`.
- Only trials whose `trial_ends_at` is still in the future at migration time (or ends later) get surveyed — no backfill email blast for trials that already ended. The migration itself seeds pre-existing lapsed trials as already-skipped so the sweep never touches them.
- Declining is **permanent** — `skipped_at` set, never shown again, never re-prompted.
- The email requires login to answer (same posture as the existing 72h trial reminder) — no tokenized/passwordless link.
- Every user-facing string is bilingual via `t(en, zh)` — no exceptions (see CLAUDE.md → Localisation).
- No frontend component tests — UI is verified by running the app (CLAUDE.md → Commands: "UI is verified by running the app (run-and-verify), not component tests").
- Never run `supabase db push` or any command that reaches production — apply the migration with `pnpm --filter @bitetime/backend db:migrate` only, against the local stack.
- The browser never talks to the `trial_feedback` table directly — RLS is enabled with **no policies** and no grant to `anon`/`authenticated`, mirroring `merchant_feedback`. The backend's service-role `admin` client (RLS-exempt) is the only door; tenancy is enforced in TypeScript (`requireOwnMerchant`), not by a Postgres policy.
- The sweep endpoint (`POST /api/internal/trial-feedback-sweep`) is not user-authenticated — it is gated by a shared secret header, and fails **closed** (503) when the secret env var is unset, matching the house rule ("Unset simply means … fails closed").

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/trialFeedback.ts` | Rating/comment validation rules shared by browser and backend — the wire contract. |
| `apps/backend/supabase/migrations/20260804150000_trial_feedback.sql` | The `trial_feedback` table, its grants, and the backfill-exclusion insert. |
| `apps/backend/src/trialFeedback.ts` | All DB access for the table (find-due, claim/release, respond/skip, admin list) + the pure email builder. |
| `apps/backend/src/env.ts` | Adds `trialFeedbackSweepSecret`. |
| `apps/backend/src/app.ts` | Adds 5 routes: owner GET/respond/skip, admin list, internal sweep. |
| `apps/frontend/src/types.ts` | `TrialFeedbackOwn`, `TrialFeedbackAdminItem`. |
| `apps/frontend/src/store.ts` | `fetchTrialFeedback`, `respondTrialFeedback`, `skipTrialFeedback`, `fetchAdminTrialFeedback`. |
| `apps/frontend/src/merchant/TrialFeedbackPrompt.tsx` | The rating+comment card, mounted from both `Dashboard.tsx` and `SuspendedScreen.tsx`. |
| `apps/frontend/src/admin/AdminTrialFeedback.tsx` | Superadmin's read-only response list, wired into `AdminHome.tsx`. |
| `.github/workflows/trial-feedback-sweep.yml` | Daily cron calling the sweep endpoint. |

---

### Task 1: Shared validation module

**Files:**
- Create: `packages/shared/src/trialFeedback.ts`
- Test: `packages/shared/src/trialFeedback.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export const TRIAL_FEEDBACK_RATING_MIN = 1
  export const TRIAL_FEEDBACK_RATING_MAX = 5
  export const TRIAL_FEEDBACK_COMMENT_MAX_LENGTH = 2000
  export interface TrialFeedbackDraft { rating: number; comment: string | null }
  export type TrialFeedbackValidation =
    | { ok: true; value: TrialFeedbackDraft }
    | { ok: false; error: string }
  export function validateTrialFeedback(body: unknown): TrialFeedbackValidation
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/trialFeedback.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateTrialFeedback, TRIAL_FEEDBACK_COMMENT_MAX_LENGTH } from './trialFeedback.js'

describe('validateTrialFeedback', () => {
  it('accepts a rating with no comment', () => {
    expect(validateTrialFeedback({ rating: 4 })).toEqual({ ok: true, value: { rating: 4, comment: null } })
  })

  it('accepts a rating with a trimmed comment', () => {
    expect(validateTrialFeedback({ rating: 5, comment: '  loved it  ' }))
      .toEqual({ ok: true, value: { rating: 5, comment: 'loved it' } })
  })

  it('treats an empty or whitespace-only comment as none', () => {
    expect(validateTrialFeedback({ rating: 3, comment: '   ' }))
      .toEqual({ ok: true, value: { rating: 3, comment: null } })
  })

  it('rejects a missing rating', () => {
    expect(validateTrialFeedback({ comment: 'hi' }).ok).toBe(false)
  })

  it('rejects a rating outside 1–5', () => {
    expect(validateTrialFeedback({ rating: 0 }).ok).toBe(false)
    expect(validateTrialFeedback({ rating: 6 }).ok).toBe(false)
  })

  it('rejects a non-integer rating', () => {
    expect(validateTrialFeedback({ rating: 3.5 }).ok).toBe(false)
  })

  it('rejects a non-string comment', () => {
    expect(validateTrialFeedback({ rating: 3, comment: 42 }).ok).toBe(false)
  })

  it(`rejects a comment longer than ${TRIAL_FEEDBACK_COMMENT_MAX_LENGTH} characters`, () => {
    const tooLong = 'x'.repeat(TRIAL_FEEDBACK_COMMENT_MAX_LENGTH + 1)
    expect(validateTrialFeedback({ rating: 3, comment: tooLong }).ok).toBe(false)
  })

  it('accepts a comment of exactly the maximum length', () => {
    const atLimit = 'x'.repeat(TRIAL_FEEDBACK_COMMENT_MAX_LENGTH)
    expect(validateTrialFeedback({ rating: 3, comment: atLimit }).ok).toBe(true)
  })

  it('drops any extra keys — builds its result rather than spreading the body', () => {
    const result = validateTrialFeedback({
      rating: 4, comment: 'good', responded_at: 'x', merchant_id: 'someone-elses-shop',
    })
    expect(result).toEqual({ ok: true, value: { rating: 4, comment: 'good' } })
  })

  it('rejects a null or non-object body without throwing', () => {
    expect(validateTrialFeedback(null).ok).toBe(false)
    expect(validateTrialFeedback('nope').ok).toBe(false)
    expect(validateTrialFeedback(undefined).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bitetime/shared test -- trialFeedback` (from repo root)
Expected: FAIL — `Cannot find module './trialFeedback.js'` (or similar resolution error).

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/trialFeedback.ts`:

```ts
// Trial feedback (#155) — validation for the one-time, platform-initiated survey asked
// once a shop's 7-day trial ends. Shared because both sides enforce it: the dashboard form
// disables submit until a rating is picked, and the backend refuses anything else. The
// database CHECK constraints in 20260804150000_trial_feedback.sql are the final authority;
// this exists to keep the browser and the server from disagreeing about what will be
// accepted. Mirrors feedback.ts's shape and reasoning.

export const TRIAL_FEEDBACK_RATING_MIN = 1
export const TRIAL_FEEDBACK_RATING_MAX = 5
export const TRIAL_FEEDBACK_COMMENT_MAX_LENGTH = 2000

export interface TrialFeedbackDraft {
  rating: number
  comment: string | null
}

export type TrialFeedbackValidation =
  | { ok: true; value: TrialFeedbackDraft }
  | { ok: false; error: string }

/**
 * Validates a trial-feedback submission and returns a clean draft.
 *
 * This is also the write allowlist: it BUILDS its result field by field rather than
 * spreading the body, so a caller cannot smuggle `responded_at`, `merchant_id` or
 * `skipped_at` through it — the backend derives all of those itself. Never bypass this
 * and insert a raw body.
 */
export function validateTrialFeedback(body: unknown): TrialFeedbackValidation {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as {
    rating?: unknown
    comment?: unknown
  }

  if (
    typeof raw.rating !== 'number' ||
    !Number.isInteger(raw.rating) ||
    raw.rating < TRIAL_FEEDBACK_RATING_MIN ||
    raw.rating > TRIAL_FEEDBACK_RATING_MAX
  ) {
    return {
      ok: false,
      error: `Rating must be an integer between ${TRIAL_FEEDBACK_RATING_MIN} and ${TRIAL_FEEDBACK_RATING_MAX}`,
    }
  }

  let comment: string | null = null
  if (raw.comment !== undefined && raw.comment !== null) {
    if (typeof raw.comment !== 'string') {
      return { ok: false, error: 'Comment must be text' }
    }
    const trimmed = raw.comment.trim()
    if (trimmed.length > TRIAL_FEEDBACK_COMMENT_MAX_LENGTH) {
      return { ok: false, error: `Comment must be ${TRIAL_FEEDBACK_COMMENT_MAX_LENGTH} characters or fewer` }
    }
    comment = trimmed.length > 0 ? trimmed : null
  }

  return { ok: true, value: { rating: raw.rating, comment } }
}
```

- [ ] **Step 4: Export from the package index**

In `packages/shared/src/index.ts`, add (after the existing `feedback.js` export block):

```ts
export {
  validateTrialFeedback,
  TRIAL_FEEDBACK_RATING_MIN, TRIAL_FEEDBACK_RATING_MAX, TRIAL_FEEDBACK_COMMENT_MAX_LENGTH,
} from './trialFeedback.js'
export type { TrialFeedbackDraft, TrialFeedbackValidation } from './trialFeedback.js'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @bitetime/shared test -- trialFeedback`
Expected: PASS — all 11 tests green.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/trialFeedback.ts packages/shared/src/trialFeedback.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add trial feedback validation rules"
```

---

### Task 2: Database migration

**Files:**
- Create: `apps/backend/supabase/migrations/20260804150000_trial_feedback.sql`

**Interfaces:**
- Produces: table `public.trial_feedback (merchant_id uuid PK, sent_at timestamptz, rating smallint, comment text, responded_at timestamptz, skipped_at timestamptz)`, RLS enabled with no policies, only `service_role` granted.

- [ ] **Step 1: Write the migration**

Create `apps/backend/supabase/migrations/20260804150000_trial_feedback.sql`:

```sql
-- Trial feedback (#155) — a one-time, PLATFORM-initiated survey asked once a shop's 7-day
-- trial has ended, independent of outcome (converted, still trialing, or suspended). Not to
-- be confused with merchant_feedback, which is merchant-initiated and open-ended.
--
-- One row per merchant, created by the daily sweep (not by the merchant) the moment its
-- email goes out — the row IS the "have we asked" record, and its lifecycle owns three
-- states past that: answered (rating + optional comment, responded_at set), skipped
-- (skipped_at set, no rating), or still pending (neither set). See CONTEXT.md → Trial
-- feedback and docs/adr/0011-trial-feedback-is-a-cron-sweep-not-a-webhook.md.
--
-- Like merchant_feedback, the browser never touches this table directly: only the backend's
-- service-role client reads and writes it, so RLS is enabled with NO policies and no grant
-- is given to anon/authenticated — the withheld grant is what actually shuts the door.
create table if not exists public.trial_feedback (
  merchant_id  uuid primary key references public.merchants (id) on delete cascade,
  sent_at      timestamptz not null default now(),
  rating       smallint check (rating between 1 and 5),
  comment      text check (char_length(comment) <= 2000),
  responded_at timestamptz,
  skipped_at   timestamptz
);

-- The admin list's only sort: newest-answered-first.
create index if not exists trial_feedback_responded_idx
  on public.trial_feedback (responded_at desc)
  where responded_at is not null;

alter table public.trial_feedback enable row level security;

revoke all on table public.trial_feedback from anon, authenticated;
grant select, insert, update on table public.trial_feedback to service_role;

-- Backfill exclusion (#155 scope decision: only trials ending AFTER this feature ships are
-- surveyed). Every merchant whose trial had already ended by the time this migration ran
-- gets a row stamped as already-skipped, so the daily sweep — which surveys any merchant
-- with a past trial_ends_at and no trial_feedback row — never emails them retroactively.
-- A trial still in progress (trial_ends_at in the future, or null for a comped shop) is
-- untouched and will be surveyed normally when its own trial ends.
insert into public.trial_feedback (merchant_id, sent_at, skipped_at)
select mb.merchant_id, now(), now()
from public.merchant_billing mb
where mb.trial_ends_at is not null
  and mb.trial_ends_at <= now()
on conflict (merchant_id) do nothing;
```

- [ ] **Step 2: Apply it locally**

Ensure local Supabase is running (`supabase status` from `apps/backend`; if not, `supabase start`), then:

Run: `pnpm --filter @bitetime/backend db:migrate`
Expected: output lists `20260804150000_trial_feedback.sql` as applied, no errors.

- [ ] **Step 3: Verify the table and the backfill**

Run (from `apps/backend`):
```bash
DB_URL=$(supabase status -o env | grep '^DB_URL=' | cut -d'"' -f2)
psql "$DB_URL" -c "\d trial_feedback"
psql "$DB_URL" -c "select count(*) as pre_existing_skipped from trial_feedback where skipped_at is not null;"
```
Expected: `\d` shows the five columns and the primary key; the count matches however many local `merchant_billing` rows already have a past `trial_ends_at` (0 on a fresh local stack, since `db reset` wipes fixtures — that's fine, the assertion is just "it doesn't error and the count is sane").

- [ ] **Step 4: Commit**

```bash
git add apps/backend/supabase/migrations/20260804150000_trial_feedback.sql
git commit -m "feat(db): add trial_feedback table with backfill exclusion for pre-existing trials"
```

---

### Task 3: Backend data-access module + email builder

**Files:**
- Create: `apps/backend/src/trialFeedback.ts`
- Test: `apps/backend/tests/unit/trialFeedback.test.ts`

**Interfaces:**
- Consumes: `admin` from `./supabase.js`; `TrialFeedbackDraft` from `@bitetime/shared` (Task 1).
- Produces:
  ```ts
  export interface TrialFeedbackRow {
    merchant_id: string; sent_at: string; rating: number | null; comment: string | null
    responded_at: string | null; skipped_at: string | null
  }
  export interface TrialFeedbackWithShop extends TrialFeedbackRow {
    shop_name: string | null; shop_slug: string | null
  }
  export interface DueTrial { merchantId: string; ownerId: string; shopName: string }
  export function buildTrialFeedbackEmail(input: { shopName: string; dashboardUrl: string }): { subject: string; text: string }
  export function findDueTrials(now: Date): Promise<DueTrial[]>
  export function claimSend(merchantId: string): Promise<boolean>
  export function releaseSend(merchantId: string): Promise<void>
  export function getOwnTrialFeedback(merchantId: string): Promise<TrialFeedbackRow | null>
  export function respondTrialFeedback(merchantId: string, draft: TrialFeedbackDraft): Promise<{ ok: true; row: TrialFeedbackRow } | { ok: false; reason: 'not_found' | 'already_done' }>
  export function skipTrialFeedback(merchantId: string): Promise<{ ok: true; row: TrialFeedbackRow } | { ok: false; reason: 'not_found' | 'already_done' }>
  export function listTrialFeedbackForAdmin(): Promise<TrialFeedbackWithShop[]>
  ```
  (`findDueTrials`, `claimSend`, `releaseSend`, `getOwnTrialFeedback`, `respondTrialFeedback`, `skipTrialFeedback`, `listTrialFeedbackForAdmin` all talk to the database and are exercised through the API tests in Tasks 4–6, not unit-tested here — only the pure `buildTrialFeedbackEmail` gets a unit test, matching how `feedback.ts`'s DB functions are only ever tested via `tests/api/feedback.test.ts`.)

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/unit/trialFeedback.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildTrialFeedbackEmail } from '../../src/trialFeedback.js'

describe('buildTrialFeedbackEmail', () => {
  it('names the shop in the subject and links to the dashboard', () => {
    const { subject, text } = buildTrialFeedbackEmail({
      shopName: 'Kopi Corner',
      dashboardUrl: 'https://tinyorder.vercel.app/merchant',
    })
    expect(subject).toContain('Kopi Corner')
    expect(text).toContain('Kopi Corner')
    expect(text).toContain('https://tinyorder.vercel.app/merchant')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bitetime/backend test -- trialFeedback`
Expected: FAIL — `Cannot find module '../../src/trialFeedback.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/trialFeedback.ts`:

```ts
// Trial feedback (#155) — data access for the one-time, platform-initiated survey asked
// once a shop's trial has ended. See CONTEXT.md → Trial feedback.
//
// Every statement here is a single write or read against the service-role `admin` client
// (RLS-exempt) — no transaction is needed, same posture as feedback.ts.
import { admin } from './supabase.js'
import type { TrialFeedbackDraft } from '@bitetime/shared'

export interface TrialFeedbackRow {
  merchant_id: string
  sent_at: string
  rating: number | null
  comment: string | null
  responded_at: string | null
  skipped_at: string | null
}

export interface TrialFeedbackWithShop extends TrialFeedbackRow {
  shop_name: string | null
  shop_slug: string | null
}

export interface DueTrial {
  merchantId: string
  ownerId: string
  shopName: string
}

export interface TrialFeedbackEmailInput {
  shopName: string
  dashboardUrl: string
}

// Pure — mirrors buildTrialReminderEmail in billingLifecycle.ts. Text-only: like the trial
// reminder, this is a transactional nudge, not a marketing send.
export function buildTrialFeedbackEmail({ shopName, dashboardUrl }: TrialFeedbackEmailInput) {
  const subject = `How was your TinyOrder trial for ${shopName}?`
  const text = `Hi,

Your free trial for ${shopName} has ended. We'd love to know how it went — good or bad, it all helps.

Leave a quick rating: ${dashboardUrl}

It takes less than a minute.

— TinyOrder`
  return { subject, text }
}

/**
 * Merchants whose trial has ended and who have never been sent this survey — the sweep's
 * worklist. A merchant with no `merchant_billing` row, or one whose `trial_ends_at` is null
 * (never trialed, or comped) or still in the future, is not a candidate.
 */
export async function findDueTrials(now: Date): Promise<DueTrial[]> {
  const { data, error } = await admin
    .from('merchant_billing')
    .select('merchant_id, trial_ends_at, merchants(owner_id, name)')
    .not('trial_ends_at', 'is', null)
    .lte('trial_ends_at', now.toISOString())
  if (error) throw new Error(error.message)

  const candidates = (data ?? []).map((row: any) => ({
    merchantId: row.merchant_id as string,
    ownerId: row.merchants.owner_id as string,
    shopName: row.merchants.name as string,
  }))
  if (candidates.length === 0) return []

  const { data: already, error: seenErr } = await admin
    .from('trial_feedback')
    .select('merchant_id')
    .in('merchant_id', candidates.map(c => c.merchantId))
  if (seenErr) throw new Error(seenErr.message)

  const seen = new Set((already ?? []).map((r: any) => r.merchant_id as string))
  return candidates.filter(c => !seen.has(c.merchantId))
}

/**
 * The atomic one-shot claim: creates the row BEFORE the email is sent, so a concurrent sweep
 * run cannot double-send. Mirrors claimOnce in orderEmails.ts, adapted to an INSERT —
 * `merchant_id` is the primary key, so a second claim for the same merchant hits a
 * unique-violation and this returns false rather than throwing.
 */
export async function claimSend(merchantId: string): Promise<boolean> {
  const { error } = await admin.from('trial_feedback').insert({ merchant_id: merchantId })
  if (!error) return true
  if (error.code === '23505') return false // already claimed by a concurrent run
  throw new Error(error.message)
}

/**
 * Hand back a claim whose send did not happen, so the next sweep retries it — mirrors
 * releaseClaim in orderEmails.ts. Deletes rather than nulling a column, because "claimed" for
 * this table IS "the row exists".
 */
export async function releaseSend(merchantId: string): Promise<void> {
  const { error } = await admin.from('trial_feedback').delete().eq('merchant_id', merchantId)
  if (error) {
    console.error(`Failed to release trial_feedback claim for ${merchantId} — survey will not be retried:`, error.message)
  }
}

export async function getOwnTrialFeedback(merchantId: string): Promise<TrialFeedbackRow | null> {
  const { data, error } = await admin
    .from('trial_feedback').select('*').eq('merchant_id', merchantId).maybeSingle()
  if (error) throw new Error(error.message)
  return data as TrialFeedbackRow | null
}

type WriteOutcome =
  | { ok: true; row: TrialFeedbackRow }
  | { ok: false; reason: 'not_found' | 'already_done' }

async function writeOnce(merchantId: string, patch: Record<string, unknown>): Promise<WriteOutcome> {
  const { data, error } = await admin
    .from('trial_feedback')
    .update(patch)
    .eq('merchant_id', merchantId)
    .is('responded_at', null)
    .is('skipped_at', null)
    .select('*')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (data) return { ok: true, row: data as TrialFeedbackRow }

  // The conditional UPDATE matched nothing — either no survey was ever sent to this
  // merchant, or one was and it is already answered/skipped. Distinguish them so the route
  // can tell "nothing to answer" (404) from "you already answered" (409).
  const existing = await getOwnTrialFeedback(merchantId)
  return { ok: false, reason: existing ? 'already_done' : 'not_found' }
}

export async function respondTrialFeedback(merchantId: string, draft: TrialFeedbackDraft): Promise<WriteOutcome> {
  return writeOnce(merchantId, {
    rating: draft.rating,
    comment: draft.comment,
    responded_at: new Date().toISOString(),
  })
}

export async function skipTrialFeedback(merchantId: string): Promise<WriteOutcome> {
  return writeOnce(merchantId, { skipped_at: new Date().toISOString() })
}

// Newest-first, joined with the shop the same way feedback.ts's listFeedback is — only
// ANSWERED rows (a rating was actually given), which is what a superadmin reading responses
// means; a merchant who was sent the survey and never touched it is not a "response".
export async function listTrialFeedbackForAdmin(): Promise<TrialFeedbackWithShop[]> {
  const { data, error } = await admin
    .from('trial_feedback')
    .select('*, merchants(name, slug)')
    .not('responded_at', 'is', null)
    .order('responded_at', { ascending: false })
  if (error) throw new Error(error.message)

  return (data ?? []).map((row: any) => {
    const { merchants, ...rest } = row
    return { ...rest, shop_name: merchants?.name ?? null, shop_slug: merchants?.slug ?? null }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bitetime/backend test -- trialFeedback`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/trialFeedback.ts apps/backend/tests/unit/trialFeedback.test.ts
git commit -m "feat(backend): add trial feedback data access and email builder"
```

---

### Task 4: Owner-facing routes (get / respond / skip)

**Files:**
- Modify: `apps/backend/src/app.ts`
- Test: `apps/backend/tests/api/trial-feedback.test.ts`

**Interfaces:**
- Consumes: `getOwnTrialFeedback`, `respondTrialFeedback`, `skipTrialFeedback` from `./trialFeedback.js` (Task 3); `validateTrialFeedback` from `@bitetime/shared` (Task 1); `requireOwnMerchant` from `./mw.js` (existing).
- Produces routes: `GET /api/trial-feedback`, `POST /api/trial-feedback/respond`, `POST /api/trial-feedback/skip`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/api/trial-feedback.test.ts`:

```ts
// tests/api/trial-feedback.test.ts
// GET/POST /api/trial-feedback[/respond|/skip] — the merchant's own view of the survey
// (#155). requireOwnMerchant scopes every route to the caller's own shop, so there is no
// :id to spoof; what matters here is the one-shot state machine (pending → answered XOR
// skipped, never both, never twice).
import { describe, it, expect } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function get(path: string, token?: string) {
  return app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
}

function post(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('trial feedback — own merchant', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await get('/api/trial-feedback')).status).toBe(401)
    expect((await post('/api/trial-feedback/respond', { rating: 5 })).status).toBe(401)
    expect((await post('/api/trial-feedback/skip', undefined)).status).toBe(401)
  })

  it('returns null when no survey has been sent yet', async () => {
    await resetMerchant('trial-feedback-none-shop')
    const owner = await makeUser('trial-feedback-none@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    await seedMerchant({ slug: 'trial-feedback-none-shop', owner_id: userId })

    const res = await get('/api/trial-feedback', token)
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it('refuses respond and skip when no survey has been sent', async () => {
    await resetMerchant('trial-feedback-unsent-shop')
    const owner = await makeUser('trial-feedback-unsent@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    await seedMerchant({ slug: 'trial-feedback-unsent-shop', owner_id: userId })

    expect((await post('/api/trial-feedback/respond', { rating: 5 }, token)).status).toBe(404)
    expect((await post('/api/trial-feedback/skip', undefined, token)).status).toBe(404)
  })

  it('lets the owner answer a pending survey, and refuses a second answer', async () => {
    await resetMerchant('trial-feedback-pending-shop')
    const owner = await makeUser('trial-feedback-pending@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'trial-feedback-pending-shop', owner_id: userId })
    await serviceClient().from('trial_feedback').insert({ merchant_id: merchantId })

    const getBefore = await get('/api/trial-feedback', token)
    const before = await getBefore.json() as { responded_at: string | null; skipped_at: string | null }
    expect(before.responded_at).toBeNull()
    expect(before.skipped_at).toBeNull()

    const res = await post('/api/trial-feedback/respond', { rating: 4, comment: 'Pretty good' }, token)
    expect(res.status).toBe(200)
    const row = await res.json() as { rating: number; comment: string; responded_at: string | null }
    expect(row.rating).toBe(4)
    expect(row.comment).toBe('Pretty good')
    expect(row.responded_at).not.toBeNull()

    const second = await post('/api/trial-feedback/respond', { rating: 1 }, token)
    expect(second.status).toBe(409)
  })

  it('rejects an out-of-range rating', async () => {
    await resetMerchant('trial-feedback-badrating-shop')
    const owner = await makeUser('trial-feedback-badrating@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'trial-feedback-badrating-shop', owner_id: userId })
    await serviceClient().from('trial_feedback').insert({ merchant_id: merchantId })

    const res = await post('/api/trial-feedback/respond', { rating: 9 }, token)
    expect(res.status).toBe(400)
  })

  it('lets the owner skip a pending survey, and refuses answering after skipping', async () => {
    await resetMerchant('trial-feedback-skip-shop')
    const owner = await makeUser('trial-feedback-skip@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'trial-feedback-skip-shop', owner_id: userId })
    await serviceClient().from('trial_feedback').insert({ merchant_id: merchantId })

    const res = await post('/api/trial-feedback/skip', undefined, token)
    expect(res.status).toBe(200)
    const row = await res.json() as { skipped_at: string | null }
    expect(row.skipped_at).not.toBeNull()

    const after = await post('/api/trial-feedback/respond', { rating: 5 }, token)
    expect(after.status).toBe(409)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bitetime/backend test:db -- trial-feedback.test.ts` (requires local Supabase running — `supabase start` from `apps/backend` if not)
Expected: FAIL — 404s on undefined routes.

- [ ] **Step 3: Add the import**

In `apps/backend/src/app.ts`, after line 46 (`import { insertFeedback, listFeedback, ... } from './feedback.js'`), add:

```ts
import {
  buildTrialFeedbackEmail, findDueTrials, claimSend, releaseSend,
  getOwnTrialFeedback, respondTrialFeedback, skipTrialFeedback, listTrialFeedbackForAdmin,
} from './trialFeedback.js'
```

In the existing `@bitetime/shared` import (currently line 52), add `validateTrialFeedback` to the destructured list:

```ts
import { isCart, isBusinessNature, validateOptionGroups, optionGroupsFromRow, validateFeedback, isFeedbackStatus, validateTrialFeedback, shopDistance, routedKm, distanceFee, REFUSAL_STATUS, QUOTE_REFUSAL_STATUS, DEFAULT_TIMEZONE, isTimezone, computeMerchantStats, ordersInWindow, windowTotals, todayInZone, isRevenueRange, granularityFor } from '@bitetime/shared'
```

- [ ] **Step 4: Add the routes**

In `apps/backend/src/app.ts`, immediately after the `app.patch('/api/admin/feedback/:feedbackId', ...)` handler (the block ending around line 1382), add:

```ts
// ── Trial feedback (#155) ───────────────────────────────────────────────────────
// One-time, platform-initiated survey — see CONTEXT.md → Trial feedback. requireOwnMerchant
// scopes every route to the caller's own shop; there is no :id to name a different one.

app.get('/api/trial-feedback', requireOwnMerchant, async (c) => {
  const merchant = c.get('merchant')
  return c.json(await getOwnTrialFeedback(merchant.id))
})

app.post('/api/trial-feedback/respond', requireOwnMerchant, async (c) => {
  const merchant = c.get('merchant')
  const parsed = validateTrialFeedback(await c.req.json().catch(() => ({})))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  const result = await respondTrialFeedback(merchant.id, parsed.value)
  if (!result.ok) return c.json({ error: result.reason }, result.reason === 'not_found' ? 404 : 409)
  return c.json(result.row)
})

app.post('/api/trial-feedback/skip', requireOwnMerchant, async (c) => {
  const merchant = c.get('merchant')
  const result = await skipTrialFeedback(merchant.id)
  if (!result.ok) return c.json({ error: result.reason }, result.reason === 'not_found' ? 404 : 409)
  return c.json(result.row)
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @bitetime/backend test:db -- trial-feedback.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 6: Typecheck and full unit suite**

Run: `pnpm typecheck && pnpm --filter @bitetime/backend test`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/app.ts apps/backend/tests/api/trial-feedback.test.ts
git commit -m "feat(backend): add owner-facing trial feedback routes"
```

---

### Task 5: Internal sweep route (cron entry point)

**Files:**
- Modify: `apps/backend/src/env.ts`
- Modify: `apps/backend/src/app.ts`
- Modify: `apps/backend/vitest.db.config.ts`
- Test: `apps/backend/tests/api/trial-feedback-sweep.test.ts`

**Interfaces:**
- Consumes: `findDueTrials`, `claimSend`, `releaseSend`, `buildTrialFeedbackEmail` from `./trialFeedback.js` (Task 3); `admin` from `./supabase.js`; `env` from `./env.js`.
- Produces: `POST /api/internal/trial-feedback-sweep`; exported `trialFeedbackDeps: { email: EmailSend }` (test seam, mirrors `notifyDeps`/`githubDeps`).

- [ ] **Step 1: Add the env var**

In `apps/backend/src/env.ts`, after the `githubToken` block, add:

```ts
  // Shared secret for the trial-feedback cron sweep (POST /api/internal/trial-feedback-sweep,
  // called by a GitHub Actions schedule — see .github/workflows/trial-feedback-sweep.yml).
  // Optional, same posture as googleMapsApiKey: unset means the endpoint always refuses (503)
  // rather than running unauthenticated.
  trialFeedbackSweepSecret: process.env.TRIAL_FEEDBACK_SWEEP_SECRET || '',
```

- [ ] **Step 2: Stub the secret for the DB test suites**

In `apps/backend/vitest.db.config.ts`, inside `loadSupabaseEnv()`, right after the `STRIPE_STUBS` loop, add:

```ts
  // Same reasoning as the Stripe stubs: importing the app must be possible without a real
  // secret, and this one carries no live-network risk (it only gates an internal endpoint),
  // so a plain default — not a forced-empty like GOOGLE_MAPS_API_KEY — is enough.
  if (!process.env.TRIAL_FEEDBACK_SWEEP_SECRET) process.env.TRIAL_FEEDBACK_SWEEP_SECRET = 'test-sweep-secret-stub'
```

- [ ] **Step 3: Write the failing test**

Create `apps/backend/tests/api/trial-feedback-sweep.test.ts`:

```ts
// tests/api/trial-feedback-sweep.test.ts
// POST /api/internal/trial-feedback-sweep — the daily cron's entry point (#155). Not
// user-authenticated: a shared secret header is the only gate, so what matters here is that
// the gate actually holds, and that the sweep only ever touches a merchant once.
import { describe, it, expect, afterEach } from 'vitest'
import { app, trialFeedbackDeps } from '../../src/app.js'
import { env } from '../../src/env.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'

function sweep(secret?: string) {
  return app.request('/api/internal/trial-feedback-sweep', {
    method: 'POST',
    headers: secret !== undefined ? { 'x-sweep-secret': secret } : {},
  })
}

async function ownerIdOf(email: string) {
  const user = await makeUser(email, 'password123')
  const { data } = await user.auth.getSession()
  return data.session!.user.id
}

describe('POST /api/internal/trial-feedback-sweep', () => {
  afterEach(() => {
    trialFeedbackDeps.email = async () => {}
  })

  it('refuses with no secret configured', async () => {
    const saved = env.trialFeedbackSweepSecret
    env.trialFeedbackSweepSecret = ''
    try {
      expect((await sweep('anything')).status).toBe(503)
    } finally {
      env.trialFeedbackSweepSecret = saved
    }
  })

  it('refuses a missing or wrong header', async () => {
    expect((await sweep()).status).toBe(403)
    expect((await sweep('wrong-secret')).status).toBe(403)
  })

  it('emails a merchant whose trial ended and has never been surveyed, then never again', async () => {
    await resetMerchant('sweep-due-shop')
    const ownerId = await ownerIdOf('sweep-due-owner@example.com')
    const merchantId = await seedMerchant({ slug: 'sweep-due-shop', owner_id: ownerId })
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId, status: 'trialing', trial_ends_at: new Date(Date.now() - 60_000).toISOString(),
    })

    const sent: Array<{ to: string; subject: string }> = []
    trialFeedbackDeps.email = async (to, subject) => { sent.push({ to, subject }) }

    const res = await sweep(env.trialFeedbackSweepSecret)
    expect(res.status).toBe(200)
    const body = await res.json() as { due: number; sent: number }
    expect(body.sent).toBeGreaterThanOrEqual(1)
    expect(sent.some(m => m.to === 'sweep-due-owner@example.com')).toBe(true)

    const { data: row } = await serviceClient()
      .from('trial_feedback').select('*').eq('merchant_id', merchantId).maybeSingle()
    expect(row).toBeTruthy()
    expect(row!.responded_at).toBeNull()
    expect(row!.skipped_at).toBeNull()

    // A second sweep must not email this merchant again — the claim already exists.
    sent.length = 0
    await sweep(env.trialFeedbackSweepSecret)
    expect(sent.some(m => m.to === 'sweep-due-owner@example.com')).toBe(false)
  })

  it('never surveys a shop still inside its trial', async () => {
    await resetMerchant('sweep-not-due-shop')
    const ownerId = await ownerIdOf('sweep-not-due-owner@example.com')
    const merchantId = await seedMerchant({ slug: 'sweep-not-due-shop', owner_id: ownerId })
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId, status: 'trialing', trial_ends_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    })

    const sent: string[] = []
    trialFeedbackDeps.email = async (to) => { sent.push(to) }
    await sweep(env.trialFeedbackSweepSecret)
    expect(sent.includes('sweep-not-due-owner@example.com')).toBe(false)

    const { data: row } = await serviceClient()
      .from('trial_feedback').select('*').eq('merchant_id', merchantId).maybeSingle()
    expect(row).toBeNull()
  })

  it('releases the claim when the send fails, so the next sweep retries', async () => {
    await resetMerchant('sweep-retry-shop')
    const ownerId = await ownerIdOf('sweep-retry-owner@example.com')
    const merchantId = await seedMerchant({ slug: 'sweep-retry-shop', owner_id: ownerId })
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId, status: 'trialing', trial_ends_at: new Date(Date.now() - 60_000).toISOString(),
    })

    trialFeedbackDeps.email = async () => { throw new Error('Resend outage') }
    await sweep(env.trialFeedbackSweepSecret)

    const { data: rowAfterFailure } = await serviceClient()
      .from('trial_feedback').select('*').eq('merchant_id', merchantId).maybeSingle()
    expect(rowAfterFailure).toBeNull() // claim released — not stuck as permanently "sent"

    trialFeedbackDeps.email = async () => {}
    const res = await sweep(env.trialFeedbackSweepSecret)
    const body = await res.json() as { sent: number }
    expect(body.sent).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @bitetime/backend test:db -- trial-feedback-sweep.test.ts`
Expected: FAIL — 404 on the undefined route.

- [ ] **Step 5: Add the deps export and route**

In `apps/backend/src/app.ts`, near the existing `notifyDeps`/`githubDeps` exports (around line 1565), add:

```ts
// Same seam as notifyDeps/githubDeps: production sends real email, tests capture what would
// have been sent.
export const trialFeedbackDeps: { email: typeof resendSend } = { email: resendSend }
```

Add the `node:crypto` import near the top of the file, alongside the other `import` statements:

```ts
import { timingSafeEqual } from 'node:crypto'
```

Then, after the two owner-facing routes added in Task 4, add:

```ts
app.get('/api/admin/trial-feedback', requireSuperadmin, async (c) => {
  return c.json(await listTrialFeedbackForAdmin())
})

// Constant-time compare, guarding the length check first (a mismatched length would
// otherwise throw inside timingSafeEqual rather than answer false).
function safeEqualSecret(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Not user-authenticated — called by a GitHub Actions schedule (see
// .github/workflows/trial-feedback-sweep.yml), gated by a shared secret header instead.
// Fails CLOSED (503) when the secret is unset, matching the house rule that an optional,
// unset credential means a refusal, never an open door.
app.post('/api/internal/trial-feedback-sweep', async (c) => {
  if (!env.trialFeedbackSweepSecret) return c.json({ error: 'Sweep disabled' }, 503)
  const provided = c.req.header('x-sweep-secret') || ''
  if (!safeEqualSecret(provided, env.trialFeedbackSweepSecret)) return c.json({ error: 'Forbidden' }, 403)

  const due = await findDueTrials(new Date())
  let sentCount = 0
  for (const trial of due) {
    const claimed = await claimSend(trial.merchantId)
    if (!claimed) continue // a concurrent run already has it

    const { data: ownerUser } = await admin.auth.admin.getUserById(trial.ownerId)
    const ownerEmail = ownerUser?.user?.email
    if (!ownerEmail) {
      console.error(`trial-feedback sweep: no email for merchant ${trial.merchantId}, releasing claim`)
      await releaseSend(trial.merchantId)
      continue
    }

    try {
      const { subject, text } = buildTrialFeedbackEmail({
        shopName: trial.shopName,
        dashboardUrl: `${env.frontendUrl}/merchant`,
      })
      await trialFeedbackDeps.email(ownerEmail, subject, { text })
      sentCount++
    } catch (err) {
      console.error(
        `trial-feedback sweep: send failed for merchant ${trial.merchantId}, releasing claim:`,
        err instanceof Error ? err.message : String(err),
      )
      await releaseSend(trial.merchantId)
    }
  }

  return c.json({ due: due.length, sent: sentCount })
})
```

(The admin list route is placed here alongside the sweep for locality since Task 6 only needs to add its test; both belong to the same "Trial feedback" block in `app.ts`.)

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @bitetime/backend test:db -- trial-feedback-sweep.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 7: Typecheck and full unit suite**

Run: `pnpm typecheck && pnpm --filter @bitetime/backend test`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/env.ts apps/backend/src/app.ts apps/backend/vitest.db.config.ts apps/backend/tests/api/trial-feedback-sweep.test.ts
git commit -m "feat(backend): add secret-gated trial feedback sweep endpoint"
```

---

### Task 6: Admin list route test + RLS grant test

**Files:**
- Test: `apps/backend/tests/api/trial-feedback-admin.test.ts`
- Test: `apps/backend/tests/rls/trial-feedback-grant.test.ts`

(The `GET /api/admin/trial-feedback` route itself was added in Task 5, Step 5, alongside the sweep route, for file locality. This task only adds its test coverage plus the RLS-grant belt test.)

**Interfaces:**
- Consumes: the route added in Task 5 (`GET /api/admin/trial-feedback`); `anonClient`, `makeUser`, `seedMerchant`, `serviceClient`, `resetMerchant` from `../rls/helpers.js` (existing).

- [ ] **Step 1: Write the admin list test**

Create `apps/backend/tests/api/trial-feedback-admin.test.ts`:

```ts
// tests/api/trial-feedback-admin.test.ts
// GET /api/admin/trial-feedback — superadmin-only, ANSWERED responses only (#155).
import { describe, it, expect } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'

async function sessionOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function get(path: string, token?: string) {
  return app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
}

describe('GET /api/admin/trial-feedback', () => {
  it('refuses a non-superadmin', async () => {
    await resetMerchant('trial-feedback-admin-shop')
    const owner = await makeUser('trial-feedback-admin-owner@example.com', 'password123')
    const { token, userId } = await sessionOf(owner)
    await seedMerchant({ slug: 'trial-feedback-admin-shop', owner_id: userId })

    expect((await get('/api/admin/trial-feedback', token)).status).toBe(403)
  })

  it('lists an answered response joined with its shop, excluding a merely-sent or skipped one', async () => {
    await resetMerchant('trial-feedback-admin-answered-shop')
    await resetMerchant('trial-feedback-admin-pending-shop')
    await resetMerchant('trial-feedback-admin-skipped-shop')

    const answeredOwner = await makeUser('trial-feedback-admin-answered@example.com', 'password123')
    const { userId: answeredOwnerId } = await sessionOf(answeredOwner)
    const answeredId = await seedMerchant({ slug: 'trial-feedback-admin-answered-shop', owner_id: answeredOwnerId })
    await serviceClient().from('trial_feedback').insert({
      merchant_id: answeredId, rating: 5, comment: 'Great!', responded_at: new Date().toISOString(),
    })

    const pendingOwner = await makeUser('trial-feedback-admin-pending@example.com', 'password123')
    const { userId: pendingOwnerId } = await sessionOf(pendingOwner)
    const pendingId = await seedMerchant({ slug: 'trial-feedback-admin-pending-shop', owner_id: pendingOwnerId })
    await serviceClient().from('trial_feedback').insert({ merchant_id: pendingId })

    const skippedOwner = await makeUser('trial-feedback-admin-skipped@example.com', 'password123')
    const { userId: skippedOwnerId } = await sessionOf(skippedOwner)
    const skippedId = await seedMerchant({ slug: 'trial-feedback-admin-skipped-shop', owner_id: skippedOwnerId })
    await serviceClient().from('trial_feedback').insert({ merchant_id: skippedId, skipped_at: new Date().toISOString() })

    const superadmin = await makeUser('trial-feedback-admin-super@example.com', 'password123')
    const { data } = await superadmin.auth.getSession()
    await serviceClient().from('profiles').insert({
      user_id: data.session!.user.id, name: 'Super', app_role: 'superadmin',
    })
    const superToken = data.session!.access_token

    const res = await get('/api/admin/trial-feedback', superToken)
    expect(res.status).toBe(200)
    const items = await res.json() as Array<{ merchant_id: string; shop_name: string | null; rating: number | null }>

    expect(items.some(i =>
      i.merchant_id === answeredId && i.rating === 5 && i.shop_name === 'trial-feedback-admin-answered-shop',
    )).toBe(true)
    expect(items.some(i => i.merchant_id === pendingId)).toBe(false)
    expect(items.some(i => i.merchant_id === skippedId)).toBe(false)
  })
})
```

- [ ] **Step 2: Write the RLS grant test**

Create `apps/backend/tests/rls/trial-feedback-grant.test.ts`:

```ts
// tests/rls/trial-feedback-grant.test.ts
// Belt on top of the code path: after the revoke, a browser (anon or authenticated) client
// cannot SELECT trial_feedback directly at all — mirrors billing-grant.test.ts. If this ever
// passes with rows, the grant crept back and the API is no longer the only door.
import { describe, it, expect } from 'vitest'
import { anonClient, makeUser, seedMerchant, serviceClient } from './helpers.js'

describe('trial_feedback is not directly readable by the browser', () => {
  it('denies an anonymous SELECT', async () => {
    const { data, error } = await anonClient().from('trial_feedback').select('*')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
    if (error) expect(error.message.toLowerCase()).toContain('permission denied')
  })

  it('denies an authenticated SELECT even for the merchant owner', async () => {
    const owner = await makeUser('trial-feedback-grant-owner@example.com', 'password123')
    const { data: session } = await owner.auth.getSession()
    const ownerId = session.session!.user.id
    const merchantId = await seedMerchant({ slug: 'trial-feedback-grant-shop', owner_id: ownerId })
    const { error: seedError } = await serviceClient().from('trial_feedback').insert({ merchant_id: merchantId })
    if (seedError) throw new Error(`seeding trial_feedback: ${seedError.message}`)

    const { data, error } = await owner.from('trial_feedback').select('*').eq('merchant_id', merchantId)

    expect(error).not.toBeNull()
    expect(error?.code === '42501' || error?.message.toLowerCase().includes('permission denied')).toBe(true)
    expect(data).toBeNull()
  })
})
```

- [ ] **Step 3: Run both tests**

Run: `pnpm --filter @bitetime/backend test:db -- trial-feedback-admin.test.ts trial-feedback-grant.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 4: Full DB suite**

Run: `pnpm --filter @bitetime/backend test:db`
Expected: PASS, no regressions in other suites.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/tests/api/trial-feedback-admin.test.ts apps/backend/tests/rls/trial-feedback-grant.test.ts
git commit -m "test(backend): cover admin trial feedback listing and browser-grant isolation"
```

---

### Task 7: Frontend types and store functions

**Files:**
- Modify: `apps/frontend/src/types.ts`
- Modify: `apps/frontend/src/store.ts`

**Interfaces:**
- Consumes: `apiGet`, `apiSend`, `Result` from `./api.js` (existing, already imported in `store.ts`).
- Produces:
  ```ts
  export interface TrialFeedbackOwn {
    merchant_id: string; sent_at: string; rating: number | null; comment: string | null
    responded_at: string | null; skipped_at: string | null
  }
  export interface TrialFeedbackAdminItem extends TrialFeedbackOwn {
    shop_name: string | null; shop_slug: string | null
  }
  export function fetchTrialFeedback(): Promise<Result<TrialFeedbackOwn | null>>
  export function respondTrialFeedback(rating: number, comment: string | null): Promise<Result<TrialFeedbackOwn>>
  export function skipTrialFeedback(): Promise<Result<TrialFeedbackOwn>>
  export function fetchAdminTrialFeedback(): Promise<Result<TrialFeedbackAdminItem[]>>
  ```

- [ ] **Step 1: Add the types**

In `apps/frontend/src/types.ts`, after the `FeedbackItem` interface (around line 274), add:

```ts
// One row of the one-time trial-experience survey (#155). `null` from `fetchTrialFeedback`
// means no survey has been sent yet — the trial hasn't ended. A non-null row with neither
// responded_at nor skipped_at is a pending prompt still waiting on the merchant.
export interface TrialFeedbackOwn {
  merchant_id: string
  sent_at: string
  rating: number | null
  comment: string | null
  responded_at: string | null
  skipped_at: string | null
}

export interface TrialFeedbackAdminItem extends TrialFeedbackOwn {
  shop_name: string | null
  shop_slug: string | null
}
```

- [ ] **Step 2: Add the store functions**

In `apps/frontend/src/store.ts`, after the `setFeedbackStatus` function (end of the "Merchant platform feedback" block), add:

```ts
// ── Trial feedback (#155) ───────────────────────────────────────────────────────
// One-time, platform-initiated survey — see CONTEXT.md → Trial feedback. Scoped to the
// caller's own shop by the backend (requireOwnMerchant), so there is no merchantId to pass.
export async function fetchTrialFeedback(): Promise<Result<TrialFeedbackOwn | null>> {
  return apiGet<TrialFeedbackOwn | null>('/api/trial-feedback', { auth: true })
}

export async function respondTrialFeedback(rating: number, comment: string | null): Promise<Result<TrialFeedbackOwn>> {
  return apiSend<TrialFeedbackOwn>('/api/trial-feedback/respond', 'POST', { rating, comment }, { auth: true })
}

export async function skipTrialFeedback(): Promise<Result<TrialFeedbackOwn>> {
  return apiSend<TrialFeedbackOwn>('/api/trial-feedback/skip', 'POST', undefined, { auth: true })
}

export async function fetchAdminTrialFeedback(): Promise<Result<TrialFeedbackAdminItem[]>> {
  return apiGet<TrialFeedbackAdminItem[]>('/api/admin/trial-feedback', { auth: true })
}
```

Add `TrialFeedbackOwn` and `TrialFeedbackAdminItem` to `store.ts`'s existing `import type { ... } from './types'` line.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/types.ts apps/frontend/src/store.ts
git commit -m "feat(frontend): add trial feedback types and API calls"
```

---

### Task 8: TrialFeedbackPrompt component, wired into Dashboard and SuspendedScreen

**Files:**
- Create: `apps/frontend/src/merchant/TrialFeedbackPrompt.tsx`
- Modify: `apps/frontend/src/merchant/Dashboard.tsx`
- Modify: `apps/frontend/src/merchant/SuspendedScreen.tsx`

**Interfaces:**
- Consumes: `fetchTrialFeedback`, `respondTrialFeedback`, `skipTrialFeedback` from `../store` (Task 7); `TRIAL_FEEDBACK_COMMENT_MAX_LENGTH` from `@bitetime/shared` (Task 1); `useSession` from `../SessionContext` (existing).
- Produces: default export `TrialFeedbackPrompt` — a React component taking no props, rendering nothing until it knows there's something pending.

This task has no automated test (CLAUDE.md: UI is verified by running the app). Verification is run-and-verify in Step 4.

- [ ] **Step 1: Write the component**

Create `apps/frontend/src/merchant/TrialFeedbackPrompt.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { TRIAL_FEEDBACK_COMMENT_MAX_LENGTH } from '@bitetime/shared'
import { useSession } from '../SessionContext'
import { fetchTrialFeedback, respondTrialFeedback, skipTrialFeedback } from '../store'
import { Textarea } from '../components/ui/textarea'
import { Button } from '../components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The one-time trial-experience survey (#155) — shown once a merchant's `trial_feedback` row
 * exists and is neither answered nor skipped. Mounted from both Dashboard and SuspendedScreen,
 * since a lapsed trial is exactly the merchant most likely to have this waiting for them
 * (see CONTEXT.md → Trial feedback). Renders nothing while loading, and nothing once there
 * is nothing pending — including for a merchant with no shop yet.
 */
export default function TrialFeedbackPrompt() {
  const { t, merchant } = useSession()
  const [status, setStatus] = useState<'loading' | 'pending' | 'done'>('loading')
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchTrialFeedback().then(r => {
      if (cancelled) return
      const pending = !!(r.ok && r.data && !r.data.responded_at && !r.data.skipped_at)
      setStatus(pending ? 'pending' : 'done')
    })
    return () => { cancelled = true }
  }, [])

  if (!merchant || status !== 'pending') return null

  const trimmed = comment.trim()
  const tooLong = trimmed.length > TRIAL_FEEDBACK_COMMENT_MAX_LENGTH

  const submit = async () => {
    if (rating < 1 || tooLong || busy) return
    setBusy(true); setError('')
    const r = await respondTrialFeedback(rating, trimmed || null)
    if (r.ok) setStatus('done')
    else { setError(r.error.message || t('Could not send', '无法发送')); setBusy(false) }
  }

  const skip = async () => {
    if (busy) return
    setBusy(true); setError('')
    const r = await skipTrialFeedback()
    if (r.ok) setStatus('done')
    else { setError(r.error.message || t('Could not send', '无法发送')); setBusy(false) }
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4 mb-6 rounded-md border-[1.5px] border-oxblood/20 bg-surface-raised">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[14px] font-medium text-ink">
          {t('How was your trial?', '试用体验如何？')}
        </p>
        <button
          type="button"
          onClick={() => void skip()}
          disabled={busy}
          className="text-[12px] text-text-tertiary underline shrink-0"
        >
          {t('No thanks', '不用了')}
        </button>
      </div>

      <div className="flex gap-1" role="radiogroup" aria-label={t('Rating', '评分')}>
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={String(n)}
            onMouseEnter={() => setHoverRating(n)}
            onMouseLeave={() => setHoverRating(0)}
            onClick={() => setRating(n)}
          >
            <Star
              size={22}
              strokeWidth={1.75}
              className={cn((hoverRating || rating) >= n ? 'fill-oxblood text-oxblood' : 'text-text-tertiary')}
            />
          </button>
        ))}
      </div>

      <Textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        rows={3}
        placeholder={t('Anything you want to add? (optional)', '还有什么想说的吗？（可选）')}
        aria-label={t('Comment', '留言')}
      />
      {tooLong && (
        <p className="text-[12px] text-danger-fg">
          {t(`Comment must be ${TRIAL_FEEDBACK_COMMENT_MAX_LENGTH} characters or fewer`,
             `留言不能超过 ${TRIAL_FEEDBACK_COMMENT_MAX_LENGTH} 个字`)}
        </p>
      )}
      {error && <p className="text-[13px] text-danger-fg">{error}</p>}

      <Button onClick={() => void submit()} disabled={rating < 1 || tooLong || busy} className="self-start">
        {busy ? t('Sending…', '发送中…') : t('Submit', '提交')}
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Wire into Dashboard**

In `apps/frontend/src/merchant/Dashboard.tsx`, add the import alongside the other section imports:

```ts
import TrialFeedbackPrompt from './TrialFeedbackPrompt'
```

Then render it right after `<BillingBanner />` (inside `DashboardShell`, before `<OnboardingChecklist ... />`):

```tsx
      <BillingBanner />
      <TrialFeedbackPrompt />
      <OnboardingChecklist section={section} onNavigate={selectSection} />
```

- [ ] **Step 3: Wire into SuspendedScreen**

In `apps/frontend/src/merchant/SuspendedScreen.tsx`, add the import:

```ts
import TrialFeedbackPrompt from './TrialFeedbackPrompt'
```

Render it right after the closing `</div>` of the status banner block, before the `{err && ...}` block:

```tsx
      </div>
      <TrialFeedbackPrompt />
      {err && (
```

- [ ] **Step 4: Run-and-verify**

Invoke the `verify` skill (or manually): start local Supabase and both dev servers, seed a merchant whose `trial_feedback` has a pending row (via `psql` insert or a temporary sweep call), sign in as that merchant, and confirm:
1. The prompt renders on `/merchant` (Dashboard) with 5 clickable stars and a comment box.
2. Submitting with no rating selected is disabled.
3. Picking a rating and submitting makes the prompt disappear and `GET /api/trial-feedback` now returns a row with `responded_at` set.
4. Repeat with a shop set to `status = 'suspended'` (or simulate via `serviceClient`) — the prompt renders inside `SuspendedScreen` instead, and "No thanks" marks it `skipped_at` and hides it permanently on reload.
5. Both English and `lang=zh` render correctly (toggle language in the UI).

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/merchant/TrialFeedbackPrompt.tsx apps/frontend/src/merchant/Dashboard.tsx apps/frontend/src/merchant/SuspendedScreen.tsx
git commit -m "feat(frontend): add trial feedback prompt to dashboard and suspended screen"
```

---

### Task 9: Admin trial feedback page

**Files:**
- Create: `apps/frontend/src/admin/AdminTrialFeedback.tsx`
- Modify: `apps/frontend/src/admin/AdminHome.tsx`

**Interfaces:**
- Consumes: `fetchAdminTrialFeedback` from `../store` (Task 7); `TrialFeedbackAdminItem` from `../types` (Task 7).
- Produces: default export `AdminTrialFeedback`, wired as a new `AdminHome` section.

No automated test (CLAUDE.md: UI is verified by running the app). Verification is run-and-verify in Step 3.

- [ ] **Step 1: Write the component**

Create `apps/frontend/src/admin/AdminTrialFeedback.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { useSession } from '../SessionContext'
import { fetchAdminTrialFeedback } from '../store'
import type { TrialFeedbackAdminItem } from '../types'
import { Card } from '../components/ui/card'

/**
 * Superadmin's read-only list of trial-feedback survey RESPONSES (#155) — merchants who
 * were sent the survey and never answered are not shown here; see CONTEXT.md → Trial
 * feedback. Newest-first, no triage actions: unlike AdminFeedback this is a survey, not a
 * complaint queue.
 */
export default function AdminTrialFeedback() {
  const { t, lang } = useSession()
  const [items, setItems] = useState<TrialFeedbackAdminItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchAdminTrialFeedback()
      .then(r => {
        if (cancelled) return
        if (r.ok) { setItems(r.data); setError('') }
        else setError(r.error.message || t('Could not load feedback', '无法加载反馈'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [t])

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-MY', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-heading text-[20px] text-oxblood">{t('Trial feedback', '试用反馈')}</h2>

      {error && <p className="text-[13px] text-danger-fg">{error}</p>}
      {loading && <p className="text-[13px] text-text-tertiary">{t('Loading…', '加载中…')}</p>}
      {!loading && items.length === 0 && (
        <p className="text-[13px] text-text-tertiary">{t('No responses yet.', '暂无回复。')}</p>
      )}

      {items.map(item => (
        <Card key={item.merchant_id} className="p-4 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-[15px] text-oxblood">
              {item.shop_name ?? t('Deleted shop', '已删除的店铺')}
            </span>
            {item.shop_slug && (
              <span className="text-[12px] text-text-tertiary">/s/{item.shop_slug}</span>
            )}
            <span className="ml-auto text-[12px] text-text-tertiary">
              {item.responded_at ? formatDate(item.responded_at) : ''}
            </span>
          </div>

          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map(n => (
              <Star
                key={n}
                size={16}
                strokeWidth={1.75}
                className={(item.rating ?? 0) >= n ? 'fill-oxblood text-oxblood' : 'text-text-tertiary'}
              />
            ))}
          </div>

          {item.comment && <p className="text-[14px] text-ink whitespace-pre-wrap">{item.comment}</p>}
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Wire into AdminHome**

In `apps/frontend/src/admin/AdminHome.tsx`:

Add `Star` to the `lucide-react` import and add the new component import:

```ts
import { LayoutDashboard, Store, MessageSquare, Star } from 'lucide-react'
```
```ts
import AdminTrialFeedback from './AdminTrialFeedback'
```

Add a section entry to `SECTIONS`:

```ts
const SECTIONS = [
  { key: 'overview',  en: 'Overview',  zh: '概览', icon: <LayoutDashboard {...ICON} /> },
  { key: 'merchants', en: 'Merchants', zh: '商家', icon: <Store {...ICON} /> },
  { key: 'feedback',  en: 'Feedback',  zh: '反馈', icon: <MessageSquare {...ICON} /> },
  { key: 'trial-feedback', en: 'Trial feedback', zh: '试用反馈', icon: <Star {...ICON} /> },
]
```

Add the render branch:

```tsx
        {section === 'feedback'  && <AdminFeedback />}
        {section === 'trial-feedback' && <AdminTrialFeedback />}
```

- [ ] **Step 3: Run-and-verify**

With the app running and at least one answered `trial_feedback` row seeded (from Task 8's verification, or via `psql`), sign in as a superadmin, navigate to `/admin` → "Trial feedback" in the sidebar, and confirm:
1. The answered response appears with its shop name, star rating, comment, and timestamp.
2. A pending or skipped row (seed one via `psql` if none exists) does **not** appear in the list.
3. `zh` language toggle renders the Chinese labels correctly.

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/admin/AdminTrialFeedback.tsx apps/frontend/src/admin/AdminHome.tsx
git commit -m "feat(frontend): add superadmin trial feedback page"
```

---

### Task 10: GitHub Actions daily sweep workflow

**Files:**
- Create: `.github/workflows/trial-feedback-sweep.yml`

**Interfaces:**
- Consumes: `POST /api/internal/trial-feedback-sweep` (Task 5), via two GitHub repo secrets it does not itself set: `BACKEND_URL`, `TRIAL_FEEDBACK_SWEEP_SECRET`.

This task's final verification step is a **manual, human-only** action (setting production secrets and a deployed backend env var) — the agent must stop after creating the file and flag it, exactly as CLAUDE.md requires for anything that reaches production.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/trial-feedback-sweep.yml`:

```yaml
# Daily trigger for the trial-feedback survey (#155) — the first scheduled (rather than
# webhook- or request-driven) job in this repo. See
# docs/adr/0011-trial-feedback-is-a-cron-sweep-not-a-webhook.md for why: no single Stripe
# event covers every way a trial can end (converted, still trialing untouched, suspended),
# so nothing webhook-driven can fire this reliably for all of them.
#
# TWO REPO SECRETS ARE REQUIRED and are NOT set by this file:
#   BACKEND_URL                 — the deployed backend's base URL (Railway)
#   TRIAL_FEEDBACK_SWEEP_SECRET — must equal the backend's TRIAL_FEEDBACK_SWEEP_SECRET env var
# Without both, the sweep 403s/503s harmlessly — see apps/backend/src/env.ts's
# trialFeedbackSweepSecret and the route's fail-closed check.
name: trial-feedback-sweep

on:
  schedule:
    - cron: '0 3 * * *'
  workflow_dispatch: {}

jobs:
  sweep:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Call the sweep endpoint
        run: |
          status=$(curl -sS -o /tmp/body -w '%{http_code}' \
            -X POST "${{ secrets.BACKEND_URL }}/api/internal/trial-feedback-sweep" \
            -H "x-sweep-secret: ${{ secrets.TRIAL_FEEDBACK_SWEEP_SECRET }}")
          cat /tmp/body
          if [ "$status" -ge 300 ]; then
            echo "Sweep failed with HTTP $status"
            exit 1
          fi
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/trial-feedback-sweep.yml
git commit -m "feat(ci): add daily trial feedback sweep workflow"
```

- [ ] **Step 3: STOP — flag the manual production step**

Do not attempt to set repository secrets or Railway environment variables. Report to the user:

> This workflow needs two things only a human can set, before it will ever succeed:
> 1. A `TRIAL_FEEDBACK_SWEEP_SECRET` environment variable on the deployed backend (Railway) — any random string.
> 2. Two matching GitHub repository secrets (Settings → Secrets and variables → Actions): `BACKEND_URL` (the deployed backend's base URL) and `TRIAL_FEEDBACK_SWEEP_SECRET` (the same value as step 1).
>
> Until both are set, the workflow runs on schedule but the sweep call 503s (secret unset) or 403s (mismatched) — harmless, but no survey emails go out. Once set, trigger it once by hand via the Actions tab → "trial-feedback-sweep" → "Run workflow", and confirm it returns HTTP 200.

---

## Self-Review

**Spec coverage:**
- General trial-experience survey, day-7, regardless of outcome → Task 3 `findDueTrials` (filters solely on `trial_ends_at <= now`, no status branching) + Task 2 migration comment.
- Email only, links to dashboard, login required → Task 5 sweep route builds the email with `${env.frontendUrl}/merchant`; no tokenized link anywhere.
- New dedicated `trial_feedback` table with send/respond/skip state → Task 2, Task 3.
- Rating 1–5 required, comment optional ≤2000 → Task 1 (shared validation) + Task 2 (DB CHECK) + Task 8 (form).
- Cron sweep, not webhook, first scheduled job → Task 5 + Task 10 + ADR 0011 (already written).
- Backfill exclusion (new trials only) → Task 2 migration's `insert ... on conflict do nothing` seeding skipped rows for pre-existing lapsed trials.
- Form reachable from `SuspendedScreen` as well as `Dashboard` → Task 8, Steps 2–3.
- Permanent dismiss → Task 3 `skipTrialFeedback` / `writeOnce` guard (`is('responded_at', null).is('skipped_at', null)`) makes both respond and skip one-shot; Task 8's `status` state never re-shows once `'done'`.
- New dedicated admin page, separate from `AdminFeedback` → Task 9.
- Browser never touches the table directly (RLS + grants) → Task 2 + Task 6's grant test.

**Placeholder scan:** No task step reads "TBD", "handle appropriately", or references undefined types — verified every code block above is complete and self-contained.

**Type consistency:** `TrialFeedbackDraft` (Task 1) flows into `respondTrialFeedback(merchantId, draft)` (Task 3) unchanged; `TrialFeedbackRow` (Task 3, backend) and `TrialFeedbackOwn` (Task 7, frontend) share the same five fields (`merchant_id`/`sent_at`/`rating`/`comment`/`responded_at`/`skipped_at`) by design — the frontend type is the JSON-serialized shape of the backend row, which is what the routes actually return. `trialFeedbackDeps.email` (Task 5) has the same signature as `resendSend`/`EmailSend` (existing), consumed identically to `notifyDeps.email`.
