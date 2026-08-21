// The customer's invoice: what was ordered, and what is owed.
//
// PURE — no `supabase.ts`, no `db.ts`, no `env.ts`, and the font arrives as a PARAMETER, the same
// rule the Claude adapters follow with their API key. That is what lets
// `pnpm --filter @bitetime/backend test` render a real PDF with no database and no environment.
//
// It reads the ORDER and the SHOP, and never the menu. `orders.items[].name` is the snapshot of
// `products.name` as it stood, so a merchant tidying their menu next month cannot rewrite last
// month's paper. There is no menu lookup here to get that wrong.
//
// It asserts NOTHING about payment and nothing about progress. The platform never touches the
// money — bank transfer and QR are off-platform — so "paid" is not a fact it holds. Status,
// courier and AWB are absent for a second reason: paper goes stale and an order does not, and a
// customer holding a page that says `preparing` about an order delivered last week has been
// misinformed by us.
//
// English labels, always. See `invoiceFont.ts` for why the CJK face is embedded anyway.
//
// The QR code's orientation is the one property here no assertion covers: a mirrored matrix draws
// a plausible-looking code that scans to nothing. It was checked by rasterising a rendered page and
// decoding it with jsQR, which returned the exact lookup URL. Redo that if the drawing loop is ever
// touched — `invoiceQrUrl` is unit-tested, the pixels are not.
//
// Decisions: docs/adr/0017-the-invoice-is-a-pdf-and-the-only-invoice.md.
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { pdfFontkit } from './pdfFontkit.js'
import QRCode from 'qrcode'
import { isDistancePriced, type FulfilmentMethod, DEFAULT_TIMEZONE, isTimezone } from '@bitetime/shared'

// The status gate is NOT here: it lives in `@bitetime/shared`, because the BROWSER reads it too —
// it decides whether to offer the download at all, and a second copy would put a button on screen
// that answers 404. Import `canIssueInvoice` from the shared package, never from this module.
import { formatMoney, formatAddress, MODE_LABELS } from './orderNotice.js'

// Cents, not float dust. A twin of `pricing.ts`'s private `round2`, kept local for the same
// reason `orderNotice.ts` keeps its own `formatMoney`: the shared package holds rules that must
// hold identically on BOTH sides of the wire, and what a document prints is not one of them.
const round2 = (n: number) => parseFloat(n.toFixed(2))

/**
 * An order's subtotal, summed back from its stored lines.
 *
 * `orders` persists `items`, `shipping_fee`, `discount` and `total` — never a subtotal. Summing
 * the lines is what makes the printed arithmetic close: `pricing.ts` builds the total FROM this
 * same sum (`subtotal = round2(Σ lineTotal)`, `total = round2(subtotal + shipping − discount +
 * tax)`), so subtotal + fee − voucher + tax = total on the page, by construction.
 *
 * Deriving it the other way — `total − shipping + discount` — would always reconcile with the
 * total while silently disagreeing with the lines printed directly above it. This way a data bug
 * shows up on the invoice instead of hiding inside it.
 *
 * Every entry counts: a split promo writes two lines under one product id. Each line is rounded
 * to cents before summing, both because `pricing.ts` does and because the invoice prints each
 * line rounded — a subtotal summed from unrounded products could disagree with the column
 * printed above it.
 */
export function invoiceSubtotal(items: any[] | null | undefined): number {
  if (!Array.isArray(items)) return 0
  return round2(items.reduce((sum, it) => sum + round2((it?.price ?? 0) * (it?.qty ?? 0)), 0))
}

/**
 * A tax rate as it is printed: `6`, `6.5`, never `6.00`.
 *
 * `tax_rate` is `numeric(5,2)`, so the row can arrive as a number or as `'6.00'` depending on
 * which client read it — the label must not depend on which one it was.
 */
export function formatTaxRate(rate: number | string | null | undefined): string {
  const n = typeof rate === 'string' ? Number(rate) : rate
  if (n === null || n === undefined || !Number.isFinite(n)) return '0'
  return String(parseFloat(n.toFixed(2)))
}

