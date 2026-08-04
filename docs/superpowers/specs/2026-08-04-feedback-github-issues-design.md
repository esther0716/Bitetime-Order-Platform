# Auto-filing merchant feedback as GitHub issues

## Where this starts

A merchant submits platform feedback via the `FeedbackFab` on their dashboard (`apps/frontend/src/merchant/FeedbackFab.tsx`) — a category (`bug` / `feature` / `billing` / `other`) plus a message, capped at 2000 chars. `POST /api/merchants/:id/feedback` writes it to `merchant_feedback` (`apps/backend/src/feedback.ts:26`) and it sits there until a superadmin opens `AdminFeedback.tsx` and triages it by hand. There is no GitHub integration anywhere in the repo today — no client library, no `GITHUB_TOKEN`, nothing.

This spec files every submission as a GitHub issue on `leongcheefai/Bitetime-Order-Platform` automatically, so feedback lands in the same triage surface (`needs-triage` label, per `docs/agents/triage-labels.md`) as everything else the project tracks, instead of a separate silo the admin dashboard is the only way to see.

## Decisions taken during design

| Question | Decision |
|---|---|
| Which categories file issues | All four (`bug`, `feature`, `billing`, `other`) |
| GitHub API down/erroring | Feedback still saves; issue creation is best-effort and never blocks or fails the submit request |
| Store a link back to the issue? | Yes — new columns on `merchant_feedback`, shown in `AdminFeedback.tsx` |
| Resolving feedback in-app | Also closes the linked GitHub issue (best-effort, same fail-open policy); reopening in-app reopens the issue |
| Labels | `needs-triage` + a category label: `bug`→`bug`, `feature`→`enhancement`, `billing`→`billing`, `other`→`other` (reusing the repo's existing `bug`/`enhancement` labels rather than inventing feedback-specific ones) |
| Issue title | `"[Feedback] <category>: <shop name>"` — stable and scannable; the merchant's actual message goes in the body, not the title |
| GitHub client | Plain `fetch()` against the REST API, no new dependency — avoids the `--external:` flag CLAUDE.md requires for new backend runtime deps |
| Target repo | Hardcoded constant (`leongcheefai/Bitetime-Order-Platform`), not env-configurable — it's the one canonical repo per CLAUDE.md |

## Backend

### `apps/backend/src/github.ts` (new)

Thin wrapper, three functions, all best-effort — catch, log (`console.error` with feedback id + status/body), return `null`. Never throw.

```ts
createIssue({ title, body, labels }): Promise<{ number: number; html_url: string } | null>
closeIssue(number): Promise<void>   // best-effort, swallows errors
reopenIssue(number): Promise<void>  // best-effort, swallows errors
```

`createIssue` calls `POST https://api.github.com/repos/leongcheefai/Bitetime-Order-Platform/issues` with `Authorization: Bearer ${GITHUB_TOKEN}`. If `GITHUB_TOKEN` is unset, `createIssue` returns `null` immediately without making a request (fail-open, same pattern as `GOOGLE_MAPS_API_KEY` — unset means the feature quietly doesn't run, not a startup error). If the request 422s (e.g. an unknown label — see Setup below), retry once with only `needs-triage` and drop the category label, so the issue still gets filed.

### `env.ts`

New optional var `GITHUB_TOKEN` — a fine-grained PAT scoped to `issues:write` on this one repo. Not required at startup (unlike `SUPABASE_*`/Stripe keys), matching `GOOGLE_MAPS_API_KEY`'s "fails closed, not fails startup" treatment.

### Submit flow — `POST /api/merchants/:id/feedback` (`app.ts:1318`)

After `insertFeedback()` commits and before the response is sent, build the issue and call `createIssue()` in the same request. Its outcome never changes the response — the row returned to the merchant is the same whether or not the GitHub call succeeds. On success, a follow-up `UPDATE merchant_feedback SET github_issue_number = …, github_issue_url = …` (also best-effort — a failure here just means the DB doesn't show a link the merchant never sees anyway; logged, not retried, matching the existing "notify is separate from commit" posture used for Telegram order notifications).

Body includes: the merchant's message, shop name + slug, the feedback row id, submitted timestamp.

### Resolve/reopen flow — `PATCH /api/admin/feedback/:feedbackId` (`app.ts:1343`)

After `updateFeedbackStatus()` commits, if the row carries a `github_issue_number`, call `closeIssue()` (status → `resolved`) or `reopenIssue()` (status → `open`), best-effort. The admin dashboard's status is authoritative regardless of whether the GitHub call lands.

## Data model

Migration adds two nullable columns to `merchant_feedback`:

```sql
alter table public.merchant_feedback
  add column github_issue_number bigint,
  add column github_issue_url text;
```

No RLS change — the table already has no browser grants; only the backend's service-role connection touches it.

`FeedbackRow` (`apps/backend/src/feedback.ts`) and `FeedbackItem` (`apps/frontend/src/types.ts`) both gain optional `github_issue_number?: number` and `github_issue_url?: string | null`.

## Frontend

`AdminFeedback.tsx` — when `github_issue_url` is present, render a `View issue #<number> ↗` link next to the existing category badge.

## One-time setup (human, not code)

The repo has `bug` and `enhancement` already but not `billing` or `other`. Before this ships:

```bash
gh label create billing --repo leongcheefai/Bitetime-Order-Platform --color <any>
gh label create other --repo leongcheefai/Bitetime-Order-Platform --color <any>
```

`GITHUB_TOKEN` also needs to be set in the backend's deployment environment (Railway per the CORS/prod-map memory) — a fine-grained PAT, `issues:write` on this repo only, added the same way `RESEND_API_KEY`/Stripe keys already are. Not committed anywhere; the code treats it as optional so nothing breaks if it's set late.

## Error handling

- GitHub unreachable / 401 / 403 / rate-limited → logged, feedback DB write and the merchant's response are unaffected in every case.
- Unknown label (setup step missed) → `createIssue()` retries once without the category label rather than losing the issue entirely.
- The link-back `UPDATE` failing after a successful `createIssue()` → logged; GitHub has the issue, the app just doesn't show the link. No compensating retry.

## Tests

- `apps/backend/tests/unit/github.test.ts` — mock `fetch`; assert title/body construction, category→label mapping, the 422-retry-without-category-label path, and that all three functions swallow errors and return `null`/resolve rather than throwing.
- `tests/api` feedback suite extended: submit still returns `201` with the feedback row when `GITHUB_TOKEN` is unset in the test env (`vitest.db.config.ts` stubs it, same as the Stripe keys) — proves the fail-open path with no live GitHub calls in any automated test.
- Resolve/reopen route tests: status still flips correctly regardless of the (stubbed, absent) GitHub call outcome.

## Out of scope

- Two-way sync from GitHub back into the app (closing the issue on GitHub does not reopen/resolve the feedback row).
- Rate-limiting or deduping issue creation beyond the feedback submit endpoint's existing 20/hour-per-user limit.
- Any repo other than `leongcheefai/Bitetime-Order-Platform`.
- Editing an issue's body if the merchant's feedback message is later changed (there is no edit path for feedback today).
