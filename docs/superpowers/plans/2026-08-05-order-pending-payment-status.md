# Order Pending-Payment Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An order for a shop with manual bank/QR payment info configured is born `pending_payment` instead of `new`, and flips to `new` automatically the moment the customer's payment-proof upload lands — closing #182.

**Architecture:** `pending_payment` becomes a sixth value in the existing status vocabulary (no DB migration — `orders.status` is a free `text` column with no check constraint). Order intake (`orders.ts`) decides the birth status from whether the merchant row has `payment_bank`/`payment_qr`/`payment_note` set — the same condition that already gates whether the frontend shows the proof-upload widget. The existing `POST /api/orders/:orderId/payment-proof` handler's `setOrderPaymentProof` becomes a single atomic `UPDATE ... SET payment_proof = $1, status = CASE WHEN status = 'pending_payment' THEN 'new' ELSE status END`, so a late upload can flip a pending order forward but can never resurrect one a merchant already moved elsewhere (e.g. `cancelled`). The merchant dashboard needs no new logic — its status dropdown and badges are built from shared arrays that just gain one more entry.

**Tech Stack:** Hono + `postgres.js` (`db.ts`'s `sql`/`withTransaction`) on the backend, React 19 + TypeScript on the frontend, Vitest (`tests/api` against real Postgres — never mocked, per this repo's rule) and one frontend unit test in `store.test.ts`. UI changes are verified by running the app, not by component tests (per `CLAUDE.md`).

**Design doc:** `docs/superpowers/specs/2026-08-05-order-pending-payment-status-design.md` — read it for the "why"; this plan only restates what's needed to build each task.

## Global Constraints

- Every user-visible string is `t(english, chinese)` — `t` comes from `useSession()`. No i18n library.
- Backend relative imports keep `.js` specifiers that resolve to `.ts` source. Leave them as `.js`.
- Never run `pnpm --filter @bitetime/backend db:push` or any `supabase` command that reaches production. This feature needs no migration at all.
- `pnpm --filter @bitetime/backend test:db` needs a running local Supabase (`supabase start` from `apps/backend`).
- Never mock the database in `tests/api`. That suite exists to prove properties of the real thing.
- The new status string is exactly `pending_payment` everywhere it appears (backend `writes.ts`, frontend `types.ts`/`orderStatus.tsx`/`store.ts`) — every task below depends on this exact spelling.
- Gate condition is exactly `payment_bank || payment_qr || payment_note` truthy on the merchant row — the same condition `Storefront.tsx:881` already uses to decide whether the proof-upload widget renders. A shop with none of the three still gets `new`, unchanged from today.

---

## File Structure

**Modify:**
- `apps/backend/src/writes.ts` — `ORDER_STATUSES` (:7) gains `'pending_payment'`.
- `apps/backend/src/orders.ts` — `assertOrderableMerchant`'s select and `OrderableMerchant` type gain `hasPaymentInfo`; the intake insert's hardcoded `'new'` (:322) becomes conditional; `setOrderPaymentProof` (:359-362) becomes a status-aware `UPDATE`.
- `apps/backend/tests/rls/helpers.ts` — `seedMerchant` gains optional `payment_bank`/`payment_qr`/`payment_note` fields, for the new tests below to seed a shop that should gate.
- `apps/backend/tests/api/orders.test.ts` — new test: a shop with payment info configured is born `pending_payment`.
- `apps/backend/tests/api/payment-proof.test.ts` — new tests: upload flips `pending_payment` → `new`; upload leaves a `cancelled` order alone.
- `apps/frontend/src/types.ts` — `OrderStatus` union (:15) gains `'pending_payment'`.
- `apps/frontend/src/orderStatus.tsx` — `ORDER_STATUSES`, `STATUS_LABELS`, `STATUS_BADGE` each gain a `pending_payment` entry.
- `apps/frontend/src/store.ts` — client-side guard array `ORDER_STATUSES` (:499) gains `'pending_payment'`.
- `apps/frontend/src/store.test.ts` — the "accepts all five valid statuses" test (:1144) becomes six.
- `apps/frontend/src/store/OrderTimeline.tsx` — new early-return banner for `status === 'pending_payment'`, mirroring the existing `cancelled` block.

