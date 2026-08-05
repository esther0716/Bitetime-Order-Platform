# Order pending-payment status

## What we are building

#182 asks that an order start as "pending payment" and only become "new" once the customer submits proof of payment. The payment-proof upload endpoint already exists (#156-adjacent, shipped 2026-08-04) but was deliberately built with "no new status, no gating" — this spec lifts exactly that boundary.

Decisions taken during design:

| Question | Decision |
|---|---|
| Does every order get gated? | No. Only orders for shops that have `payment_bank`, `payment_qr` or `payment_note` set — the same condition that already decides whether the proof-upload widget renders on the order-placed screen. A shop with none of these has no way for a customer to submit proof, so gating it would strand every order in `pending_payment` forever. |
| What happens to a shop with no payment info configured? | Order is born `new`, exactly as today. No behaviour change for these shops. |
| What flips `pending_payment` → `new`? | The existing `POST /api/orders/:orderId/payment-proof` upload succeeding. No new endpoint. |
| Can a merchant override manually? | Yes. `pending_payment` becomes an ordinary entry in the existing status list/dropdown — a merchant can move an order straight to `new` (cash paid in person, proof sent outside the app) or to any other status, same as today. |
| Can an upload resurrect a cancelled order? | No. The status flip only fires `pending_payment → new`; a merchant-cancelled order stays cancelled even if a proof lands after the cancel. |
| Does this need a DB migration? | No. `orders.status` is a free `text` column with no check constraint — `pending_payment` is just a new string value the app starts writing. |

## Backend (`apps/backend/src/orders.ts`, `writes.ts`)

**Status list** — add `'pending_payment'` to `ORDER_STATUSES` in `apps/backend/src/writes.ts` (the allowlist the merchant PATCH endpoint validates against).

**Intake** (`assertOrderableMerchant`, `orders.ts`) — add `payment_bank, payment_qr, payment_note` to the merchant `select`, and thread a `hasPaymentInfo: boolean` through `OrderableMerchant`. In the insert (currently hardcoded `'new'`), use:

```
${merchant.hasPaymentInfo ? 'pending_payment' : 'new'}
```

**Proof upload → status flip** (`setOrderPaymentProof`, `orders.ts`) — change the single-column update to a single atomic statement that also advances status, guarded so it only ever moves an order out of `pending_payment`:

```sql
update orders
set payment_proof = $1,
    status = case when status = 'pending_payment' then 'new' else status end
where id = $2
```

No transaction needed — same non-transactional `sql` client the function already uses. The `case` guard is what keeps a late upload from reviving a cancelled/completed order.

No change to `app.ts`'s upload handler itself — it already calls `setOrderPaymentProof` after a successful storage write.

## Frontend

**Status list/labels/badges** (`apps/frontend/src/orderStatus.tsx`) — add a `pending_payment` entry to `ORDER_STATUSES`, `STATUS_LABELS` (`Pending payment` / `待付款`), and `STATUS_BADGE` (a warm/amber-toned badge, visually distinct from `preparing`'s existing warn styling — exact tokens picked at implementation time from the existing palette).

**Client-side guard array** (`apps/frontend/src/store.ts` `ORDER_STATUSES`, ~line 499) — add `'pending_payment'` so `setOrderStatus` doesn't reject a merchant manually setting it.

**Type** (`apps/frontend/src/types.ts`) — add `'pending_payment'` to the `OrderStatus` union.

**Merchant dashboard** — no code change needed beyond the above: `OrderDetailSheet`'s status dropdown and `OrdersView`/`CustomersView` badges are all built from `ORDER_STATUSES`/`STATUS_LABELS`/`STATUS_BADGE`, so the new value shows up for free.

**Customer-facing tracker** (`apps/frontend/src/store/OrderTimeline.tsx`) — today an unrecognised status silently falls back to step-0 "Placed" (`FLOW.indexOf` returns `-1`, clamped to `0`). Add an explicit early-return banner for `status === 'pending_payment'`, mirroring the existing `cancelled` banner block: an icon + "Awaiting payment confirmation" / "等待付款确认" message, rendered instead of the four-step tracker. More honest than implying the order is already in prep.

**`OrderHistory.tsx`** — no change needed; it renders `StatusBadge`/labels from the same shared maps.

## Testing

- `apps/backend/tests/api/orders.test.ts` (or wherever intake is tested) — a merchant with `payment_bank`/`payment_qr`/`payment_note` set produces an order with `status: 'pending_payment'`; a merchant with none of those still produces `'new'` (regression check — existing fixtures likely already cover this implicitly, verify they still pass).
- `apps/backend/tests/api/payment-proof.test.ts` — uploading proof against a `pending_payment` order flips it to `new`; uploading against an order already `cancelled`/`completed`/`new` leaves status untouched.

## Out of scope

- No DB migration (no check constraint exists to update).
- No new endpoint — reuses the existing proof-upload POST.
- No change to who can read/write `payment_proof` itself (unchanged from the shipped feature).
- No Telegram/email notification tied to the status flip.
- No retroactive backfill of existing `new` orders that never got a chance at `pending_payment` — this only affects orders placed after the change ships.
