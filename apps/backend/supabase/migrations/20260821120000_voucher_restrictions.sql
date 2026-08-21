-- Voucher restrictions, and the end of `used_by` as the record of who redeemed what (#241).
--
-- A merchant asked for a code one customer can use more than once. The one-redemption-per-customer
-- rule was hardcoded in `claimVoucher` with no column behind it, so there was nothing to configure.
-- See docs/adr/0019-voucher-redemptions-are-rows-not-a-list.md and CONTEXT.md -> Voucher.

-- ── the three restriction columns ────────────────────────────────────────────
--
-- `per_customer_limit` NULL means unlimited, and the DEFAULT of 1 is what every existing row gets:
-- one redemption each is exactly the rule they were created under, so the backfill of this column
-- changes no shop's behaviour.
--
-- `expires_at` is an INSTANT, never a local date string — the rule `products.promo_end` already
-- follows. The merchant picks a DATE; `voucherExpiry.ts` resolves it to the last millisecond of
-- that day in `merchants.timezone` before it reaches this column. Stored naively, a merchant's
-- "31 Aug" becomes 00:00Z, which in Asia/Kuala_Lumpur kills the voucher at 8am on the day they
-- thought it ran.
--
-- `min_order` is compared against the SUBTOTAL, before any discount — not subtotal + shipping,
-- which is what a percent voucher discounts against. With shipping in the base an East Malaysia
-- customer qualifies at a lower food spend than a West Malaysia one, and on a distance-priced shop
-- the threshold moves street by street. A merchant who types 50 means food.
alter table public.vouchers
  add column if not exists per_customer_limit int default 1,
  add column if not exists expires_at timestamptz,
  add column if not exists min_order numeric;

-- Both caps NULL is an unlimited discount for one person — #72 reached through the dashboard
-- instead of the request body. At least one side must be bounded. Stated here as well as in the
-- create endpoint because this one cannot be forgotten by a later caller.
alter table public.vouchers drop constraint if exists vouchers_bounded;
alter table public.vouchers
  add constraint vouchers_bounded
  check (max_uses is not null or per_customer_limit is not null);

alter table public.vouchers drop constraint if exists vouchers_limits_positive;
alter table public.vouchers
  add constraint vouchers_limits_positive
  check (
    (per_customer_limit is null or per_customer_limit >= 1)
    and (min_order is null or min_order >= 0)
  );

-- ── a redemption is a row ────────────────────────────────────────────────────
--
-- `used_by` was a jsonb ARRAY of redeemer keys, read as a SET: a key present meant "this person
-- has redeemed", and `used_by.length` was the total. `per_customer_limit` turns it into a multiset
-- and nothing the shape was getting away with survives that. It is read and rewritten INSIDE the
-- order transaction under the voucher's row lock, and with `per_customer_limit = 3` against a null
-- `max_uses` — now a legal combination — the array has no ceiling at all.
--
-- `order_id` is NULLABLE because backfilled rows have no order, and `redeemed_at` for the same
-- reason: no timestamp exists for a historical entry, and inventing one is a lie. Live redemptions
-- carry both.
--
-- Reached only from `orders.ts` over the direct `db.ts` connection, which authenticates as the
-- database owner and is RLS-exempt. Same posture as `ai_usage` and `releases`: no grants, and RLS
-- on with zero policies as the backstop for a grant reopened by accident.
create table if not exists public.voucher_redemptions (
  id          uuid primary key default gen_random_uuid(),
  voucher_id  uuid not null references public.vouchers (id) on delete cascade,
  -- The redeemer's key: the lowercased email off their VERIFIED JWT, and nothing a request body
  -- can name (#72). Not a foreign key to auth.users — historical rows hold WhatsApp numbers that
  -- match no account, and an account deleted later must not take its redemptions with it.
  customer_key text not null,
  order_id    uuid references public.orders (id) on delete set null,
  redeemed_at timestamptz
);

-- The two questions asked on the checkout path: how many has this person taken, and how many has
-- the code taken. Both are prefixes of this index.
create index if not exists voucher_redemptions_voucher_customer_idx
  on public.voucher_redemptions (voucher_id, customer_key);

alter table public.voucher_redemptions enable row level security;
revoke all on table public.voucher_redemptions from anon, authenticated;

-- ── backfill: verbatim ───────────────────────────────────────────────────────
--
-- One row per array element, WhatsApp keys from historical guest redemptions included, exactly as
-- stored. This migration therefore changes no merchant's numbers at the instant it runs, which is
-- the only backfill that cannot surprise someone mid-campaign. Dropping the non-email keys would
-- have handed every live voucher extra capacity on deploy day, unannounced.
--
-- Guarded on emptiness so a re-run cannot double every count.
insert into public.voucher_redemptions (voucher_id, customer_key)
select v.id, k
from public.vouchers v
cross join lateral jsonb_array_elements_text(
  case when jsonb_typeof(v.used_by) = 'array' then v.used_by else '[]'::jsonb end
) as k
where not exists (select 1 from public.voucher_redemptions);

-- `used_by` is NOT dropped here. `claimVoucher` names it in an UPDATE, so an older backend build
-- still serving traffic would fail every voucher checkout the moment this applies. It stays as a
-- dead column and a later migration removes it — expand, then contract.

-- ── delete becomes deactivate ────────────────────────────────────────────────
--
-- A hard delete would take the redemption history with it, and delete-and-recreate was also how a
-- merchant silently reset `used_by`. The unique constraint becomes PARTIAL so that retiring a code
-- does not reserve its string for ever: recreating it makes a NEW row with a new id, so the old
-- campaign's redemptions stay attached to the old campaign and count against nobody.
--
-- `claimVoucher` and the public lookup both already filter `and active`, so each still matches
-- exactly one row. Consequence: two rows can share a code, and any query on the string alone must
-- say `and active` or get an ambiguous answer.
alter table public.vouchers drop constraint if exists vouchers_merchant_id_code_key;
create unique index if not exists vouchers_merchant_code_active_idx
  on public.vouchers (merchant_id, code) where active;
