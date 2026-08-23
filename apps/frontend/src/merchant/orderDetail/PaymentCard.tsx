import { useState, useEffect } from 'react'
import { useSession } from '../../SessionContext'
import { fetchPaymentProof } from '../../store'
import { formatMoney } from '../../currency'
import { formatTaxRate } from '../../taxRate'
import { Badge } from '@/components/ui/badge'
import DrawerCard from './DrawerCard'

/**
 * What is owed, and what the customer sent to show they paid it.
 *
 * The proof used to be its own section three groups above the total it proves. It sits beside
 * the money now — on a desktop next to the summary, and under it on a phone, where there is no
 * width for a column.
 */
export default function PaymentCard({
  order,
  currency,
  merchantId,
}: {
  order: any
  currency?: string
  merchantId: string
}) {
  const { t } = useSession()
  // `orderId` on the record is what proves a fetched url still belongs to the order on screen —
  // switching to a different order (proof or not) must not keep showing the last one's image
  // while its own fetch is still in flight.
  const [proof, setProof] = useState<{ orderId: string; url: string } | null>(null)

  // Lazy: only fetched when the drawer is open for an order that actually has one, not on every
  // dashboard list render. ONE effect owns the whole lifecycle of one fetched image — it revokes
  // the url ITS OWN fetch created, in ITS OWN cleanup — so switching to a DIFFERENT order (proof
  // or not) or unmounting always revokes, not just "a new proof landed".
  useEffect(() => {
    if (!order?.payment_proof) return
    const orderId = order.id!
    let cancelled = false
    let url: string | null = null
    fetchPaymentProof(merchantId, orderId).then((r) => {
      if (cancelled || !r.ok) return
      url = URL.createObjectURL(r.data)
      setProof({ orderId, url })
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [order?.id, order?.payment_proof, merchantId])

  const proofUrl = proof && proof.orderId === order?.id ? proof.url : null

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

        {order.payment_proof && (
          <div className="shrink-0">
            {proofUrl ? (
              <a href={proofUrl} target="_blank" rel="noopener noreferrer" className="block w-[78px]">
                <img
                  src={proofUrl}
                  alt={t('Payment proof', '付款凭证')}
                  className="w-[78px] h-[78px] object-cover rounded-lg border border-border"
                />
              </a>
            ) : (
              <span className="text-[13px] text-muted-foreground">{t('Loading…', '加载中…')}</span>
            )}
          </div>
        )}
      </div>
    </DrawerCard>
  )
}
