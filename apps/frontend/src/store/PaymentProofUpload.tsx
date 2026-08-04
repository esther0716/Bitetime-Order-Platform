import { useState } from 'react'
import { toast } from 'sonner'
import { useSession } from '../SessionContext'
import { uploadPaymentProof, MAX_PAYMENT_PROOF_BYTES, PAYMENT_PROOF_TYPES } from '../store'

type UploadState = 'idle' | 'uploading' | 'uploaded' | 'error'

/**
 * Optional proof-of-payment upload, shown under the shop's payment QR/bank details on the
 * order-placed screen. No gating anywhere: the customer can skip it, upload later (outside the
 * app), or replace what they already sent — this widget has no memory of a page reload, matching
 * the QR block it sits under, which is also never shown anywhere else.
 */
export default function PaymentProofUpload({ orderId }: { orderId: string }) {
  const { t } = useSession()
  const [state, setState] = useState<UploadState>('idle')

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (!PAYMENT_PROOF_TYPES.includes(file.type)) {
      toast.error(t('Unsupported image type', '不支持的图片格式'))
      return
    }
    if (file.size > MAX_PAYMENT_PROOF_BYTES) {
      toast.error(t('Image too large (max 2MB)', '图片过大（最大 2MB）'))
      return
    }
    setState('uploading')
    const r = await uploadPaymentProof(orderId, file)
    if (r.ok) {
      setState('uploaded')
      toast.success(t('Payment proof uploaded', '付款凭证已上传'))
    } else {
      setState('error')
      toast.error(t('Could not upload — try again', '上传失败，请重试'))
    }
  }

  const inputId = `payment-proof-${orderId}`

  return (
    <div className="mt-3 flex flex-col items-center gap-1.5">
      <label
        htmlFor={inputId}
        className="text-[13px] font-medium text-oxblood underline cursor-pointer"
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
        <span className="text-[12px] text-rose-muted">{t('Uploading…', '上传中…')}</span>
      )}
      {state === 'uploaded' && (
        <span className="text-[12px] text-rose-muted">{t('Uploaded ✓', '已上传 ✓')}</span>
      )}
    </div>
  )
}
