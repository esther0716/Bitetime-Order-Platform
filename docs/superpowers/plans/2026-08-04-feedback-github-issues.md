# Feedback → GitHub Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every merchant feedback submission (`POST /api/merchants/:id/feedback`) automatically files a GitHub issue on `leongcheefai/Bitetime-Order-Platform`, labelled `needs-triage` + a category label, and admin resolve/reopen keeps the issue's open/closed state in sync — all best-effort, never blocking or failing the feedback flow.

**Architecture:** New `apps/backend/src/github.ts` module — pure title/body/label builders plus three thin `fetch()`-based adapters (`createGithubIssue`, `closeGithubIssue`, `reopenGithubIssue`), shaped exactly like `telegramSend` in `notify.ts`: the token is a function parameter, not read from `env` inside the module, so the module stays unit-testable without triggering `env.ts`'s fail-fast `required()` checks. `app.ts` holds a mutable `githubDeps` object (mirroring the existing `notifyDeps`) so `tests/api` can swap in fakes. Two nullable columns on `merchant_feedback` link a row to its issue; `AdminFeedback.tsx` shows the link.

**Tech Stack:** Hono backend (TypeScript), Supabase Postgres migration, `@bitetime/shared` types (no changes needed there), Vitest (`tests/unit` for the pure module, `tests/api` for the wired-up route behavior against real Postgres), React 19 + TypeScript frontend.

## Global Constraints

- Backend relative imports keep `.js` specifiers that resolve to `.ts` source — leave them as `.js`.
- Never run `pnpm --filter @bitetime/backend db:push` or any `supabase` command that reaches production. Local migration only (`db:migrate`); a human pushes.
- `pnpm --filter @bitetime/backend test:db` needs a running local Supabase (`supabase start` from `apps/backend`).
- Never mock the database in `tests/api` or `tests/rls`. Those suites exist to prove properties of real Postgres.
- No live GitHub API calls in any automated test. `github.ts`'s adapters must never read `env` directly — token is always a parameter — specifically so `tests/unit` (which runs with zero env vars set, per `.github/workflows/ci.yml`) never imports `env.ts` transitively and never makes a real network call.
- Every GitHub call in `github.ts` is best-effort: catch, `console.error`, return `null` / resolve `void`. Never throw out of `github.ts`.
- No new backend runtime dependency — GitHub calls use the global `fetch`, not a client library, so no `--external:` flag is needed in `apps/backend/package.json`'s `build` script.
- Repo is the hardcoded constant `leongcheefai/Bitetime-Order-Platform` (exported as `GITHUB_REPO` from `github.ts`) — not env-configurable.
- Every user-visible string in `AdminFeedback.tsx` is `t(english, chinese)` — there is no i18n library.

---

## File Structure

**Create:**
- `apps/backend/supabase/migrations/20260804120000_merchant_feedback_github_issue.sql` — the two link-back columns.
- `apps/backend/src/github.ts` — pure builders + best-effort fetch adapters.
- `apps/backend/tests/unit/github.test.ts` — builder and adapter tests (mocked `fetch`, no `env.ts` import).

**Modify:**
- `apps/backend/src/feedback.ts` — `FeedbackRow` gains two fields; new `updateFeedbackGithubIssue`.
- `apps/backend/src/app.ts` — import `github.ts`, add `githubDeps`, wire the submit route (`:1318`) and the resolve/reopen route (`:1343`).
- `apps/backend/tests/api/feedback.test.ts` — two new tests using the `githubDeps` swap (mirrors `notifyDeps` swap in `tests/api/notifyOrder.test.ts`).
- `apps/frontend/src/types.ts` — `FeedbackItem` gains the two fields (`:262`).
- `apps/frontend/src/admin/AdminFeedback.tsx` — render the issue link when present.

**One-time human setup, not part of this plan's tasks** (call this out to the user at the end, per the spec): create the `billing` and `other` GitHub labels on the repo, and set `GITHUB_TOKEN` in the backend's deployment environment. Neither blocks any task below — the code fails open without them.

---

### Task 1: Migration — link-back columns

**Files:**
- Create: `apps/backend/supabase/migrations/20260804120000_merchant_feedback_github_issue.sql`

