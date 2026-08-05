# GitHub Release Notes for Merchants (#163) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Superadmin pulls GitHub releases into the app; Claude rewrites each into merchant-facing copy; superadmin publishes reviewed drafts; all merchants see published releases via a "what's new" bell in the dashboard sidebar, each opening a dedicated `/releases/:tag` page.

**Architecture:** New `releases` table (RLS-locked, backend-only). `apps/backend/src/github.ts` gains a `listGithubReleases` adapter; a new `apps/backend/src/releases.ts` holds the Claude humanization call and all DB CRUD. Six new Hono routes (4 superadmin-gated, 2 public). Frontend: a `ReleasesBell` popover in `DashboardShell`, a public `ReleaseNotes` page, and an `AdminReleases` section inside the existing admin dashboard.

**Tech Stack:** Hono (backend), `@anthropic-ai/sdk` (new dependency), Supabase/Postgres, React + React Router v7, Base UI (`Popover`), Vitest.

**Design spec:** `docs/superpowers/specs/2026-08-05-github-release-notes-design.md` — read it once before starting; this plan implements it task by task.

## Global Constraints

- Every GitHub- or Claude-calling function takes its credential as a **parameter**, never reads `env.ts` directly — this is what lets `tests/unit` import these modules with zero env vars set (see `github.ts`'s own header comment).
- Every such function is **best-effort**: swallow errors, `console.error`, return `null`/resolve `void`. Never throw. A GitHub or Claude outage must never break the pull action for the releases that did succeed.
- DB access for `releases` goes through the service-role `admin` client (`apps/backend/src/supabase.ts`), exactly like `feedback.ts` — single statements, no transaction.
- `releases` has RLS enabled with **zero policies** — this alone denies `anon` and `authenticated` regardless of any grant. Never add a policy to this table.
- Never run `supabase db push` or any command that reaches production. `db:migrate` (local) is as far as this plan goes.
- Follow the `t(en, zh)` bilingual convention for every new user-facing string in the frontend.
- UI is verified by running the app, per `CLAUDE.md` — no component tests for the new React pieces; the final task is a manual run-and-verify pass.

---

### Task 1: `releases` table migration

**Files:**
- Create: `apps/backend/supabase/migrations/20260805130000_releases_table.sql`

**Interfaces:**
- Produces: `public.releases` table with columns `id, tag, name, html_url, raw_body, published_at, title, summary, humanize_error, status, created_at, updated_at`. Every later backend task reads/writes this table by these exact column names.

- [ ] **Step 1: Write the migration**

```sql
-- GitHub releases pulled and rewritten into merchant-facing copy for the dashboard's "what's
-- new" bell (#163). See docs/superpowers/specs/2026-08-05-github-release-notes-design.md.
--
-- Reached only through apps/backend/src/app.ts routes (the service-role `admin` client) —
-- never a browser role, hence no policy grants below (same posture as merchant_secrets,
-- 20260718130000_revoke_all_browser_grants.sql). RLS enabled with zero policies denies
-- anon/authenticated regardless of any table-level grant.
create table public.releases (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique,
  name text not null,
  html_url text not null,
  raw_body text not null,
  published_at timestamptz not null,
  title text,
  summary text,
  humanize_error text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index releases_status_published_at_idx
  on public.releases (status, published_at desc);

alter table public.releases enable row level security;
-- No policies: RLS enabled + zero policies denies every role but service_role (which bypasses
-- RLS entirely). tests/rls/releases-grant.test.ts is the proof anon/authenticated get neither.
```

- [ ] **Step 2: Apply it to the local Supabase stack**

Run from `apps/backend/`:
```bash
supabase start
npm run db:migrate
```
Expected: the migration applies with no error; `supabase status` still reports the stack running.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/supabase/migrations/20260805130000_releases_table.sql
git commit -m "feat(backend): add releases table for GitHub release notes (#163)"
```

---

### Task 2: `ANTHROPIC_API_KEY` config

**Files:**
- Modify: `apps/backend/src/env.ts`
- Modify: `apps/backend/.env.example`

**Interfaces:**
- Produces: `env.anthropicApiKey: string` — read by Task 5's `humanizeRelease`.

- [ ] **Step 1: Add the env var to `env.ts`**

In `apps/backend/src/env.ts`, immediately after the `githubToken` line, add:

```ts
  // Anthropic (Claude API — rewrites raw GitHub release bodies into merchant-facing copy for
  // the "what's new" bell, see releases.ts). Optional, same posture as githubToken: unset
  // means humanizeRelease logs and returns null, and the pulled release is stored with
  // humanize_error set rather than a title/summary — the pull itself never fails.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
```

- [ ] **Step 2: Add the env var to `.env.example`**

In `apps/backend/.env.example`, immediately after the `GITHUB_TOKEN=` line, add:

```
# Anthropic (rewrites raw GitHub release notes into merchant-facing copy, see releases.ts).
# Optional: unset = humanization is skipped and logged, the pulled release still saves with
# humanize_error set.
ANTHROPIC_API_KEY=
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bitetime/backend typecheck`
Expected: passes (no new type errors — `env.ts`'s object literal just gained a field).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/env.ts apps/backend/.env.example
git commit -m "feat(backend): add ANTHROPIC_API_KEY env var"
```

---

### Task 3: `listGithubReleases` adapter

**Files:**
- Modify: `apps/backend/src/github.ts`
- Test: `apps/backend/tests/unit/github.test.ts`

**Interfaces:**
- Consumes: `GITHUB_API`, `GITHUB_REPO`, `headers(token)` — all already defined in `github.ts`.
- Produces: `GithubRelease` interface (`tag_name, name, body, html_url, published_at`), `ListGithubReleases` function type, `listGithubReleases: ListGithubReleases` — consumed by `releaseDeps` in Task 6.

- [ ] **Step 1: Write the failing tests**

Append to `apps/backend/tests/unit/github.test.ts` (add `listGithubReleases` and `GITHUB_REPO` to the existing import from `'../../src/github.js'` at the top of the file):

```ts
describe('listGithubReleases', () => {
  it('returns null and makes no request when the token is empty', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await listGithubReleases('', 10)
    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches releases from the right repo and per_page, mapping the fields', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`)
      return new Response(
        JSON.stringify([
          {
            tag_name: '0.1.5', name: '0.1.5', body: 'raw body',
            html_url: 'https://github.com/x/y/releases/tag/0.1.5',
            published_at: '2026-08-05T05:02:51Z',
          },
        ]),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchSpy)
    const result = await listGithubReleases('ghp_test', 10)
    expect(result).toEqual([
      {
        tag_name: '0.1.5', name: '0.1.5', body: 'raw body',
        html_url: 'https://github.com/x/y/releases/tag/0.1.5',
        published_at: '2026-08-05T05:02:51Z',
      },
    ])
  })

  it('defaults a null body to an empty string', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify([{
        tag_name: '0.1.4', name: '0.1.4', body: null,
        html_url: 'https://github.com/x/y/releases/tag/0.1.4',
        published_at: '2026-08-04T00:00:00Z',
      }]),
      { status: 200 },
    )))
    const result = await listGithubReleases('ghp_test', 10)
    expect(result?.[0]?.body).toBe('')
  })

  it('returns null and does not throw on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    const result = await listGithubReleases('ghp_test', 10)
    expect(result).toBeNull()
  })

  it('returns null and does not throw on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await listGithubReleases('ghp_test', 10)
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bitetime/backend test -- github.test.ts`
Expected: FAIL — `listGithubReleases` is not exported from `../../src/github.js`.

- [ ] **Step 3: Implement `listGithubReleases`**

Append to `apps/backend/src/github.ts` (after `reopenGithubIssue`):

```ts
export interface GithubRelease {
  tag_name: string
  name: string
  body: string
  html_url: string
  published_at: string
}

export type ListGithubReleases = (token: string, perPage: number) => Promise<GithubRelease[] | null>

export const listGithubReleases: ListGithubReleases = async (token, perPage) => {
  if (!token) {
    console.error('GitHub release listing skipped: no token configured')
    return null
  }
  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/releases?per_page=${perPage}`, {
      headers: headers(token),
    })
    if (!res.ok) {
      console.error(`GitHub release listing failed: ${res.status} ${await res.text()}`)
      return null
    }
    const data = (await res.json()) as GithubRelease[]
    return data.map((r) => ({
      tag_name: r.tag_name,
      name: r.name,
      body: r.body ?? '',
      html_url: r.html_url,
      published_at: r.published_at,
    }))
  } catch (e) {
    console.error('GitHub release listing failed:', e instanceof Error ? e.message : String(e))
    return null
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bitetime/backend test -- github.test.ts`
Expected: PASS, all cases including the new `listGithubReleases` describe block.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/github.ts apps/backend/tests/unit/github.test.ts
git commit -m "feat(backend): add listGithubReleases adapter"
```

---

### Task 4: Add `@anthropic-ai/sdk` dependency

**Files:**
- Modify: `apps/backend/package.json`

**Interfaces:**
- Produces: `@anthropic-ai/sdk` importable from `apps/backend/src/releases.ts` (Task 5).

- [ ] **Step 1: Add the dependency**

In `apps/backend/package.json`, add `"@anthropic-ai/sdk": "^0.115.0"` (current published version, verified via `npm view @anthropic-ai/sdk version`) as the first entry in `"dependencies"` (alphabetically before `@bitetime/shared`).

- [ ] **Step 2: Add its `--external:` flag to the esbuild bundle command**

In the same file's `"build"` script, add `--external:@anthropic-ai/sdk` to the list of `--external:` flags (any position among the existing ones — e.g. right after `--external:@supabase/supabase-js`), following CLAUDE.md's rule that every backend runtime dependency needs one or esbuild bundles it.

- [ ] **Step 3: Install**

Run: `pnpm install` (from the repo root)
Expected: `@anthropic-ai/sdk` appears in `apps/backend/node_modules` and the root lockfile updates.

- [ ] **Step 4: Verify the build still bundles cleanly**

Run: `pnpm --filter @bitetime/backend build`
Expected: succeeds, `apps/backend/dist/server.js` is produced (this doesn't yet import the SDK — Task 5 does — this step just proves the external flag didn't break the command).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/package.json pnpm-lock.yaml
git commit -m "chore(backend): add @anthropic-ai/sdk dependency"
```

---

### Task 5: `releases.ts` — humanization + DB CRUD

**Files:**
- Create: `apps/backend/src/releases.ts`
- Test: `apps/backend/tests/unit/releases.test.ts`

**Interfaces:**
- Consumes: `admin` from `./supabase.js` (already exists); `Anthropic` from `@anthropic-ai/sdk` (Task 4).
- Produces: `ReleaseRow`, `HumanizedRelease`, `HumanizeRelease` type, `humanizeRelease`, `listReleaseTags`, `insertDraftRelease`, `listAllReleases`, `getReleaseById`, `updateReleaseStatus`, `updateReleaseHumanization`, `PublicReleaseRow`, `listPublishedReleases`, `PublicReleaseDetailRow`, `getPublishedReleaseByTag` — all consumed by `app.ts` routes in Task 6.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/tests/unit/releases.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { humanizeRelease } from '../../src/releases.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('humanizeRelease', () => {
  it('returns null and makes no request when the API key is empty', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await humanizeRelease('', { tag: '0.1.5', name: '0.1.5', body: 'raw body' })
    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns the parsed title and summary on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        stop_reason: 'end_turn',
        content: [{
          type: 'text',
          text: JSON.stringify({ title: 'Faster checkout', summary: 'Orders now confirm instantly.' }),
        }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const result = await humanizeRelease('sk-ant-test', { tag: '0.1.5', name: '0.1.5', body: 'raw body' })
    expect(result).toEqual({ title: 'Faster checkout', summary: 'Orders now confirm instantly.' })
  })

  it('returns null when the response is a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5',
        stop_reason: 'refusal', content: [], usage: { input_tokens: 10, output_tokens: 0 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const result = await humanizeRelease('sk-ant-test', { tag: '0.1.5', name: '0.1.5', body: 'raw body' })
    expect(result).toBeNull()
  })

  it('returns null and does not throw on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await humanizeRelease('sk-ant-test', { tag: '0.1.5', name: '0.1.5', body: 'raw body' })
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bitetime/backend test -- releases.test.ts`
Expected: FAIL — `apps/backend/src/releases.ts` does not exist yet.

- [ ] **Step 3: Implement `releases.ts`**

Create `apps/backend/src/releases.ts`:

```ts
// GitHub releases pulled and rewritten into merchant-facing copy for the dashboard's "what's
// new" bell (#163). See docs/superpowers/specs/2026-08-05-github-release-notes-design.md.
//
// humanizeRelease is an ADAPTER shaped like github.ts's createGithubIssue: the API key is a
// PARAMETER, never read from env.ts, so this file can be imported by a unit test with zero env
// vars set. Best-effort: it swallows its own errors and returns null rather than throwing — a
// Claude outage must never break the pull action, only leave a release without a summary.
//
// The DB functions below use the service-role `admin` client (same posture as feedback.ts):
// every statement here is a single read or write, so no transaction is needed.
import Anthropic from '@anthropic-ai/sdk'
import { admin } from './supabase.js'

export interface ReleaseRow {
  id: string
  tag: string
  name: string
  html_url: string
  raw_body: string
  published_at: string
  title: string | null
  summary: string | null
  humanize_error: string | null
  status: 'draft' | 'published'
  created_at: string
  updated_at: string
}

export interface HumanizedRelease {
  title: string
  summary: string
}

export type HumanizeRelease = (
  apiKey: string,
  input: { tag: string; name: string; body: string },
) => Promise<HumanizedRelease | null>

function buildPrompt(input: { tag: string; name: string; body: string }): string {
  return `You are writing a "what's new" note for a food-ordering platform's merchants — small business owners, not developers. Rewrite this GitHub release into copy they can read in ten seconds.

Release: ${input.name} (${input.tag})

Raw release notes (from GitHub, written for developers — pull request titles, links, technical jargon):
${input.body}

Write:
- "title": a short, plain-language headline (under 60 characters), no version numbers or PR references.
- "summary": 2-4 short sentences or bullet points describing what changed FOR THE MERCHANT — what they can now do or what improved. Skip anything purely internal (refactors, dependency bumps, test changes) unless it fixed a bug merchants would have noticed. If nothing in this release is merchant-visible, say so plainly in one sentence.

Write in plain English. No markdown formatting, no links, no PR/issue numbers.`
}

const RELEASE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['title', 'summary'],
  additionalProperties: false,
} as const

export const humanizeRelease: HumanizeRelease = async (apiKey, input) => {
  if (!apiKey) {
    console.error(`Release humanization skipped for ${input.tag}: no Anthropic API key configured`)
    return null
  }
  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1024,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: RELEASE_SCHEMA },
      },
      messages: [{ role: 'user', content: buildPrompt(input) }],
    })

    if (response.stop_reason === 'refusal') {
      console.error(`Release humanization refused for ${input.tag}`)
      return null
    }

    const block = response.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') {
      console.error(`Release humanization for ${input.tag} returned no text content`)
      return null
    }

    const parsed = JSON.parse(block.text) as HumanizedRelease
    if (!parsed.title || !parsed.summary) {
      console.error(`Release humanization for ${input.tag} returned an incomplete result`)
      return null
    }
    return parsed
  } catch (e) {
    console.error(`Release humanization failed for ${input.tag}:`, e instanceof Error ? e.message : String(e))
    return null
  }
}

