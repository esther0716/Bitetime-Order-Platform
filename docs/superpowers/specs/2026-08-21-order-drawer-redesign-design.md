# Order detail drawer — redesign

**Date:** 2026-08-21
**Status:** approved, not implemented
**Scope:** frontend only. No `store.ts` change, no new endpoint, no migration.

## The problem

`apps/frontend/src/merchant/OrderDetailSheet.tsx` is 436 lines and holds seven
sections. Each new order feature added one more section to the same flat
scroll. The drawer is now cramped. Five faults cause this:

1. **Every section has the same weight.** The `Section` component separates
   groups with one hairline and one 11px label. "Payment proof" therefore looks
   as important as "Items".
2. **The controls sit in the scroll.** The note save button, the tracking save
   button and the status `Select` are spread through the body. The status
   control is last, so the most frequent action needs the longest scroll.
3. **The header holds too much.** `SheetHeader` carries the order number, a
   copy button, a status badge, a timestamp and an invoice row of one label and
   two buttons. The row wraps onto its own line.
4. **The courier is drawn twice.** `Fulfilment` renders courier and AWB as
   read-only `DetailRow`s. `Delivery tracking` renders the same two fields as a
   form. A condition on `mode` and `readOnly` chooses between them.
5. **The drawer wastes the desktop.** `sm:max-w-md` caps it at 448px, and the
   84px label column pushes a delivery address onto three lines.

A merchant uses this drawer for four different jobs — change the status, read
the order to fulfil it, check the payment, and enter tracking or send the
invoice. No section can be demoted, so the answer is hierarchy, not removal.

## The design

The drawer becomes a header, a scrolling body of cards, and a fixed footer.

### Header

The header states identity only:

- the order number, at 19px, with the copy button beside it;
- a status chip and a fulfilment-mode chip;
- the placed date and the wanted date, as muted text.

The invoice actions leave the header body. On a desktop the drawer shows
**Download invoice** as a button and puts **Send invoice on WhatsApp** in a
`⋯` menu. On a phone the `⋯` menu holds the download, the WhatsApp send and the
copy-number action.

`canIssueInvoice(order.status)` gates these items exactly as it does today. If
the menu holds no item, the drawer does not draw the `⋯` button.

### Body

The body scrolls. Its background is the cream canvas, and each group is a white
card with a border and a 12px radius. This is the treatment the dashboard
already uses, so the drawer stops reading as one flat sheet. A card that edits
something owns its save button in its own footer.

The cards, in order:

| Card | Holds |
|------|-------|
| Items | The line items, their option selections, the promo chip, and the line totals. |
| Payment | Subtotal, shipping, discount, tax and the emphasised total. The payment proof thumbnail sits beside the totals on a desktop, and below the total on a phone. |
| Customer & delivery | Customer name, WhatsApp link, fulfilment mode and date, region, and the address. Two columns at `sm` and above, one column below. |
| Tracking | Courier and AWB. Delivery orders only. |
| Note | The note textarea, or the note as text when the drawer is read-only. |

The fulfilment date keeps its current rule. An order that carries no
`fulfil_date` shows `—`, and the card does not drop the field. A missing field
would read as "this order has no fulfilment information", which is not true of
an order placed before #91.

The `Customer & delivery` card replaces the 84px label gutter with a
label-above-value field. The address then uses the full width of its column and
stops wrapping to three lines. The address label carries a copy button.

The `Tracking` card is one component. It renders editable inputs, or the same
two facts as text when the order is not a delivery order or the drawer is read
only. This removes the duplicate rendering that fault 4 describes.

### Footer

The footer is fixed at the bottom of the drawer and does not scroll.

On a desktop it shows the status `Select` and, to its right, a primary button
that advances the order to the next status.

On a phone it shows the primary advance button at full width, and a small text
button below it that reads **Set another status**. The phone footer gives the
common move a thumb-sized target and keeps every other status one tap away.

Both shapes use one `Select` with one `onValueChange` handler. Only the trigger
differs: a `SelectTrigger` on a desktop, and the **Set another status** text
button on a phone. The status list itself is the same list in both.