/**
 * The download's file name.
 *
 * It reaches a `Content-Disposition` header, so it is reduced to characters that header can
 * carry — an order number is `PREFIX-YYMMDD-XXXX` and never needs more than these.
 */
export function invoiceFileName(orderNumber: string | null | undefined): string {
  const safe = String(orderNumber ?? '')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return safe ? `Invoice-${safe}.pdf` : 'Invoice.pdf'
}

export interface InvoiceLine {
  name: string
  /** The chosen options with the deltas that were charged — "" when the line has none. */
  options: string
  qty: number
  unitText: string
  amountText: string
}

export interface InvoiceMoneyRow {
  label: string
  /** Signed: a voucher is negative, so the rows above the total add up to it. */
  amount: number
  text: string
  strong?: boolean
}

export interface InvoiceDoc {
  shopName: string
  shopAddress: string
  orderNumber: string
  placed: string
  method: string
  fulfilDate: string
  customerName: string
  address: string
  lines: InvoiceLine[]
  money: InvoiceMoneyRow[]
  payment: string[]
}

/**
 * The money line for the shipping charge, named after the METHOD that produced it — a twin of
 * the frontend's `feeLineLabel`, English only.
 *
 * The km is appended only when the fee was actually priced by it, and the method decides that,
 * not the presence of a distance on the row: a region-priced order has no distance, and printing
 * one would be a lie about what produced the money.
 */
function feeLabel(mode: string | null | undefined, km: number | null): string {
  const distancePriced = mode != null && isDistancePriced(mode as FulfilmentMethod)
  const base = distancePriced ? 'Express delivery fee' : 'Delivery fee'
  if (km === null || !Number.isFinite(km) || !distancePriced) return base
  return `${base} (${km.toFixed(1)} km)`
}

/** The order's placed timestamp, in the SHOP's timezone — the clock its merchant and its
 *  customers both keep. An unusable `merchants.timezone` falls back rather than throwing. */
function placedAt(created: unknown, timezone: unknown): string {
  const d = new Date(String(created ?? ''))
  if (Number.isNaN(d.getTime())) return ''
  const timeZone = isTimezone(timezone) ? String(timezone) : DEFAULT_TIMEZONE
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(d)
}

/**
 * The fulfil date as a person reads it: `21 Aug 2026`, never `2026-08-21`.
 *
 * A CALENDAR date, formatted from its parts rather than through a `Date` — `fulfil_date` is a
 * `YYYY-MM-DD` on the shop's own clock, and parsing it into an instant would render the day
 * before for anyone reading east or west of the shop. The frontend's `formatCalendarDate` states
 * the same rule for the same reason.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function calendarDate(value: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (!m) return value ? String(value) : ''
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${Number(m[3])} ${month} ${m[1]}` : String(value)
}

/**
 * One order and one shop → everything the page prints, and nothing else.
 *
 * Separated from the drawing so the document's CONTENT is assertable without parsing a PDF: the
 * money reconciling, the fee wearing its method's name, an address appearing on a delivery and
 * never on a pickup. The renderer below turns this into bytes and makes no decisions of its own.
 */
