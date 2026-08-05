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