**Interfaces:**
- Produces: `merchant_feedback.github_issue_number bigint null`, `merchant_feedback.github_issue_url text null`. Every later task that touches `merchant_feedback` reads or writes these.

- [x] **Step 1: Write the migration**

Create `apps/backend/supabase/migrations/20260804120000_merchant_feedback_github_issue.sql`:

```sql
-- Links a merchant_feedback row to the GitHub issue auto-filed for it (see github.ts and
-- docs/superpowers/specs/2026-08-04-feedback-github-issues-design.md).
--
-- Both nullable: issue creation is best-effort and runs AFTER the feedback row is already
-- committed, so a row can legitimately have no issue behind it — GITHUB_TOKEN unset, the
-- GitHub API down, or every row written before this shipped. Nothing here ever blocks or
-- rolls back a feedback submission.

alter table public.merchant_feedback
  add column if not exists github_issue_number bigint,
  add column if not exists github_issue_url text;
```

- [x] **Step 2: Apply it locally**

Run: `pnpm --filter @bitetime/backend db:migrate`
Expected: migration applies with no error (needs local Supabase running — `supabase start` from `apps/backend` if it isn't).

- [x] **Step 3: Verify the columns exist**

Run:
```bash
cd apps/backend && supabase status -o env | grep DB_URL
```
Take the printed URL and run:
```bash
psql "<that DB_URL>" -c "\d public.merchant_feedback" | grep github_issue
```
Expected: both `github_issue_number` (bigint) and `github_issue_url` (text) listed, both nullable.

- [x] **Step 4: Commit**

```bash
git add apps/backend/supabase/migrations/20260804120000_merchant_feedback_github_issue.sql
git commit -m "feat(backend): add github issue link-back columns to merchant_feedback"
```

---

### Task 2: `github.ts` — builders and adapters

**Files:**
- Create: `apps/backend/src/github.ts`
- Test: `apps/backend/tests/unit/github.test.ts`

**Interfaces:**
- Consumes: `FeedbackCategory` from `@bitetime/shared` (already exists — `packages/shared/src/feedback.ts`).
- Produces (consumed by Task 3 route wiring):
  - `GITHUB_REPO: string`
  - `categoryToLabel(category: FeedbackCategory): string`
  - `buildIssueTitle(category: FeedbackCategory, shopName: string): string`
  - `buildIssueBody(input: { message: string; shopName: string; shopSlug: string; feedbackId: string; createdAt: string }): string`
  - `interface GithubIssue { number: number; html_url: string }`
  - `type CreateGithubIssue = (token: string, input: { title: string; body: string; labels: string[] }) => Promise<GithubIssue | null>`
  - `type GithubIssueAction = (token: string, issueNumber: number) => Promise<void>`
  - `createGithubIssue: CreateGithubIssue`
  - `closeGithubIssue: GithubIssueAction`
  - `reopenGithubIssue: GithubIssueAction`

- [x] **Step 1: Write the failing tests**

Create `apps/backend/tests/unit/github.test.ts`:

```ts
// GitHub adapter for auto-filing merchant feedback as issues (#89-follow-up). Token is a
// PARAMETER on every export here (never read from env.ts) precisely so this file can be
// imported at runtime by a unit test with zero env vars set — see the plan's Global
// Constraints. No network call happens unless `fetch` is stubbed below.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  GITHUB_REPO,
  categoryToLabel,
  buildIssueTitle,
  buildIssueBody,
  createGithubIssue,
  closeGithubIssue,
  reopenGithubIssue,
} from '../../src/github.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('categoryToLabel', () => {
  it('maps to the repo\'s existing labels where one already fits', () => {
    expect(categoryToLabel('bug')).toBe('bug')
    expect(categoryToLabel('feature')).toBe('enhancement')
    expect(categoryToLabel('billing')).toBe('billing')
    expect(categoryToLabel('other')).toBe('other')
  })
})

describe('buildIssueTitle', () => {
  it('is [Feedback] <category>: <shop name>', () => {
    expect(buildIssueTitle('bug', 'Golden Wok')).toBe('[Feedback] bug: Golden Wok')
  })
})

describe('buildIssueBody', () => {
  it('includes the message, shop, feedback id and timestamp', () => {
    const body = buildIssueBody({
      message: 'App crashes when I add a voucher at checkout',
      shopName: 'Golden Wok',
      shopSlug: 'golden-wok',
      feedbackId: 'abc-123',
      createdAt: '2026-08-04T00:00:00Z',
    })
    expect(body).toContain('App crashes when I add a voucher at checkout')
    expect(body).toContain('Golden Wok')
    expect(body).toContain('/s/golden-wok')
    expect(body).toContain('abc-123')
    expect(body).toContain('2026-08-04T00:00:00Z')
  })
})

describe('createGithubIssue', () => {
  it('skips and makes no request when the token is empty', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await createGithubIssue('', { title: 't', body: 'b', labels: ['needs-triage'] })
    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns the issue number and url on success, and posts to the right repo', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe(`https://api.github.com/repos/${GITHUB_REPO}/issues`)
      return new Response(
        JSON.stringify({ number: 42, html_url: 'https://github.com/x/y/issues/42' }),
        { status: 201 },
      )
    })
    vi.stubGlobal('fetch', fetchSpy)
    const result = await createGithubIssue('ghp_test', {
      title: 't', body: 'b', labels: ['needs-triage', 'bug'],
    })
    expect(result).toEqual({ number: 42, html_url: 'https://github.com/x/y/issues/42' })
  })

  it('retries once without the category label on a 422, and still returns the issue', async () => {
    let call = 0
    const fetchSpy = vi.fn(async (_url: string, init: any) => {
      call++
      const labels = JSON.parse(init.body).labels
      if (call === 1) {
        expect(labels).toEqual(['needs-triage', 'other'])
        return new Response('{"message":"Label does not exist"}', { status: 422 })
      }
      expect(labels).toEqual(['needs-triage'])
      return new Response(
        JSON.stringify({ number: 7, html_url: 'https://github.com/x/y/issues/7' }),
        { status: 201 },
      )
    })
    vi.stubGlobal('fetch', fetchSpy)
    const result = await createGithubIssue('ghp_test', {
      title: 't', body: 'b', labels: ['needs-triage', 'other'],
    })
    expect(result).toEqual({ number: 7, html_url: 'https://github.com/x/y/issues/7' })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('returns null and does not throw when every attempt fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    const result = await createGithubIssue('ghp_test', { title: 't', body: 'b', labels: ['needs-triage'] })
    expect(result).toBeNull()
  })

  it('returns null and does not throw on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await createGithubIssue('ghp_test', { title: 't', body: 'b', labels: ['needs-triage'] })
    expect(result).toBeNull()
  })
})

