# GitHub release notes for merchants (#163)

## What we are building

Superadmin pulls GitHub releases from `leongcheefai/Bitetime-Order-Platform` into the app, and merchants see them as a "what's new" bell in the dashboard sidebar — Notion's `Help → What's new` popover, listing recent updates, each opening a dedicated release-notes page in a new tab.

Raw GitHub release bodies are auto-generated PR-title lists (`feat(frontend): add Telegram bot setup guide … by @leongcheefai in #185`) — dev-facing and unreadable to a merchant. Pulling a release therefore also rewrites it into merchant-facing copy via one Claude API call, and the result sits as a draft until superadmin publishes it.

Decisions taken during brainstorming:

| Question | Decision |
|---|---|
| Content source | Claude (`claude-opus-5`) rewrites the raw GitHub body into a short title + summary. No manual copy-editing UI. |
| Language | English only — release notes are not folded into the app's `t(en, zh)` bilingual pattern. |
| Fetch mechanism | Superadmin-triggered pull (`POST /api/admin/releases/pull`) into a DB table, not a live fetch on every dashboard load or a cron sweep. Matches the issue's literal "superadmin can pull the release." |
| Publish gate | Pulling humanizes and stores as `draft`; a release only reaches merchants after a superadmin explicitly publishes it. Guards against bad AI output reaching every shop unreviewed. |
| Audience | All merchants regardless of plan — this is a product-wide announcement, not a Pro feature. |
| Where the release page lives | Our own route, `/releases/:tag`, not a link out to `github.com/.../releases/tag/X`. Matches the Notion screenshot's UX (their releases page is on their own domain) and is required anyway once the copy is Claude-rewritten — GitHub's page would still show the raw PR-title body. |

## Data model

`apps/backend/supabase/migrations/<ts>_releases.sql`:

```sql
-- Releases pulled from GitHub (leongcheefai/Bitetime-Order-Platform) and rewritten into
-- merchant-facing copy by Claude. See docs/superpowers/specs/2026-08-05-github-release-notes-design.md.
-- Reached only through apps/backend/src/app.ts routes (admin client / db.ts) — never a browser
-- role, hence no policy grants below (same posture as merchant_secrets).
create table public.releases (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique,
  name text not null,               -- GitHub release name, e.g. "0.1.5"
  html_url text not null,           -- github.com release page, kept for admin reference only
  raw_body text not null,           -- original GitHub release body (PR-title list)
  published_at timestamptz not null, -- GitHub's own publish date, used for sort/display
  title text,                       -- Claude-written merchant-facing title; null until humanized
  summary text,                     -- Claude-written merchant-facing summary; null until humanized
  humanize_error text,              -- set when the Claude call failed; title/summary stay null
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index releases_status_published_at_idx
  on public.releases (status, published_at desc);

alter table public.releases enable row level security;
-- No policies: browser roles (anon, authenticated) have no grants on this table
-- (20260718130000_revoke_all_browser_grants.sql pattern). All access goes through
-- apps/backend/src/app.ts using the admin (service-role) client.

-- Revised during implementation: RLS bypass and table-level GRANT are separate layers in
-- Postgres — service_role still needs an explicit grant to touch a NEW table at all, RLS
-- bypass or not. Every route 500'd with "permission denied" until this was added, matching
-- trial_feedback's migration.
revoke all on table public.releases from anon, authenticated;
grant select, insert, update, delete on table public.releases to service_role;
```

`status = 'draft'` covers both "pulled, humanized, awaiting publish" and "humanization failed" (distinguished by `humanize_error` being set) — one state field, not two.

## Backend

### `apps/backend/src/github.ts` — add release listing

New export alongside the existing issue-filing functions, same adapter shape (token as parameter, best-effort — returns `null` and logs on failure, never throws):

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
  // GET /repos/{GITHUB_REPO}/releases?per_page={perPage}, same headers() helper as createGithubIssue
}
```

### New modules `apps/backend/src/releases.ts` + `releasesDb.ts`

**Revised during implementation:** split into two files, not one, matching the `shopCustomers.ts`/`shopCustomersDb.ts` convention rather than the single-file plan below. `releases.ts` holds only the Claude call and imports nothing from `supabase.ts` — that's what keeps it importable by a zero-env-var unit test, the same constraint `github.ts` documents for itself. `releasesDb.ts` holds the `releases` table CRUD (plain `admin` REST calls — no transaction needed, nothing here is multi-statement) and is exercised only via the DB-backed test suites.

```ts
export interface HumanizedRelease {
  title: string
  summary: string
}

export type HumanizeRelease = (
  apiKey: string,
  input: { tag: string; name: string; body: string },
) => Promise<HumanizedRelease | null>

