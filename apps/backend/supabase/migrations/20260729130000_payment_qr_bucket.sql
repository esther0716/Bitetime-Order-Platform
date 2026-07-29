-- Payment QR (#156): the DuitNow QR a shop shows a customer once the order is placed.
--
-- The column already exists — `merchants.payment_qr` has been on the table since the
-- multi-tenant schema (20260627120000) and has never been written by anything. It holds a
-- PATH into the bucket below, not a URL, exactly like `products.image_urls`.
--
-- Public bucket: the storefront's success view is public (a guest orders without an account),
-- so the image has to be world-readable by URL. What a merchant may WRITE is scoped to their
-- own folder by the policy below; what they may PUT IN their own row is scoped by
-- `pickMerchantConfig` (writes.ts), because the backend writes that column through the
-- service role and no policy runs on that connection.
insert into storage.buckets (id, name, public)
values ('payment-qr', 'payment-qr', true)
on conflict (id) do nothing;

-- Same reasoning as 20260727120000 for product images: the browser's checks in store.ts are a
-- UX affordance, not a control — the upload goes straight from the client to Storage with the
-- merchant's own token. These are the numbers store.ts states, and if one changes, change the
-- other. 2 MiB is generous for a QR screenshot and small enough that a public bucket under the
-- platform's own domain cannot be used as free file hosting.
update storage.buckets
set
  file_size_limit = 2097152, -- 2 MiB — MAX_PAYMENT_QR_BYTES in store.ts
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] -- PAYMENT_QR_TYPES
where id = 'payment-qr';

-- Anyone may read (public storefront).
drop policy if exists payment_qr_read_public on storage.objects;
create policy payment_qr_read_public on storage.objects
  for select using (bucket_id = 'payment-qr');

-- A merchant may write only inside their own folder ({merchant_id}/…). Mirrors
-- product_images_write_own; `current_merchant_id()` is the security-definer resolver
-- (20260728130000).
drop policy if exists payment_qr_write_own on storage.objects;
create policy payment_qr_write_own on storage.objects
  for all
  using (
    bucket_id = 'payment-qr'
    and (storage.foldername(name))[1] = public.current_merchant_id()::text
  )
  with check (
    bucket_id = 'payment-qr'
    and (storage.foldername(name))[1] = public.current_merchant_id()::text
  );

comment on column public.merchants.payment_qr is
  'Storage path in the public `payment-qr` bucket ({merchant_id}/{file}), shown on the order-placed screen. Never a URL — resolve it with paymentQrUrl().';