describe('closeGithubIssue / reopenGithubIssue', () => {
  it('PATCHes the issue state', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    await closeGithubIssue('ghp_test', 42)
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://api.github.com/repos/${GITHUB_REPO}/issues/42`,
      expect.objectContaining({ method: 'PATCH' }),
    )
    const [, closeInit] = fetchSpy.mock.calls[0] as [string, any]
    expect(JSON.parse(closeInit.body)).toEqual({ state: 'closed' })

    fetchSpy.mockClear()
    await reopenGithubIssue('ghp_test', 42)
    const [, reopenInit] = fetchSpy.mock.calls[0] as [string, any]
    expect(JSON.parse(reopenInit.body)).toEqual({ state: 'open' })
  })

  it('never throws when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(closeGithubIssue('ghp_test', 42)).resolves.toBeUndefined()
    await expect(reopenGithubIssue('ghp_test', 42)).resolves.toBeUndefined()
  })

  it('skips without a token', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await closeGithubIssue('', 42)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bitetime/backend test -- github.test.ts`
Expected: FAIL — `Cannot find module '../../src/github.js'`.

- [x] **Step 3: Write `github.ts`**

Create `apps/backend/src/github.ts`:

```ts
// The one place in this codebase that talks to GitHub — auto-filing merchant platform
// feedback (#89-follow-up) as an issue on the platform repo, so it lands in the same
// triage queue (needs-triage, docs/agents/triage-labels.md) as everything else the
// project tracks. See docs/superpowers/specs/2026-08-04-feedback-github-issues-design.md.
//
// Every export here is an ADAPTER, shaped and injected like telegramSend in notify.ts: the
// token is a PARAMETER, never read from env.ts. That is what lets this module be imported
// at runtime by a unit test that has zero env vars set (tests/unit runs with none, per
// .github/workflows/ci.yml) without tripping env.ts's fail-fast required() checks. The
// caller (app.ts, which already imports env.ts for other reasons) reads env.githubToken
// and passes it in.
//
// Best-effort throughout: every export here swallows its own errors and returns null /
// resolves void rather than throwing. A GitHub outage must never fail a feedback
// submission or an admin's resolve/reopen click.
import type { FeedbackCategory } from '@bitetime/shared'

export const GITHUB_REPO = 'leongcheefai/Bitetime-Order-Platform'
const GITHUB_API = 'https://api.github.com'

// bug/enhancement already exist on the repo; billing/other are created once by hand (see
// the spec's "One-time setup"). feature -> enhancement reuses the repo's existing
// vocabulary rather than inventing a feedback-specific label.
const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: 'bug',
  feature: 'enhancement',
  billing: 'billing',
  other: 'other',
}

