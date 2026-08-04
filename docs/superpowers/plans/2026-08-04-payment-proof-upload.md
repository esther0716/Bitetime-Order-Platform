# Payment Proof Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer attach a proof-of-payment screenshot to the order they just placed, right under the shop's payment QR/bank details on the order-placed screen, and let the merchant see it in the existing per-order detail sheet.

**Architecture:** A new `orders.payment_proof` column (a storage path) and a private `payment-proof` Supabase Storage bucket that the browser never touches directly — unlike the existing `payment-qr`/`product-images` buckets, both the upload and the read go through the backend's service-role client, because guest checkout has no auth token to scope an RLS write policy against and a payment screenshot is more sensitive than the shop's own public QR. One new unauthenticated `POST /api/orders/:orderId/payment-proof` (mirrors `POST /api/orders` itself — same trust model) and one new authenticated `GET /api/merchants/:id/orders/:orderId/payment-proof` (reuses the existing `requireMerchantOwns` + `requireOwnsChild('orders', …)` chain the sibling PATCH route already uses).

**Tech Stack:** Postgres + Supabase Storage (migration), Hono + `@supabase/supabase-js` (service role) + `postgres.js` on the backend, React 19 + TypeScript + the `Result`-convention `api.ts`/`store.ts` seam on the frontend, Vitest (`tests/rls`, `tests/api`, and frontend unit tests) — no component tests, per this repo's UI-is-verified-by-running-the-app rule.

**Design doc:** `docs/superpowers/specs/2026-08-04-payment-proof-upload-design.md` — read it for the "why" behind every decision below; this plan only restates what's needed to build each task.

## Global Constraints

- Every user-visible string is `t(english, chinese)` — `t` comes from `useSession()`. No i18n library.
- Backend relative imports keep `.js` specifiers that resolve to `.ts` source. Leave them as `.js`.
- Never run `pnpm --filter @bitetime/backend db:push` or any `supabase` command that reaches production. Local migration only (`db:migrate`); a human pushes.
- `pnpm --filter @bitetime/backend test:db` needs a running local Supabase (`supabase start` from `apps/backend`). It reads its own keys from `supabase status`.
- Never mock the database or Storage in `tests/api` or `tests/rls`. Those suites exist to prove properties of the real thing.
- Bucket name is exactly `payment-proof`. Column name is exactly `orders.payment_proof`. Both new routes' paths are exactly as given above — the frontend tasks depend on these exact strings.
- 2 MiB / `image/jpeg|png|webp` is the ceiling on both sides (client check in `store.ts`, bucket config in the migration) — the same numbers `payment-qr` already uses, restated, not reused, because the two buckets are unrelated.
- No new order status, no gating, no required upload. Pure attachment.

---

## File Structure

**Create:**
- `apps/backend/supabase/migrations/20260804160000_orders_payment_proof.sql` — column + private bucket.
- `apps/backend/tests/rls/payment-proof-storage.test.ts` — proves the bucket is unreachable from any browser client.
- `apps/backend/tests/api/payment-proof.test.ts` — the new upload/read routes.
- `apps/frontend/src/store/PaymentProofUpload.tsx` — the small upload widget shown under the payment-instructions block.

**Modify:**
- `apps/backend/src/orders.ts` — `placeOrder` returns `id` alongside `orderNumber` (:123, :287-330); two new small exports, `orderMerchantId` and `setOrderPaymentProof`.
- `apps/backend/src/app.ts` — new import from `./orders.js`; two new routes (near :779 and near :1647).
- `apps/backend/tests/api/orders.test.ts` — four `toEqual({ orderNumber })` assertions become `toEqual({ orderNumber, id: expect.any(String) })` (:273, :296-297, :727).
- `apps/frontend/src/api.ts` — new `apiSendFile`, alongside the existing `apiGetFile`.
- `apps/frontend/src/api.test.ts` — tests for it.
- `apps/frontend/src/store.ts` — `placeOrder`'s return type gains `id`; new `MAX_PAYMENT_PROOF_BYTES`, `PAYMENT_PROOF_TYPES`, `uploadPaymentProof`, `fetchPaymentProof`.
- `apps/frontend/src/store.test.ts` — `placeOrder` test updated for `id`; new tests for `uploadPaymentProof`/`fetchPaymentProof`.
- `apps/frontend/src/types.ts` — `Order.payment_proof?: string | null` (:167).
- `apps/frontend/src/store/Storefront.tsx` — `SuccessState.orderId` (:70-92), threaded from `placeOrder`'s result (:754-761), and `<PaymentProofUpload>` rendered under the QR block (:897-919).
- `apps/frontend/src/merchant/OrderDetailSheet.tsx` — a lazily-fetched proof-image section.

---

### Task 1: Schema — `orders.payment_proof` and the private `payment-proof` bucket

**Files:**
- Create: `apps/backend/supabase/migrations/20260804160000_orders_payment_proof.sql`
- Create: `apps/backend/tests/rls/payment-proof-storage.test.ts`

**Interfaces:**
- Produces: `orders.payment_proof text` (nullable). Storage bucket `payment-proof` (private, 2 MiB, `image/jpeg|png|webp`), with **no** `storage.objects` policies — every later backend task reads/writes it only through the service-role `admin` client.

- [ ] **Step 1: Write the migration**

Create `apps/backend/supabase/migrations/20260804160000_orders_payment_proof.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration locally**

```bash
cd apps/backend
pnpm db:migrate
```

Expected: applies with no error. (If it refuses because local migration history holds a version whose file is gone — a leftover from switching branches on the shared local Supabase — repair that version explicitly against local, per CLAUDE.md; do not use `db reset` without asking.)

- [ ] **Step 3: Confirm the column and bucket exist**

```bash
supabase status -o env | grep DB_URL
```

Take the port from that line (55322 here, not the 54322 default) and run:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -c \
  "select column_name from information_schema.columns where table_name = 'orders' and column_name = 'payment_proof';"
psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -c \
  "select id, public, file_size_limit from storage.buckets where id = 'payment-proof';"
```

