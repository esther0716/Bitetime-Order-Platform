import { Copy } from 'lucide-react'
import { useSession } from '../../SessionContext'
import { formatAddress } from '../../address'
import { formatCalendarDate } from '../../orderDate'
import { fulfilmentLabel } from '../../fulfilmentLabel'
import WaLink from '../WaLink'
import { Button } from '@/components/ui/button'
import DrawerCard, { Field, FIELD_GRID } from './DrawerCard'
import { copyText } from './copyText'

/**
 * Who the order is for and where it goes.
 *
 * These were two groups, `Customer` and `Fulfilment`, and the second drew its rows through a
 * fixed 84px label column — which left a delivery address about 300px to wrap in, so a real
 * Malaysian address took three lines. `Field` puts the label ABOVE its value, and the address
 * spans both columns, so it gets the full width of the card.
 */
export default function CustomerCard({ order }: { order: any }) {
  const { t, lang } = useSession()
  const address = order.address ? formatAddress(order.address) : null


  return (
    <DrawerCard title={t('Customer & delivery', '顾客与配送')}>
      <div className={FIELD_GRID}>
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
                  onClick={() => copyText(address, { en: 'Address copied', zh: '地址已复制' }, t)}
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
