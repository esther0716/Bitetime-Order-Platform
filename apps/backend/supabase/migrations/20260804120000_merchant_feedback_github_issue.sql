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