---

### Task 1: Backend — gate intake status on the merchant's payment info

**Files:**
- Modify: `apps/backend/src/writes.ts:7`
- Modify: `apps/backend/src/orders.ts` (`assertOrderableMerchant` ~455-499, `OrderableMerchant` type ~436-445, insert ~287-328)
- Modify: `apps/backend/tests/rls/helpers.ts` (`seedMerchant`, ~94-145)
- Modify: `apps/backend/tests/api/orders.test.ts`

**Interfaces:**
- Produces: `OrderableMerchant.hasPaymentInfo: boolean`, read by the insert in `placeOrder`. `seedMerchant` accepts optional `payment_bank?: string`, `payment_qr?: string`, `payment_note?: string`.

- [ ] **Step 1: Add the allowlist entry**

In `apps/backend/src/writes.ts:7`:

```ts
export const ORDER_STATUSES = ['pending_payment', 'new', 'preparing', 'ready', 'completed', 'cancelled']
```

- [ ] **Step 2: Let `seedMerchant` seed payment info, for the test in Step 4**

In `apps/backend/tests/rls/helpers.ts`, add to the `fields` parameter of `seedMerchant` (near the other optional fields, ~106-118):

```ts
  /** Manual-payment display fields (#156). Omitted leaves the column defaults (null) — used to
   * test the #182 pending-payment gate, which keys off whether any of these three is set. */
  payment_bank?: string
  payment_qr?: string
  payment_note?: string
```

And in the insert object (near the other `...(fields.x !== undefined ? ... )` spreads, ~129-139):

```ts
      ...(fields.payment_bank !== undefined ? { payment_bank: fields.payment_bank } : {}),
      ...(fields.payment_qr !== undefined ? { payment_qr: fields.payment_qr } : {}),
      ...(fields.payment_note !== undefined ? { payment_note: fields.payment_note } : {}),
```

- [ ] **Step 3: Write the failing test**

In `apps/backend/tests/api/orders.test.ts`, add a new top-level `describe` block after the closing of `describe('POST /api/orders', ...)` (after the existing suite, so it gets its own lifecycle rather than perturbing the shared `shop` fixture used throughout that suite):

```ts
describe('POST /api/orders — pending-payment gate (#182)', () => {
  let paidOwnerId: string
  let paidShop: string
  let paidProductId: string

  beforeAll(async () => {
    const owner = await makeUser('ord-paid-owner@test.dev', 'password123')
    paidOwnerId = (await owner.auth.getUser()).data.user!.id
    paidShop = await seedMerchant({
      slug: 'ord-paid-shop',
      order_prefix: 'PD',
      owner_id: paidOwnerId,
      payment_bank: 'Maybank 1234567890',
    })
    paidProductId = await seedProduct({ merchant_id: paidShop, price: 13 })
    await setFulfilmentConfig(paidShop, { lead_days: 0, window_days: 14, closed_weekdays: [] })
  }, 60_000)

  afterAll(async () => {
    await resetMerchant('ord-paid-shop')
  })

  it('is born pending_payment when the shop has payment_bank set', async () => {
    const res = await post(body(paidShop, paidProductId, { fulfilDate: tomorrowInShopZone() }))
    expect(res.status).toBe(200)

    const { data: order } = await serviceClient()
      .from('orders').select('status').eq('merchant_id', paidShop).single()
    expect(order!.status).toBe('pending_payment')
  })
})
```

- [ ] **Step 4: Run it to confirm it fails**

```bash
pnpm --filter @bitetime/backend test:db -- orders.test.ts -t "pending-payment gate"
```