export function categoryToLabel(category: FeedbackCategory): string {
  return CATEGORY_LABELS[category]
}

export function buildIssueTitle(category: FeedbackCategory, shopName: string): string {
  return `[Feedback] ${category}: ${shopName}`
}

export function buildIssueBody(input: {
  message: string
  shopName: string
  shopSlug: string
  feedbackId: string
  createdAt: string
}): string {
  return [
    input.message,
    '',
    '---',
    `Shop: ${input.shopName} (/s/${input.shopSlug})`,
    `Feedback ID: ${input.feedbackId}`,
    `Submitted: ${input.createdAt}`,
  ].join('\n')
}

export interface GithubIssue {
  number: number
  html_url: string
}

export type CreateGithubIssue = (
  token: string,
  input: { title: string; body: string; labels: string[] },
) => Promise<GithubIssue | null>

export type GithubIssueAction = (token: string, issueNumber: number) => Promise<void>

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/**
 * Files the issue. On a 422 with more than one label (most likely an unrecognised
 * category label — see the spec's one-time setup step) retries once with only
 * needs-triage, so a missed label never loses the issue outright. Any other failure, or a
 * second failure, logs and returns null.
 */
export const createGithubIssue: CreateGithubIssue = async (token, { title, body, labels }) => {
  if (!token) {
    console.error('GitHub issue skipped: no token configured')
    return null
  }

  const post = (issueLabels: string[]) =>
    fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ title, body, labels: issueLabels }),
    })

  try {
    let res = await post(labels)
    if (res.status === 422 && labels.length > 1) {
      res = await post(labels.filter((l) => l === 'needs-triage'))
    }
    if (!res.ok) {
      console.error(`GitHub issue creation failed: ${res.status} ${await res.text()}`)
      return null
    }
    const data = (await res.json()) as { number: number; html_url: string }
    return { number: data.number, html_url: data.html_url }
  } catch (e) {
    console.error('GitHub issue creation failed:', e instanceof Error ? e.message : String(e))
    return null
  }
}

async function setIssueState(token: string, issueNumber: number, state: 'open' | 'closed'): Promise<void> {
  if (!token) return
  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({ state }),
    })
    if (!res.ok) console.error(`GitHub issue #${issueNumber} state update failed: ${res.status}`)
  } catch (e) {
    console.error(`GitHub issue #${issueNumber} state update failed:`, e instanceof Error ? e.message : String(e))
  }
}

export const closeGithubIssue: GithubIssueAction = (token, issueNumber) =>
  setIssueState(token, issueNumber, 'closed')
