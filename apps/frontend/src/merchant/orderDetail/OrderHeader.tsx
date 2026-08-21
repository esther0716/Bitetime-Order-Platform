import { toast } from 'sonner'
import { Copy, MoreHorizontal } from 'lucide-react'
import { useSession } from '../../SessionContext'
import { fetchOrderInvoice } from '../../store'
import { fmtDateTime } from '../../merchantDate'
import { formatCalendarDate } from '../../orderDate'
import { StatusBadge } from '../../orderStatus'
import { fulfilmentLabel } from '../../fulfilmentLabel'
import { canIssueInvoice } from '@bitetime/shared'
import InvoiceButton from '../../components/InvoiceButton'
import SendInvoiceOnWa from '../SendInvoiceOnWa'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'

/**
 * The drawer's header says WHICH order this is, and nothing else.
 *
 * It used to also carry a row of invoice controls, captioned INVOICE, under a title that is
 * mostly an order number — which wrapped onto its own line and made the header read as a wall
 * of text. Those controls now sit at the end of the title row, and on a phone they collapse
 * into one `⋯` menu.
 *
 * That menu is a Popover and not a DropdownMenu on purpose: `InvoiceButton` and
 * `SendInvoiceOnWa` each render their own button or anchor, and a `DropdownMenuItem` is
 * `role="menuitem"` — which would nest an interactive element inside an interactive one. A
 * popover panel has no such semantics, so both components go in untouched.
 */
export default function OrderHeader({
  order,
  readOnly,
  merchantId,
}: {
  order: any
  readOnly: boolean
  merchantId: string
}) {
  const { t, lang } = useSession()
  const invoiceable = canIssueInvoice(order.status)
  // Below `sm` the panel always has something to hold — copy and download live there. At `sm`
  // and above those two are visible in the row instead, so the only entry left is the WhatsApp
  // send, which a suspended shop does not get. Without this the desktop `⋯` would open an
  // empty panel.
  const menuOnDesktop = !readOnly

  // The number is what a merchant reads back to a customer on the phone or pastes into their
  // own books. Selecting six characters of a sheet title on a phone is the fiddly part.
  const copyOrderNumber = async (n: string) => {
    try {
      await navigator.clipboard.writeText(n)
      toast.success(t('Order number copied', '订单号已复制'))
    } catch {
      toast.error(t('Could not copy — copy it manually', '无法复制 — 请手动复制'))
    }
  }

  return (
    <SheetHeader className="shrink-0 border-b border-border pr-9">
      <div className="flex items-center gap-2">
        <SheetTitle className="text-[17px] sm:text-[19px]">{order.order_number || '—'}</SheetTitle>
        {order.order_number && (
          <Button
            variant="ghost"
            size="iconRound"
            aria-label={t('Copy order number', '复制订单号')}
            onClick={() => copyOrderNumber(order.order_number!)}
            className="hidden sm:inline-flex"
          >
            <Copy className="size-3.5" />
          </Button>
        )}

        {invoiceable && (
          <>
            {/* Visible on a desktop, where there is room for a word. On a phone the same
                action lives in the panel below. Two instances, but they are breakpoint
                exclusive — only one is ever on screen. */}
            <span className="ml-auto hidden sm:inline-flex">
              <InvoiceButton
                status={order.status}
                orderNumber={order.order_number}
                fetcher={() => fetchOrderInvoice(merchantId, order.id)}
                className="text-[13px]"
                label={t('Download invoice', '下载账单')}
              />
            </span>

            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="iconRound"
                    aria-label={t('More actions', '更多操作')}
                    className={cn('ml-auto sm:ml-0', !menuOnDesktop && 'sm:hidden')}
                  />
                }
              >
                <MoreHorizontal className="size-4" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto min-w-[190px] flex flex-col items-start gap-2.5 p-3">
                {order.order_number && (
                  <Button
                    variant="link"
                    size="none"
                    className="sm:hidden inline-flex items-center gap-1.5 text-[13px] text-foreground"
                    onClick={() => copyOrderNumber(order.order_number!)}
                  >
                    <Copy className="size-3.5" />
                    {t('Copy order number', '复制订单号')}
                  </Button>
                )}
                <span className="sm:hidden">
                  <InvoiceButton
                    status={order.status}
                    orderNumber={order.order_number}
                    fetcher={() => fetchOrderInvoice(merchantId, order.id)}
                    className="text-[13px]"
                    label={t('Download invoice', '下载账单')}
                  />
                </span>
                {/* A WhatsApp message the merchant presses send on. It carries the LINK to
                    that customer's own invoice door, never the file — see `invoiceShare.ts`.
                    It renders null with no WhatsApp number, which is why the panel sizes to
                    its content rather than to a fixed row count. */}
                {!readOnly && (
                  <SendInvoiceOnWa
                    status={order.status}
                    orderNumber={order.order_number}
                    customerWa={order.customer_wa}
                    customerName={order.customer_name}
                  />
                )}
              </PopoverContent>
            </Popover>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-1.5">
        <StatusBadge status={order.status || 'new'} t={t} />
        <Badge className="bg-neutral-100 text-neutral-fg border-transparent">
          {fulfilmentLabel(order.mode, t)}
        </Badge>
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-1 text-[12px] text-muted-foreground">
        <span>{t('Placed', '下单')} {fmtDateTime(order.created_at)}</span>
        {/* The date the CUSTOMER asked for — what the merchant schedules around — not
            `created_at` beside it. Shown as `—` rather than dropped for a legacy order: a
            missing date would read as "this order has no fulfilment info" rather than
            "placed before #91". */}
        <span aria-hidden="true" className="text-border">·</span>
        <span>
          {t('For', '取货日期')}{' '}
          {order.fulfil_date ? formatCalendarDate(order.fulfil_date, lang) : '—'}
        </span>
      </div>
    </SheetHeader>
  )
}
