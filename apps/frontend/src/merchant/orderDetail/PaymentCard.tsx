import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useSession } from '../../SessionContext'
import {
  fetchPaymentProof,
  fetchMerchantPaymentProof,
  uploadMerchantPaymentProof,
  PAYMENT_PROOF_TYPES,
  type MerchantProofSaved,
} from '../../store'
import { formatMoney } from '../../currency'
import { formatTaxRate } from '../../taxRate'
import { Badge } from '@/components/ui/badge'
import DrawerCard from './DrawerCard'
import ZoomableImage from '../../components/ZoomableImage'

/**
 * What is owed, and what either side sent to show it was paid.
 *
 * The proof used to be its own section three groups above the total it proves. It sits beside
 * the money now — on a desktop next to the summary, and under it on a phone, where there is no
 * width for a column.
 *
 * TWO slots, never one: `payment_proof` is what the CUSTOMER attached on the order-placed screen,
 * `payment_proof_merchant` is what the SHOP filed for a customer who closed the browser and sent
 * the slip over WhatsApp instead. Filing one can never overwrite the other.
 */

/**
 * One fetched proof image, or null. `kind` picks the route rather than a passed-in function, so
 * every dependency here is a primitive and the effect re-runs on exactly the three things that
 * change which bytes are wanted.
 *
 * `orderId` on the record is what proves a fetched url still belongs to the order on screen —
 * switching to a different order (proof or not) must not keep showing the last one's image while
 * its own fetch is still in flight. ONE effect owns the whole lifecycle of one fetched image — it
 * revokes the url ITS OWN fetch created, in ITS OWN cleanup — so switching orders or unmounting
 * always revokes, not just "a new proof landed".
 */