Expected: FAIL — `seedMerchant` rejects the unknown `payment_bank` field (TypeScript) or the order comes back `new` (the gate doesn't exist yet). If Step 2 wasn't done yet, this will be a type error rather than a runtime assertion failure — do Step 2 first if so, then re-run.

- [ ] **Step 5: Implement the gate**

In `apps/backend/src/orders.ts`, extend the `MerchantRow` type and select inside `assertOrderableMerchant` (~461-472):

```ts
  type MerchantRow = Record<string, unknown> & {
    order_prefix: string
    status: string
    currency: string | null
    timezone: string | null
    payment_bank: string | null
    payment_qr: string | null
    payment_note: string | null
  }
  const rows = await tx<MerchantRow[]>`
    select order_prefix, status::text, shipping, currency, config, timezone, tax_enabled, tax_rate,
           pickup_enabled, delivery_enabled, express_enabled,
           delivery_base_fee, delivery_rate_per_km, delivery_max_km, origin_place_id,
           payment_bank, payment_qr, payment_note
    from merchants where id = ${merchantId}
  `
```

Add the field to the return object (~476-499):

```ts
    // #182: an order is born pending_payment only when the customer will actually SEE somewhere
    // to send proof — the same condition Storefront.tsx uses to render the upload widget. A shop
    // with none of the three has no upload surface, so gating it would strand every order.
    hasPaymentInfo: Boolean(merchant.payment_bank || merchant.payment_qr || merchant.payment_note),
```

Add the field to the `OrderableMerchant` interface (~436-445):

```ts
  methods: ShopMethods
  hasPaymentInfo: boolean
```

Change the hardcoded status in the insert (~319-322):

```ts
        -- Born pending_payment when the shop takes manual payment (has bank/QR/note to show the
        -- customer) — #182. Otherwise 'new', unchanged. Never taken from the caller, same reason
        -- as always: a client-chosen status is a client-chosen workflow state.
        ${merchant.hasPaymentInfo ? 'pending_payment' : 'new'},
```

- [ ] **Step 6: Run the test again to confirm it passes**

```bash
pnpm --filter @bitetime/backend test:db -- orders.test.ts -t "pending-payment gate"
```

Expected: PASS.

- [ ] **Step 7: Run the full orders suite to confirm no regression**

```bash
pnpm --filter @bitetime/backend test:db -- orders.test.ts
```

Expected: all PASS, including the existing `'writes the order row, with the cart and the total'` test asserting `status: 'new'` for the plain `ord-shop` fixture (which has no payment info set, so it's unaffected).

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/writes.ts apps/backend/src/orders.ts apps/backend/tests/rls/helpers.ts apps/backend/tests/api/orders.test.ts
git commit -m "feat(backend): gate order intake status on merchant payment info (#182)"
```

---

### Task 2: Backend — proof upload flips `pending_payment` → `new`

**Files:**
- Modify: `apps/backend/src/orders.ts` (`setOrderPaymentProof`, ~359-362)
- Modify: `apps/backend/tests/api/payment-proof.test.ts`

**Interfaces:**
- Consumes: nothing new — `setOrderPaymentProof(orderId: string, path: string): Promise<void>` keeps its exact signature; `app.ts`'s POST handler (~1791-1820) calls it unchanged.
- Produces: same signature, new behaviour — the row's `status` column advances alongside `payment_proof` in one statement.

- [ ] **Step 1: Write the failing tests**

In `apps/backend/tests/api/payment-proof.test.ts`, add two cases inside the existing `describe('POST /api/orders/:orderId/payment-proof', ...)` block, after the "second upload replaces the first" case. `seedOrder` already takes a `status` via a raw insert — extend it to accept a status override rather than hardcoding `'new'`:

Change `seedOrder` (~28-42) to accept a status:

```ts
async function seedOrder(merchantId: string, status: string = 'new') {
  const { data, error } = await serviceClient()
    .from('orders')
    .insert({
      merchant_id: merchantId,
      order_number: `PP-${crypto.randomUUID().slice(0, 8)}`,
      status,
      customer_name: 'Ah Meng',
      customer_wa: '60123456789',
    })
    .select('id')
    .single()
  if (error) throw new Error(`seeding order: ${error.message}`)
  return data!.id as string
}
```

Then add:

```ts
  it('flips a pending_payment order to new on a successful upload', async () => {
    const merchantId = await shopWithOwner('pp-flip-shop')
    const orderId = await seedOrder(merchantId, 'pending_payment')
    written.push(`${merchantId}/${orderId}.png`)

    const res = await post(orderId, PNG_1X1, 'image/png')
    expect(res.status).toBe(200)

    const { data: order } = await serviceClient().from('orders').select('status').eq('id', orderId).single()
    expect(order!.status).toBe('new')

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })

  it('leaves a cancelled order cancelled — an upload cannot resurrect it', async () => {
    const merchantId = await shopWithOwner('pp-cancelled-shop')
    const orderId = await seedOrder(merchantId, 'cancelled')
    written.push(`${merchantId}/${orderId}.png`)

    const res = await post(orderId, PNG_1X1, 'image/png')
    expect(res.status).toBe(200)

    const { data: order } = await serviceClient().from('orders').select('status').eq('id', orderId).single()
    expect(order!.status).toBe('cancelled')

    await serviceClient().from('merchants').delete().eq('id', merchantId)
  })
```

- [ ] **Step 2: Run to confirm they fail**

```bash
pnpm --filter @bitetime/backend test:db -- payment-proof.test.ts -t "flips a pending_payment"
```

Expected: FAIL — the first test fails because `setOrderPaymentProof` doesn't touch `status` yet (stays `pending_payment`). The second test currently passes already (nothing touches status at all today) — that's fine, it's here to pin the behaviour going forward, not to prove a regression.

- [ ] **Step 3: Implement the flip**

In `apps/backend/src/orders.ts`, replace `setOrderPaymentProof` (~359-362):

```ts
/**
 * Stamps the storage path onto the order row, and advances a pending order past the payment
 * gate (#182) in the same statement — a successful upload is the ONLY thing that turns
 * pending_payment into new. The CASE guard is deliberate: it moves an order OUT of
 * pending_payment and never overwrites any other status, so a proof landing after a merchant
 * already cancelled (or completed) the order leaves that decision alone.
 */
export async function setOrderPaymentProof(orderId: string, path: string): Promise<void> {
  await sql`
    update orders
    set payment_proof = ${path},
        status = case when status = 'pending_payment' then 'new' else status end
    where id = ${orderId}
  `
}
```

- [ ] **Step 4: Run the tests again to confirm they pass**

```bash
pnpm --filter @bitetime/backend test:db -- payment-proof.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/orders.ts apps/backend/tests/api/payment-proof.test.ts
git commit -m "feat(backend): payment-proof upload advances pending_payment to new (#182)"
```

---

### Task 3: Frontend — status vocabulary (types, labels, badges, guard array)

**Files:**
- Modify: `apps/frontend/src/types.ts:15`
- Modify: `apps/frontend/src/orderStatus.tsx`
- Modify: `apps/frontend/src/store.ts:499`
- Modify: `apps/frontend/src/store.test.ts:1144`

**Interfaces:**
- Produces: `OrderStatus` includes `'pending_payment'`; `STATUS_LABELS.pending_payment` and `STATUS_BADGE.pending_payment` exist, consumed by `StatusBadge` (used in `OrderDetailSheet`, `OrdersView`, `CustomersView`, `OrderHistory`) and by `OrderDetailSheet`'s status dropdown (built from `ORDER_STATUSES`).

- [ ] **Step 1: Write the failing test**

In `apps/frontend/src/store.test.ts`, change the loop at :1144-1155 to the six-status list:

```ts
  it('accepts all six valid statuses: pending_payment, new, preparing, ready, completed, cancelled', async () => {
    for (const status of ['pending_payment', 'new', 'preparing', 'ready', 'completed', 'cancelled']) {
```

(the rest of the loop body is unchanged)

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm --filter @bitetime/frontend test -- store.test.ts -t "accepts all six"
```

Expected: FAIL — `setOrderStatus('ord-1', 'pending_payment', 'm1')` returns `{ ok: false, error: { code: 'invalid_status' } }` because the client guard array doesn't know the value yet, so `result.ok && result.data.status` is `false`, not `'pending_payment'`.

- [ ] **Step 3: Add the type**

In `apps/frontend/src/types.ts:15`:

```ts
export type OrderStatus = 'pending_payment' | 'new' | 'preparing' | 'ready' | 'completed' | 'cancelled'
```

- [ ] **Step 4: Add the label, badge, and guard-array entries**

In `apps/frontend/src/orderStatus.tsx`:

```ts
export const ORDER_STATUSES = ['pending_payment', 'new', 'preparing', 'ready', 'completed', 'cancelled']

export const STATUS_LABELS: Record<string, { en: string; zh: string }> = {
  pending_payment: { en: 'Pending payment', zh: '待付款' },
  new:       { en: 'New',       zh: '新订单' },
  preparing: { en: 'Preparing', zh: '备料中' },
  ready:     { en: 'Ready',     zh: '已备好' },
  completed: { en: 'Completed', zh: '已完成' },
  cancelled: { en: 'Cancelled', zh: '已取消' },
}

type BadgeConfig = { variant?: 'infoBlue' | 'danger'; className?: string }
export const STATUS_BADGE: Record<string, BadgeConfig> = {
  pending_payment: { className: 'bg-rose-pale text-oxblood border-transparent' },
  new:       { variant: 'infoBlue' },
  preparing: { className: 'bg-warn-bg-alt text-warn-fg-alt border-transparent' },
  ready:     { className: 'bg-success-bg-soft text-success-deep border-transparent' },
  completed: { className: 'bg-prep-bg-alt text-prep-fg-alt border-transparent' },
  cancelled: { className: 'bg-danger-bg text-danger-fg border-transparent' },
}
```

(`bg-rose-pale text-oxblood` is the same pairing `OrderTimeline.tsx`'s cancelled banner already uses for its container — reused here, not invented, so it stays inside the existing palette. Visually distinct from `preparing`'s warn styling.)

- [ ] **Step 5: Add the client-side guard-array entry**

In `apps/frontend/src/store.ts:499`:

```ts
const ORDER_STATUSES = ['pending_payment', 'new', 'preparing', 'ready', 'completed', 'cancelled']
```

- [ ] **Step 6: Run the test again to confirm it passes**

```bash
pnpm --filter @bitetime/frontend test -- store.test.ts -t "accepts all six"
```

Expected: PASS.

- [ ] **Step 7: Run the full frontend unit suite to confirm no regression**

```bash
pnpm --filter @bitetime/frontend test
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/types.ts apps/frontend/src/orderStatus.tsx apps/frontend/src/store.ts apps/frontend/src/store.test.ts
git commit -m "feat(frontend): add pending_payment to the order status vocabulary (#182)"
```

---

### Task 4: Frontend — customer-facing tracker shows an honest "awaiting payment" state

**Files:**
- Modify: `apps/frontend/src/store/OrderTimeline.tsx`

**Interfaces:**
- Consumes: `status: string` prop (unchanged signature).
- Produces: no new export — same `default function OrderTimeline({ status, mode, t })`.

Today, an unrecognised status falls through to `FLOW.indexOf(status)` returning `-1`, clamped to `0` — so `pending_payment` would silently render as "Placed", the same as a genuinely new order. This step makes it honest, the same way the file already special-cases `cancelled`.

There is no component-test suite for this file (UI is verified by running the app per `CLAUDE.md`) — this task is verified in Task 5's manual run-through, not by an automated test.

- [ ] **Step 1: Add the early-return banner**

In `apps/frontend/src/store/OrderTimeline.tsx`, add a case right after the existing `cancelled` block (~44-51), before the `FLOW.indexOf` line:

```tsx
  // A cancelled order never rejoins the flow — a greyed-out four-step line would imply it might.
  if (status === 'cancelled') {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-danger-border bg-rose-pale px-3 py-2.5 mt-3">
        <Ban className="size-4 shrink-0 text-danger" strokeWidth={1.75} />
        <span className="text-[13px] font-medium text-danger">{t('Order cancelled', '订单已取消')}</span>
      </div>
    )
  }

  // Nothing has been prepped yet — the four-step tracker would misleadingly imply the order is
  // already in progress. #182: this is the state between checkout and the customer's payment
  // proof landing (or the merchant manually moving it on).
  if (status === 'pending_payment') {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-clay-border bg-surface-raised px-3 py-2.5 mt-3">
        <Clock className="size-4 shrink-0 text-rose-muted" strokeWidth={1.75} />
        <span className="text-[13px] font-medium text-rose-muted">
          {t('Awaiting payment confirmation', '等待付款确认')}
        </span>
      </div>
    )
  }
```

`Clock` is already imported at the top of the file (:1) for the "Preparing" step icon, so no new import is needed.

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/store/OrderTimeline.tsx
git commit -m "feat(frontend): pending-payment banner on the customer order tracker (#182)"
```

---

### Task 5: Manual verification (run-and-verify, per CLAUDE.md)

No component tests cover the storefront/dashboard UI — this task drives the real app locally, per this repo's testing convention.

**Files:** none (verification only).

- [ ] **Step 1: Start the stack**

```bash
supabase start   # from apps/backend, if not already running
pnpm --filter @bitetime/backend db:migrate   # picks up nothing new (no migration in this feature) — confirms the stack is current
pnpm dev   # from repo root: frontend :5173, backend :8787
```

- [ ] **Step 2: Configure a shop's payment info**

Log into a merchant dashboard (or use an existing dev shop), go to Shop Settings → Payment, and set a bank detail (`payment_bank`). Save.

- [ ] **Step 3: Place an order against that shop as a customer**

Open `/s/<slug>`, add an item, check out as a guest. On the order-placed screen, confirm the payment QR/bank-details block and the "Upload payment proof (optional)" widget both render (unchanged from before this feature).

- [ ] **Step 4: Confirm the order starts pending_payment**

In the merchant dashboard's Orders view, find the new order. Confirm its badge reads "Pending payment" (not "New"), and open `OrderDetailSheet` to confirm the status dropdown shows `pending_payment` selected, with `pending_payment` present as one of the other options.

- [ ] **Step 5: Upload payment proof and confirm the flip**

Back on the order-placed screen (or via the guest tracking flow, if the tab is still open), upload a small JPEG/PNG through the widget. Confirm the toast succeeds. Refresh the merchant dashboard's Orders view — the same order's badge should now read "New".

- [ ] **Step 6: Confirm the no-payment-info shop is unaffected**

Repeat Steps 3-4 against a shop with no `payment_bank`/`payment_qr`/`payment_note` set. Confirm the order-placed screen shows no payment block and no upload widget, and the order in the dashboard is born "New" directly (never "Pending payment").

- [ ] **Step 7: Confirm the manual-override path**

Move a `pending_payment` order to `new` directly from the merchant dashboard's status dropdown, without any upload. Confirm it saves and the badge updates — proving the merchant override path works independently of the customer's upload.

- [ ] **Step 8: Confirm cancel-then-upload doesn't resurrect the order**

Place one more order against the payment-info shop (born `pending_payment`), cancel it from the dashboard, then upload a payment proof against that same order (the order-placed screen tab, if still open, or by hitting the upload endpoint directly for that order id). Confirm the dashboard still shows it as `cancelled`, not `new`.

- [ ] **Step 9: Report results**

Summarize what was checked and any deviation from expected behaviour. If everything in Steps 3-8 matched, the feature is complete.

---

## Task Summary

1. Backend: intake gates status on merchant payment info.
2. Backend: proof upload flips `pending_payment` → `new`, guarded against clobbering other statuses.
3. Frontend: status vocabulary (type, labels, badges, client guard array) gains `pending_payment`.
4. Frontend: customer tracker shows an honest "awaiting payment" state instead of aliasing to "Placed".
5. Manual run-and-verify of the full flow, including the two edge cases (no payment info; cancel-then-upload).
