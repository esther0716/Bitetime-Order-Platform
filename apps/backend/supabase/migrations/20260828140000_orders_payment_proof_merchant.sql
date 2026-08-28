-- The MERCHANT's own copy of a payment receipt, beside the customer's (`orders.payment_proof`,
-- 20260804160000). A customer who pays by transfer often closes the browser before uploading
-- anything and sends the slip over WhatsApp instead — the shop then has the only copy, and had
-- nowhere in the app to put it.
--
-- A SECOND column, not a shared one: overwriting `payment_proof` would let the shop replace what
-- the customer themselves attached, and the two answer different questions ("what the customer
-- sent" versus "what the shop filed"). Both slots are optional and independent.
--
-- Same private `payment-proof` bucket (its size limit and mime list already apply), a distinct
-- object name so neither upload can clobber the other.
alter table public.orders
  add column if not exists payment_proof_merchant text;

comment on column public.orders.payment_proof_merchant is
  'Storage path in the PRIVATE `payment-proof` bucket ({merchant_id}/{order_id}-merchant.{ext}),
   a receipt the SHOP filed for this order (the customer sent it outside the app). Never a URL.
   Written and read only through the backend
   (POST/GET /api/merchants/:id/orders/:orderId/merchant-payment-proof) — the bucket has no
   policies for the browser at all.';
