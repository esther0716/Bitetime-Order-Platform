import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { useSession } from '../SessionContext'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

/**
 * The one "are you sure?" for every delete in the app.
 *
 * Controlled, and deliberately so: the row actions that open it (a dropdown item, a × on a
 * thumbnail) live inside table column defs and list maps, so the caller holds "which row" in
 * state and this holds only "is it open" plus the busy flag while `onConfirm` runs.
 *
 * `onConfirm` owns its own failure reporting — every delete handler here already toasts what
 * went wrong — so this closes once the promise settles rather than trying to distinguish a
 * refused delete from a successful one.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void | Promise<void>
  /**
   * Escape hatch for a confirm opened from INSIDE another dialog (the product form's photo and
   * option editors): pass `z-modal-popover` so it paints above its parent popup, the same way
   * the form's Select menu does.
   */
  className?: string
}) {
  const { t } = useSession()
  const [busy, setBusy] = useState(false)
  const descId = useId()

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o) }}>
      {/* Described by our own node rather than DialogDescription: a body may carry a quoted name
          in its own element, and DialogDescription renders a <p>. aria-describedby keeps it read. */}
      <DialogContent aria-describedby={descId} className={className}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div id={descId} className="text-sm text-rose-muted flex flex-col gap-2">{body}</div>
        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel ?? t('Never mind', '取消')}
          </Button>
          <Button type="button" size="sm" variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? t('Deleting…', '删除中…') : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
