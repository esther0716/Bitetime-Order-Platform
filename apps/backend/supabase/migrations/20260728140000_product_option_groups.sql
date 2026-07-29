-- Menu options (#145): the questions a product asks, and the answers it offers.
--
-- A jsonb COLUMN and not two child tables, which is ADR 0008. The short version, because it is
-- the part a reader of this file will wonder about:
--
--   * An option's `delta` is a price input on BOTH sides of the wire. A `delta numeric` column
--     comes back as a STRING from postgres.js and a NUMBER from PostgREST — the trap
--     `productFromRow` already documents for `price` — and mapping one side and not the other is
--     a refused checkout for every option order, not a rounding gap. Numbers inside jsonb parse
--     as numbers from both drivers, so the trap does not exist here.
--   * A product and its groups then commit in ONE upsert through the endpoint that already
--     exists, with no transaction and no half-saved menu item.
--   * Nothing queries them independently: they are read with their product, written with their
--     product, and never referenced by an order — which snapshots names and the delta CHARGED,
--     precisely so that editing a menu cannot rewrite a receipt.
--
-- WHAT THIS COSTS, stated plainly: no check constraints. `minSelect <= maxSelect`, `delta >= 0`,
-- a non-empty option list and the caps are all enforced in `validateOptionGroups`
-- (packages/shared/src/options.ts), called by the product write endpoint. Postgres will happily
-- store `{"minSelect": 9, "maxSelect": 2}` if that function is wrong. This is a deliberate
-- departure from how `promo_sold` and `merchants_one_fulfilment_method` are held, and it is
-- affordable only because 20260718130000 left the backend as the sole writer.
--
-- Shape (see packages/shared/src/options.ts for the authority):
--   [{ id, name, name_zh?, minSelect, maxSelect|null, maxPerOption|null, active,
--      options: [{ id, name, name_zh?, delta, active }] }]
--
-- `'[]'` is "this product asks nothing", which is every existing row and every shop that never
-- turns the feature on. NOT NULL so no reader has to tell an absent column from an empty one.
alter table public.products
  add column if not exists option_groups jsonb not null default '[]'::jsonb;

-- The one thing Postgres CAN cheaply hold: it is a LIST. Everything inside it is the validator's
-- job, but an object or a scalar here would break every reader at once, and `optionGroupsFromRow`
-- would silently fail closed to "no groups" — a product quietly selling with its questions gone.
alter table public.products
  drop constraint if exists products_option_groups_is_array;
alter table public.products
  add constraint products_option_groups_is_array
  check (jsonb_typeof(option_groups) = 'array');

-- Refresh PostgREST's schema cache so the new column is visible immediately — without this the
-- storefront's product read fails with "Could not find the 'option_groups' column in the schema
-- cache" until the server restarts.
notify pgrst, 'reload schema';