function useProofUrl(
  merchantId: string,
  orderId: string | undefined,
  path: string | null | undefined,
  kind: 'customer' | 'merchant',
): string | null {
  const [proof, setProof] = useState<{ orderId: string; url: string } | null>(null)

  // Lazy: only fetched when the drawer is open for an order that actually has one, not on every
  // dashboard list render.
  useEffect(() => {
    if (!orderId || !path) return
    let cancelled = false
    let url: string | null = null
    const load = kind === 'merchant' ? fetchMerchantPaymentProof : fetchPaymentProof
    load(merchantId, orderId).then((r) => {
      if (cancelled || !r.ok) return
      url = URL.createObjectURL(r.data)
      setProof({ orderId, url })
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [merchantId, orderId, path, kind])

  return proof && proof.orderId === orderId ? proof.url : null
}

/** A thumbnail under its own caption. Opens the full image over the sheet, not in a new tab —
 *  a merchant checking a slip mid-order must not lose the order to look at it. */
function ProofThumb({ url, caption, alt }: { url: string; caption: string; alt: string }) {
  return (
    <div className="flex flex-col items-center gap-1 w-[78px]">
      <ZoomableImage
        src={url}
        alt={alt}
        triggerClassName="w-[78px]"
        imgClassName="w-[78px] h-[78px] object-cover rounded-lg border border-border"
        caption={
          <span className="text-[11px] text-muted-foreground text-center leading-tight">{caption}</span>
        }
      />
    </div>
  )
}

/**
 * The shop's own slot: a thumbnail once there is one, and the file input either way.
 *
 * After an upload the thumbnail is the FILE the merchant just picked, previewed locally with an
 * object URL — not a re-fetch, which would be a round trip for bytes the browser already holds.
 * That local preview outranks the fetched one for as long as the sheet stays open.
 */
function MerchantProofSlot({
  merchantId,
  order,
  onUploaded,
}: {
  merchantId: string
  order: any
  onUploaded: (saved: MerchantProofSaved) => void
}) {
  const { t } = useSession()
  const orderId = order?.id as string | undefined
  const fetchedUrl = useProofUrl(merchantId, orderId, order?.payment_proof_merchant, 'merchant')
  const [picked, setPicked] = useState<{ orderId: string; url: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const pickedUrlRef = useRef<string | null>(null)

  useEffect(() => {
    pickedUrlRef.current = picked?.url ?? null
  }, [picked])

  // Revoke whatever's left on unmount — a replace mid-lifetime is revoked at the point of
  // replacement (handleFile), not here; this only covers the final one.
  useEffect(() => () => {
    if (pickedUrlRef.current) URL.revokeObjectURL(pickedUrlRef.current)
  }, [])

  async function handleFile(file: File | undefined) {
    if (!file || !orderId) return
    setUploading(true)
    const r = await uploadMerchantPaymentProof(merchantId, orderId, file)
    setUploading(false)
    if (!r.ok) {
      toast.error(r.error.message || t('Could not upload — try again', '上传失败，请重试'))
      return
    }
    setPicked((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return { orderId, url: URL.createObjectURL(file) }
    })
    toast.success(t('Receipt saved', '收据已保存'))
    // The row now carries a path and, if it was pending_payment, a new status. The route hands
    // both back, so the sheet patches its list from the write's own result — never a guess, and
    // never a refetch.
    onUploaded(r.data)
  }

  const localUrl = picked && picked.orderId === orderId ? picked.url : null
  const url = localUrl ?? fetchedUrl
  const has = Boolean(localUrl || order?.payment_proof_merchant)
  const inputId = `merchant-payment-proof-${orderId ?? 'none'}`

  return (
    <div className="flex flex-col items-center gap-1">
      {url ? (
        <ProofThumb
          url={url}
          alt={t('Receipt filed by the shop', '店家上传的收据')}
          caption={t('Filed by you', '你上传的')}
        />
      ) : (
        has && <span className="text-[13px] text-muted-foreground">{t('Loading…', '加载中…')}</span>
      )}
      <label
        htmlFor={inputId}
        className="text-[12px] font-medium text-primary underline cursor-pointer text-center"
      >
        {uploading
          ? t('Uploading…', '上传中…')
          : has
            ? t('Replace receipt', '替换收据')
            : t('Upload receipt', '上传收据')}
      </label>
      <input
        id={inputId}
        type="file"
        accept={PAYMENT_PROOF_TYPES.join(',')}
        className="sr-only"
        disabled={uploading}
        onChange={(e) => {
          void handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}

export default function PaymentCard({
  order,
  currency,
  merchantId,
  readOnly = false,
  onProofUploaded,
}: {
  order: any
  currency?: string
  merchantId: string
  readOnly?: boolean
  onProofUploaded?: (saved: MerchantProofSaved) => void
}) {
  const { t } = useSession()
  const customerProofUrl = useProofUrl(merchantId, order?.id, order?.payment_proof, 'customer')

  const subtotal = (order.items ?? []).reduce(
    (sum: number, it: any) => sum + (it.price ?? 0) * (it.qty ?? 0),
    0,
  )

  return (
    <DrawerCard
      title={t('Payment', '付款')}
      aside={
        order.payment_proof ? (
          <Badge className="bg-success-100 text-success-fg border-transparent">
            {t('Proof uploaded', '已上传凭证')}
          </Badge>
        ) : undefined
      }
    >
      {/* `sm:flex-row-reverse` puts the summary left and the proof right at desktop width,
          while the phone stack keeps the summary first, above the proof. */}
      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-start sm:gap-4">
        <div className="flex-1 min-w-0 text-[13px]">
          {/* Summed from the lines above, because `orders` stores no subtotal column. Without
              it the card lists three adjustments under a total they cannot be checked against:
              a merchant querying a discount has nothing to subtract it FROM. The sum is the
              same arithmetic the Items card already prints line by line. */}
          <div className="flex justify-between py-0.5">
            <span className="text-muted-foreground">{t('Subtotal', '小计')}</span>
            <span className="tabular-nums text-foreground">{formatMoney(subtotal, currency)}</span>
          </div>
          {order.shipping_fee != null && (
            <div className="flex justify-between py-0.5">
              {/* The dashboard keeps its own word for this ("Shipping"), which is the
                  merchant's, not the customer's — only the DISTANCE is added here. The
                  stored value labels it, never a re-derivation: null (region-priced, or
                  placed before #101) prints the plain label, never `0.0 km`. */}
              <span className="text-muted-foreground">
                {order.delivery_distance_km != null
                  ? t(`Shipping (${Number(order.delivery_distance_km).toFixed(1)} km)`,
                      `运费（${Number(order.delivery_distance_km).toFixed(1)} 公里）`)
                  : t('Shipping', '运费')}
              </span>
              <span className="tabular-nums text-foreground">{formatMoney(order.shipping_fee, currency)}</span>
            </div>
          )}
          {order.discount != null && order.discount > 0 && (
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">
                {t('Discount', '折扣')}{order.voucher_code ? ` (${order.voucher_code})` : ''}
              </span>
              <span className="tabular-nums text-foreground">−{formatMoney(order.discount, currency)}</span>
            </div>
          )}
          {order.tax_rate != null && order.tax_rate > 0 && (
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">{t('Tax', '税')} ({formatTaxRate(order.tax_rate)}%)</span>
              <span className="tabular-nums text-foreground">{formatMoney(order.tax ?? 0, currency)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline mt-2 px-3 py-2.5 rounded-lg bg-brand-50 text-[15px] font-medium">
            <span className="text-foreground">{t('Total', '总计')}</span>
            <span className="tabular-nums text-primary">{formatMoney(order.total, currency)}</span>
          </div>
        </div>

        {/* Two slots side by side. The customer's is read-only — the shop files its own copy
            beside it and never over it. */}
        <div className="shrink-0 flex items-start gap-3">
          {order.payment_proof && (
            customerProofUrl ? (
              <ProofThumb
                url={customerProofUrl}
                alt={t('Payment proof', '付款凭证')}
                caption={t('From customer', '顾客上传')}
              />
            ) : (
              <span className="text-[13px] text-muted-foreground">{t('Loading…', '加载中…')}</span>
            )
          )}
          {/* Hidden in the read-only view (a superadmin looking at someone else's shop): that
              view writes nothing, and filing a receipt is a write. */}
          {!readOnly && (
            <MerchantProofSlot
              merchantId={merchantId}
              order={order}
              onUploaded={(saved) => onProofUploaded?.(saved)}
            />
          )}
        </div>
      </div>
    </DrawerCard>
  )
}
