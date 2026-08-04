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
