import { useSession } from '../../SessionContext'
import { COURIERS, trackingUrl, courierName } from '../../couriers'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DrawerCard, { LBL, Field, FIELD_GRID, CardSaveButton } from './DrawerCard'

/**
 * The courier and the air waybill, said ONCE.
 *
 * They used to be drawn twice — as read-only rows under `Fulfilment`, and as this form — with
 * a condition on the mode and on `readOnly` picking between them. Two renderings of one fact
 * is two places to change it. This component renders the inputs when the merchant may edit
 * them and the same two facts as text when they may not.
 */
export default function TrackingCard({
  order,
  courier,
  awb,
  onCourier,
  onAwb,
  onSave,
  saving,
  dirty,
  readOnly,
}: {
  order: any
  courier: string
  awb: string
  onCourier: (v: string) => void
  onAwb: (v: string) => void
  onSave: () => void
  saving: boolean
  dirty: boolean
  readOnly: boolean
}) {
  const { t } = useSession()
  const courierItems = COURIERS.map(c => ({ value: c.code, label: c.name }))
  const editable = order.mode === 'delivery' && !readOnly

  // Nothing to say and nothing to enter — a card headed TRACKING with two em dashes under it
  // tells a merchant less than no card at all.
  if (!editable && !order.courier && !order.awb) return null

  if (!editable) {
    return (
      <DrawerCard title={t('Tracking', '物流')}>
        <div className={FIELD_GRID}>
          {order.courier && (
            <Field label={t('Courier', '快递公司')}>
              {courierName(order.courier) || order.courier}
            </Field>
          )}
          {order.awb && (
            <Field label={t('AWB / Tracking no.', '运单号')}>
              <span className="tabular-nums">{order.awb}</span>
            </Field>
          )}
        </div>
      </DrawerCard>
    )
  }

  const preview = trackingUrl(courier, awb)

  return (
    <DrawerCard
      title={t('Tracking', '物流')}
      footer={
        <CardSaveButton
          label={t('Save tracking', '保存物流')}
          savingLabel={t('Saving…', '保存中…')}
          saving={saving}
          dirty={dirty}
          onSave={onSave}
        />
      }
    >
      <div className={FIELD_GRID}>
        <div className="flex flex-col gap-1 min-w-0">
          <label className={LBL} htmlFor={`courier-${order.id}`}>{t('Courier', '快递公司')}</label>
          <Select
            // `courier` stays a string; Base UI spells "nothing selected" as null, so the two
            // meet here rather than anywhere downstream.
            value={courier || null}
            onValueChange={v => onCourier(v ?? '')}
            items={courierItems}
          >
            <SelectTrigger id={`courier-${order.id}`} className="w-full bg-background text-[13px]">
              <SelectValue placeholder={t('Select courier…', '选择快递…')} />
            </SelectTrigger>
            <SelectContent>
              {courierItems.map(c => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1 min-w-0">
          <label className={LBL} htmlFor={`awb-${order.id}`}>{t('AWB / Tracking no.', '运单号')}</label>
          <Input
            id={`awb-${order.id}`}
            value={awb}
            onChange={e => onAwb(e.target.value)}
            placeholder={t('e.g. 630123456789', '例如 630123456789')}
            className="text-[13px] bg-background border-border"
          />
        </div>
      </div>

      {preview && (
        <a
          href={preview}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-[13px] text-primary font-medium hover:underline w-fit"
        >
          {t('Preview track link →', '预览追踪链接 →')}
        </a>
      )}
    </DrawerCard>
  )
}