export const reopenGithubIssue: GithubIssueAction = (token, issueNumber) =>
  setIssueState(token, issueNumber, 'open')
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bitetime/backend test -- github.test.ts`
Expected: PASS, all cases.

- [x] **Step 5: Typecheck**

Run: `pnpm --filter @bitetime/backend typecheck`
Expected: no errors.

- [x] **Step 6: Commit**

```bash
git add apps/backend/src/github.ts apps/backend/tests/unit/github.test.ts
git commit -m "feat(backend): add github.ts issue-filing adapter"
```

---

### Task 3: `env.ts` / `.env.example` — `GITHUB_TOKEN`

**Files:**
- Modify: `apps/backend/src/env.ts`
- Modify: `apps/backend/.env.example`

**Interfaces:**
- Produces: `env.githubToken: string` (empty string when unset). Task 4 reads this and passes it into the `github.ts` adapters.

- [x] **Step 1: Add the optional var to `env.ts`**

In `apps/backend/src/env.ts`, after the `googleMapsApiKey` block (currently ends at line 36):

```ts
  // GitHub (auto-files merchant feedback as issues on leongcheefai/Bitetime-Order-Platform,
  // see github.ts). Optional, same posture as googleMapsApiKey: unset means issue creation
  // is skipped and logged, never a startup error — the feedback table is the source of
  // truth regardless of whether GitHub has heard about a row.
  githubToken: process.env.GITHUB_TOKEN || '',
```

- [x] **Step 2: Add it to `.env.example`**

In `apps/backend/.env.example`, after the `GOOGLE_MAPS_API_KEY=` line:

```
# GitHub (auto-files merchant feedback as issues on leongcheefai/Bitetime-Order-Platform).
# Fine-grained PAT, issues:write on that one repo. Optional: unset = issue creation is
# skipped, feedback still saves normally.
GITHUB_TOKEN=
```

- [x] **Step 3: Typecheck**

Run: `pnpm --filter @bitetime/backend typecheck`
Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add apps/backend/src/env.ts apps/backend/.env.example
git commit -m "feat(backend): add optional GITHUB_TOKEN env var"
```

---

### Task 4: `feedback.ts` — row shape and link-back write

**Files:**
- Modify: `apps/backend/src/feedback.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (consumed by Task 5): `FeedbackRow.github_issue_number: number | null`, `FeedbackRow.github_issue_url: string | null`; `updateFeedbackGithubIssue(id: string, issue: { number: number; html_url: string }): Promise<void>`.

- [x] **Step 1: Extend `FeedbackRow`**

In `apps/backend/src/feedback.ts`, change the interface at lines 10-19:

```ts
export interface FeedbackRow {
  id: string
  merchant_id: string
  user_id: string
  category: FeedbackCategory
  message: string
  status: FeedbackStatus
  created_at: string
  resolved_at: string | null
  github_issue_number: number | null
  github_issue_url: string | null
}
```

(`FeedbackWithShop extends FeedbackRow`, so it picks these up automatically — no change needed there.)

- [x] **Step 2: Add `updateFeedbackGithubIssue`**

At the end of `apps/backend/src/feedback.ts`, after `updateFeedbackStatus`:

```ts
// Best-effort link-back after a successful createGithubIssue call (github.ts). Failure
// here is logged, never thrown: GitHub already has the issue at this point, so losing the
// link means the admin dashboard doesn't show it, not that the issue is missing.
export async function updateFeedbackGithubIssue(
  id: string,
  issue: { number: number; html_url: string },
): Promise<void> {
  const { error } = await admin
    .from('merchant_feedback')
    .update({ github_issue_number: issue.number, github_issue_url: issue.html_url })
    .eq('id', id)
  if (error) console.error(`feedback ${id}: failed to link GitHub issue #${issue.number}:`, error.message)
}
```

- [x] **Step 3: Typecheck**

Run: `pnpm --filter @bitetime/backend typecheck`
Expected: no errors. (`insertFeedback`'s `data as FeedbackRow` cast still holds — the DB row already carries the two new nullable columns via `select('*')`.)

- [x] **Step 4: Commit**

```bash
git add apps/backend/src/feedback.ts
git commit -m "feat(backend): add github issue fields and link-back write to feedback.ts"
```

---

### Task 5: Wire the routes in `app.ts`

**Files:**
- Modify: `apps/backend/src/app.ts`
- Modify: `apps/backend/tests/api/feedback.test.ts`

**Interfaces:**
- Consumes: everything produced in Tasks 2-4 (`github.ts` exports, `env.githubToken`, `feedback.ts`'s new field and `updateFeedbackGithubIssue`).
- Produces: `githubDeps: { createIssue: CreateGithubIssue; closeIssue: GithubIssueAction; reopenIssue: GithubIssueAction }`, exported from `app.ts` — the DI seam Task tests use, mirroring the existing `notifyDeps`.

- [x] **Step 1: Import the new pieces**

In `apps/backend/src/app.ts`, change line 46 from:

```ts
import { insertFeedback, listFeedback, updateFeedbackStatus } from './feedback.js'
```

to:

```ts
import { insertFeedback, listFeedback, updateFeedbackStatus, updateFeedbackGithubIssue } from './feedback.js'
```

Add a new import near it (same block, after the `feedback.js` import):

```ts
import {
  createGithubIssue, closeGithubIssue, reopenGithubIssue,
  buildIssueTitle, buildIssueBody, categoryToLabel,
  type CreateGithubIssue, type GithubIssueAction,
} from './github.js'
```

- [x] **Step 2: Add `githubDeps`**

In `apps/backend/src/app.ts`, immediately before the `// ── Merchant platform feedback (#89) ──` comment (currently line 1304), insert:

