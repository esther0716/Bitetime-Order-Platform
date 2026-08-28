import { useState, type ReactNode } from 'react'
import { useSession } from '../SessionContext'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * A thumbnail that opens its own full-size image in a modal.
 *
 * Not `ImageLightbox`, which is the product GALLERY beside it: that one takes Storage paths, owns
 * several images with arrow-key paging, and is driven by a caller that holds the open state. This
 * takes ONE resolved src, renders the thumbnail itself, and owns its own open state.
 *
 * Every payment image — the customer's slip, the receipt the shop filed, the shop's payment QR —
 * used to be an `<a target="_blank">`. On a phone that is a new browser tab the reader has to
 * find their way back from, and on the merchant dashboard it threw the order sheet away to show
 * one screenshot. The image is a detail of the page it sits on, so it opens over that page.
 *
 * The trigger keeps its own sizing: 78px in the dashboard's two-slot row, 160px in order
 * history, full width for a QR. Only the modal is shared — one behaviour, four call sites.
 *
 * `caption` is the line under the thumbnail, if any; it stays outside the button, so a screen
 * reader gets the image's own `alt` for the control and the caption as plain text beside it.
 */
export default function ZoomableImage({
  src,
  alt,
  title,
  triggerClassName,
  imgClassName,
  caption,
}: {
  src: string
  alt: string
  /** The modal's accessible name. Falls back to `alt`, which is usually the same sentence. */
  title?: string
  triggerClassName?: string
  imgClassName?: string
  caption?: ReactNode
}) {
  const { t } = useSession()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('block cursor-pointer', triggerClassName)}
      >
        <img src={src} alt={alt} className={imgClassName} />
      </button>
      {caption}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle className="sr-only">{title ?? alt}</DialogTitle>
          <div className="flex items-center justify-center bg-background rounded-lg overflow-hidden">
            <img
              src={src}
              alt={t('Enlarged image', '放大的图片')}
              className="max-h-[70vh] w-full object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
