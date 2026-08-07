-- Menu categories: the sections a merchant arranges their own menu into.
--
-- A jsonb COLUMN ON THE MERCHANT ROW and not a `product_categories` table, which is ADR 0013.
-- The short version, because it is what a reader of this file will wonder about:
--
--   * `MerchantProvider` already fetches the whole merchant row before any storefront renders,
--     and `ProductsManager` holds the same row. A list stored here is ALREADY LOADED on both
--     surfaces; a table costs a public read endpoint, three authenticated write endpoints, an
--     RLS policy set with its isolation suite, a `requireOwnsChild` guard, a second storefront
--     fetch, and a reorder that writes N rows and so wants a transaction.
--   * The table's headline benefit — `on delete set null`, so no product points at a category
--     that is gone — buys tidiness rather than safety HERE. A category is decoration: a product
--     whose category vanished is still priced, still in stock, still sellable. The honest
--     reading of a dangling id is "uncategorized", which the model needs anyway for every
--     product a merchant has not filed and every shop that never opens the feature.
--   * ADR 0008's three reasons for putting option groups in jsonb do NOT transfer, and this is
--     decided on its own bill — see the ADR before citing 0008 either way.
--
-- WHAT THIS COSTS, stated plainly: no check constraints. The cap of 20, the 1–40 character name,
-- and uniqueness on a folded name are all enforced in `validateMenuCategories`
-- (packages/shared/src/menuCategories.ts), called by the write endpoints. Postgres will happily
-- store two categories called "Cakes" if that function is wrong. Same deliberate departure as
-- 20260728140000, affordable for the same one reason: 20260718130000 left the backend the sole
-- writer.
--
-- Shape (see packages/shared/src/menuCategories.ts for the authority):
--   [{ id, name, name_zh?, active }]
--
-- ARRAY ORDER IS DISPLAY ORDER — no `sort` column and no tie-break, as with option groups.
--
-- `'[]'` is "this shop arranges nothing", which is every existing row. NOT NULL so no reader has
-- to tell an absent column from an empty one.
alter table public.merchants
  add column if not exists product_categories jsonb not null default '[]'::jsonb;

-- The one thing Postgres CAN cheaply hold: it is a LIST. Everything inside it is the validator's
-- job, but an object or a scalar here would break every reader at once and the storefront would
-- fail closed to "no categories" — a shop's menu structure quietly gone.
alter table public.merchants
  drop constraint if exists merchants_product_categories_is_array;
alter table public.merchants
  add constraint merchants_product_categories_is_array
  check (jsonb_typeof(product_categories) = 'array');

-- Which section a product sits in. Deliberately NOT a foreign key — there is no table to point
-- at, and the dangling case is the load-bearing one: deleting a category rewrites nothing, and
-- an id the shop's list no longer holds reads as uncategorized. NULL is the same state, which is
-- why no default and no NOT NULL: "never filed" and "filed into something since deleted" must be
-- indistinguishable to every reader.
alter table public.products
  add column if not exists category_id text;

-- Refresh PostgREST's schema cache so the new columns are visible immediately — without this the
-- storefront's merchant read fails with "Could not find the 'product_categories' column in the
-- schema cache" until the server restarts.
notify pgrst, 'reload schema';
