-- Slug history: what survives a rename (#253, ADR 0022).
--
-- A slug rename used to be destructive: every shared link, printed QR code and indexed
-- /s/<old-slug> URL broke the moment the merchant pressed save. This table remembers where an
-- old slug went, so the storefront edge function can answer it with a 301 to the current slug.
--
-- One row per retired slug, keyed on the slug itself. Claim-wins: when a shop (new or renaming)
-- claims a slug that sits in another shop's history, the claim deletes the row — a live shop's
-- claim beats a dead redirect, and freed slugs stay genuinely reusable. The cascade means a
-- deleted shop takes its redirects with it.
create table if not exists public.merchant_slug_history (
  old_slug    text primary key,
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists merchant_slug_history_merchant_id_idx
  on public.merchant_slug_history (merchant_id);

-- RLS on and NO browser grants, matching every table since
-- 20260718130000_revoke_all_browser_grants.sql: all reads and writes go through the backend.
alter table public.merchant_slug_history enable row level security;
revoke all on public.merchant_slug_history from anon, authenticated;
grant select, insert, update, delete on public.merchant_slug_history to service_role;
