import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { useSession } from '../../SessionContext'
import { formatAddress } from '../../address'
import { formatCalendarDate } from '../../orderDate'
import { fulfilmentLabel } from '../../fulfilmentLabel'
import WaLink from '../WaLink'
import { Button } from '@/components/ui/button'
import DrawerCard, { LBL } from './DrawerCard'

/**
 * Who the order is for and where it goes.
 *
 * These were two groups, `Customer` and `Fulfilment`, and the second drew its rows through a
 * fixed 84px label column — which left a delivery address about 300px to wrap in, so a real
 * Malaysian address took three lines. The label sits ABOVE its value now, and the field spans
 * both columns, so the address gets the full width of the card.
 */
function Field({
  label,
  action,
  children,
}: {
  label: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className={`${LBL} flex items-center gap-1`}>{label}{action}</span>
      <span className="text-[13px] text-foreground break-words">{children}</span>
    </div>
  )
}

export default function CustomerCard({ order }: { order: any }) {
  const { t, lang } = useSession()
  const address = order.address ? formatAddress(order.address) : null

  const copyAddress = async (a: string) => {
    try {
      await navigator.clipboard.writeText(a)
      toast.success(t('Address copied', '地址已复制'))
    } catch {
      toast.error(t('Could not copy — copy it manually', '无法复制 — 请手动复制'))
    }
  }

  return (
    <DrawerCard title={t('Customer & delivery', '顾客与配送')}>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-x-6">
        <Field label={t('Customer', '顾客')}>
          {order.customer_name || '—'}
        </Field>

        {order.customer_wa && (
          <Field label={t('WhatsApp', 'WhatsApp')}>
            <WaLink wa={order.customer_wa} />
          </Field>
        )}

        <Field label={t('Fulfilment', '配送')}>
          {/* The date the CUSTOMER asked for, shown as `—` rather than omitted for a legacy
              order: a missing row would read as "this order has no fulfilment info" rather
              than "placed before #91". */}
          {fulfilmentLabel(order.mode, t)}
          {' · '}
          {order.fulfil_date ? formatCalendarDate(order.fulfil_date, lang) : '—'}
        </Field>

        {order.region && (
          <Field label={t('Region', '地区')}>{order.region}</Field>
        )}

        {address && (
          <div className="sm:col-span-2">
            <Field
              label={t('Address', '地址')}
              action={
                <Button
                  variant="ghost"
                  size="iconRound"
                  className="size-5"
                  aria-label={t('Copy address', '复制地址')}
                  onClick={() => copyAddress(address)}
                >
                  <Copy className="size-3" />
                </Button>
              }
            >
              {address}
            </Field>
          </div>
        )}
      </div>
    </DrawerCard>
  )
}
