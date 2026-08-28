import type { ReactNode } from 'react'
import { useSession } from '../SessionContext'
import { paymentQrUrl } from '../store'
import { hasPaymentInstructions } from '../paymentProof'
import type { Merchant } from '../types'
import ZoomableImage from '../components/ZoomableImage'
import { cn } from '@/lib/utils'

/**
 * How to pay this shop: the bank line, the shop's own note, and its payment QR.
 *
 * Shown on the order-placed screen and again in order history, because a customer who closes the
 * tab to open their banking app loses the first one and had no way back to it. The two must not
 * drift — a bank number the storefront renders one way and history another is the kind of
 * difference that costs a transfer — so this is one component with two mounts.
 *
 * `children` is the slot under the instructions, and every caller uses it for the proof upload:
 * the words say who to pay, the code says how, and the last thing in the block is the reply.
 *
 * Renders NOTHING when the shop configured none of the three. An empty box titled "Payment
 * Instructions" tells a customer their shop forgot something, when the truth is usually that the
 * shop takes payment some other way.
 */
export default function PaymentInstructions({
  merchant,
  className,
  children,
}: {
  merchant: Merchant
  className?: string
  children?: ReactNode
}) {
  const { t } = useSession()
  if (!hasPaymentInstructions(merchant)) return null

  return (
    <div
      className={cn(
        'text-left px-[14px] py-[10px] bg-card border-[0.5px] border-border rounded-md text-[13px] text-muted-foreground leading-[1.5]',
        className,
      )}
    >
      <div className="font-semibold text-primary mb-1">
        {t('Payment Instructions', '付款说明')}
      </div>
      {merchant.payment_bank && <p>{merchant.payment_bank}</p>}
      {merchant.payment_note && (
        <p className={cn('whitespace-pre-line', merchant.payment_bank && 'mt-[6px]')}>
          {merchant.payment_note}
        </p>
      )}
      {/* The shop's payment QR (#156). Last in the block on purpose: the words say who
          is being paid, the code is how.
          NO fixed aspect ratio, and no cropping: what merchants upload here is a phone
          SCREENSHOT of their banking app as often as a clean QR, and letterboxing a
          portrait screenshot into a square leaves the code itself a third of the width
          — a QR too small to scan is the one failure this whole feature cannot survive.
          It renders at its own aspect, as wide as the block allows, and links to the
          full-resolution original for a customer whose camera still will not read it. */}
      {merchant.payment_qr && (
        <div className={cn(
          'flex flex-col items-center gap-1.5',
          (merchant.payment_bank || merchant.payment_note) && 'mt-3',
        )}>
          <ZoomableImage
            src={paymentQrUrl(merchant.payment_qr)}
            alt={t('Payment QR code', '付款二维码')}
            triggerClassName="w-full max-w-[240px] rounded-md bg-white p-2 border border-border"
            imgClassName="w-full h-auto object-contain"
          />
          <span className="text-[12px] text-muted-foreground">
            {t('Scan to pay · tap to enlarge', '扫码付款 · 点击放大')}
          </span>
        </div>
      )}

      {children}
    </div>
  )
}