When the drawer is read only, the drawer does not render the footer. No status
write is then reachable.

### The advance rule

A new pure module, `merchant/orderDetail/nextStatus.ts`, holds the rule:

| From | To | Button label |
|------|----|--------------|
| `new` | `preparing` | Start preparing → |
| `preparing` | `ready` | Mark ready → |
| `ready` | `completed` | Mark completed → |
| `pending_payment` | — | none |
| `completed` | — | none |
| `cancelled` | — | none |
| unknown | — | none |

`nextStatus` returns `null` for the last four rows. The footer then shows the
select alone.

`pending_payment` is deliberately outside the chain. To advance that order is
to say that the money arrived. A merchant makes that decision through the
status list, which asks them to choose the value.

An unknown status returns `null` for the same reason `STATUS_BADGE` falls back
to neutral: an unknown status is a status this module has not been taught, not
a status to guess a successor for.

## Files

The single file becomes a folder, `apps/frontend/src/merchant/orderDetail/`.
The repository already nests `analytics/`, `pixels/` and `store/` this way.

| File | Owns |
|------|------|
| `OrderDetailSheet.tsx` | The `Sheet`, the note/courier/AWB drafts, the three save handlers, and the header/body/footer frame. |
| `DrawerCard.tsx` | The white card itself — a title row, a body, and an optional footer for the card's own save button. |
| `OrderHeader.tsx` | Number, copy, chips, dates, invoice actions and the `⋯` menu. |
| `ItemsCard.tsx` | The line items. |
| `PaymentCard.tsx` | The totals and the payment proof, including the proof fetch effect. |
| `CustomerCard.tsx` | Customer and fulfilment fields. |
| `TrackingCard.tsx` | Courier and AWB, editable or read-only. |
| `NoteCard.tsx` | The note, editable or read-only. |
| `StatusFooter.tsx` | The footer, in both its desktop and its phone shape. |
| `nextStatus.ts` | The advance rule. Pure. |
| `nextStatus.test.ts` | Its tests. |

`OrderDetailSheet` keeps its current props — `order`, `onClose`,
`onOrderUpdated` and `readOnly`. `OrdersView`, `CustomersView` and
`SuspendedScreen` change by one import path only.

The payment proof effect moves into `PaymentCard.tsx` unchanged. It keeps the
`orderId` guard and the `URL.revokeObjectURL` cleanup, because one effect must
still own the whole life of one fetched image.

`DetailRow` is deleted. `Section` is replaced by the card components.

## What does not change

- Every Supabase call. `setOrderStatus`, `setOrderNote` and `setOrderTracking`
  keep their current signatures and their current call sites.
- `onOrderUpdated`. Each save still bubbles the updated order up, so
  `OrdersView` and `CustomersView` patch their own rows.
- The status vocabulary. `ORDER_STATUSES`, `STATUS_LABELS` and `STATUS_BADGE`
  in `orderStatus.tsx` stay as they are.
- The invoice rule. `canIssueInvoice` still decides whether the invoice actions
  exist.
- The order-number copy behaviour, the WhatsApp link and the track-link
  preview.

## Also added

These are cheap because the new structure invites them. None needs a backend
change.

- A copy button on the delivery address.
- The wanted date in the header, beside the placed date.
- The one-click advance button, from `nextStatus`.

## Verification

1. `pnpm test` covers `nextStatus.test.ts`.
2. `pnpm lint` and `pnpm typecheck` must pass.
3. Run the app against local Supabase and drive it, as `CLAUDE.md` requires for
   UI work. Check these paths:
   - open an order from the Orders view, and from the Customers view;
   - advance a `new` order, then a `preparing` order;
   - open a `pending_payment` order and confirm no advance button appears;
   - open a `completed` order and confirm no advance button appears;
   - save a courier and an AWB, then reopen the order;
   - save a note, then reopen the order;
   - open an order that has a payment proof, and view the image;
   - open the suspended-shop view and confirm the footer is absent;
   - repeat the first three checks at 390px width.
