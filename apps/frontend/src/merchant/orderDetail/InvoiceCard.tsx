import { useSession } from '../../SessionContext'
import { fetchOrderInvoice } from '../../store'
import { canIssueInvoice } from '@bitetime/shared'
import InvoiceButton from '../../components/InvoiceButton'
import SendInvoiceOnWa from '../SendInvoiceOnWa'
import DrawerCard from './DrawerCard'

/**
 * The one paper this order produces, and the two ways it reaches one customer: the merchant
 * downloads it themselves, or sends the customer the link to fetch their own.
 *
 * These two lived at the end of the header, where a phone had no room for them — so they
 * collapsed into a `⋯` menu, which then had to be gated on whether it would open empty, and
 * which carried a second copy of the download button for the other breakpoint. A card holds
 * both at either size and needs none of that.
 *
 * `canIssueInvoice` gates the whole card, label included: an un-invoiceable order shows no
 * orphaned caption. `SendInvoiceOnWa` gates itself again on top — it carries the LINK to that
 * customer's own invoice door, never the file (see `invoiceShare.ts`), so it draws nothing
 * without a dialable number, and a guest order gets the download alone.
 */
export default function InvoiceCard({
  order,
  merchantId,
  readOnly,
}: {
  order: any
  merchantId: string
  readOnly: boolean
}) {
  const { t } = useSession()
  if (!canIssueInvoice(order.status)) return null

  return (
    <DrawerCard title={t('Invoice', '账单')}>
      <div className="flex items-center gap-5 flex-wrap">
        <InvoiceButton
          status={order.status}
          orderNumber={order.order_number}
          fetcher={() => fetchOrderInvoice(merchantId, order.id)}
          className="text-[13px]"
          label={t('Download invoice', '下载账单')}
        />
        {!readOnly && (
          <SendInvoiceOnWa
            status={order.status}
            orderNumber={order.order_number}
            customerWa={order.customer_wa}
            customerName={order.customer_name}
          />
        )}
      </div>
    </DrawerCard>
  )
}
