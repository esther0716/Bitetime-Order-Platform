-- The MONTHLY ceiling on what the platform spends with Anthropic on one shop's behalf.
--
-- The daily ceilings already in `quotaWindows.ts` are in-memory sliding windows, and that is the
-- right shape for a burst stop: they cost nothing and they reset on redeploy, which for a
-- twenty-four hour window is a rounding error. A MONTH is not. A ceiling that a redeploy zeroes
-- is not a ceiling over a month — this backend deploys more often than monthly, so the counter
-- has to outlive the process. Hence a table rather than another `createSlidingWindow`.
--
-- `period` is 'YYYY-MM' on the SHOP's clock, not the server's: a merchant in Kuala Lumpur must
-- get their allowance back at their own midnight on the 1st, and `todayInZone` is already how
-- every other date this platform shows a merchant is computed. It is text rather than a date so
-- the primary key IS the bucket — one row per shop per feature per month, and the increment is a
-- single conflicting insert with no read before it.
--
-- The one non-month bucket is the literal 'lifetime', which counts down once and never resets.
-- Menu import needs it because it is a SETUP feature wearing a subscription's clothes: a merchant
-- photographs their menu once, in a burst of fifteen or twenty pages, and then barely again. A
-- flat monthly ceiling has to be either too small for that first week or absurdly generous for
-- every week after it. Two buckets are neither. Text rather than a nullable column so one primary
-- key covers both kinds and `consumeAiCall` needs no second code path.
--
-- Reached only from `apps/backend/src/aiUsage.ts` over the direct `db.ts` connection, which
-- authenticates as the database owner and is RLS-exempt. No browser role and no service_role
-- client touches it, so there are no grants below (same posture as `releases`,
-- 20260805130000_releases_table.sql). RLS is enabled with zero policies as the backstop for a
-- grant that gets reopened by accident.
create table public.ai_usage (
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  feature text not null check (feature in ('menu_import', 'assistant')),
  period text not null check (period = 'lifetime' or period ~ '^\d{4}-\d{2}$'),
  calls integer not null default 0 check (calls >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, feature, period)
);

alter table public.ai_usage enable row level security;

revoke all on table public.ai_usage from anon, authenticated;
