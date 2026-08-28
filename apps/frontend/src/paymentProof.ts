/**
 * Whether a customer may still attach proof of payment to one of their own orders.
 *
 * The order-placed screen offers the upload once and never again — a customer who closed the tab
 * before uploading has nowhere to put the slip, which is the same gap the merchant's own slot
 * fills from the other side. Order history offers it a second time, for the orders where it can
 * still mean something.
 *
 * `completed` and `cancelled` are out. A receipt cannot revive a cancelled order — the intake
 * rule only ever moves an order OUT of `pending_payment` and leaves every other status alone —
 * and offering an upload that changes nothing reads as a promise the app does not keep.
 *
 * An unknown status is out too: this file has not been taught it, and the safe reading of a
 * status we cannot place is "do not offer", matching how `orderStatus.tsx` renders one neutral
 * rather than guessing a colour.
 */
const UPLOADABLE_STATUSES = ['pending_payment', 'new', 'preparing', 'ready']

export function canUploadPaymentProof(status: string | null | undefined): boolean {
  return status != null && UPLOADABLE_STATUSES.includes(status)
}