export function buildInvoice(order: any, merchant: any): InvoiceDoc {
  const cur = order.currency ?? 'MYR'
  const items: any[] = Array.isArray(order.items) ? order.items : []
  const mode = order.mode as string | null

  const subtotal = invoiceSubtotal(items)
  const shipping = Number(order.shipping_fee ?? 0) || 0
  const discount = Number(order.discount ?? 0) || 0
  const tax = Number(order.tax ?? 0) || 0
  const taxRate = Number(order.tax_rate ?? 0) || 0
  const km = order.delivery_distance_km == null ? null : Number(order.delivery_distance_km)

  const money: InvoiceMoneyRow[] = [
    { label: 'Subtotal', amount: subtotal, text: formatMoney(subtotal, cur) },
  ]
  if (shipping > 0) {
    money.push({ label: feeLabel(mode, km), amount: shipping, text: formatMoney(shipping, cur) })
  }
  if (discount > 0) {
    money.push({ label: 'Voucher', amount: -discount, text: `−${formatMoney(discount, cur)}` })
  }
  if (taxRate > 0) {
    money.push({ label: `Tax (${formatTaxRate(order.tax_rate)}%)`, amount: tax, text: formatMoney(tax, cur) })
  }
  money.push({
    label: 'Total',
    amount: Number(order.total ?? 0) || 0,
    text: formatMoney(order.total ?? 0, cur),
    strong: true,
  })

  // A pickup invoice must not carry an address the customer never gave for this order.
  const showAddress = (mode === 'delivery' || mode === 'express') && !!order.address

  return {
    shopName: String(merchant?.name ?? ''),
    // The shop's own address, whichever it keeps: a pickup shop states one for collection, a
    // distance-priced shop states one to route from. A shop with neither prints no line at all,
    // rather than a labelled blank.
    shopAddress: String(merchant?.pickup_address ?? merchant?.origin_address ?? '') || '',
    orderNumber: String(order.order_number ?? ''),
    placed: placedAt(order.created_at, merchant?.timezone),
    method: (mode && MODE_LABELS[mode]) || (mode ?? ''),
    fulfilDate: calendarDate(order.fulfil_date),
    customerName: String(order.customer_name ?? ''),
    address: showAddress ? formatAddress(order.address) : '',
    lines: items.map((it) => {
      // Rows written before menu options carry no `selections` key at all. Absent reads as no
      // options, never as a crash — the same rule `promo` already follows on these rows.
      const picks: any[] = Array.isArray(it?.selections) ? it.selections : []
      const qty = Number(it?.qty ?? 0) || 0
      const price = Number(it?.price ?? 0) || 0
      return {
        name: `${String(it?.name ?? '')}${it?.promo ? ' (Promo)' : ''}`,
        // The delta is what makes the line self-proving: without it, "Latte ×1 @ 15.00" cannot be
        // reconciled against a menu that says 12 and oat +3.
        options: picks
          .map((p) => {
            const delta = Number(p?.delta ?? 0) || 0
            const suffix = delta > 0 ? ` (+${formatMoney(delta, cur)})` : ''
            return `${String(p?.optionName ?? '')} ×${Number(p?.qty ?? 0) || 0}${suffix}`
          })
          .join(', '),
        qty,
        unitText: formatMoney(price, cur),
        amountText: formatMoney(round2(price * qty), cur),
      }
    }),
    money,
    payment: [merchant?.payment_bank, merchant?.payment_note]
      .map((v) => (v == null ? '' : String(v).trim()))
      .filter(Boolean),
  }
}

// ── The ticket ────────────────────────────────────────────────────────────────
//
// The page IS the ticket: 226pt wide (80mm, the width of a till roll) and as tall as the order
// needs. That shape is chosen for where this document is actually read — a phone, in a chat —
// where an A4 sheet arrives as a postage stamp the reader has to pinch open. It also prints
// scaled-to-fit on A4 and feeds a thermal printer natively.
//
// One consequence, accepted: there is no pagination. A forty-line order makes a very long page
// rather than a second one, exactly as a till roll does.

const W = 226
const PAD = 16
const INK = rgb(0.09, 0.09, 0.11)
const MUTED = rgb(0.45, 0.45, 0.48)
const RULE = rgb(0.82, 0.82, 0.85)
const WELL = rgb(0.96, 0.96, 0.97)

/**
 * Text as the font can draw it.
 *
 * Tabs and carriage returns reach here from free-typed merchant fields (`payment_note` above
 * all) and `drawText` renders them as a missing glyph rather than as space. A codepoint the face
 * has no glyph for is left alone deliberately — Noto Sans SC maps it to `.notdef`, which prints
 * an empty box, and a box is a better answer than a throw the merchant would meet as a broken
 * feature with nothing on screen to say why.
 */
