-- The order log (#268, ADR 0025): one row per thing that happened to one order.
--
-- APPEND-ONLY. An event is inserted in the same transaction as the write it records and is never
-- updated or deleted — a log that can be edited is not a log. `service_role` is granted select
-- and insert only, so even the backend cannot rewrite history by accident; the browser roles
-- hold nothing, matching every table since 20260718130000_revoke_all_browser_grants.sql.
--
-- `merchant_id` is denormalised from the order. The merchant read proves tenancy through the
-- order (requireOwnsChild), so the column is not what guards it; it exists so a per-shop read
-- (a superadmin dispute view, a shop-wide export) needs no join. `actor_id` is null for a guest
-- and for the system; `actor_kind` is what tells those two apart on screen.
--
-- `kind` is CHECKed against the closed list `packages/shared/src/orderEvents.ts` also holds, so
-- a kind the drawer has not been taught cannot be written. Adding a kind means both places.
--
-- No backfill. An order placed before this migration has no events, and the drawer reads
-- "placed" off the order's own created_at — the one fact the row already holds. A backfilled
-- status history would be a guess written as a record.
create table if not exists public.order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  kind        text not null check (kind in (
                'created',
                'payment_proof_uploaded',
                'merchant_payment_proof_uploaded',
                'status_changed',
                'note_changed',
                'courier_changed',
                'awb_changed',
                'voucher_released',
                'voucher_restored'
              )),
  actor_kind  text not null check (actor_kind in ('merchant', 'customer', 'system')),
  actor_id    uuid,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists order_events_order_id_created_at_idx
  on public.order_events (order_id, created_at);

alter table public.order_events enable row level security;
revoke all on public.order_events from anon, authenticated;
grant select, insert on public.order_events to service_role;
