-- `current_merchant_id()` must run as definer, or product photo uploads fail for everyone.
--
-- The helper reads `public.merchants`, and it was SECURITY INVOKER — so its body ran with the
-- caller's privileges. That was fine until 20260718130000 revoked every browser grant on
-- `public.merchants`: since then any call to it from an `authenticated` session dies with
--   ERROR: permission denied for table merchants
--
-- Nothing on the browser's path calls it directly, which is why this stayed hidden — except one:
-- the `product_images_write_own` policy on `storage.objects` (20260703183731). Storage grants were
-- deliberately left alone by the revoke ("those back supabase-js auth/storage calls, which stay
-- browser-side"), and product image upload really is still a direct browser->Storage write
-- (`store.ts -> uploadProductImages`). So the policy still ran, still called this helper, and the
-- helper now hit a table its caller can no longer read. The merchant saw "permission denied for
-- table merchants" on Save changes and could not add a photo to any product.
--
-- Note this is a REFUSAL, not a hole: the policy could not evaluate, so the write was denied. The
-- fix is to let the helper read the row it needs, not to hand the browser back a grant on
-- `merchants` — that would reopen the door 20260718130000 closed.
--
-- Same treatment `is_superadmin()` already got in 20260627120150 for the same class of reason (its
-- read of `profiles` could not run under the caller). The body is safe to run as owner: it takes no
-- arguments, so there is nothing to inject; `search_path` is pinned; and it returns only the id of
-- the shop the caller themselves owns, which the caller already knows.
create or replace function public.current_merchant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.id from public.merchants m where m.owner_id = auth.uid() limit 1;
$$;