export async function listReleaseTags(): Promise<string[]> {
  const { data, error } = await admin.from('releases').select('tag')
  if (error) throw new Error(error.message)
  return (data ?? []).map((row: { tag: string }) => row.tag)
}

export async function insertDraftRelease(input: {
  tag: string
  name: string
  htmlUrl: string
  rawBody: string
  publishedAt: string
}): Promise<ReleaseRow> {
  const { data, error } = await admin
    .from('releases')
    .insert({
      tag: input.tag,
      name: input.name,
      html_url: input.htmlUrl,
      raw_body: input.rawBody,
      published_at: input.publishedAt,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as ReleaseRow
}

export async function listAllReleases(): Promise<ReleaseRow[]> {
  const { data, error } = await admin
    .from('releases')
    .select('*')
    .order('published_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as ReleaseRow[]
}

export async function getReleaseById(id: string): Promise<ReleaseRow | null> {
  const { data, error } = await admin.from('releases').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as ReleaseRow | null
}

export async function updateReleaseStatus(
  id: string,
  status: 'draft' | 'published',
): Promise<ReleaseRow | null> {
  const { data, error } = await admin
    .from('releases')
    .update({ status })
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as ReleaseRow | null
}

// Best-effort, like feedback.ts's updateFeedbackGithubIssue: the pull/regenerate action has
// already happened by the time this is called, so a write failure here is logged, never thrown.
export async function updateReleaseHumanization(
  id: string,
  outcome: HumanizedRelease | { error: string },
): Promise<void> {
  const patch = 'title' in outcome
    ? { title: outcome.title, summary: outcome.summary, humanize_error: null }
    : { humanize_error: outcome.error }
  const { error } = await admin.from('releases').update(patch).eq('id', id)
  if (error) console.error(`release ${id}: failed to save humanization result:`, error.message)
}

export interface PublicReleaseRow {
  tag: string
  title: string
  published_at: string
}

export async function listPublishedReleases(limit: number): Promise<PublicReleaseRow[]> {
  const { data, error } = await admin
    .from('releases')
    .select('tag, title, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as PublicReleaseRow[]
}

export interface PublicReleaseDetailRow extends PublicReleaseRow {
  summary: string
}

export async function getPublishedReleaseByTag(tag: string): Promise<PublicReleaseDetailRow | null> {
  const { data, error } = await admin
    .from('releases')
    .select('tag, title, summary, published_at')
    .eq('status', 'published')
    .eq('tag', tag)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as PublicReleaseDetailRow | null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bitetime/backend test -- releases.test.ts`
Expected: PASS. If the SDK's response parsing rejects the hand-built fixture JSON, adjust the fixture to match the exact fields the installed `@anthropic-ai/sdk` version requires — check the error message from the failing assertion.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bitetime/backend typecheck`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/releases.ts apps/backend/tests/unit/releases.test.ts
git commit -m "feat(backend): add releases.ts (Claude humanization + DB CRUD)"
```

---

### Task 6: Wire routes into `app.ts`

**Files:**
- Modify: `apps/backend/src/app.ts`

**Interfaces:**
- Consumes: everything produced in Task 3 and Task 5.
- Produces: `releaseDeps` (exported, mutable, same shape as `githubDeps`) — consumed by Task 7's API tests. Six routes: `POST /api/admin/releases/pull`, `GET /api/admin/releases`, `PATCH /api/admin/releases/:id`, `POST /api/admin/releases/:id/regenerate`, `GET /api/releases`, `GET /api/releases/:tag`.

- [ ] **Step 1: Extend the `github.js` import**

Find the existing import block:
```ts
import {
  createGithubIssue, closeGithubIssue, reopenGithubIssue,
  buildIssueTitle, buildIssueBody, categoryToLabel,
  type CreateGithubIssue, type GithubIssueAction,
} from './github.js'
```
Replace it with:
```ts
import {
  createGithubIssue, closeGithubIssue, reopenGithubIssue, listGithubReleases,
  buildIssueTitle, buildIssueBody, categoryToLabel,
  type CreateGithubIssue, type GithubIssueAction, type ListGithubReleases,
} from './github.js'
```

- [ ] **Step 2: Add the `releases.js` import**

Add this import near the `feedback.js` import:
```ts
import {
  humanizeRelease, type HumanizeRelease,
  listReleaseTags, insertDraftRelease, listAllReleases, getReleaseById,
  updateReleaseStatus, updateReleaseHumanization,
  listPublishedReleases, getPublishedReleaseByTag,
} from './releases.js'
```

- [ ] **Step 3: Add `releaseDeps` and the six routes**

Find the `PATCH /api/admin/feedback/:feedbackId` route (ends with `return c.json(row)\n})`). Immediately after its closing `})`, insert:

```ts

// Same pattern as githubDeps: held mutable so tests can capture what would be sent to GitHub
// and Claude without a live network call. Production uses the real fetch/SDK adapters.
export const releaseDeps: {
  listReleases: ListGithubReleases
  humanize: HumanizeRelease
} = {
  listReleases: listGithubReleases,
  humanize: humanizeRelease,
}

// ── Release notes (#163) ────────────────────────────────────────────────────
// Superadmin-triggered pull, not a live fetch or a cron sweep — pulling humanizes via Claude and
// stores drafts; a release only reaches merchants once explicitly published. See the spec.

app.post('/api/admin/releases/pull', requireSuperadmin, async (c) => {
  const fetched = await releaseDeps.listReleases(env.githubToken, 10)
  if (fetched === null) return c.json({ error: 'Could not reach GitHub' }, 502)

  const existingTags = new Set(await listReleaseTags())
  const toPull = fetched.filter((r) => !existingTags.has(r.tag_name))

  let pulled = 0
  for (const release of toPull) {
    const row = await insertDraftRelease({
      tag: release.tag_name,
      name: release.name,
      htmlUrl: release.html_url,
      rawBody: release.body,
      publishedAt: release.published_at,
    })
    const humanized = await releaseDeps.humanize(env.anthropicApiKey, {
      tag: row.tag,
      name: row.name,
      body: row.raw_body,
    })
    if (humanized) await updateReleaseHumanization(row.id, humanized)
    else await updateReleaseHumanization(row.id, { error: 'Claude could not summarize this release' })
    pulled++
  }

  return c.json({ pulled })
})

app.get('/api/admin/releases', requireSuperadmin, async (c) => {
  return c.json(await listAllReleases())
})

app.patch('/api/admin/releases/:id', requireSuperadmin, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { status?: unknown }
  if (body.status !== 'draft' && body.status !== 'published') {
    return c.json({ error: 'Unknown release status' }, 400)
  }
  const row = await updateReleaseStatus(c.req.param('id'), body.status)
  if (!row) return c.json({ error: 'Release not found' }, 404)
  return c.json(row)
})

