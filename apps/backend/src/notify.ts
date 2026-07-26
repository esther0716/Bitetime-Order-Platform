// The MERCHANT's Telegram arm of the order-notification fan-out.
//
// The bot token lives in `merchant_secrets` and is read here with the service-role client — it
// never reaches the browser. The message is built from the stored order row, so a client cannot
// forge its content. Deps (db, send) are injected for testing.
//
// The two email arms live in `orderEmails.ts`; what all three share is `orderNotice.ts`.
import { formatAddress, formatKm, formatMoney, MODE_LABELS, type NotifyOrderInput, type NotifyResult } from './orderNotice.js'

// Pure: render the Telegram message from an order row, in the order's own
// stamped currency (falls back to MYR for legacy rows without one).
export function buildOrderMessage(order: any, merchantName?: string): string {
  const cur = order.currency ?? 'MYR'
  const items = Array.isArray(order.items) ? order.items : []
  // `(Promo)` is plain text, not a badge — Telegram's Markdown here is already `*bold*` labels
  // and this is the one place in the app that can't reach for the storefront's pill styling.
  // Missing key reads as `false` (older rows never wrote it), never as a crash — see orders.ts.
  const lines = items
    .map((i: any) => `• ${i.name}${i.promo ? ' (Promo)' : ''} × ${i.qty} — ${formatMoney((i.price ?? 0) * (i.qty ?? 0), cur)}`)
    .join('\n')
  let msg = `🛎️ *New order${merchantName ? ` — ${merchantName}` : ''}*\n\n`
  msg += `*Order No.:* ${order.order_number}\n`
  msg += `*Name:* ${order.customer_name ?? ''}\n`
  if (order.customer_wa) msg += `*WhatsApp:* ${order.customer_wa}\n`
  if (order.mode) msg += `*Mode:* ${MODE_LABELS[order.mode as string] ?? order.mode}\n`
  // The merchant reading this on their phone is the person scheduling around it, so it sits
  // with the mode rather than down by the totals. Omitted rather than blanked for rows written
  // before #91 — `orders.fulfil_date` is null for every one of them, and a `*Date:* ` with
  // nothing after it reads as data we lost.
  if (order.fulfil_date) msg += `*Date:* ${order.fulfil_date}\n`
  if (order.address) msg += `*Address:* ${formatAddress(order.address)}\n`
  // Distance-priced orders only; a region-priced order has no distance and must not print an
  // empty label. `delivery_distance_km` is null for every order placed before #101.
  const km = formatKm(order.delivery_distance_km)
  if (km) msg += `*Distance:* ${km}\n`
  msg += `\n*Items:*\n${lines}\n`
  if (order.shipping_fee) msg += `*Shipping:* ${formatMoney(order.shipping_fee, cur)}\n`
  msg += `\n*Total: ${formatMoney(order.total ?? 0, cur)}*`
  return msg
}

export type TelegramSend = (token: string, chatId: string, text: string) => Promise<void>

// Real adapter: Telegram Bot API over fetch.
export const telegramSend: TelegramSend = async (token, chatId, text) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
  if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status}`)
}

// Verify the order exists for the merchant, read that merchant's secret, send.
// Returns skipped:true (still ok) when the merchant has no Telegram configured.
export async function notifyOrderPlaced(db: any, send: TelegramSend, input: NotifyOrderInput): Promise<NotifyResult> {
  const { merchantId, orderNumber } = input
  if (!merchantId || !orderNumber) return { ok: false, error: 'missing merchantId or orderNumber' }

  const { data: order, error: oErr } = await db
    .from('orders').select('*')
    .eq('merchant_id', merchantId).eq('order_number', orderNumber).maybeSingle()
  if (oErr) return { ok: false, error: 'order lookup failed' }
  if (!order) return { ok: false, error: 'order not found' }

  const { data: secret } = await db
    .from('merchant_secrets').select('tg_token, tg_chat_id')
    .eq('merchant_id', merchantId).maybeSingle()
  if (!secret?.tg_token || !secret?.tg_chat_id) return { ok: true, skipped: true }

  const { data: merchant } = await db.from('merchants').select('name, plan').eq('id', merchantId).maybeSingle()

  // Telegram alerts are Pro (#110). Only the token WRITE was gated there, on the reasoning that
  // a shop with a token configured must keep receiving its orders — true while no shop could
  // ever leave Pro, and false the moment downgrades existed. A shop that steps down keeps its
  // token (a credential, not an artifact: deleting it would make re-upgrading mean re-doing
  // BotFather) and simply stops being sent to.
  //
  // Fails CLOSED on a null or unknown plan, matching `hasProAccess`: entitlement is never
  // assumed from an absent value. Safe to check here in a way it would not be inside the order
  // transaction, because notify is a separate call made after the order has already landed —
  // this can refuse without an order being lost.
  if (merchant?.plan !== 'pro') return { ok: true, skipped: true }

  try {
    await send(secret.tg_token, secret.tg_chat_id, buildOrderMessage(order, merchant?.name))
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) }
  }
}
