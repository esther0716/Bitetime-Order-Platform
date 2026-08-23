import { useState } from 'react'
import { useSession } from '../../SessionContext'
import { setOrderStatus, setOrderNote, setOrderTracking } from '../../store'
import { toast } from 'sonner'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import OrderHeader from './OrderHeader'
import StatusFooter from './StatusFooter'
import ItemsCard from './ItemsCard'
import PaymentCard from './PaymentCard'
import InvoiceCard from './InvoiceCard'
import CustomerCard from './CustomerCard'
import TrackingCard from './TrackingCard'
import NoteCard from './NoteCard'

// The order-detail drawer, shared by OrdersView and CustomersView. Open when
// `order` is non-null; owns its own note/courier/awb drafts and bubbles every
// status/note/tracking save up via `onOrderUpdated` so the parent can patch its
// own list.
export default function OrderDetailSheet({
  order,
  onClose,
  onOrderUpdated,
  readOnly = false,
}: {
  order: any | null
  onClose: () => void
  onOrderUpdated: (o: any) => void
  readOnly?: boolean
}) {
  const { t, merchant } = useSession()
  const [noteDraft, setNoteDraft] = useState('')
  const [drawerFor, setDrawerFor] = useState<string | undefined>(undefined)
  const [savingNote, setSavingNote] = useState(false)
  const [courierDraft, setCourierDraft] = useState('')
  const [awbDraft, setAwbDraft] = useState('')
  const [savingTrack, setSavingTrack] = useState(false)

  // Re-seed the drafts when a different order opens (adjust-state-during-render:
  // keyed on id so a status/note/tracking patch that replaces `order` mid-view
  // keeps typing).
  if (order && order.id !== drawerFor) {
    setDrawerFor(order.id)
    setNoteDraft(order.note ?? '')
    setCourierDraft(order.courier ?? '')
    setAwbDraft(order.awb ?? '')
  }

  function handleStatusChange(o: any, status: string) {
    setOrderStatus(o.id, status, merchant!.id).then(r => {
      if (r.ok) onOrderUpdated(r.data)
      else toast.error(t('Could not update order status.', '无法更新订单状态。'))
    })
  }

  function handleNoteSave() {
    if (!order) return
    setSavingNote(true)
    setOrderNote(order.id, noteDraft, merchant!.id).then(r => {
      if (r.ok) {
        onOrderUpdated(r.data)
        toast.success(t('Note saved', '备注已保存'))
      } else {
        toast.error(t('Could not save note.', '无法保存备注。'))
      }
    }).finally(() => setSavingNote(false))
  }

  function handleTrackingSave() {
    if (!order) return
    setSavingTrack(true)
    setOrderTracking(order.id, courierDraft || null, awbDraft, merchant!.id).then(r => {
      if (r.ok) {
        onOrderUpdated(r.data)
        toast.success(t('Tracking saved', '物流已保存'))
      } else {
        toast.error(t('Could not save tracking.', '无法保存物流。'))
      }
    }).finally(() => setSavingTrack(false))
  }

  const orderCurrency = order?.currency ?? merchant?.currency
  const noteDirty = order != null && noteDraft.trim() !== (order.note ?? '')
  const trackDirty = order != null &&
    (courierDraft !== (order.courier ?? '') || awbDraft.trim() !== (order.awb ?? ''))

  return (
    <Sheet open={order !== null} onOpenChange={open => { if (!open) { onClose(); setDrawerFor(undefined) } }}>
      {/* `data-[side=right]:sm:max-w-[680px]`, not a bare `sm:max-w-[680px]`: the base
          SheetContent already carries `data-[side=right]:sm:max-w-sm`, and a plain utility
          has one variant against its two, so Tailwind orders it FIRST and the base wins.
          Matching the variant lets tailwind-merge drop the base one instead. `w-full` has the
          same problem against the base's `data-[side=right]:w-3/4`, and loses it the same way —
          which left a phone drawer three quarters of the screen wide with a dead strip beside
          it — so the width is spelled with the variant too.
          `gap-0` and `overflow-hidden` undo the base popup's `gap-4` and let the body be the
          only thing that scrolls. */}
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-[680px] gap-0 overflow-hidden"
      >
        {order && (
          <>
            <OrderHeader order={order} />

            <div className="flex-1 min-h-0 overflow-y-auto bg-background flex flex-col gap-3 p-3 sm:p-4">
              <ItemsCard items={order.items ?? []} currency={orderCurrency} />
              <PaymentCard order={order} currency={orderCurrency} merchantId={merchant!.id} />
              <InvoiceCard order={order} merchantId={merchant!.id} readOnly={readOnly} />
              <CustomerCard order={order} />

              <TrackingCard
                order={order}
                courier={courierDraft}
                awb={awbDraft}
                onCourier={setCourierDraft}
                onAwb={setAwbDraft}
                onSave={handleTrackingSave}
                saving={savingTrack}
                dirty={trackDirty}
                readOnly={readOnly}
              />

              <NoteCard
                note={noteDraft}
                saved={order.note ?? null}
                onChange={setNoteDraft}
                onSave={handleNoteSave}
                saving={savingNote}
                dirty={noteDirty}
                readOnly={readOnly}
              />
            </div>

            {!readOnly && (
              <StatusFooter
                status={order.status || 'new'}
                onChange={s => handleStatusChange(order, s)}
              />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
