-- Shop customers (#143). See CONTEXT.md -> "Shop customer" and
-- docs/adr/0007-shop-customers-are-keyed-by-phone.md.
--
-- Two independent pieces:
--   1. orders.customer_phone_key — the identity, stamped at intake, so a shop's customers can
--      be grouped in SQL without shipping the order table anywhere.
--   2. shop_customers — what the MERCHANT wrote. Behaviour is never copied here; orders stay
--      the sole record of what happened, so there is no counter that can drift.

-- ── 1. The identity, on the order ────────────────────────────────────────────
--
-- Written by the backend in TypeScript, from phoneKey() — the SAME function guest order
-- tracking matches on. Deliberately NOT a generated column: a generated column would restate
-- the last-eight rule in SQL, and two copies of one rule must then agree forever. This is a
-- value on a row already being inserted, so intake gains no lock and no failure mode.
--
-- NULL means the order carried no usable number. It is NOT a customer — see the backfill note.
alter table orders
  add column if not exists customer_phone_key text;

comment on column orders.customer_phone_key is
  'Last 8 digits of customer_wa, stamped by the backend''s phoneKey(). Identifies a shop customer within a merchant. NULL = the order identifies nobody and is excluded from the customer list (and counted separately).';

-- Tenant first: every read of this column is already scoped to one shop, and the customer
-- grouping is the only thing that reads it.
create index if not exists orders_merchant_phone_key_idx
  on orders (merchant_id, customer_phone_key);

-- The backfill, and the ONE place this rule is expressed in SQL — once, here, never again.
-- It must agree with phoneKey() exactly:
--   * strip every non-digit                     -> regexp_replace(..., '\D', '', 'g')
--   * take the last eight (or all, if fewer)    -> right(digits, 8)   [matches JS slice(-8)]
--   * no digits at all is NULL, never ''        -> nullif(..., '')
-- That last line is the whole point: '' as a key would let every phone-less order collapse
-- onto one row, which is exactly the fake `—` customer this feature removes.
update orders
   set customer_phone_key = nullif(right(regexp_replace(coalesce(customer_wa, ''), '\D', '', 'g'), 8), '')
 where customer_phone_key is null;

-- ── 2. What the merchant wrote ───────────────────────────────────────────────
--
-- Created LAZILY, on a merchant's first note or tag — most shop customers never have a row.
-- Holds opinions only: no order count, no spend, no last-order date. Those are derived from
-- `orders` on every read, so they cannot go stale.
create table if not exists shop_customers (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants (id) on delete cascade,
  -- Not a foreign key to anything: a shop customer is not a row elsewhere, it is a fold over
  -- orders. A key with no orders behind it is harmless — it simply never joins.
  phone_key   text not null,
  note        text,
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- One row per person per shop. This is the tenancy boundary AND the identity rule, stated
  -- as a constraint: shop A and shop B writing about the same phone are two separate rows,
  -- and neither can see the other.
  constraint shop_customers_merchant_phone_key unique (merchant_id, phone_key)
);

comment on table shop_customers is
  'Merchant-authored notes and tags about one person who orders from one shop. Shop-private: never shown to the customer, never visible to another merchant. Behaviour (order counts, spend, recency) is NOT stored here — it is derived from orders.';

-- RLS on and NO browser grants, matching every other table since
-- 20260718130000_revoke_all_browser_grants.sql: reads and writes go through the backend, which
-- enforces tenancy with requireMerchantOwns. Postgres checks table privileges before RLS, so
-- the absent grant is what actually closes the door; the policy below is the belt for anything
-- that ever reopens a grant by accident.
alter table shop_customers enable row level security;

revoke all on shop_customers from anon, authenticated;

-- Stated explicitly rather than inherited. A table created by a migration does NOT pick up the
-- DML grants every other table here holds for service_role — it lands with the structural
-- privileges only (TRUNCATE/REFERENCES/TRIGGER), which is enough to look correct in a schema
-- dump and not enough to read a row. The backend's own path goes through db.ts (the owner
-- connection, grant-exempt) so it works either way; anything reaching this table through
-- PostgREST — the service-role client, and the DB test suites — gets a bare 42501 instead.
grant select, insert, update, delete on shop_customers to service_role;

drop policy if exists shop_customers_owner_or_super on shop_customers;
create policy shop_customers_owner_or_super on shop_customers
  for all
  using (
    exists (select 1 from merchants m where m.id = shop_customers.merchant_id and m.owner_id = auth.uid())
    or public.is_superadmin()
  )
  with check (
    exists (select 1 from merchants m where m.id = shop_customers.merchant_id and m.owner_id = auth.uid())
    or public.is_superadmin()
  );