Expected: one row naming `payment_proof`; one bucket row with `public = f` and `file_size_limit = 2097152`.

- [ ] **Step 4: Write the RLS smoke test**

Create `apps/backend/tests/rls/payment-proof-storage.test.ts`:

```typescript
// tests/rls/payment-proof-storage.test.ts
// The `payment-proof` bucket is deliberately given NO storage.objects policies
// (20260804160000) — every read and write goes through the backend's service-role client
// instead (POST /api/orders/:orderId/payment-proof, GET /api/merchants/:id/orders/:orderId/
// payment-proof). This is the proof that "no policy" really does mean "no access" for the
// browser's own Supabase client, not an assumption: a future migration that accidentally flips
// the bucket `public` or adds a permissive policy is only ever caught here, since — unlike
// product-images-storage.test.ts's bucket — no app surface exercises this one directly.
import { describe, it, expect } from 'vitest'
import { anonClient, makeUser, seedMerchant, serviceClient } from './helpers.js'

const BUCKET = 'payment-proof'

// Smallest valid PNG (1x1) — the bucket enforces allowed_mime_types, so the upload has to be a
// real image/png or Storage would refuse it for a reason that has nothing to do with the policy
// under test.
const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)
function png() {
  return new Blob([PNG_1X1], { type: 'image/png' })
}

describe('payment-proof storage: no browser access either way', () => {
  it('denies an anonymous upload', async () => {
    const { error } = await anonClient()
      .storage.from(BUCKET)
      .upload('anon/anon.png', png(), { contentType: 'image/png' })
    expect(error).not.toBeNull()
  })

  it('denies a merchant owner uploading, even into what would be their own folder', async () => {
    const owner = await makeUser('payment-proof-owner@example.com', 'password123')
    const { data: session } = await owner.auth.getSession()
    const merchantId = await seedMerchant({ slug: 'payment-proof-shop', owner_id: session.session!.user.id })

    const { error } = await owner.storage
      .from(BUCKET)
      .upload(`${merchantId}/own.png`, png(), { contentType: 'image/png' })
    expect(error).not.toBeNull()
  })

  it('denies an anonymous read', async () => {
    // Written directly by the service role, exactly as the backend does after a real upload.
    const path = 'seed/read-check.png'
    await serviceClient().storage.from(BUCKET).upload(path, png(), { contentType: 'image/png', upsert: true })

    const { error } = await anonClient().storage.from(BUCKET).download(path)
    expect(error).not.toBeNull()

    await serviceClient().storage.from(BUCKET).remove([path])
  })
})
```

- [ ] **Step 5: Run it**

```bash
pnpm --filter @bitetime/backend test:db -- payment-proof-storage
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/supabase/migrations/20260804160000_orders_payment_proof.sql apps/backend/tests/rls/payment-proof-storage.test.ts
git commit -m "feat(backend): add orders.payment_proof column and private payment-proof bucket"
```

---

### Task 2: Thread the order id through `POST /api/orders`

The upload endpoint (Task 3) needs something to address the order by. `SuccessState` on the frontend (Task 8) only has `orderNumber` today, and the order's UUID is the natural, already-unique key — so `placeOrder` starts returning it.

**Files:**
- Modify: `apps/backend/src/orders.ts:123,287-330`
- Modify: `apps/backend/tests/api/orders.test.ts:273,296-297,727`

**Interfaces:**
- Produces: `placeOrder(...): Promise<{ orderNumber: string; id: string }>`. Task 3's route and Task 6's frontend `placeOrder` both consume the `id` this adds.

- [ ] **Step 1: Update the failing tests first**

In `apps/backend/tests/api/orders.test.ts`, change the three exact-shape assertions:

```typescript
// :273
    expect(await res.json()).toEqual({ orderNumber: `OR-${DAY}-0050`, id: expect.any(String) })
```

```typescript
// :296-297
    expect(await first.json()).toEqual({ orderNumber: `OR-${DAY}-0050`, id: expect.any(String) })
    expect(await second.json()).toEqual({ orderNumber: `OR-${DAY}-0051`, id: expect.any(String) })
```

```typescript
// :727
    expect(await retry.json()).toEqual({ orderNumber: `OR-${DAY}-0050`, id: expect.any(String) })
```

- [ ] **Step 2: Run the suite to see it fail**

```bash
pnpm --filter @bitetime/backend test:db -- orders.test
```

Expected: those 4 assertions FAIL (actual has no `id` key yet). Everything else in the file still passes.

- [ ] **Step 3: Make `placeOrder` return the id**

In `apps/backend/src/orders.ts`, change the return type at line 123:

```typescript
): Promise<{ orderNumber: string; id: string }> {
```

Change the insert (lines 287-327) to capture the returned id — add `returning id` and capture the row:

```typescript
    const [{ id }] = await tx<{ id: string }[]>`
      insert into orders (
        merchant_id, user_id, customer_name, customer_wa, customer_phone_key, mode, address,
        shipping_fee, items, total, currency, discount, tax, tax_rate, voucher_code, fulfil_date, order_number, status,
        delivery_distance_km, delivery_base_fee, delivery_rate_per_km
      ) values (
        ${input.merchantId},
        ${input.userId},
        ${input.customerName},
        ${input.customerWa},
        ${phoneKey(input.customerWa)},
        ${input.mode},
        ${tx.json((input.address ?? null) as never)},
        ${bd.shipping},
        ${tx.json(items as never)},
        ${bd.total},
        ${merchant.currency},
        ${discount},
        ${bd.tax},
        ${bd.taxRate},
        ${discount ? (input.voucherCode ?? null) : null},
        ${input.fulfilDate},
        ${orderNumber},
        'new',
        ${distanceKm},
        ${distanceBase},
        ${distanceRate}
      )
      returning id
    `
```

