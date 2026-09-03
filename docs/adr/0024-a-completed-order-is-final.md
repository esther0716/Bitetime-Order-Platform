# 24. A completed order's status is final

Date: 2026-09-02
Status: Accepted. Bounds [ADR 0023](0023-a-cancelled-order-returns-its-redemption.md).

## Context

ADR 0023 made a cancellation release the voucher redemption the order spent. It reasoned about
the orders a shop cancels before it hands anything over — the out-of-stock order, the order that
was never paid for. It did not bound the move that undoes a delivery.

`completed` → `cancelled` is that move, and it is one press of a list the drawer already shows.
The goods are gone, the customer keeps them, and the redemption comes back. The merchant does not
have to intend the exploit for it to happen: a mis-tapped list on a phone frees a slot on their own
voucher and gives no sign that it did.

## Decision

**An order whose status is `completed` accepts no further status change.** The backend refuses the
patch with `409 order_completed`; the drawer draws the badge and a line of text where the control
used to be.

**`completed` alone.** `cancelled` stays changeable: ADR 0023 needs un-cancelling to keep working,
and a merchant correcting their own mis-click is the case that ADR argued for.

**An identical value is not a change.** A patch writing `completed` onto a completed order is a
no-op and returns 200, so a retry is still safe.

**`note`, `courier` and `awb` stay writable.** A shop files an AWB after the delivery, and that is
not a status change. Only the `status` field is frozen.

**The backend is the boundary; the UI is a courtesy.** The control is hidden because a control
nobody may use is noise, but the refusal lives in `PATCH /api/merchants/:id/orders/:orderId`,
after the tenancy guards and before the write.

## Rejected

- **Cancel a completed order, but do not release the redemption.** Keeps the record honest and
  splits the rule in two: the void would stop being "void if and only if the order is cancelled",
  which is the property that makes ADR 0023's write idempotent and self-repairing.
- **Freeze `cancelled` too.** Symmetric and tidy. Rejected: it deletes ADR 0023's un-cancel.
- **Disable the list instead of hiding it.** A disabled list still invites a merchant to open it
  and read six moves, none of which are available.
- **A confirmation dialog on completed → cancelled.** Puts the decision on the merchant every
  time, to stop a thing that should not be possible at all.

## Consequences

- A merchant who completes an order by mistake cannot record a later cancellation on it. They can
  still refund outside the app, and the order's note carries the reason. Judged the cheaper
  failure: the wrong direction hands out a voucher use for delivered goods.
- Every future status control must ask `isStatusFinal` first. There is one today
  (`merchant/orderDetail/StatusFooter.tsx`), and the frontend copy of the rule lives in
  `orderStatus.tsx` next to the vocabulary it belongs to.
