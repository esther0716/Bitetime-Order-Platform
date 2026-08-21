import { MessageCircle } from 'lucide-react'
import { canIssueInvoice } from '@bitetime/shared'
import { useSession } from '../SessionContext'
import { invoiceLookupUrl, invoiceWaMessage, invoiceWaShareHref } from '../invoiceShare'
import { Button } from '../components/ui/button'

/**
 * "Send invoice on WhatsApp", on the merchant's order sheet.
 *
 * A LINK, not a fetch: it opens the customer's WhatsApp chat with a sentence already typed, and
 * the merchant presses send. Nothing is sent from here and nothing is recorded — see
 * `invoiceShare.ts` for why a PDF cannot travel this way at all.
 *
 * Merchant-side only. The customer's own history and the order-placed screen already hand them
 * `InvoiceButton`; a customer has no one to send their own invoice to.
 *
 * Renders NOTHING rather than a disabled control, in three cases, and each is a different fact:
 * an order too early to be invoiced (`canIssueInvoice`, the same shared rule the download button
 * and the endpoint use, so a button on screen and a door that answers cannot come apart), an
 * order with no number yet, and a stored number with nothing dialable in it.
 */
export default function SendInvoiceOnWa({
  status,
  orderNumber,
  customerWa,
  customerName,
}: {
  status: string | null | undefined
  orderNumber: string | null | undefined
  customerWa: string | null | undefined
  customerName: string | null | undefined
}) {
  const { t, merchant } = useSession()

  if (!merchant || !orderNumber || !customerWa || !canIssueInvoice(status)) return null

  const url = invoiceLookupUrl(window.location.origin, merchant.slug, orderNumber)
  const message = invoiceWaMessage(
    { shopName: merchant.name, customerName, orderNumber, url },
    t,
  )
  const href = invoiceWaShareHref(customerWa, message)
  if (href === null) return null

  return (
    <Button
      variant="link"
      size="none"
      // Same one-line row as `InvoiceButton` beside it: `size="none"` clears the shared button's
      // own flex, so an inline icon + label has to be stated here or the icon stacks above.
      className="inline-flex items-center gap-1.5 text-[13px] w-fit"
      render={<a href={href} target="_blank" rel="noopener noreferrer" />}
    >
      <MessageCircle size={14} strokeWidth={1.5} aria-hidden />
      {t('Send invoice on WhatsApp', '通过 WhatsApp 发送账单')}
    </Button>
  )
}
