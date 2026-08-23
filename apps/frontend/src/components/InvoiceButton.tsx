import { useState } from 'react'
import { toast } from 'sonner'
import { Download, Loader2 } from 'lucide-react'
import { canIssueInvoice } from '@bitetime/shared'
import { useSession } from '../SessionContext'
import { saveBlob } from '../download'
import { Button } from './ui/button'
import type { Result } from '../api'

/**
 * "Download invoice", wherever an order is on screen.
 *
 * ONE component for three doors — the customer's own history, the merchant's order sheet and the
 * order-placed screen — because the thing that differs between them is only which endpoint proves
 * the caller, and that is a function this takes as an argument. What must NOT differ is when the
 * button appears: `canIssueInvoice` is shared with the backend (`@bitetime/shared`), so a button
 * on screen and an endpoint that answers cannot come apart.
 *
 * Renders nothing at all for an order that cannot be issued one. A `pending_payment` order needs a
 * SENTENCE rather than a hidden button — the customer is waiting on the shop, not on us — and the
 * order-placed screen says it; a disabled button here would say it in every list too.
 */
export default function InvoiceButton({
  status,
  orderNumber,
  fetcher,
  variant = 'link',
  className,
  label,
}: {
  status: string | null | undefined
  orderNumber: string | null | undefined
  fetcher: () => Promise<Result<{ blob: Blob; filename: string | null }>>
  variant?: 'link' | 'soft'
  className?: string
  /**
   * Overrides the label ONLY. The default says the whole thing, because a customer meeting this
   * in their own order history has nothing else on screen naming what downloads. The merchant's
   * sheet passes a short one — its row is already headed INVOICE, and saying the word twice on
   * one line is what made that header read as a wall of text.
   */
  label?: string
}) {
  const { t } = useSession()
  const [busy, setBusy] = useState(false)

  if (!canIssueInvoice(status)) return null

  async function download() {
    setBusy(true)
    const r = await fetcher()
    setBusy(false)
    if (!r.ok) {
      toast.error(t('Could not build the invoice', '无法生成账单'))
      return
    }
    saveBlob(r.data.blob, r.data.filename ?? `Invoice-${orderNumber ?? 'order'}.pdf`)
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={variant === 'link' ? 'none' : undefined}
      onClick={download}
      disabled={busy}
      // The icon and its label sit on ONE line. `size="none"` clears the shared button's own
      // geometry — including the flex it uses to align an icon — so an inline row has to be
      // stated here or the icon stacks above the words.
      className={`inline-flex items-center gap-1.5 ${className ?? ''}`}
    >
      {busy
        ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden />
        : <Download size={14} strokeWidth={1.5} aria-hidden />}
      {label ?? t('Download invoice', '下载账单')}
    </Button>
  )
}
