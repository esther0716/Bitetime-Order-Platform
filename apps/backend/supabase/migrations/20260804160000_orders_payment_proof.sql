-- Payment proof upload: a customer's screenshot of a completed bank transfer, attached to the
-- order they just placed on the order-placed screen, right under the shop's payment QR/bank
-- details (#156's sibling). Optional, no workflow effect — the merchant looks at it in the
-- order-detail sheet the same way they already look at the customer's WhatsApp number.
--
-- Column: a storage PATH into the bucket below, mirroring `merchants.payment_qr`. Never a URL.
alter table public.orders
  add column if not exists payment_proof text;

comment on column public.orders.payment_proof is
  'Storage path in the PRIVATE `payment-proof` bucket ({merchant_id}/{order_id}.{ext}), a
   customer''s proof-of-payment screenshot. Never a URL. Read only through the backend
   (GET /api/merchants/:id/orders/:orderId/payment-proof) — the bucket has no public read policy.';

-- Private, unlike payment-qr: a bank-transfer screenshot often shows account digits, and the
-- shop's own QR (meant to be scanned by anyone) is not the same trust level as a customer's own
-- receipt.
insert into storage.buckets (id, name, public)
values ('payment-proof', 'payment-proof', false)
on conflict (id) do nothing;

update storage.buckets
set
  file_size_limit = 2097152, -- 2 MiB — MAX_PAYMENT_PROOF_BYTES in store.ts, same ceiling as payment-qr
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] -- PAYMENT_PROOF_TYPES
where id = 'payment-proof';

-- Deliberately NO storage.objects policies for this bucket. Unlike payment-qr and product-images,
-- the browser never calls Storage for this bucket in either direction — guest checkout has no
-- token to scope an RLS write against, so the upload goes through the backend's service-role
-- client instead (POST /api/orders/:orderId/payment-proof), which bypasses RLS entirely. With
-- zero policies and `public: false`, anon/authenticated get nothing here by default — proven in
-- tests/rls/payment-proof-storage.test.ts.