// Anthropic SDK, claude-opus-5, output_config.effort: "low" (plain summarization),
// structured output (json_schema: {title, summary}) instead of a prefill. Best-effort:
// catches and logs, returns null — the caller stores humanize_error and leaves the release
// in `draft` with no title/summary, same shape as a GitHub-fetch failure.
export const humanizeRelease: HumanizeRelease = async (apiKey, { tag, name, body }) => { ... }
```

DB functions (`insertDraftRelease`, `listAllReleases`, `listPublishedReleases`, `getReleaseByTag`, `updateReleaseStatus`, `updateReleaseHumanization`) follow the same shape as `feedback.ts`'s DB helpers — plain `admin.from('releases')` calls, no RLS involvement since this connection is service-role.

### Dependency injection seam

Same pattern as `githubDeps` / `notifyDeps` in `app.ts` — held mutable so tests capture calls without live network:

```ts
export const releaseDeps: {
  listReleases: ListGithubReleases
  humanize: HumanizeRelease
} = { listReleases: listGithubReleases, humanize: humanizeRelease }
```

### Routes (`app.ts`)

| Route | Guard | Behavior |
|---|---|---|
| `POST /api/admin/releases/pull` | `requireSuperadmin` | `releaseDeps.listReleases(env.githubToken, 10)`. For each `tag_name` not already in the table: insert a draft row, then `releaseDeps.humanize(env.anthropicApiKey, ...)` and fill `title`/`summary`, or set `humanize_error` on failure. Returns the count pulled. **Revised during implementation:** a missing `env.anthropicApiKey` is handled inside `humanizeRelease` itself (logs, returns `null`, no throw) rather than gating the route with an up-front 500 — a route-level check broke testability against the `releaseDeps` mock, and this is more consistent with `githubToken`'s posture elsewhere: the pull still succeeds, and the gap surfaces per-row as `humanize_error` on the admin screen. |
| `GET /api/admin/releases` | `requireSuperadmin` | All rows, newest `published_at` first — the review table. |
| `PATCH /api/admin/releases/:id` | `requireSuperadmin` | Body `{status: 'draft' \| 'published'}`. |
| `POST /api/admin/releases/:id/regenerate` | `requireSuperadmin` | Re-runs `releaseDeps.humanize` for one row (recovers from a failed or unsatisfying first pass). |
| `GET /api/releases` | none (public) | `status = 'published'` rows only, `{tag, title, publishedAt}`, newest first, capped (10) — feeds the popover. |
| `GET /api/releases/:tag` | none (public) | One `status = 'published'` row, full `{tag, title, summary, publishedAt}`. 404 for a draft or unknown tag — a draft is never reachable by tag guessing. |

### Config

- `apps/backend/.env.example`: add `ANTHROPIC_API_KEY=`
- `apps/backend/src/env.ts`: `anthropicApiKey: process.env.ANTHROPIC_API_KEY || ''` — optional at startup (same posture as `githubToken`/`googleMapsApiKey`), but `/api/admin/releases/pull` treats it as required and fails loudly.
- `apps/backend/package.json`: add `@anthropic-ai/sdk` as a runtime dependency, and add its `--external:@anthropic-ai/sdk` flag to the esbuild bundle command per the monorepo's rule that every backend runtime dependency needs one.

## Frontend

### `src/types.ts`

```ts
export interface PublicRelease { tag: string; title: string; publishedAt: string }
export interface ReleaseDetail extends PublicRelease { summary: string }
export interface AdminRelease {
  id: string; tag: string; name: string; htmlUrl: string
  title: string | null; summary: string | null; humanizeError: string | null
  status: 'draft' | 'published'; publishedAt: string
}
```

### `src/store.ts`

`listPublishedReleases()`, `getReleaseByTag(tag)`, `adminPullReleases()`, `adminListReleases()`, `adminSetReleaseStatus(id, status)`, `adminRegenerateRelease(id)` — wired through whatever the current `store.ts` convention is (the `Result<T, E>` refactor per #122 covers most slices; match it rather than introducing a new pattern).

### Bell + popover — `src/components/DashboardShell.tsx`

Added to the sidebar footer row next to `LanguageSelect` (`DashboardShell.tsx:199-202`) — the shell has no top app-bar on desktop, so this is the only free real estate, per the earlier repo scan. Built from the existing `Popover`/`DropdownMenu` primitives (`components/ui/popover.tsx`, `dropdown-menu.tsx`), the same composition already used in `AdminMerchants.tsx` and `ProductsManager.tsx`.

- `listPublishedReleases()` runs once when the dashboard mounts.
- An unread dot (reusing the existing `Badge` component, `DashboardShell.tsx:186-188`) shows when the newest release's `tag` differs from `localStorage['bitetime_last_seen_release']`; opening the popover updates that key.
- Each row: title + short relative date, `<a target="_blank" rel="noopener noreferrer" href={`/releases/${tag}`}>`.

### `/releases/:tag` page

New file, e.g. `src/marketing/ReleaseNotes.tsx`. Top-level route in `AppRouter.tsx`, **no guard** — public, same posture as GitHub's own release page, and it needs to be openable from a new tab without re-authenticating. Fetches `getReleaseByTag(tag)` on mount; loading / not-found states; renders `title` + `summary` as plain prose (Claude's output is plain text, no markdown renderer needed). Not added to the prerender `ROUTES` list — this is dynamic per-tag content, not a static SEO landing page, so it doesn't carry the four-places prerender obligation the marketing pages do.

### Admin review — `/admin/releases`

New file `src/admin/AdminReleases.tsx`, role `superadmin`. "Pull releases from GitHub" button (`adminPullReleases()`, toast with the count pulled). Table of all releases: tag, title (or raw `name` if `humanizeError` is set), status badge, `publishedAt`. Row actions: Publish/Unpublish (`adminSetReleaseStatus`), Regenerate (`adminRegenerateRelease`) — the last one visible always, most useful when `humanizeError` is set.

## Testing

- `apps/backend/tests/unit/`: `humanizeRelease` prompt-building and the pull route's dedupe-by-tag logic, against `releaseDeps` mocked the same way `githubDeps` is mocked in `feedback.test.ts`.
- `apps/backend/tests/api/`: the 6 routes — superadmin gating on the `/admin/*` ones, published-only visibility on the public ones, 404 on a draft tag.
- `apps/backend/tests/rls/`: `releases` denies both `anon` and `authenticated` — proof the table posture matches `merchant_secrets`, not an oversight.