```ts
// The GitHub adapter, held mutable so tests can capture what would be sent without a live
// network — same pattern as notifyDeps below. Production uses the real fetch adapters.
export const githubDeps: {
  createIssue: CreateGithubIssue
  closeIssue: GithubIssueAction
  reopenIssue: GithubIssueAction
} = {
  createIssue: createGithubIssue,
  closeIssue: closeGithubIssue,
  reopenIssue: reopenGithubIssue,
}

```

- [x] **Step 3: Wire the submit route**

In `apps/backend/src/app.ts`, replace the body of `app.post('/api/merchants/:id/feedback', ...)` (currently lines 1318-1333):

```ts
app.post('/api/merchants/:id/feedback', requireMerchantOwns, async (c) => {
  const user = c.get('user')
  const merchant = c.get('merchant')

  if (!feedbackWindow.allow(user.id)) {
    return c.json({ error: 'Too many feedback submissions. Please try again later.' }, 429)
  }

  const parsed = validateFeedback(await c.req.json().catch(() => ({})))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  // merchant.id comes from the route the middleware already verified; user.id from the
  // JWT. Neither is ever read from the body — see tests/api/feedback.test.ts.
  const row = await insertFeedback({ merchantId: merchant.id, userId: user.id, draft: parsed.value })

  // Best-effort (github.ts). Never changes what the merchant gets back — the row below is
  // the same whether or not this succeeds.
  const issue = await githubDeps.createIssue(env.githubToken, {
    title: buildIssueTitle(parsed.value.category, merchant.name),
    body: buildIssueBody({
      message: parsed.value.message,
      shopName: merchant.name,
      shopSlug: merchant.slug,
      feedbackId: row.id,
      createdAt: row.created_at,
    }),
    labels: ['needs-triage', categoryToLabel(parsed.value.category)],
  })
  if (issue) await updateFeedbackGithubIssue(row.id, issue)

  return c.json(row, 201)
})
```

- [x] **Step 4: Wire the resolve/reopen route**

In `apps/backend/src/app.ts`, replace the body of `app.patch('/api/admin/feedback/:feedbackId', ...)` (currently lines 1343-1350):

```ts
app.patch('/api/admin/feedback/:feedbackId', requireSuperadmin, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { status?: unknown }
  if (!isFeedbackStatus(body.status)) return c.json({ error: 'Unknown feedback status' }, 400)

  const row = await updateFeedbackStatus(c.req.param('feedbackId'), body.status)
  if (!row) return c.json({ error: 'Feedback not found' }, 404)

  // Best-effort keep-in-sync (github.ts). The dashboard's status is authoritative either way.
  if (row.github_issue_number) {
    const action = body.status === 'resolved' ? githubDeps.closeIssue : githubDeps.reopenIssue
    await action(env.githubToken, row.github_issue_number)
  }

  return c.json(row)
})
```

- [x] **Step 5: Typecheck**

Run: `pnpm --filter @bitetime/backend typecheck`
Expected: no errors.

- [x] **Step 6: Write the new API tests**

In `apps/backend/tests/api/feedback.test.ts`, add the `githubDeps` import to the existing import line:

```ts
import { app, feedbackWindow, githubDeps } from '../../src/app.js'
```

