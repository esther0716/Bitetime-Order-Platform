/**
 * When an order may produce an invoice.
 *
 * Shared because it must hold identically on BOTH sides of the wire, which is the only thing that
 * belongs in this package. The browser reads it to decide whether to offer the download at all;
 * the backend reads it to decide whether to answer one. Two copies would show a customer a button
 * that answers 404 — or, worse, hide a button for an order the endpoint would have issued.
 *
 * `pending_payment` is refused because the shop has confirmed nothing: at a shop taking manual
 * payment an order is BORN in that status, and a document titled Invoice for money nobody has
 * seen is a claim the platform cannot make. `cancelled` is refused because nothing happened.
 *
 * An unrecognised status — an old row, a status added later and not taught here — reads as no.
 * Refusing to issue is recoverable; issuing for a state nobody considered is not.
 */
export const INVOICE_STATUSES = ['new', 'preparing', 'ready', 'completed'] as const

export function canIssueInvoice(status: string | null | undefined): boolean {
  return (INVOICE_STATUSES as readonly string[]).includes(status ?? '')
}