(Only the wrapping `await tx\`` → `const [{ id }] = await tx<{ id: string }[]>\`` and the trailing `returning id` are new — every value in the `values (...)` list, and every comment attached to them, stays exactly as it was.)

And change line 329:

```typescript
    return { orderNumber, id }
```

- [ ] **Step 4: Run the suite again**

```bash
pnpm --filter @bitetime/backend test:db -- orders.test
```

Expected: all pass, including the 4 updated assertions.

- [ ] **Step 5: Run the full db suite to catch anything else that reads this response shape**

```bash
pnpm --filter @bitetime/backend test:db
```

Expected: all pass. (`app.ts`'s `POST /api/orders` handler does `return c.json(result)` — no change needed there, it already forwards whatever `placeOrder` returns.)

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/orders.ts apps/backend/tests/api/orders.test.ts
git commit -m "feat(backend): return the order id from POST /api/orders"
```

---

### Task 3: `POST /api/orders/:orderId/payment-proof` — the upload route

Unauthenticated, exactly like `POST /api/orders` itself — guest checkout has no token, and an order id is not a secret a client-side policy could gate on either, so this goes through the backend's service-role client the same way order intake already does.

**Files:**
- Modify: `apps/backend/src/orders.ts` — add `orderMerchantId` and `setOrderPaymentProof`.
- Modify: `apps/backend/src/app.ts` — import them; add the route.
- Create: `apps/backend/tests/api/payment-proof.test.ts`

**Interfaces:**
- Consumes: `sql` from `./db.js` (already imported in `orders.ts`).
- Produces: `orderMerchantId(orderId: string): Promise<string | null>` and `setOrderPaymentProof(orderId: string, path: string): Promise<void>`, both exported from `orders.ts`. Task 4's GET route does not use these (it reads `payment_proof` off the row `requireOwnsChild` already loaded), but Task 3's route depends on both.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/api/payment-proof.test.ts`:

```typescript
// tests/api/payment-proof.test.ts
// POST /api/orders/:orderId/payment-proof — unauthenticated, exactly like POST /api/orders
// itself. Driven in-process against real Postgres + real Storage: `admin.storage` is not
// mockable here without also faking the property (a real upload landing in the bucket) this
// suite exists to prove.
import { describe, it, expect, afterAll } from 'vitest'
import { app } from '../../src/app.js'
import { serviceClient, resetMerchant, seedMerchant, makeUser } from '../rls/helpers.js'

const BUCKET = 'payment-proof'

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

// `merchants.owner_id` is UNIQUE and NOT NULL — the POST route itself needs no owner (it's
// unauthenticated), but seeding a valid shop row does. Each shop gets its own throwaway user.
let ownerCounter = 0
async function shopWithOwner(slug: string): Promise<string> {
  await resetMerchant(slug)
  ownerCounter += 1
  const owner = await makeUser(`payment-proof-${ownerCounter}@example.com`, 'password123')
  const { data: session } = await owner.auth.getSession()
  return seedMerchant({ slug, owner_id: session.session!.user.id })
}

async function seedOrder(merchantId: string) {
  const { data, error } = await serviceClient()
    .from('orders')
    .insert({
      merchant_id: merchantId,
      order_number: `PP-${crypto.randomUUID().slice(0, 8)}`,
      status: 'new',
      customer_name: 'Ah Meng',
      customer_wa: '60123456789',
    })
    .select('id')
    .single()
  if (error) throw new Error(`seeding order: ${error.message}`)
  return data!.id as string
}

function post(orderId: string, body: Uint8Array | string, contentType: string) {
  return app.request(`/api/orders/${orderId}/payment-proof`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  })
}

const written: string[] = []
afterAll(async () => {
  if (written.length) await serviceClient().storage.from(BUCKET).remove(written)
})

describe('POST /api/orders/:orderId/payment-proof', () => {
  it('uploads the image, stores it under {merchant_id}/{order_id}.png, and stamps the order row', async () => {
    const merchantId = await shopWithOwner('pp-shop')
    const orderId = await seedOrder(merchantId)
    written.push(`${merchantId}/${orderId}.png`)

    const res = await post(orderId, PNG_1X1, 'image/png')
    expect(res.status).toBe(200)

    const { data: order } = await serviceClient().from('orders').select('payment_proof').eq('id', orderId).single()
    expect(order!.payment_proof).toBe(`${merchantId}/${orderId}.png`)

    const { data: file, error } = await serviceClient().storage.from(BUCKET).download(order!.payment_proof)
    expect(error).toBeNull()
    expect(file!.size).toBe(PNG_1X1.byteLength)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('a second upload replaces the first (upsert), not accumulates', async () => {
    const merchantId = await shopWithOwner('pp-replace-shop')
    const orderId = await seedOrder(merchantId)
    written.push(`${merchantId}/${orderId}.png`)

    await post(orderId, PNG_1X1, 'image/png')
    const SECOND = Uint8Array.from([...PNG_1X1, 0, 0, 0, 0])
    const res = await post(orderId, SECOND, 'image/png')
    expect(res.status).toBe(200)

    const { data: order } = await serviceClient().from('orders').select('payment_proof').eq('id', orderId).single()
    const { data: file } = await serviceClient().storage.from(BUCKET).download(order!.payment_proof)
    expect(file!.size).toBe(SECOND.byteLength)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('400s on an unsupported content type and writes nothing', async () => {
    const merchantId = await shopWithOwner('pp-badtype-shop')
    const orderId = await seedOrder(merchantId)

    const res = await post(orderId, 'not an image', 'application/pdf')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('unsupported_type')

    const { data: order } = await serviceClient().from('orders').select('payment_proof').eq('id', orderId).single()
    expect(order!.payment_proof).toBeNull()

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('400s on a body over 2 MiB', async () => {
    const merchantId = await shopWithOwner('pp-toobig-shop')
    const orderId = await seedOrder(merchantId)

    const big = new Uint8Array(2 * 1024 * 1024 + 1)
    const res = await post(orderId, big, 'image/png')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('too_large')

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('404s for an order id that does not exist', async () => {
    const res = await post('00000000-0000-0000-0000-000000000000', PNG_1X1, 'image/png')
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

```bash
pnpm --filter @bitetime/backend test:db -- payment-proof.test
```

Expected: FAIL — the route does not exist yet (404s or errors on every case, including the one already expecting 404 for the wrong reason).

- [ ] **Step 3: Add `orderMerchantId` and `setOrderPaymentProof` to `orders.ts`**

Add near the bottom of `apps/backend/src/orders.ts` (after `placeOrder`'s closing brace):

```typescript
/**
 * The shop an order belongs to — the one thing the payment-proof upload needs before it can
 * accept a file, and the one thing it must never take from the caller. An order id names its
 * own shop; a client-supplied merchantId would let anyone attach a proof image into any shop's
 * folder. `null` for a missing OR malformed id — the caller only ever needs to know "not found",
 * and a hand-typed id in the URL is the same failure as a real one that was never placed.
 */
export async function orderMerchantId(orderId: string): Promise<string | null> {
  try {
    const rows = await sql<{ merchant_id: string }[]>`
      select merchant_id from orders where id = ${orderId}
    `
    return rows[0]?.merchant_id ?? null
  } catch {
    return null
  }
}

/** Stamps the storage path onto the order row. No return value — the caller already knows the path. */
export async function setOrderPaymentProof(orderId: string, path: string): Promise<void> {
  await sql`update orders set payment_proof = ${path} where id = ${orderId}`
}
```

- [ ] **Step 4: Add the route in `app.ts`**

Extend the existing import from `./orders.js` (currently `import { placeOrder, OrderError } from './orders.js'`):

```typescript
import { placeOrder, OrderError, orderMerchantId, setOrderPaymentProof } from './orders.js'
```

Add, right after the `POST /api/orders` handler's closing `})` (immediately before the `notifyDeps` declaration):

```typescript
// ── Payment proof — the customer's own screenshot of a completed transfer ─────────────────────
// Unauthenticated, exactly like POST /api/orders itself: guest checkout has no token to scope an
// RLS write against, and an order id is not a secret a client-side policy could gate on either —
// so this goes through the service-role client, the same shape order intake already uses. See
// docs/superpowers/specs/2026-08-04-payment-proof-upload-design.md.
const PAYMENT_PROOF_BUCKET = 'payment-proof'
const MAX_PAYMENT_PROOF_BYTES = 2 * 1024 * 1024
const PAYMENT_PROOF_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