function clean(text: string): string {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/\t/g, '  ').replace(/[\r\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

/** Break `text` to fit `maxWidth`, on spaces where there are any and between characters where
 *  there are not — which is every Chinese product name. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const source = clean(text)
  if (!source) return []
  const out: string[] = []
  for (const paragraph of source.split('\n')) {
    if (!paragraph) { out.push(''); continue }
    let line = ''
    for (const word of paragraph.split(/(\s+)/)) {
      if (!word) continue
      const candidate = line + word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue }
      // Too wide with this word attached. Break at the space if there is a line to keep…
      if (line) { out.push(line.trimEnd()); line = word.trimStart(); continue }
      // …and per CHARACTER when there is not: one "word" can be wider than the whole column,
      // which is every Chinese run, since they carry no spaces to break at.
      for (const ch of candidate) {
        if (line && font.widthOfTextAtSize(line + ch, size) > maxWidth) { out.push(line); line = '' }
        line += ch
      }
    }
    out.push(line.trimEnd())
  }
  return out
}

/**
 * The address the QR code carries: this order's own lookup, with the number already filled in.
 *
 * It stops at the number ON PURPOSE. The phone is not in the link and must not be: a ticket is
 * forwarded, photographed and left on counters, and a link that fetched the document by itself
 * would make the paper the credential. Scanning gets the reader to the right form; proving the
 * order is still theirs to do (ADR 0018).
 */
export function invoiceQrUrl(order: any, merchant: any, frontendUrl: string): string {
  const base = String(frontendUrl ?? '').replace(/\/+$/, '')
  const shop = encodeURIComponent(String(merchant?.slug ?? ''))
  const number = encodeURIComponent(String(order?.order_number ?? ''))
  return `${base}/invoice?shop=${shop}&order=${number}`
}

/**
 * A layout op: draw something at `dy` points below the block's own top.
 *
 * The ticket's height is not known until its contents are measured, and a page cannot be resized
 * once drawn into. So each block reports its height and defers its drawing — the page is created
 * at the summed height, and every op then runs against a known top. Measuring and drawing in one
 * pass, with the numbers written twice, is how the two come to disagree.
 */
interface Block {
  height: number
  draw: (page: PDFPage, top: number) => void
  /** The torn edge. Nothing may be placed below it — see where the page number goes. */
  tail?: boolean
}

interface Ctx { font: PDFFont }

const text = (
  page: PDFPage, body: string, x: number, y: number,
  opts: { size: number; font: PDFFont; color?: ReturnType<typeof rgb>; align?: 'left' | 'center' | 'right' },
) => {
  const value = clean(body)
  if (!value) return
  const w = opts.font.widthOfTextAtSize(value, opts.size)
  const left = opts.align === 'right' ? x - w : opts.align === 'center' ? x - w / 2 : x
  page.drawText(value, { x: left, y, size: opts.size, font: opts.font, color: opts.color ?? INK })
}

/** A label above its value — the mock's "TICKET ID / 0120077…" pair, ours in two columns. */
function pairRow(ctx: Ctx, left: [string, string], right?: [string, string]): Block {
  return {
    height: 30,
    draw(page, top) {
      text(page, left[0].toUpperCase(), PAD, top - 8, { size: 6.5, font: ctx.font, color: MUTED })
      text(page, left[1], PAD, top - 22, { size: 10, font: ctx.font })
      if (!right) return
      text(page, right[0].toUpperCase(), W - PAD, top - 8, { size: 6.5, font: ctx.font, color: MUTED, align: 'right' })
      text(page, right[1], W - PAD, top - 22, { size: 10, font: ctx.font, align: 'right' })
    },
  }
}

/** A label and a wrapped value stacked, for the long ones: the address, the shop's own address. */
function stackRow(ctx: Ctx, label: string, value: string): Block | null {
  const lines = wrap(value, ctx.font, 9, W - PAD * 2)
  if (lines.length === 0) return null
  return {
    height: 12 + lines.length * 11 + 6,
    draw(page, top) {
      text(page, label.toUpperCase(), PAD, top - 8, { size: 6.5, font: ctx.font, color: MUTED })
      lines.forEach((line, i) => text(page, line, PAD, top - 20 - i * 11, { size: 9, font: ctx.font }))
    },
  }
}

/**
 * The perforation: a dashed rule with a notch bitten out of each edge.
 *
 * The notches are what make a rectangle read as a TICKET rather than a table, and they are drawn
 * as filled circles in the viewer's own white rather than as arcs — the page is the ticket, so
 * "outside the edge" is not somewhere anything else is drawn.
 */
function perforation(): Block {
  return {
    height: 18,
    draw(page, top) {
      const y = top - 9
      page.drawLine({
        start: { x: PAD + 6, y }, end: { x: W - PAD - 6, y },
        thickness: 0.7, color: RULE, dashArray: [3, 3],
      })
      for (const cx of [0, W]) {
        page.drawCircle({ x: cx, y, size: 6, color: rgb(1, 1, 1), borderColor: RULE, borderWidth: 0.7 })
      }
    },
  }
}

const gap = (height: number): Block => ({ height, draw: () => {} })

/** The shop's name and what this piece of paper is. */
function header(ctx: Ctx, doc: InvoiceDoc): Block {
  const nameLines = wrap(doc.shopName, ctx.font, 15, W - PAD * 2)
  return {
    height: 26 + nameLines.length * 19 + 16,
    draw(page, top) {
      // The word first, small and muted: a reader who is holding six of these needs to know what
      // it is before they need to know whose it is.
      text(page, 'INVOICE', W / 2, top - 20, { size: 7.5, font: ctx.font, color: MUTED, align: 'center' })
      nameLines.forEach((line, i) => (
        text(page, line, W / 2, top - 40 - i * 19, { size: 15, font: ctx.font, align: 'center' })
      ))
    },
  }
}

/** One ordered line: the name and its amount, then what was chosen, then the unit maths. */
function itemRow(ctx: Ctx, line: InvoiceLine): Block {
  const NAME = 12, OPTION = 9.5, UNIT = 11, TAIL = 7
  const nameLines = wrap(line.name, ctx.font, 9.5, W - PAD * 2 - 54)
  const optionLines = line.options ? wrap(line.options, ctx.font, 7.5, W - PAD * 2 - 12) : []

  return {
    height: nameLines.length * NAME + optionLines.length * OPTION + UNIT + TAIL,
    draw(page, top) {
      // ONE cursor, moving down and never back up. The earlier version positioned the unit line
      // relative to the name block and the options relative to the unit line, and the two
      // arithmetics disagreed the moment a name wrapped — printing the maths through the name.
      let y = top - 9
      nameLines.forEach((l, i) => text(page, l, PAD, y - i * NAME, { size: 9.5, font: ctx.font }))
      // The amount sits on the FIRST line of a wrapped name, where the eye looks for it.
      text(page, line.amountText, W - PAD, y, { size: 9.5, font: ctx.font, align: 'right' })
      y -= nameLines.length * NAME

      optionLines.forEach((l, i) => (
        text(page, l, PAD + 8, y - i * OPTION, { size: 7.5, font: ctx.font, color: MUTED })
      ))
      y -= optionLines.length * OPTION

      text(page, `${line.qty} × ${line.unitText}`, PAD, y, { size: 7.5, font: ctx.font, color: MUTED })
    },
  }
}

/** Subtotal, fee, voucher and tax in quiet type; the total in the size the reader came for. */
function moneyRows(ctx: Ctx, doc: InvoiceDoc): Block {
  const minor = doc.money.filter(r => !r.strong)
  const total = doc.money.find(r => r.strong)
  return {
    height: minor.length * 13 + 30,
    draw(page, top) {
      minor.forEach((row, i) => {
        const y = top - 9 - i * 13
        text(page, row.label, PAD, y, { size: 8.5, font: ctx.font, color: MUTED })
        text(page, row.text, W - PAD, y, { size: 8.5, font: ctx.font, color: MUTED, align: 'right' })
      })
      if (!total) return
      const y = top - 9 - minor.length * 13 - 12
      text(page, 'TOTAL', PAD, y, { size: 9, font: ctx.font })
      text(page, total.text, W - PAD, y - 2, { size: 15, font: ctx.font, align: 'right' })
    },
  }
}

/** The shop's payment instructions, in the well the mock gives the card chip. */
function paymentWell(ctx: Ctx, doc: InvoiceDoc): Block | null {
  if (doc.payment.length === 0) return null
  const lines = doc.payment.flatMap(p => wrap(p, ctx.font, 8, W - PAD * 2 - 20))
  return {
    height: lines.length * 11 + 34,
    draw(page, top) {
      const boxHeight = lines.length * 11 + 22
      page.drawRectangle({
        x: PAD, y: top - boxHeight, width: W - PAD * 2, height: boxHeight,
        color: WELL, borderColor: RULE, borderWidth: 0.5,
      })
      text(page, 'PAYMENT', PAD + 10, top - 13, { size: 6.5, font: ctx.font, color: MUTED })
      lines.forEach((line, i) => text(page, line, PAD + 10, top - 25 - i * 11, { size: 8, font: ctx.font }))
    },
  }
}

/**
 * The QR block, drawn as VECTOR squares rather than an embedded image.
 *
 * One module is one filled rectangle, so the code stays sharp at any zoom and on any printer, and
 * the whole block costs a few hundred bytes instead of a raster. It carries a quiet zone of four
 * modules, which is what makes a scanner find it against the page.
 */
function qrBlock(ctx: Ctx, url: string, orderNumber: string): Block {
  const matrix = QRCode.create(url, { errorCorrectionLevel: 'M' })
  const size = matrix.modules.size
  const data = matrix.modules.data
  const box = 108
  const quiet = 4
  const module = box / (size + quiet * 2)

  return {
    height: box + 34,
    draw(page, top) {
      const originX = (W - box) / 2 + quiet * module
      const originY = top - box + quiet * module
      for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
          if (!data[row * size + col]) continue
          page.drawRectangle({
            x: originX + col * module,
            // The matrix reads top-down and the page counts up from its foot, so the row index is
            // mirrored. Getting this wrong yields a code that scans to nothing.
            y: originY + (size - 1 - row) * module,
            width: module, height: module, color: INK,
          })
        }
      }
      // The order number under the code, the way the mock prints digits under its barcode: it is
      // what a reader types when a camera will not focus, and a wrapped URL is only noise.
      text(page, 'Scan to get this invoice again', W / 2, top - box - 10, {
        size: 7, font: ctx.font, color: MUTED, align: 'center',
      })
      text(page, orderNumber, W / 2, top - box - 22, { size: 8, font: ctx.font, align: 'center' })
    },
  }
}

