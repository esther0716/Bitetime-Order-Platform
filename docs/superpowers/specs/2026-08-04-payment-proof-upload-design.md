# Payment proof upload

## What we are building

The order-placed screen (`Storefront.tsx` success view) already shows the shop's payment QR/bank details/note (#156) when the merchant has any of `payment_qr`, `payment_bank`, `payment_note` set. A customer paying by that QR/transfer has no way to hand the shop proof of payment inside the app today — it happens over WhatsApp or not at all.

This adds an optional image upload right under that block, and a place for the merchant to see it: the existing per-order `OrderDetailSheet` in the dashboard.

Decisions taken during design (see brainstorming transcript):

| Question | Decision |
|---|---|
| Where can the customer upload? | Success screen only. It's ephemeral (component state, not a route) and that's accepted — matches how the QR itself is already shown nowhere else. No guest order-tracking route exists to revisit later (dropped, per `orderTracking`/#CLAUDE.md history). |
| Where does the merchant see it? | `OrderDetailSheet`, alongside status/tracking/note — no separate surface. |
| Does uploading change order state? | No. Pure attachment, no new status, no gating, no filtering. Merchant eyeballs it like they eyeball the WhatsApp number today. |
| Upload path (browser → storage) | Through the backend, not direct-to-Storage. Guest checkout has no auth token to scope an RLS write policy against, and an order id is not a secret — same reasoning that already put order intake itself behind the backend instead of a client-side insert. |
| Bucket visibility | Private. A payment screenshot often shows bank account digits — more sensitive than the shop's own QR (which is meant to be public). Merchant reads it through an authenticated, ownership-checked backend route; nobody else can fetch it by guessing a path. |
| When does the upload UI show? | Same condition as the existing instructions block: `payment_note \|\| payment_bank \|\| payment_qr`. A shop taking manual bank transfer with no QR image still benefits. |
| Required before leaving the screen? | No. Optional, always skippable, no validation gate. |

## Data model

`apps/backend/supabase/migrations/<ts>_orders_payment_proof.sql`:

```sql
alter table public.orders
  add column if not exists payment_proof text;

comment on column public.orders.payment_proof is
  'Storage path in the private `payment-proof` bucket ({merchant_id}/{order_id}), a customer''s
   proof-of-payment screenshot. Never a URL. Read only via the backend
   (GET /api/merchants/:id/orders/:orderId/payment-proof) — the bucket has no public read.';

insert into storage.buckets (id, name, public)
values ('payment-proof', 'payment-proof', false)
on conflict (id) do nothing;

update storage.buckets
set
  file_size_limit = 2097152, -- 2 MiB — MAX_PAYMENT_PROOF_BYTES in store.ts, same ceiling as payment-qr
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'payment-proof';

-- No storage.objects policies: unlike payment-qr and product-images, the browser never talks to
-- this bucket directly in either direction. Only the backend's service-role client (admin) reads
-- and writes it, so RLS on the bucket has nothing to gate.
```

`POST /api/orders` (order intake, `orders.ts`) already inserts the row and returns `{ orderNumber }`; the insert gains `returning id` and the response becomes `{ orderNumber, id }`. `placeOrder()` in `store.ts` and `SuccessState` in `Storefront.tsx` both gain the `orderId`/`id` field so the success screen has something to address the proof endpoint with.

## Backend (`apps/backend/src/app.ts`)

**Upload — unauthenticated, guest-tolerant, same trust model as order intake itself:**

```
POST /api/orders/:orderId/payment-proof
```

- Body is the raw image bytes; `Content-Type` header carries the mime type (no multipart — one file, no other fields).
- Look up the order by id via `db.ts` (`select merchant_id from orders where id = $1`) — RLS-exempt connection, so this is the one spot doing its own tenancy-adjacent check: a 404 for a missing id, same as any other not-found.
- Validate `Content-Type` is one of `image/jpeg|png|webp` and body size ≤ 2 MiB (mirrors `PAYMENT_QR_TYPES`/`MAX_PAYMENT_QR_BYTES`; a sibling `MAX_PAYMENT_PROOF_BYTES`/`PAYMENT_PROOF_TYPES` pair in `store.ts` states the same numbers for the client-side check, exactly like the payment-qr split).
- Upload via `admin.storage.from('payment-proof').upload(`${merchantId}/${orderId}.${ext}`, bytes, { contentType, upsert: true })` — fixed path, so a re-upload replaces rather than accumulates.
- `update orders set payment_proof = $path where id = $orderId` via `db.ts`.
- 200 with no body on success (frontend doesn't need the path back — it never renders the image itself).

**Read — merchant-only, reuses the existing ownership middleware chain:**

```
GET /api/merchants/:id/orders/:orderId/payment-proof
```

- `requireMerchantOwns, requireOwnsChild('orders', 'orderId')` — the exact chain already guarding `PATCH /api/merchants/:id/orders/:orderId`.
- 404 if `child.payment_proof` is null (nothing to fetch).
- Otherwise `admin.storage.from('payment-proof').download(path)`, streamed back as `new Response(buffer, { headers: { 'Content-Type': ... } })` — the same raw-`Response` shape `report.xlsx` already uses, because Hono's `c.body` doesn't accept a Buffer.

## Frontend

**`api.ts`** — a new `apiSendFile(path, file, opts)` alongside the existing `apiGetFile`: POSTs the file's raw bytes with `Content-Type: file.type`, same `Result`/error-handling shape as `apiSend`. No multipart — the backend reads the raw body.

**`store.ts`**:

- `PAYMENT_PROOF_BUCKET`-equivalent constants (`MAX_PAYMENT_PROOF_BYTES = 2 * 1024 * 1024`, `PAYMENT_PROOF_TYPES`) — no `storage.from(...)` calls here, unlike `uploadPaymentQr`, since this bucket is never touched by the browser's Supabase client.
- `uploadPaymentProof(orderId: string, file: File): Promise<Result<void>>` — client-side type/size check (same messages as `uploadPaymentQr`), then `apiSendFile('/api/orders/${orderId}/payment-proof', file)`. No auth — guest path.
- `fetchPaymentProof(merchantId: string, orderId: string): Promise<Result<Blob>>` — `apiGetFile('/api/merchants/${merchantId}/orders/${orderId}/payment-proof', { auth: 'required' })`, unwraps to just the blob (filename unused).

**`Storefront.tsx`**:

- `SuccessState` gains `orderId: string`.
- `placeOrder()`'s result (`result.data`) gains `.id`; carried into `setSuccess({ ..., orderId: result.data.id })`.
- Under the existing payment-instructions block (same `merchant.payment_note || merchant.payment_bank || merchant.payment_qr` guard), a small section: file `<input type="file" accept="image/jpeg,image/png,image/webp">`, on change → client validate → `uploadPaymentProof(success.orderId, file)` → toast + inline "uploaded" state with a "replace" affordance (re-select re-uploads, `upsert:true` on the backend makes that safe). No blocking of the rest of the screen at any point.

**`OrderDetailSheet.tsx`**:

- If `order.payment_proof` is set, a new `Section` ("Payment proof") that lazily calls `fetchPaymentProof(merchantId, order.id)` when the sheet opens (not on every dashboard list render), turns the blob into an object URL with `URL.createObjectURL`, shows it as an `<img>` (natural aspect, same reasoning as the customer-facing QR — these are phone screenshots), and revokes the object URL on close/unmount.

## Out of scope

- No new order status/flag. No filtering "orders awaiting payment verification" in the dashboard.
- No guest order-tracking surface (doesn't exist; not being added here).
- No multi-image upload, no history of past uploads — one image per order, replace-in-place.
- No Telegram/email inclusion of the proof image.
