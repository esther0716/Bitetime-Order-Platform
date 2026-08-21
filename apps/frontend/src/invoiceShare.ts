import { waDigits } from './waNumber'
import type { Translate } from './types'

/**
 * How a merchant hands one order's invoice to the customer over WhatsApp.
 *
 * What this is NOT: a send. `wa.me` carries TEXT and nothing else — a PDF attachment needs the
 * WhatsApp Business Cloud API, which means a verified WABA and an approved template per shop and
 * a per-conversation fee, for a shop paying RM39.90 a month. So the merchant taps, WhatsApp opens
 * the customer's chat with the sentence already typed, and the merchant sends it themselves.
 *
 * The link in that sentence is the guest invoice door (`/invoice`), not the PDF. The door still
 * asks for the phone the order was placed with (ADR 0018), which is exactly what makes the link
 * safe to put in a message that can be forwarded: whoever holds it holds nothing.
 *
 * Frontend-only, for `waNumber.ts`'s reason — nothing on the wire depends on how a sentence is
 * worded. `origin` is an argument rather than a read of `window`, so the whole module is pure.
 */

/** The guest invoice door for one order. `shop` is required: an order number is unique per SHOP. */
export function invoiceLookupUrl(origin: string, slug: string, orderNumber: string): string {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin
  return `${base}/invoice?shop=${encodeURIComponent(slug)}&order=${encodeURIComponent(orderNumber)}`
}

/**
 * The sentence the merchant sends.
 *
 * Written in the language the MERCHANT is reading, because the platform stores no customer
 * language and a name is not one. The url goes LAST: WhatsApp draws its link preview from the
 * final url in a message, and a trailing full stop would be swallowed into the link.
 */
export function invoiceWaMessage(
  { shopName, customerName, orderNumber, url }: {
    shopName: string
    customerName: string | null | undefined
    orderNumber: string
    url: string
  },
  t: Translate,
): string {
  const name = customerName?.trim()
  const greeting = name ? t(`Hi ${name},`, `你好 ${name}，`) : t('Hi,', '你好，')
  return t(
    `${greeting} here is your invoice from ${shopName} for order ${orderNumber}: ${url}`,
    `${greeting}这是 ${shopName} 订单 ${orderNumber} 的账单：${url}`,
  )
}

/**
 * The tap-to-send link, or null when the stored number cannot be dialled.
 *
 * Null is a real answer and not a failure: `orders.customer_wa` holds whatever the customer typed,
 * so some of it is unusable, and the caller draws no button rather than a button to nobody.
 */
export function invoiceWaShareHref(customerWa: string, message: string): string | null {
  const digits = waDigits(customerWa)
  return digits === null ? null : `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}