/** The scalloped foot: the ticket's torn edge, as in the mock. */
function scallops(): Block {
  return {
    height: 14,
    tail: true,
    draw(page, top) {
      const radius = 7
      for (let x = radius; x < W; x += radius * 2.4) {
        page.drawCircle({ x, y: top - 12, size: radius, color: rgb(1, 1, 1), borderColor: RULE, borderWidth: 0.6 })
      }
      page.drawRectangle({ x: 0, y: top - 20, width: W, height: 8, color: rgb(1, 1, 1) })
    },
  }
}

/**
 * The head of a continuation page: whose ticket this is, and that it is not the start of one.
 *
 * A second sheet with no shop name and no order number on it is a scrap of paper. This is the
 * smallest thing that keeps it attached to the first.
 */
function continuedHeader(ctx: Ctx, doc: InvoiceDoc): Block {
  return {
    height: 40,
    draw(page, top) {
      text(page, doc.shopName, PAD, top - 16, { size: 10, font: ctx.font })
      text(page, doc.orderNumber, W - PAD, top - 16, { size: 8, font: ctx.font, color: MUTED, align: 'right' })
      page.drawLine({
        start: { x: PAD, y: top - 28 }, end: { x: W - PAD, y: top - 28 },
        thickness: 0.7, color: RULE, dashArray: [3, 3],
      })
    },
  }
}

