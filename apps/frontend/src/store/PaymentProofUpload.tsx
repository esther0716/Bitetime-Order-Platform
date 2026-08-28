import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useSession } from '../SessionContext'
import { uploadPaymentProof, PAYMENT_PROOF_TYPES, type PaymentProofSaved } from '../store'
import ZoomableImage from '../components/ZoomableImage'

type UploadState = 'idle' | 'uploading' | 'uploaded' | 'error'

/**
 * Optional proof-of-payment upload, shown under the shop's payment QR/bank details on the
 * order-placed screen. No gating anywhere: the customer can skip it, upload later (outside the
 * app), or replace what they already sent — this widget has no memory of a page reload, matching
 * the QR block it sits under, which is also never shown anywhere else.
 *
 * Type/size checks live once, in `uploadPaymentProof` itself — not repeated here, matching
 * `PaymentQrPicker`'s sibling shape (a single call, one branch on the Result).
 *
 * The thumbnail is the FILE the customer just picked, previewed locally with an object URL —
 * never a re-fetch from the backend. The bucket is private and unauthenticated, so there is
 * nothing for a guest checkout to re-fetch from; the browser already holds the only copy that
 * matters to it.
 *
 * `onUploaded` carries what the write moved (the path, and a status that may have left
 * `pending_payment`) to a caller that shows the order elsewhere on the page — order history,
 * whose badge and timeline would otherwise sit stale until a reload. The order-placed screen
 * has nothing to patch and passes nothing.
 */
export default function PaymentProofUpload({
  orderId,
  onUploaded,
}: {
  orderId: string
  onUploaded?: (saved: PaymentProofSaved) => void
}) {
  const { t } = useSession()
  const [state, setState] = useState<UploadState>('idle')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)

  useEffect(() => {
    previewUrlRef.current = previewUrl
  }, [previewUrl])

  // Revoke whatever's left on unmount — a replace mid-lifetime is revoked at the point of
  // replacement (handleFile), not here; this only covers the final one.
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
  }, [])

  async function handleFile(file: File | undefined) {
    if (!file) return
    setState('uploading')
    const r = await uploadPaymentProof(orderId, file)
    if (r.ok) {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(file)
      })
      setState('uploaded')
      toast.success(t('Payment proof uploaded', '付款凭证已上传'))
      onUploaded?.(r.data)
    } else {
      setState('error')
      toast.error(r.error.message || t('Could not upload — try again', '上传失败，请重试'))
    }
  }

  const inputId = `payment-proof-${orderId}`

  return (
    <div className="mt-3 flex flex-col items-center gap-1.5">
      {state === 'uploaded' && previewUrl && (
        <ZoomableImage
          src={previewUrl}
          alt={t('Payment proof', '付款凭证')}
          triggerClassName="w-full max-w-[160px] rounded-md bg-white p-1.5 border border-border"
          imgClassName="w-full h-auto object-contain"
        />
      )}
      <label
        htmlFor={inputId}
        className="text-[13px] font-medium text-primary underline cursor-pointer"
      >
        {state === 'uploaded'
          ? t('Replace payment proof', '替换付款凭证')
          : t('Upload payment proof (optional)', '上传付款凭证（可选）')}
      </label>
      <input
        id={inputId}
        type="file"
        accept={PAYMENT_PROOF_TYPES.join(',')}
        className="sr-only"
        disabled={state === 'uploading'}
        onChange={(e) => {
          void handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {state === 'uploading' && (
        <span className="text-[12px] text-muted-foreground">{t('Uploading…', '上传中…')}</span>
      )}
      {state === 'uploaded' && (
        <span className="text-[12px] text-muted-foreground">
          {t('Uploaded ✓ · tap to enlarge', '已上传 ✓ · 点击放大')}
        </span>
      )}
    </div>
  )
}
