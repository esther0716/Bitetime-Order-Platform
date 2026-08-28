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

/**
 * Whether this shop has anything to say about how to pay it — a bank line, a note, or a QR.
 *
 * The three are independent and any one is enough: plenty of shops give only a QR, and plenty
 * give only an account number. A shop with none of them takes payment some other way, and
 * showing it an empty "Payment Instructions" box states a problem that does not exist.
 */
export function hasPaymentInstructions(
  merchant: { payment_bank?: string | null; payment_note?: string | null; payment_qr?: string | null } | null | undefined,
): boolean {
  if (!merchant) return false
  return Boolean(merchant.payment_bank || merchant.payment_note || merchant.payment_qr)
}