Then, following the existing `notifyDeps`-swap pattern from `tests/api/notifyOrder.test.ts` (save originals, restore in `afterAll`, reset in `beforeEach`), add near the top of the `describe('merchant feedback', ...)` block, alongside the other `let` declarations:

```ts
  const origCreateIssue = githubDeps.createIssue
  const origCloseIssue = githubDeps.closeIssue
  const origReopenIssue = githubDeps.reopenIssue
```

Add an `afterAll` restoring them (create one if the suite doesn't already have one, otherwise add to it):

```ts
  afterAll(() => {
    githubDeps.createIssue = origCreateIssue
    githubDeps.closeIssue = origCloseIssue
    githubDeps.reopenIssue = origReopenIssue
  })
```

(Import `afterAll` from `vitest` if not already imported — check the existing `import { describe, it, expect, beforeAll } from 'vitest'` line and add it there.)

Then add two new `it` blocks at the end of the `describe('merchant feedback', ...)` block, before its closing `})`:

```ts
  it('links a created GitHub issue back onto the feedback row', async () => {
    githubDeps.createIssue = async (_token, input) => {
      expect(input.labels).toEqual(['needs-triage', 'bug'])
      expect(input.title).toBe(`[Feedback] bug: feedback-own-shop`)
      return { number: 999, html_url: 'https://github.com/leongcheefai/Bitetime-Order-Platform/issues/999' }
    }

    const created = await post(`/api/merchants/${ownShopId}/feedback`,
      { category: 'bug', message: 'github link-back check' }, ownerToken)
    const { id } = (await created.json()) as FeedbackRow

    const list = await get('/api/admin/feedback', superToken)
    const rows = (await list.json()) as Array<FeedbackRow & { github_issue_number: number | null; github_issue_url: string | null }>
    const row = rows.find(r => r.id === id)
    expect(row?.github_issue_number).toBe(999)
    expect(row?.github_issue_url).toBe('https://github.com/leongcheefai/Bitetime-Order-Platform/issues/999')
  })

  it('closes and reopens the linked GitHub issue when admin resolves/reopens', async () => {
    githubDeps.createIssue = async () => ({
      number: 1001, html_url: 'https://github.com/leongcheefai/Bitetime-Order-Platform/issues/1001',
    })
    const calls: Array<{ action: 'close' | 'reopen'; issueNumber: number }> = []
    githubDeps.closeIssue = async (_token, issueNumber) => { calls.push({ action: 'close', issueNumber }) }
    githubDeps.reopenIssue = async (_token, issueNumber) => { calls.push({ action: 'reopen', issueNumber }) }

    const created = await post(`/api/merchants/${ownShopId}/feedback`,
      { category: 'other', message: 'resolve/reopen sync check' }, ownerToken)
    const { id } = (await created.json()) as FeedbackRow

    await patch(`/api/admin/feedback/${id}`, { status: 'resolved' }, superToken)
    await patch(`/api/admin/feedback/${id}`, { status: 'open' }, superToken)

    expect(calls).toEqual([
      { action: 'close', issueNumber: 1001 },
      { action: 'reopen', issueNumber: 1001 },
    ])
  })
```

The title assertion `[Feedback] bug: feedback-own-shop` relies on `seedMerchant`'s default (`tests/rls/helpers.ts:124`: `name: fields.name ?? fields.slug`) — `ownShopId` was seeded earlier in this suite with `seedMerchant({ slug: 'feedback-own-shop', owner_id: ownerId })`, no `name` passed, so its `name` column is `'feedback-own-shop'`.

- [x] **Step 7: Run the DB-backed tests**

Requires local Supabase running (`supabase start` from `apps/backend`, if not already up).

Run: `pnpm --filter @bitetime/backend test:db -- feedback.test.ts`
Expected: PASS, including the two new tests and every existing one (existing tests run with `githubDeps` at its real, token-less default — `env.githubToken` is `''` in the test env, so `createGithubIssue` returns `null` immediately and every existing assertion is unaffected).

- [x] **Step 8: Commit**

```bash
git add apps/backend/src/app.ts apps/backend/tests/api/feedback.test.ts
git commit -m "feat(backend): file and sync GitHub issues from the feedback routes"
```

---

### Task 6: Frontend — show the issue link

**Files:**
- Modify: `apps/frontend/src/types.ts`
- Modify: `apps/frontend/src/admin/AdminFeedback.tsx`

**Interfaces:**
- Consumes: `FeedbackItem` (extended).

- [x] **Step 1: Extend `FeedbackItem`**

In `apps/frontend/src/types.ts`, change the interface at lines 262-273:

```ts
export interface FeedbackItem {
  id: string
  merchant_id: string
  user_id: string
  category: FeedbackCategory
  message: string
  status: FeedbackStatus
  created_at: string
  resolved_at: string | null
  shop_name: string | null
  shop_slug: string | null
  github_issue_number: number | null
  github_issue_url: string | null
}
```

- [x] **Step 2: Render the link**

In `apps/frontend/src/admin/AdminFeedback.tsx`, in the `Card` block (currently lines 94-118), add the link after the existing badges row and before the message paragraph:

```tsx
          {item.github_issue_url && (
            <a
              href={item.github_issue_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-oxblood underline w-fit"
            >
              {t('View issue', '查看 Issue')} #{item.github_issue_number} ↗
            </a>
          )}

```

(Placed as its own line between the badges `<div>` (closing at what is currently line 109) and the `<p>` message paragraph (currently line 111).)

- [x] **Step 3: Typecheck**

Run: `pnpm --filter @bitetime/frontend typecheck`
Expected: no errors.

- [x] **Step 4: Lint**

Run: `pnpm --filter @bitetime/frontend lint`
Expected: no errors.

- [x] **Step 5: Commit**

```bash
git add apps/frontend/src/types.ts apps/frontend/src/admin/AdminFeedback.tsx
git commit -m "feat(frontend): show linked GitHub issue in the admin feedback inbox"
```

---

### Task 7: Full-suite check and run-and-verify

**Files:** none (verification only).

- [x] **Step 1: Full backend unit + DB suites**

Run: `pnpm --filter @bitetime/backend test`
Expected: PASS (includes `github.test.ts`).

Run: `pnpm --filter @bitetime/backend test:db` (local Supabase must be running)
Expected: PASS (includes the two new `feedback.test.ts` cases and all pre-existing ones).

- [x] **Step 2: Repo-wide lint, typecheck, build**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: all pass. `pnpm build` in particular proves the backend esbuild bundle still succeeds with no new `--external:` flag needed (`github.ts` has no runtime dependency beyond global `fetch`).

- [x] **Step 3: Run-and-verify the fail-open path (no `GITHUB_TOKEN` set locally)**

With local Supabase running, start the app (`pnpm dev` from repo root; no `stripe listen` needed — nothing here touches billing). In the browser:
1. Sign in as a merchant, open the dashboard, submit feedback via the FAB.
2. Confirm it submits successfully (no error toast) — this proves the fail-open path: with no local `GITHUB_TOKEN`, `createGithubIssue` logs `GitHub issue skipped: no token configured` in the backend terminal and returns `null`, and the feedback row still saves.
3. Sign in as superadmin, open Admin → Feedback, confirm the row appears with no issue link (none was created) and that Resolve/Reopen still works.

- [ ] **Step 4: Flag live-issue verification to the user — do not do this step autonomously**

Actually creating a real GitHub issue requires a real `GITHUB_TOKEN` and will file a visible, public issue on `leongcheefai/Bitetime-Order-Platform`. That is an action visible to others on a shared system — per this project's operating rules, it needs the human's explicit go-ahead, not an agent's unilateral decision. When this task is reached, stop and ask the user: do they want to supply a test `GITHUB_TOKEN` (or point at a scratch repo) to verify the live create/close/reopen path end-to-end before considering the feature done, or is the mocked `tests/api` coverage from Task 5 sufficient? Do not set `GITHUB_TOKEN` or submit feedback against a live token without that answer.

---

## Out of scope (carried over from the spec)

- Two-way sync from GitHub back into the app.
- Rate-limiting/deduping beyond the existing 20/hour-per-user feedback limit.
- Any repo other than `leongcheefai/Bitetime-Order-Platform`.
- Editing an issue's body if the feedback message is later changed (no edit path exists).