app.post('/api/orders/:orderId/payment-proof', async (c) => {
  const orderId = c.req.param('orderId')
  const contentType = c.req.header('Content-Type') ?? ''
  const ext = PAYMENT_PROOF_EXT[contentType]
  if (!ext) return c.json({ error: 'unsupported_type' }, 400)

  const buffer = await c.req.arrayBuffer()
  if (buffer.byteLength === 0) return c.json({ error: 'invalid_body' }, 400)
  if (buffer.byteLength > MAX_PAYMENT_PROOF_BYTES) return c.json({ error: 'too_large' }, 400)

  const merchantId = await orderMerchantId(orderId)
  if (!merchantId) return c.json({ error: 'not_found' }, 404)

  const path = `${merchantId}/${orderId}.${ext}`
  const { error } = await admin.storage
    .from(PAYMENT_PROOF_BUCKET)
    .upload(path, buffer, { contentType, upsert: true })
  if (error) {
    console.error('Payment proof upload failed:', error.message)
    return c.json({ error: 'upload_failed' }, 500)
  }

  await setOrderPaymentProof(orderId, path)
  return c.json({ ok: true })
})
```

- [ ] **Step 5: Run the test**

```bash
pnpm --filter @bitetime/backend test:db -- payment-proof.test
```

Expected: 5 passed. (The 404 case now passes for the right reason.)

- [ ] **Step 6: Run the full db suite**

```bash
pnpm --filter @bitetime/backend test:db
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/orders.ts apps/backend/src/app.ts apps/backend/tests/api/payment-proof.test.ts
git commit -m "feat(backend): add POST /api/orders/:orderId/payment-proof"
```

---

### Task 4: `GET /api/merchants/:id/orders/:orderId/payment-proof` — the merchant read route

Reuses the exact `requireMerchantOwns` + `requireOwnsChild('orders', 'orderId')` chain the sibling `PATCH /api/merchants/:id/orders/:orderId` route already uses — so 401/403/cross-tenant-404 are already exhaustively proven for that chain in `tests/api/writes-orders.test.ts`; this task's tests cover only what's new: streaming the image back, and 404 when there's nothing to stream.

**Files:**
- Modify: `apps/backend/src/app.ts`
- Modify: `apps/backend/tests/api/payment-proof.test.ts`

**Interfaces:**
- Consumes: `requireMerchantOwns`, `requireOwnsChild` (already imported in `app.ts`), `admin` (already imported).

- [ ] **Step 1: Write the failing tests**

In `apps/backend/tests/api/payment-proof.test.ts`, change the top import line to add `makeUser`:

```typescript
import { serviceClient, resetMerchant, seedMerchant, makeUser } from '../rls/helpers.js'
```

Then append to the same file:

```typescript
async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function get(path: string, token?: string) {
  return app.request(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

describe('GET /api/merchants/:id/orders/:orderId/payment-proof', () => {
  it('streams the image back to the owner after an upload', async () => {
    await resetMerchant('pp-read-shop')
    const owner = await makeUser('pp-read-owner@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'pp-read-shop', owner_id: userId })
    const orderId = await seedOrder(merchantId)
    written.push(`${merchantId}/${orderId}.png`)

    await post(orderId, PNG_1X1, 'image/png')
    const res = await get(`/api/merchants/${merchantId}/orders/${orderId}/payment-proof`, token)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.length).toBe(PNG_1X1.byteLength)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('404s when the order has no proof uploaded', async () => {
    await resetMerchant('pp-none-shop')
    const owner = await makeUser('pp-none-owner@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'pp-none-shop', owner_id: userId })
    const orderId = await seedOrder(merchantId)

    const res = await get(`/api/merchants/${merchantId}/orders/${orderId}/payment-proof`, token)
    expect(res.status).toBe(404)

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })
})
```

- [ ] **Step 2: Run to see it fail**

```bash
pnpm --filter @bitetime/backend test:db -- payment-proof.test
```

Expected: the 2 new tests FAIL (404/500 — route doesn't exist).

- [ ] **Step 3: Add the route**

In `apps/backend/src/app.ts`, right after the `PATCH /api/merchants/:id/orders/:orderId` handler's closing `})`:

```typescript
// The image itself, for the merchant dashboard. Same ownership chain as the PATCH above — see
// its own comment for why requireOwnsChild is what actually proves :orderId belongs to :id, not
// just requireMerchantOwns. `child` here is the order row requireOwnsChild already loaded; no
// second query.
app.get(
  '/api/merchants/:id/orders/:orderId/payment-proof',
  requireMerchantOwns,
  requireOwnsChild('orders', 'orderId'),
  async (c) => {
    const order = c.get('child')
    const path = order?.payment_proof as string | null | undefined
    if (!path) return c.json({ error: 'not_found' }, 404)

    const { data, error } = await admin.storage.from('payment-proof').download(path)
    if (error || !data) return c.json({ error: 'download_failed' }, 500)

    const buffer = await data.arrayBuffer()
    return new Response(buffer, {
      status: 200,
      headers: { 'Content-Type': data.type || 'application/octet-stream' },
    })
  },
)
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @bitetime/backend test:db -- payment-proof.test
```

Expected: 7 passed (5 from Task 3 + 2 new).

- [ ] **Step 5: Run the full db suite and the unit suite**

```bash
pnpm --filter @bitetime/backend test:db
pnpm --filter @bitetime/backend test
pnpm --filter @bitetime/backend typecheck
```

Expected: all pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/app.ts apps/backend/tests/api/payment-proof.test.ts
git commit -m "feat(backend): add GET /api/merchants/:id/orders/:orderId/payment-proof"
```

---

### Task 5: `apiSendFile` — the upload-side twin of `apiGetFile`

**Files:**
- Modify: `apps/frontend/src/api.ts`
- Modify: `apps/frontend/src/api.test.ts`

**Interfaces:**
- Produces: `apiSendFile<T>(path: string, file: File, opts?: Opts): Promise<Result<T>>`. Task 6's `uploadPaymentProof` consumes this.

- [ ] **Step 1: Write the failing tests**

Add to `apps/frontend/src/api.test.ts`, after the `describe('apiSend', ...)` block:

```typescript
describe('apiSendFile', () => {
  function file(bytes = 'x', type = 'image/png') {
    return new File([bytes], 'proof.png', { type })
  }

  it('200 → { ok: true, data }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) }))
    const r = await apiSendFile<{ ok: boolean }>('/x', file())
    expect(r).toEqual({ ok: true, data: { ok: true } })
  })

  it('empty 200 body → { ok: true, data: null }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' }))
    const r = await apiSendFile('/x', file())
    expect(r).toEqual({ ok: true, data: null })
  })

  it('non-2xx → { ok: false, error }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'unsupported_type' }) }))
    const r = await apiSendFile('/x', file())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toBe('unsupported_type')
  })

  it('sends the file as the raw body with its own content-type, no auth header by default', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)
    const f = file('bytes', 'image/webp')
    await apiSendFile('/x', f)
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('image/webp')
    expect(init.headers.Authorization).toBeUndefined()
    expect(init.body).toBe(f)
  })

  it('auth:true attaches the token when a session exists', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)
    await apiSendFile('/x', file(), { auth: true })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
  })

  it('fetch rejection → { ok: false }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')))
    const r = await apiSendFile('/x', file())
    expect(r.ok).toBe(false)
  })
})
```

Add `apiSendFile` to the import at the top of the file: `import { apiGet, apiSend, apiSendFile, unwrap } from './api'`.

- [ ] **Step 2: Run to see it fail**

```bash
pnpm --filter @bitetime/frontend test -- src/api.test.ts
```

Expected: FAIL — `apiSendFile` is not exported.

- [ ] **Step 3: Implement it**

Add to `apps/frontend/src/api.ts`, after `apiGetFile`:

```typescript
/**
 * A POST whose body is a FILE, not JSON — the upload-side twin of `apiGetFile`. No multipart:
 * the body IS the file, and `Content-Type` names what it is (never `application/json`, unlike
 * `apiSend`). Same Result convention and the same guest-tolerant `auth` option as every other
 * call here.
 */
export async function apiSendFile<T>(path: string, file: File, opts?: Opts): Promise<Result<T>> {
  const h = await resolveHeaders({ 'Content-Type': file.type }, opts?.auth)
  if ('fail' in h) return { ok: false, error: h.fail }
  try {
    const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: h.headers, body: file })
    if (!res.ok) return { ok: false, error: await errorFromResponse(res) }
    const text = await res.text()
    return { ok: true, data: (text ? JSON.parse(text) : null) as T }
  } catch {
    return { ok: false, error: NETWORK_ERROR }
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @bitetime/frontend test -- src/api.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/api.ts apps/frontend/src/api.test.ts
git commit -m "feat(frontend): add apiSendFile"
```

---

### Task 6: `store.ts` — `uploadPaymentProof`, `fetchPaymentProof`, and `placeOrder`'s new `id`

**Files:**
- Modify: `apps/frontend/src/store.ts`
- Modify: `apps/frontend/src/store.test.ts`

**Interfaces:**
- Consumes: `apiSendFile` (Task 5), `apiGetFile`/`mapOk`/`toVoid` (already imported).
- Produces: `MAX_PAYMENT_PROOF_BYTES`, `PAYMENT_PROOF_TYPES`, `uploadPaymentProof(orderId: string, file: File): Promise<Result<void>>`, `fetchPaymentProof(merchantId: string, orderId: string): Promise<Result<Blob>>`. `placeOrder(...): Promise<Result<{ orderNumber: string; id: string }, OrderError>>`. Task 8 consumes `uploadPaymentProof`/`MAX_PAYMENT_PROOF_BYTES`/`PAYMENT_PROOF_TYPES` and `placeOrder`'s `id`; Task 9 consumes `fetchPaymentProof`.

- [ ] **Step 1: Update the `placeOrder` test first**

In `apps/frontend/src/store.test.ts`, change the mock and assertion at :697-720:

```typescript
    const fetchMock = fetchOk({ orderNumber: 'BT-260714-0050', id: 'order-uuid-1' })
```

```typescript
    expect(result).toEqual({ ok: true, data: { orderNumber: 'BT-260714-0050', id: 'order-uuid-1' } })
```

Add, right after that `it`, a new test in the same `describe('placeOrder', ...)` block:

```typescript
  it('surfaces the order id from the response', async () => {
    __mocks.getSession.mockResolvedValueOnce({ data: { session: null } })
    fetchOk({ orderNumber: 'BT-1', id: 'abc-123' })

    const r = await placeOrder({ merchantId: 'm1', cart: { p1: 1 }, quotedTotal: 0 } as any)

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.id).toBe('abc-123')
  })
```

Add a new `describe` block for the two new functions, anywhere after `describe('placeOrder', ...)`:

```typescript
describe('uploadPaymentProof', () => {
  it('rejects an unsupported type without calling fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['x'], 'proof.gif', { type: 'image/gif' })

    const r = await uploadPaymentProof('order-1', file)

    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an oversized file without calling fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const big = new Uint8Array(MAX_PAYMENT_PROOF_BYTES + 1)
    const file = new File([big], 'proof.png', { type: 'image/png' })

    const r = await uploadPaymentProof('order-1', file)

    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts a valid file to /api/orders/:orderId/payment-proof', async () => {
    __mocks.getSession.mockResolvedValueOnce({ data: { session: null } })
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['x'], 'proof.png', { type: 'image/png' })

    const r = await uploadPaymentProof('order-1', file)

    expect(r.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/orders\/order-1\/payment-proof$/)
    expect(init.body).toBe(file)
  })
})

describe('fetchPaymentProof', () => {
  it('GETs /api/merchants/:merchantId/orders/:orderId/payment-proof and unwraps to the blob', async () => {
    __mocks.getSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } } })
    const blob = new Blob(['x'], { type: 'image/png' })
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, headers: new Headers(), blob: async () => blob,
    })
    vi.stubGlobal('fetch', fetchMock)

    const r = await fetchPaymentProof('m1', 'order-1')

    expect(r).toEqual({ ok: true, data: blob })
    const [url] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/merchants\/m1\/orders\/order-1\/payment-proof$/)
  })
})
```

In the multi-line import block near the top of `store.test.ts`, change the `placeOrder` line:

```typescript
  placeOrder,
  uploadPaymentProof,
  fetchPaymentProof,
  MAX_PAYMENT_PROOF_BYTES,
```

- [ ] **Step 2: Run to see it fail**

```bash
pnpm --filter @bitetime/frontend test -- src/store.test.ts
```

Expected: FAIL — new exports don't exist, `placeOrder`'s id assertion fails.

- [ ] **Step 3: Update `placeOrder`'s return type**

In `apps/frontend/src/store.ts`, change the signature at :525 and the final line at :552:

```typescript
}): Promise<Result<{ orderNumber: string; id: string }, OrderError>> {
```

```typescript
  return { ok: true, data: (await res.json()) as { orderNumber: string; id: string } }
```

- [ ] **Step 4: Add the payment-proof functions**

Change the existing import line near the top of the file:

```typescript
import { API_URL, apiGet, apiGetFile, apiSend, apiSendFile, mapOk, toVoid } from './api'
```

Then add after `uploadPaymentQr`/`deletePaymentQr` (near :909):

```typescript
// ── Payment proof (Supabase Storage: private `payment-proof` bucket, via the backend) ─────────
// The customer's own screenshot of a completed transfer, attached to the order they just placed
// (optional). Unlike payment-qr, the browser never touches this bucket directly: a guest
// checkout has no token to scope an RLS write against, so the upload goes through the backend's
// service-role client instead — see docs/superpowers/specs/2026-08-04-payment-proof-upload-design.md.

export const MAX_PAYMENT_PROOF_BYTES = 2 * 1024 * 1024
export const PAYMENT_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** Validates client-side (same limits the bucket itself enforces), then posts the raw file. */
export async function uploadPaymentProof(orderId: string, file: File): Promise<Result<void>> {
  if (!PAYMENT_PROOF_TYPES.includes(file.type)) {
    return { ok: false, error: { message: `Unsupported image type: ${file.name}` } }
  }
  if (file.size > MAX_PAYMENT_PROOF_BYTES) {
    return { ok: false, error: { message: `Image too large (max 2MB): ${file.name}` } }
  }
  return toVoid(await apiSendFile(`/api/orders/${orderId}/payment-proof`, file))
}

/** For the merchant dashboard only — `auth: 'required'`, a signed-out caller has no shop to view. */
export async function fetchPaymentProof(merchantId: string, orderId: string): Promise<Result<Blob>> {
  const r = await apiGetFile(`/api/merchants/${merchantId}/orders/${orderId}/payment-proof`, { auth: 'required' })
  return mapOk(r, d => d.blob)
}
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @bitetime/frontend test -- src/store.test.ts
```

Expected: all pass.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @bitetime/frontend typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/store.ts apps/frontend/src/store.test.ts
git commit -m "feat(frontend): add uploadPaymentProof/fetchPaymentProof, thread order id through placeOrder"
```

---

### Task 7: `types.ts` — `Order.payment_proof`

**Files:**
- Modify: `apps/frontend/src/types.ts:167`

**Interfaces:**
- Produces: `Order.payment_proof?: string | null`. Task 9 (`OrderDetailSheet`) reads this.

- [ ] **Step 1: Add the field**

In `apps/frontend/src/types.ts`, in the `Order` interface, after `delivery_distance_km`:

```typescript
  /** Storage path in the private `payment-proof` bucket, or null/absent. Never render this
   *  directly as a URL — fetch it through `fetchPaymentProof`, which is auth-gated. */
  payment_proof?: string | null
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @bitetime/frontend typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/types.ts
git commit -m "feat(frontend): add Order.payment_proof to the type"
```

---

### Task 8: `Storefront.tsx` — the upload widget under the QR block

**Files:**
- Create: `apps/frontend/src/store/PaymentProofUpload.tsx`
- Modify: `apps/frontend/src/store/Storefront.tsx:70-92,754-761,918-919`

**Interfaces:**
- Consumes: `uploadPaymentProof`, `MAX_PAYMENT_PROOF_BYTES`, `PAYMENT_PROOF_TYPES` (Task 6); `placeOrder`'s `id` (Task 6).
- Produces: `<PaymentProofUpload orderId={string} />`, a self-contained widget with its own upload state.

This task has no automated test — per CLAUDE.md, UI is verified by running the app (Task 10), not component tests; there is no existing `Storefront.test.tsx` to extend.

- [ ] **Step 1: Create the upload widget**

Create `apps/frontend/src/store/PaymentProofUpload.tsx`:

```tsx
import { useState } from 'react'
import { toast } from 'sonner'
import { useSession } from '../SessionContext'
import { uploadPaymentProof, MAX_PAYMENT_PROOF_BYTES, PAYMENT_PROOF_TYPES } from '../store'

type UploadState = 'idle' | 'uploading' | 'uploaded' | 'error'

/**
 * Optional proof-of-payment upload, shown under the shop's payment QR/bank details on the
 * order-placed screen. No gating anywhere: the customer can skip it, upload later (outside the
 * app), or replace what they already sent — this widget has no memory of a page reload, matching
 * the QR block it sits under, which is also never shown anywhere else.
 */
export default function PaymentProofUpload({ orderId }: { orderId: string }) {
  const { t } = useSession()
  const [state, setState] = useState<UploadState>('idle')

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (!PAYMENT_PROOF_TYPES.includes(file.type)) {
      toast.error(t('Unsupported image type', '不支持的图片格式'))
      return
    }
    if (file.size > MAX_PAYMENT_PROOF_BYTES) {
      toast.error(t('Image too large (max 2MB)', '图片过大（最大 2MB）'))
      return
    }
    setState('uploading')
    const r = await uploadPaymentProof(orderId, file)
    if (r.ok) {
      setState('uploaded')
      toast.success(t('Payment proof uploaded', '付款凭证已上传'))
    } else {
      setState('error')
      toast.error(t('Could not upload — try again', '上传失败，请重试'))
    }
  }

  const inputId = `payment-proof-${orderId}`

  return (
    <div className="mt-3 flex flex-col items-center gap-1.5">
      <label
        htmlFor={inputId}
        className="text-[13px] font-medium text-oxblood underline cursor-pointer"
      >
        {state === 'uploaded'
          ? t('Replace payment proof', '替换付款凭证')
          : t('Upload payment proof (optional)', '上传付款凭证（可选）')}
      </label>
      <input
        id={inputId}
        type="file"
        accept={PAYMENT_PROOF_TYPES.join(',')}
        className="sr-only"
        disabled={state === 'uploading'}
        onChange={(e) => {
          void handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {state === 'uploading' && (
        <span className="text-[12px] text-rose-muted">{t('Uploading…', '上传中…')}</span>
      )}
      {state === 'uploaded' && (
        <span className="text-[12px] text-rose-muted">{t('Uploaded ✓', '已上传 ✓')}</span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add `orderId` to `SuccessState`**

In `apps/frontend/src/store/Storefront.tsx`, in the `SuccessState` interface (:70-92), add:

```typescript
  orderId: string
```

- [ ] **Step 3: Thread it from `placeOrder`'s result**

At the `setSuccess({...})` call (:754-761), add `orderId: result.data.id`:

```typescript
      setSuccess({
        orderId: result.data.id,
        orderNumber: result.data.orderNumber, items: cartItems, subtotal, fee, discount, taxAmount, taxRate, total,
        feeKm: quote ? quote.km : null,
        fulfilDate: chosenDate,
      })
```

- [ ] **Step 4: Import the widget and render it under the QR block**

Add to the imports near the top of `Storefront.tsx`:

```typescript
import PaymentProofUpload from './PaymentProofUpload'
```

In the payment-instructions block, right after the `{merchant.payment_qr && (...)}` block closes and before the outer block's own closing `</div>` (i.e. between the current lines 918 and 919):

```tsx
                {/* Optional, additive: same guard as the block itself — a shop with no payment
                    info configured has nothing to prove payment of. */}
                <PaymentProofUpload orderId={success.orderId} />
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @bitetime/frontend typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/store/PaymentProofUpload.tsx apps/frontend/src/store/Storefront.tsx
git commit -m "feat(frontend): add payment proof upload to the order-placed screen"
```

---

### Task 9: `OrderDetailSheet.tsx` — the merchant-side viewer

**Files:**
- Modify: `apps/frontend/src/merchant/OrderDetailSheet.tsx`

**Interfaces:**
- Consumes: `fetchPaymentProof` (Task 6), `order.payment_proof` (Task 7), `merchant.id` (already in scope via `useSession()`).

No automated test — same reasoning as Task 8; verified in Task 10.

- [ ] **Step 1: Add the lazy-fetch effect and object-URL state**

In `apps/frontend/src/merchant/OrderDetailSheet.tsx`, add `useEffect` to the React import:

```typescript
import { useState, useEffect } from 'react'
```

Add `fetchPaymentProof` to the `store` import:

```typescript
import { setOrderStatus, setOrderNote, setOrderTracking, fetchPaymentProof } from '../store'
```

Add state and an effect, near the other `useState` calls (after `savingTrack`):

```typescript
  const [proofUrl, setProofUrl] = useState<string | null>(null)

  // Lazy: only fetched when the sheet is open for an order that actually has one, not on every
  // dashboard list render. Revoked on the way out so a merchant clicking through ten orders in a
  // row doesn't leak ten object URLs.
  useEffect(() => {
    if (!order?.payment_proof || !merchant) {
      setProofUrl(null)
      return
    }
    let cancelled = false
    let url: string | null = null
    fetchPaymentProof(merchant.id, order.id).then((r) => {
      if (cancelled || !r.ok) return
      url = URL.createObjectURL(r.data)
      setProofUrl(url)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [order?.id, order?.payment_proof, merchant])
```

- [ ] **Step 2: Render the section**

Add a new `Section`, after the "Customer" section and before "Items" (both already in the file):

```tsx
              {order.payment_proof && (
                <Section title={t('Payment proof', '付款凭证')}>
                  {proofUrl ? (
                    <a href={proofUrl} target="_blank" rel="noopener noreferrer" className="block w-full max-w-[200px]">
                      <img
                        src={proofUrl}
                        alt={t('Payment proof', '付款凭证')}
                        className="w-full h-auto object-contain rounded-md border border-clay-border"
                      />
                    </a>
                  ) : (
                    <span className="text-[13px] text-rose-muted">{t('Loading…', '加载中…')}</span>
                  )}
                </Section>
              )}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @bitetime/frontend typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/merchant/OrderDetailSheet.tsx
git commit -m "feat(frontend): show uploaded payment proof in the order detail sheet"
```

---

### Task 10: Run-and-verify

Per CLAUDE.md, UI is verified by running the app, not component tests. This is the step that actually exercises Tasks 8 and 9.

**Files:** none — this task produces no diff.

- [ ] **Step 1: Start the stack**

```bash
cd apps/backend && supabase start   # if not already running
pnpm dev                             # from repo root: frontend :5173, backend :8787
```

(No `stripe listen` needed — nothing here touches billing.)

- [ ] **Step 2: Seed a shop with payment instructions**

Sign up a test shop (or use an existing local one) and, in Merchant → Settings, set at least `payment_bank` or `payment_note` (a payment QR image is not required to see the widget — Task 8 renders it on the same guard as the whole instructions block).

- [ ] **Step 3: Place an order as a guest and upload a proof**

At `/s/<slug>`, add an item, check out as a guest. On the success screen, under the payment-instructions block, confirm the "Upload payment proof (optional)" link appears, pick a small JPEG/PNG, and confirm it flips to "Uploaded ✓" with a success toast.

- [ ] **Step 4: Confirm it rejects a bad file client-side**

Try a `.pdf` or a file over 2 MB (the browser's own file picker won't stop you) — confirm the toast fires and no network request is even made (check devtools Network tab — no request should appear for a rejected file, per Task 6's client-side gate).

- [ ] **Step 5: Confirm the merchant sees it**

Sign in as the shop owner at `/merchant`, open the order in Orders, confirm a "Payment proof" section appears with the uploaded image rendered, and clicking it opens the full-resolution image in a new tab.

- [ ] **Step 6: Confirm a second upload replaces the first**

Back on the storefront (reload the same order's success view is not possible — place a fresh order instead, or reuse the same order id via devtools if still in memory), upload a different image to the same order and confirm the merchant dashboard now shows the new one, not both.

- [ ] **Step 7: Report the outcome**

If everything above holds, the feature is done. If anything fails, note exactly which step and what happened — that's a bug in one of Tasks 1-9, not a reason to change this step.