app.post('/api/admin/releases/:id/regenerate', requireSuperadmin, async (c) => {
  const row = await getReleaseById(c.req.param('id'))
  if (!row) return c.json({ error: 'Release not found' }, 404)

  const humanized = await releaseDeps.humanize(env.anthropicApiKey, {
    tag: row.tag, name: row.name, body: row.raw_body,
  })
  if (humanized) await updateReleaseHumanization(row.id, humanized)
  else await updateReleaseHumanization(row.id, { error: 'Claude could not summarize this release' })

  return c.json(await getReleaseById(row.id))
})

app.get('/api/releases', async (c) => {
  return c.json(await listPublishedReleases(10))
})

app.get('/api/releases/:tag', async (c) => {
  const row = await getPublishedReleaseByTag(c.req.param('tag'))
  if (!row) return c.json({ error: 'Release not found' }, 404)
  return c.json(row)
})
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @bitetime/backend typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app.ts
git commit -m "feat(backend): wire release notes routes"
```

---

### Task 7: Stub `ANTHROPIC_API_KEY` in the DB test config

**Files:**
- Modify: `apps/backend/vitest.db.config.ts`

**Interfaces:**
- None — this only affects the test environment's `process.env`.

- [ ] **Step 1: Add the stub**

Open `apps/backend/vitest.db.config.ts` and find the line that force-stubs `process.env.GITHUB_TOKEN = ''` (or equivalent). Immediately after it, add a line in the same style:
```ts
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? ''
```
Match whatever exact assignment style the neighboring `GOOGLE_MAPS_API_KEY`/`GITHUB_TOKEN` lines use (direct `=` assignment vs. a helper) — copy that style verbatim rather than introducing a new one. This exists for the same reason `GITHUB_TOKEN` is stubbed: a developer's real key in their shell must never let a test that forgets to mock `releaseDeps.humanize` make a live, billed Claude API call during `test:db`.

- [ ] **Step 2: Commit**

```bash
git add apps/backend/vitest.db.config.ts
git commit -m "test(backend): stub ANTHROPIC_API_KEY out of the DB test suite"
```

---

### Task 8: API tests for the six routes

**Files:**
- Create: `apps/backend/tests/api/releases.test.ts`

**Interfaces:**
- Consumes: `app, releaseDeps` from `../../src/app.js`; `makeUser, serviceClient` from `../rls/helpers.js`.

- [ ] **Step 1: Write the tests**

Create `apps/backend/tests/api/releases.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { app, releaseDeps } from '../../src/app.js'
import { makeUser, serviceClient } from '../rls/helpers.js'

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function get(path: string, token?: string) {
  return app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
}
function post(path: string, token?: string) {
  return app.request(path, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} })
}
function patch(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

let superToken: string
let memberToken: string

const origListReleases = releaseDeps.listReleases
const origHumanize = releaseDeps.humanize

describe('releases', () => {
  beforeAll(async () => {
    const superClient = await makeUser('releases-super@example.com', 'password123')
    const superIds = await tokenOf(superClient)
    const svc = serviceClient()
    await svc.from('profiles').delete().eq('user_id', superIds.userId)
    await svc.from('profiles').insert({ user_id: superIds.userId, name: 'Super', app_role: 'superadmin' })
    superToken = superIds.token

    const member = await makeUser('releases-member@example.com', 'password123')
    const memberIds = await tokenOf(member)
    memberToken = memberIds.token

    await svc.from('releases').delete().like('tag', 'releases-test-%')
  })

  afterEach(() => {
    releaseDeps.listReleases = origListReleases
    releaseDeps.humanize = origHumanize
  })

  afterAll(async () => {
    await serviceClient().from('releases').delete().like('tag', 'releases-test-%')
  })

  it('refuses the admin list to a non-superadmin and to an anonymous caller', async () => {
    expect((await get('/api/admin/releases', memberToken)).status).toBe(403)
    expect((await get('/api/admin/releases')).status).toBe(401)
  })

  it('pulls new releases, humanizes them, and skips tags already in the table', async () => {
    releaseDeps.listReleases = async () => [
      {
        tag_name: 'releases-test-1', name: 'Test 1', body: 'raw body 1',
        html_url: 'https://github.com/x/y/releases/tag/releases-test-1',
        published_at: '2026-08-05T00:00:00Z',
      },
    ]
    releaseDeps.humanize = async () => ({ title: 'Test release one', summary: 'A short summary.' })

    const first = await post('/api/admin/releases/pull', superToken)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ pulled: 1 })

    const list = await get('/api/admin/releases', superToken)
    const rows = (await list.json()) as Array<{ tag: string; title: string | null; status: string }>
    const row = rows.find((r) => r.tag === 'releases-test-1')
    expect(row?.title).toBe('Test release one')
    expect(row?.status).toBe('draft')

    // Second pull sees the same GitHub release — already-pulled tag is skipped, not duplicated.
    const second = await post('/api/admin/releases/pull', superToken)
    expect(await second.json()).toEqual({ pulled: 0 })
  })

  it('records a humanize failure without blocking the pull', async () => {
    releaseDeps.listReleases = async () => [
      {
        tag_name: 'releases-test-2', name: 'Test 2', body: 'raw body 2',
        html_url: 'https://github.com/x/y/releases/tag/releases-test-2',
        published_at: '2026-08-05T00:00:00Z',
      },
    ]
    releaseDeps.humanize = async () => null

    const res = await post('/api/admin/releases/pull', superToken)
    expect(await res.json()).toEqual({ pulled: 1 })

    const list = await get('/api/admin/releases', superToken)
    const rows = (await list.json()) as Array<{ tag: string; title: string | null; humanize_error: string | null }>
    const row = rows.find((r) => r.tag === 'releases-test-2')
    expect(row?.title).toBeNull()
    expect(row?.humanize_error).toBeTruthy()
  })

  it('regenerates a failed humanization', async () => {
    releaseDeps.listReleases = async () => [
      {
        tag_name: 'releases-test-3', name: 'Test 3', body: 'raw body 3',
        html_url: 'https://github.com/x/y/releases/tag/releases-test-3',
        published_at: '2026-08-05T00:00:00Z',
      },
    ]
    releaseDeps.humanize = async () => null
    await post('/api/admin/releases/pull', superToken)

    const list = await get('/api/admin/releases', superToken)
    const rows = (await list.json()) as Array<{ id: string; tag: string }>
    const id = rows.find((r) => r.tag === 'releases-test-3')!.id

    releaseDeps.humanize = async () => ({ title: 'Regenerated title', summary: 'Regenerated summary.' })
    const res = await post(`/api/admin/releases/${id}/regenerate`, superToken)
    expect(res.status).toBe(200)
    const row = (await res.json()) as { title: string | null; humanize_error: string | null }
    expect(row.title).toBe('Regenerated title')
    expect(row.humanize_error).toBeNull()
  })

  it('publishes a release, and it becomes visible on the public endpoints; unpublishing hides it again', async () => {
    releaseDeps.listReleases = async () => [
      {
        tag_name: 'releases-test-4', name: 'Test 4', body: 'raw body 4',
        html_url: 'https://github.com/x/y/releases/tag/releases-test-4',
        published_at: '2026-08-05T00:00:00Z',
      },
    ]
    releaseDeps.humanize = async () => ({ title: 'Public title', summary: 'Public summary.' })
    await post('/api/admin/releases/pull', superToken)

    const list = await get('/api/admin/releases', superToken)
    const rows = (await list.json()) as Array<{ id: string; tag: string }>
    const id = rows.find((r) => r.tag === 'releases-test-4')!.id

    const draftList = await get('/api/releases')
    expect((await draftList.json() as Array<{ tag: string }>).some((r) => r.tag === 'releases-test-4')).toBe(false)
    expect((await get('/api/releases/releases-test-4')).status).toBe(404)

    const published = await patch(`/api/admin/releases/${id}`, { status: 'published' }, superToken)
    expect(published.status).toBe(200)

    const publicList = await get('/api/releases')
    expect((await publicList.json() as Array<{ tag: string }>).some((r) => r.tag === 'releases-test-4')).toBe(true)

    const detail = await get('/api/releases/releases-test-4')
    expect(detail.status).toBe(200)
    expect(await detail.json()).toEqual({
      tag: 'releases-test-4', title: 'Public title', summary: 'Public summary.',
      published_at: '2026-08-05T00:00:00Z',
    })

    await patch(`/api/admin/releases/${id}`, { status: 'draft' }, superToken)
    expect((await get('/api/releases/releases-test-4')).status).toBe(404)
  })

  it('rejects an unknown status value on PATCH', async () => {
    const res = await patch(
      '/api/admin/releases/00000000-0000-0000-0000-000000000000', { status: 'bogus' }, superToken,
    )
    expect(res.status).toBe(400)
  })

  it('404s PATCH and regenerate for an unknown id', async () => {
    const bogusId = '00000000-0000-0000-0000-000000000000'
    expect((await patch(`/api/admin/releases/${bogusId}`, { status: 'published' }, superToken)).status).toBe(404)
    expect((await post(`/api/admin/releases/${bogusId}/regenerate`, superToken)).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the tests**

Run (from `apps/backend/`, with `supabase start` already running): `pnpm test:db -- releases.test.ts`
Expected: PASS. If `beforeAll`'s superadmin bootstrap fails, confirm `supabase start` is running and the migration from Task 1 was applied.

- [ ] **Step 3: Run the full DB suite to confirm nothing else broke**

Run: `pnpm --filter @bitetime/backend test:db`
Expected: PASS across `tests/rls` and `tests/api`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/tests/api/releases.test.ts
git commit -m "test(backend): API tests for release notes routes"
```

---

### Task 9: RLS test proving `releases` denies the browser

**Files:**
- Create: `apps/backend/tests/rls/releases-grant.test.ts`

**Interfaces:**
- Consumes: `anonClient, makeUser, serviceClient` from `./helpers.js`.

- [ ] **Step 1: Write the test**

Create `apps/backend/tests/rls/releases-grant.test.ts`:

```ts
// Belt on top of the code path: after the migration's RLS enable-with-no-policies, a browser
// (anon or authenticated) client cannot SELECT releases directly at all — mirrors
// trial-feedback-grant.test.ts. If this ever passes with rows, a policy crept in and the
// backend API is no longer the only door.
import { describe, it, expect } from 'vitest'
import { anonClient, makeUser, serviceClient } from './helpers.js'

describe('releases is not directly readable by the browser', () => {
  it('denies an anonymous SELECT', async () => {
    const { data, error } = await anonClient().from('releases').select('*')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
    if (error) expect(error.message.toLowerCase()).toContain('permission denied')
  })

  it('denies an authenticated SELECT', async () => {
    const user = await makeUser('releases-grant-user@example.com', 'password123')
    const svc = serviceClient()
    await svc.from('releases').insert({
      tag: 'releases-grant-test-tag',
      name: 'Test release',
      html_url: 'https://github.com/leongcheefai/Bitetime-Order-Platform/releases/tag/releases-grant-test-tag',
      raw_body: 'raw body',
      published_at: new Date().toISOString(),
    })

    const { data, error } = await user.from('releases').select('*').eq('tag', 'releases-grant-test-tag')

    expect(error).not.toBeNull()
    expect(error?.code === '42501' || error?.message.toLowerCase().includes('permission denied')).toBe(true)
    expect(data).toBeNull()
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @bitetime/backend test:db -- releases-grant.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/tests/rls/releases-grant.test.ts
git commit -m "test(backend): RLS proof that releases denies the browser"
```

---

### Task 10: Frontend types + store functions

**Files:**
- Modify: `apps/frontend/src/types.ts`
- Modify: `apps/frontend/src/store.ts`

**Interfaces:**
- Produces: `PublicRelease, ReleaseDetail, AdminRelease` types; `listPublishedReleases, getReleaseByTag, adminPullReleases, adminListReleases, adminSetReleaseStatus, adminRegenerateRelease` store functions — consumed by Tasks 11-13.

- [ ] **Step 1: Add types**

In `apps/frontend/src/types.ts`, add:

```ts
export interface PublicRelease {
  tag: string
  title: string
  published_at: string
}

export interface ReleaseDetail extends PublicRelease {
  summary: string
}

export interface AdminRelease {
  id: string
  tag: string
  name: string
  html_url: string
  raw_body: string
  published_at: string
  title: string | null
  summary: string | null
  humanize_error: string | null
  status: 'draft' | 'published'
  created_at: string
  updated_at: string
}
```

- [ ] **Step 2: Add store functions**

In `apps/frontend/src/store.ts`, add `PublicRelease, ReleaseDetail, AdminRelease` to the existing `import type { ... } from './types'` line, then append a new section:

```ts
// ── Release notes (#163) ────────────────────────────────────────────────────

export async function listPublishedReleases(): Promise<Result<PublicRelease[]>> {
  return apiGet<PublicRelease[]>('/api/releases')
}

export async function getReleaseByTag(tag: string): Promise<Result<ReleaseDetail>> {
  return apiGet<ReleaseDetail>(`/api/releases/${encodeURIComponent(tag)}`)
}

export async function adminPullReleases(): Promise<Result<{ pulled: number }>> {
  return apiSend<{ pulled: number }>('/api/admin/releases/pull', 'POST', undefined, { auth: 'required' })
}

export async function adminListReleases(): Promise<Result<AdminRelease[]>> {
  return apiGet<AdminRelease[]>('/api/admin/releases', { auth: 'required' })
}

export async function adminSetReleaseStatus(
  id: string,
  status: 'draft' | 'published',
): Promise<Result<AdminRelease>> {
  return apiSend<AdminRelease>(`/api/admin/releases/${id}`, 'PATCH', { status }, { auth: 'required' })
}

export async function adminRegenerateRelease(id: string): Promise<Result<AdminRelease>> {
  return apiSend<AdminRelease>(`/api/admin/releases/${id}/regenerate`, 'POST', undefined, { auth: 'required' })
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bitetime/frontend typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/types.ts apps/frontend/src/store.ts
git commit -m "feat(frontend): add release notes types and store functions"
```

---

### Task 11: `ReleasesBell` popover in the dashboard sidebar

**Files:**
- Create: `apps/frontend/src/components/ReleasesBell.tsx`
- Modify: `apps/frontend/src/components/DashboardShell.tsx`

**Interfaces:**
- Consumes: `listPublishedReleases` (Task 10); `Popover, PopoverTrigger, PopoverContent` from `@/components/ui/popover`; `Button` from `@/components/ui/button`; `Bell` from `lucide-react`.
- Produces: `ReleasesBell` default export, mounted in `DashboardShell`'s footer for both the merchant and admin dashboards (they share this shell).

- [ ] **Step 1: Create `ReleasesBell.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { listPublishedReleases } from '../store'
import { useSession } from '../SessionContext'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import type { PublicRelease } from '../types'

const LAST_SEEN_KEY = 'bitetime_last_seen_release'

// "What's new" bell — Notion-style: a short list of recent releases, each opening its own
// page in a new tab. See docs/superpowers/specs/2026-08-05-github-release-notes-design.md.
export default function ReleasesBell() {
  const { t } = useSession()
  const [releases, setReleases] = useState<PublicRelease[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    listPublishedReleases().then((r) => { if (r.ok) setReleases(r.data) })
  }, [])

  const newest = releases[0]?.tag ?? null
  const lastSeen = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_SEEN_KEY) : null
  const unread = newest !== null && newest !== lastSeen

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next && newest) window.localStorage.setItem(LAST_SEEN_KEY, newest)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            className="relative"
            aria-label={t("What's new", '更新日志')}
          />
        }
      >
        <Bell size={18} strokeWidth={1.75} />
        {unread && (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 size-2 rounded-full bg-oxblood"
          />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="text-[13px] font-semibold text-ink px-1 pb-1">
          {t("What's new", '更新日志')}
        </div>
        {releases.length === 0 ? (
          <div className="text-[13px] text-rose-muted px-1 py-2">
            {t('No updates yet', '暂无更新')}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {releases.map((r) => (
              <li key={r.tag}>
                <a
                  href={`/releases/${r.tag}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-[13px] text-ink no-underline hover:bg-surface-sunken"
                >
                  <span className="font-medium">{r.title}</span>
                  <span className="text-[11px] text-rose-muted">
                    {new Date(r.published_at).toLocaleDateString()}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: Mount it in `DashboardShell.tsx`**

Add to the top import block:
```ts
import ReleasesBell from './ReleasesBell'
```

Find the footer block:
```tsx
        {/* Footer — language selector, sign-out */}
        <div className="px-5 pt-4 pb-6 border-t border-divider">
          {/* Language select */}
          <div className="mb-2">
            <LanguageSelect className="w-full" />
          </div>
```

Replace the language-select wrapper `<div className="mb-2">...</div>` with:
```tsx
          <div className="mb-2 flex items-center gap-2">
            <LanguageSelect className="flex-1" />
            <ReleasesBell />
          </div>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bitetime/frontend typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/ReleasesBell.tsx apps/frontend/src/components/DashboardShell.tsx
git commit -m "feat(frontend): add what's-new bell to the dashboard sidebar"
```

---

### Task 12: `/releases/:tag` page

**Files:**
- Create: `apps/frontend/src/marketing/ReleaseNotes.tsx`
- Modify: `apps/frontend/src/AppRouter.tsx`

**Interfaces:**
- Consumes: `getReleaseByTag` (Task 10); `Spinner` from `../components/Loaders`; `Wordmark` from `../components/Wordmark`.
- Produces: public route `/releases/:tag`, no guard.

- [ ] **Step 1: Create `ReleaseNotes.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getReleaseByTag } from '../store'
import { useSession } from '../SessionContext'
import { Spinner } from '../components/Loaders'
import Wordmark from '../components/Wordmark'
import type { ReleaseDetail } from '../types'

export default function ReleaseNotes() {
  const { tag } = useParams<{ tag: string }>()
  const { t } = useSession()
  const [release, setRelease] = useState<ReleaseDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tag) return
    setLoading(true)
    setNotFound(false)
    getReleaseByTag(tag).then((r) => {
      if (r.ok) setRelease(r.data)
      else setNotFound(true)
      setLoading(false)
    })
  }, [tag])

  if (loading) {
    return (
      <div className="w-full min-h-[50vh] flex items-center justify-center">
        <Spinner label={t('Loading…', '加载中…')} />
      </div>
    )
  }

  if (notFound || !release) {
    return (
      <div className="form-wrap text-center pt-8 pb-12">
        <div className="text-center mb-10">
          <h1><Wordmark className="h-8 mx-auto" /></h1>
        </div>
        <div className="bg-surface-raised border-[1.5px] border-rose-border rounded-2xl p-5 mb-8 w-full box-border text-left">
          <p className="text-rose-muted text-[14px] leading-[1.6] mt-1.5">
            {t("We couldn't find this release.", '未找到该更新记录。')}
          </p>
        </div>
        <Link to="/" className="text-oxblood text-[13px]">{t('Back home', '返回首页')}</Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <div className="mb-2">
        <Wordmark className="h-7" />
      </div>
      <p className="text-[12px] text-rose-muted mb-6">
        {new Date(release.published_at).toLocaleDateString()}
      </p>
      <h1 className="text-2xl font-heading text-ink mb-6">{release.title}</h1>
      <div className="text-[15px] leading-[1.7] text-ink whitespace-pre-wrap">
        {release.summary}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the route in `AppRouter.tsx`**

Add to the route-level `lazy()` imports (near `SampleShopsPage`):
```ts
const ReleaseNotes = lazy(() => import('./marketing/ReleaseNotes'))
```

Add the route inside `<Routes location={location}>`, alongside the other top-level public routes (e.g. after `/sample-shops`):
```tsx
          <Route path="/releases/:tag" element={<ReleaseNotes />} />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bitetime/frontend typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/marketing/ReleaseNotes.tsx apps/frontend/src/AppRouter.tsx
git commit -m "feat(frontend): add public /releases/:tag page"
```

---

### Task 13: Admin review screen

**Files:**
- Create: `apps/frontend/src/admin/AdminReleases.tsx`
- Modify: `apps/frontend/src/admin/AdminHome.tsx`

**Interfaces:**
- Consumes: `adminPullReleases, adminListReleases, adminSetReleaseStatus, adminRegenerateRelease` (Task 10).
- Produces: a new "Releases" section in the existing superadmin dashboard (`AdminHome`'s hash-based sections — matches how Overview/Merchants/Feedback/Trial feedback already work; this is not a separate top-level route).

- [ ] **Step 1: Create `AdminReleases.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  adminPullReleases, adminListReleases, adminSetReleaseStatus, adminRegenerateRelease,
} from '../store'
import { unwrap } from '../api'
import { useSession } from '../SessionContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { AdminRelease } from '../types'

export default function AdminReleases() {
  const { t } = useSession()
  const [rows, setRows] = useState<AdminRelease[] | null>(null)
  const [pulling, setPulling] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setRows(unwrap(await adminListReleases()))
  }
  useEffect(() => { load() }, [])

  async function pull() {
    setPulling(true)
    const r = await adminPullReleases()
    if (r.ok) {
      toast.success(t(`Pulled ${r.data.pulled} release(s)`, `已拉取 ${r.data.pulled} 条更新`))
      await load()
    } else {
      toast.error(r.error.message || t('Pull failed', '拉取失败'))
    }
    setPulling(false)
  }

  async function togglePublish(row: AdminRelease) {
    setBusy(row.id)
    const next = row.status === 'published' ? 'draft' : 'published'
    const r = await adminSetReleaseStatus(row.id, next)
    if (r.ok) { toast.success(t('Updated', '已更新')); await load() }
    else toast.error(r.error.message || t('Could not update', '无法更新'))
    setBusy(null)
  }

  async function regenerate(row: AdminRelease) {
    setBusy(row.id)
    const r = await adminRegenerateRelease(row.id)
    if (r.ok) { toast.success(t('Regenerated', '已重新生成')); await load() }
    else toast.error(r.error.message || t('Regenerate failed', '重新生成失败'))
    setBusy(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-heading text-ink">{t('Releases', '更新日志')}</h2>
        <Button variant="default" size="sm" onClick={pull} disabled={pulling}>
          {pulling ? t('Pulling…', '拉取中…') : t('Pull releases from GitHub', '从 GitHub 拉取更新')}
        </Button>
      </div>
      {rows === null ? (
        <p className="text-[13px] text-rose-muted">{t('Loading…', '加载中…')}</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-rose-muted">{t('No releases pulled yet', '尚未拉取任何更新')}</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-rose-muted border-b border-divider">
              <th className="py-2 pr-3">{t('Tag', '版本')}</th>
              <th className="py-2 pr-3">{t('Title', '标题')}</th>
              <th className="py-2 pr-3">{t('Status', '状态')}</th>
              <th className="py-2 pr-3">{t('Published', '发布时间')}</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-divider">
                <td className="py-2 pr-3">{row.tag}</td>
                <td className="py-2 pr-3">
                  {row.title ?? row.name}
                  {row.humanize_error && (
                    <div className="text-[11px] text-danger-fg mt-0.5">{row.humanize_error}</div>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <Badge variant={row.status === 'published' ? 'success' : 'outline'}>
                    {row.status === 'published' ? t('Published', '已发布') : t('Draft', '草稿')}
                  </Badge>
                </td>
                <td className="py-2 pr-3">{new Date(row.published_at).toLocaleDateString()}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  <Button
                    variant="outline" size="sm" className="mr-2"
                    disabled={busy === row.id}
                    onClick={() => regenerate(row)}
                  >
                    {t('Regenerate', '重新生成')}
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={busy === row.id || !row.title}
                    onClick={() => togglePublish(row)}
                  >
                    {row.status === 'published' ? t('Unpublish', '取消发布') : t('Publish', '发布')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `AdminHome.tsx`**

Change the icon import line:
```ts
import { LayoutDashboard, Store, MessageSquare, Star } from 'lucide-react'
```
to:
```ts
import { LayoutDashboard, Store, MessageSquare, Star, Megaphone } from 'lucide-react'
```

Add the import:
```ts
import AdminReleases from './AdminReleases'
```

Add a new entry to `SECTIONS` (after `trial-feedback`):
```ts
  { key: 'releases', en: 'Releases', zh: '更新日志', icon: <Megaphone {...ICON} /> },
```

Add a new render branch (after the `trial-feedback` branch):
```tsx
        {section === 'releases' && <AdminReleases />}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bitetime/frontend typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/admin/AdminReleases.tsx apps/frontend/src/admin/AdminHome.tsx
git commit -m "feat(frontend): add admin Releases review screen"
```

---

### Task 14: Run-and-verify

**Files:** none (manual verification only — per CLAUDE.md, UI is verified by running the app).

- [ ] **Step 1: Start the stack**

From the repo root:
```bash
supabase start --workdir apps/backend
pnpm --filter @bitetime/backend db:migrate
pnpm dev
```

- [ ] **Step 2: Confirm the backend has a real `GITHUB_TOKEN` and `ANTHROPIC_API_KEY` in `apps/backend/.env`**

Both must be set to real credentials for this manual pass — this is the one step in the whole plan that hits the live GitHub API and a real, billed Claude API call. Confirm `apps/backend/.env` has both before proceeding.

- [ ] **Step 3: Sign in as superadmin, pull releases**

Go to `/admin`, open the new "Releases" section, click "Pull releases from GitHub". Confirm rows appear with a `Draft` badge and a Claude-written title (not the raw GitHub PR-title body).

- [ ] **Step 4: Publish one release**

Click "Publish" on one row. Confirm its badge flips to `Published`.

- [ ] **Step 5: Confirm the merchant dashboard shows it**

Sign in as (or impersonate) a merchant, go to `/merchant`. Confirm the bell in the sidebar footer shows an unread dot, click it, confirm the published release appears in the popover with its Claude-written title, and confirm the popover shows nothing for any release still in `Draft`.

- [ ] **Step 6: Open the release page**

Click the release row in the popover. Confirm it opens `/releases/<tag>` in a **new tab**, shows the title and summary, and that navigating directly to that URL in an incognito/signed-out window also works (public route).

- [ ] **Step 7: Confirm the unread dot clears**

Reload the merchant dashboard. Confirm the bell's unread dot is gone (localStorage `bitetime_last_seen_release` was set when the popover was opened in Step 5).

- [ ] **Step 8: Confirm a draft 404s publicly**

With a release still in `Draft` status, visit `/releases/<that-tag>` directly. Confirm it shows the "couldn't find this release" state, not the content.

- [ ] **Step 9: Run the full test suites**

```bash
pnpm --filter @bitetime/backend test
pnpm --filter @bitetime/backend test:db
pnpm --filter @bitetime/frontend typecheck
pnpm typecheck
pnpm lint
```
Expected: all pass.

- [ ] **Step 10: Final commit if any fixes were needed during verification**

If Steps 1-9 required any code changes, commit them with a descriptive message before considering the feature done.
