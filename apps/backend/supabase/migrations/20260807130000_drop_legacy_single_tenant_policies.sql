-- Removes ten pre-pivot RLS policies that exist ONLY on production. They were created through
-- the Supabase dashboard during the single-tenant era, so they were never captured in a
-- migration file — which is why every `drop policy` in this repo's history misses them: those
-- target the snake_case names this repo generates (`profiles_select_public`, `orders_insert_any`,
-- `settings_select_public`), never these human-typed ones.
--
-- Surfaced on 2026-08-07 by an accidental `supabase db pull` against the linked project
-- (history row 20260806135105 `remote_schema`, since reverted): the generated diff listed them
-- as present on remote and absent from the local migrations. Every statement here is therefore a
-- no-op locally and the real work on production. `if exists` is what makes it safe both ways.
--
-- They are currently UNREACHABLE, not exploitable: 20260718130000_revoke_all_browser_grants.sql
-- left anon and authenticated with zero grants on every public table, and Postgres checks
-- table-level privilege before RLS. The same pull confirmed it — migra emitted no anon /
-- authenticated grant statements at all, so production's browser grants already match local's.
--
-- What they break is the BACKSTOP. 20260718130000's own comment keeps RLS in place as "the belt
-- for anything that ever reopens a grant by accident", and CLAUDE.md -> Backend leans on the same
-- promise. On production that belt is cut, because these three are permissive policies that OR
-- with the correct ones:
--
--   "authenticated users can insert orders"  for insert to authenticated  with check (true)
--   "Owner can read all profiles"            for select to public         using (true)
--   "anyone authenticated can upsert settings"  for all to authenticated  using/with check (true)
--
-- Restore a single grant and that is cross-tenant order insertion, every saved delivery address
-- and phone number readable by anon, and an open door on `settings`. `tests/rls` cannot catch it:
-- those suites run against a local database built from these migration files, which has never
-- held any of these policies. A green RLS suite is evidence about local, not about production.
--
-- `"Owner can read all orders"` / `"Owner can update orders"` additionally hardcode
-- bitetimeandco@gmail.com, which is not even the transitional superadmin address
-- (bitetime@praxor.dev, see CLAUDE.md -> Auth & roles).

-- Superseded by orders_insert_guest_or_customer / orders_select_scoped / orders_update_merchant
-- (20260714100000_orders_backend_intake.sql and 20260627120100_multitenant_rls.sql).
drop policy if exists "Allow guest orders" on public.orders;
drop policy if exists "Owner can read all orders" on public.orders;
drop policy if exists "Owner can update orders" on public.orders;
drop policy if exists "authenticated users can insert orders" on public.orders;
drop policy if exists "users can read own orders" on public.orders;

-- Superseded by profiles_select_self_or_super / profiles_update_self_or_owner
-- (20260626120000_init_schema.sql).
drop policy if exists "Owner can read all profiles" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;

-- `settings` is the dead single-tenant key/value table — no merchant_id column, read by nothing
-- in apps/backend/src or apps/frontend/src, all browser grants revoked. Its remaining policies
-- guard nothing and only make the table look live. See CLAUDE.md -> Data layer.
drop policy if exists "Public read settings" on public.settings;
drop policy if exists "anyone authenticated can upsert settings" on public.settings;
drop policy if exists "anyone can read settings" on public.settings;
