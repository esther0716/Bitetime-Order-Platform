-- A superadmin impersonating a shop could not upload a product photo or a payment QR.
--
-- `product_images_write_own` (20260703183731) and `payment_qr_write_own` (20260729130000) are the
-- only two policies in this repo that scope a write to one merchant WITHOUT the
-- `or public.is_superadmin()` escape every table policy in 20260627120100_multitenant_rls.sql
-- carries. They gate on `current_merchant_id()`, which answers "the shop the CALLER owns" — and a
-- superadmin owns none, so the helper returns NULL, `(storage.foldername(name))[1] = NULL` is NULL
-- rather than true, and the write is denied with
--   new row violates row-level security policy
--
-- Impersonation is not a corner: `merchant/Dashboard.tsx` renders the whole merchant dashboard for
-- a superadmin under a "Viewing as shop" badge, reached from /admin/merchants. Product photos and
-- the payment QR are the two things on that dashboard the browser still writes DIRECTLY to
-- Storage with its own token — everything else goes through the backend, where `requireMerchantOwns`
-- already admits a superadmin. So these two policies were the only surface where the admin console
-- could see a control and not be able to use it.
--
-- This grants no reach a superadmin does not already have: `is_superadmin()` is the same
-- security-definer predicate that already lets them read and write every merchant's products,
-- vouchers and secrets. It widens WHO may write, never WHERE — the folder check still stands for
-- everyone else, and an owner still cannot touch a stranger's folder.
--
-- The suites missed it for a reason worth naming: tests/rls/product-images-storage.test.ts asserted
-- owner-yes / stranger-no / anon-no, which is the tenancy question. Nobody asked the third role.
-- It now does.

drop policy if exists product_images_write_own on storage.objects;
create policy product_images_write_own on storage.objects
  for all
  using (
    bucket_id = 'product-images'
    and (
      (storage.foldername(name))[1] = public.current_merchant_id()::text
      or public.is_superadmin()
    )
  )
  with check (
    bucket_id = 'product-images'
    and (
      (storage.foldername(name))[1] = public.current_merchant_id()::text
      or public.is_superadmin()
    )
  );

drop policy if exists payment_qr_write_own on storage.objects;
create policy payment_qr_write_own on storage.objects
  for all
  using (
    bucket_id = 'payment-qr'
    and (
      (storage.foldername(name))[1] = public.current_merchant_id()::text
      or public.is_superadmin()
    )
  )
  with check (
    bucket_id = 'payment-qr'
    and (
      (storage.foldername(name))[1] = public.current_merchant_id()::text
      or public.is_superadmin()
    )
  );