/** `1 / 2` at the foot, drawn only when there IS more than one page. */
function pageFoot(ctx: Ctx, index: number, total: number): Block {
  return {
    height: 22,
    draw(page, top) {
      text(page, `${index} / ${total}`, W / 2, top - 14, {
        size: 7, font: ctx.font, color: MUTED, align: 'center',
      })
    },
  }
}

/**
 * One order, as a ticket the customer can keep.
 *
 * The font arrives as a parameter for the same reason the Claude adapters take their API key as
 * one: it keeps this module free of `env.ts` and lets a unit test render a real PDF with no
 * environment at all. `frontendUrl` rides along because the QR code has to name a real host, and
 * this module must not be the thing that knows which.
 */
export async function renderInvoicePdf(
  order: any,
  merchant: any,
  opts: { font: Uint8Array; frontendUrl: string },
): Promise<Uint8Array> {
  const doc = buildInvoice(order, merchant)
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(pdfFontkit)
  // Subset on embed: the face is 7MB and the emitted document is ~10KB, because only the glyphs
  // this order actually uses travel with it. `pdfFontkit`, not `@pdf-lib/fontkit` — the latter
  // subsets this font to empty glyphs, silently. See that module.
  const font = await pdf.embedFont(opts.font, { subset: true })

  pdf.setTitle(`Invoice ${doc.orderNumber}`)
  pdf.setProducer('TinyOrder')
  pdf.setCreator('TinyOrder')

  const ctx: Ctx = { font }

  const blocks: (Block | null)[] = [
    header(ctx, doc),
    stackRow(ctx, 'From', doc.shopAddress),
    perforation(),
    pairRow(ctx, ['Order no.', doc.orderNumber], [
      'Amount', doc.money.find(r => r.strong)?.text ?? '',
    ]),
    pairRow(ctx, ['Date & time', doc.placed], doc.fulfilDate ? ['For', doc.fulfilDate] : undefined),
    pairRow(ctx, ['Method', doc.method], undefined),
    stackRow(ctx, 'Billed to', doc.customerName),
    stackRow(ctx, 'Address', doc.address),
    perforation(),
    ...doc.lines.map(line => itemRow(ctx, line)),
    gap(4),
    moneyRows(ctx, doc),
    gap(6),
    paymentWell(ctx, doc),
    perforation(),
    qrBlock(ctx, invoiceQrUrl(order, merchant, opts.frontendUrl), doc.orderNumber),
    scallops(),
  ]

  const live = blocks.filter((b): b is Block => b !== null)

  // Fill pages up to A4's height and start another when the next block will not fit.
  //
  // A till roll can be a metre long; a PDF viewer showing one is a page nobody can read, and a
  // printer given one either shrinks it to illegibility or crops it. So the ticket grows to at
  // most one sheet's worth and then continues, with the shop name and order number repeated at
  // the head of each continuation and a `1 / 2` at every foot.
  //
  // Blocks are ATOMIC: an item row, the money block, the QR never split across a break. Their
  // heights are already known here, which is the whole reason the layout measures before it draws.
  const MAX = 842
  const pages: Block[][] = []
  let current: Block[] = []
  let used = PAD

  for (const block of live) {
    // `+ 22` leaves room for the foot a multi-page ticket will need. Reserving it on every page
    // costs one line of white on a single-page ticket and avoids a second pagination pass.
    if (current.length > 0 && used + block.height + 22 > MAX) {
      pages.push(current)
      current = [continuedHeader(ctx, doc)]
      used = PAD + current[0].height
    }
    current.push(block)
    used += block.height
  }
  pages.push(current)

  pages.forEach((blocks, i) => {
    // The number goes ABOVE the torn edge, not below it: past the scallops is off the ticket, and
    // a page number printed there reads as something that fell off another document.
    const foot = pageFoot(ctx, i + 1, pages.length)
    const numbered = pages.length === 1 ? blocks
      : blocks[blocks.length - 1]?.tail
        ? [...blocks.slice(0, -1), foot, blocks[blocks.length - 1]]
        : [...blocks, foot]
    const height = numbered.reduce((sum, b) => sum + b.height, 0) + PAD
    const page = pdf.addPage([W, height])
    let top = height
    for (const block of numbered) {
      block.draw(page, top)
      top -= block.height
    }
  })

  return pdf.save()
}
