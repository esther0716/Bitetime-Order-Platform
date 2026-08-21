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
// Decisions: docs/adr/0017-the-invoice-is-a-pdf-and-the-only-invoice.md.
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { pdfFontkit } from './pdfFontkit.js'
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

// ── Drawing ───────────────────────────────────────────────────────────────────

const PAGE = { width: 595.28, height: 841.89 }
const MARGIN = 48
const BOTTOM = 64
const INK = rgb(0.09, 0.09, 0.11)
const MUTED = rgb(0.45, 0.45, 0.48)
const RULE = rgb(0.82, 0.82, 0.85)

// Where the four columns land. Qty, unit and amount are RIGHT-aligned on these x values so the
// money forms a column a reader can add up by eye.
const COL = { item: MARGIN, qty: 396, unit: 470, amount: PAGE.width - MARGIN }

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

interface Cursor { page: PDFPage; y: number }

function draw(
  cur: Cursor,
  text: string,
  opts: { x: number; size: number; font: PDFFont; color?: typeof INK; align?: 'left' | 'right' },
) {
  const body = clean(text)
  if (!body) return
  const x = opts.align === 'right' ? opts.x - opts.font.widthOfTextAtSize(body, opts.size) : opts.x
  cur.page.drawText(body, { x, y: cur.y, size: opts.size, font: opts.font, color: opts.color ?? INK })
}

/**
 * One order, as a document the customer can keep.
 *
 * Pagination is real, not decorative: a shop selling boxed sets can write a forty-line order, and
 * a document that ran off the bottom of page one would drop the total — the one number the
 * customer came for.
 */
export async function renderInvoicePdf(order: any, merchant: any, fontBytes: Uint8Array): Promise<Uint8Array> {
  const doc = buildInvoice(order, merchant)
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(pdfFontkit)
  // Subset on embed: the face is ~17MB and the emitted document is tens of KB, because only the
  // glyphs this order actually uses travel with it. `pdfFontkit`, not `@pdf-lib/fontkit` — the
  // latter subsets this font to empty glyphs, silently. See that module.
  const font = await pdf.embedFont(fontBytes, { subset: true })

  pdf.setTitle(`Invoice ${doc.orderNumber}`)
  pdf.setProducer('TinyOrder')
  pdf.setCreator('TinyOrder')

  let cur: Cursor = { page: pdf.addPage([PAGE.width, PAGE.height]), y: PAGE.height - MARGIN }

  const rule = () => {
    cur.page.drawLine({
      start: { x: MARGIN, y: cur.y },
      end: { x: PAGE.width - MARGIN, y: cur.y },
      thickness: 0.5,
      color: RULE,
    })
  }

  const columnHeader = () => {
    draw(cur, 'ITEM', { x: COL.item, size: 8, font, color: MUTED })
    draw(cur, 'QTY', { x: COL.qty, size: 8, font, color: MUTED, align: 'right' })
    draw(cur, 'UNIT', { x: COL.unit, size: 8, font, color: MUTED, align: 'right' })
    draw(cur, 'AMOUNT', { x: COL.amount, size: 8, font, color: MUTED, align: 'right' })
    cur.y -= 6
    rule()
    cur.y -= 14
  }

  /** Start a new page when `needed` points of content would not fit, repeating the column
   *  header so page two is still readable as a table. */
  const ensure = (needed: number, repeatHeader = false) => {
    if (cur.y - needed >= BOTTOM) return
    cur = { page: pdf.addPage([PAGE.width, PAGE.height]), y: PAGE.height - MARGIN }
    if (repeatHeader) columnHeader()
  }

  // ── Header ──
  draw(cur, doc.shopName, { x: MARGIN, size: 16, font })
  draw(cur, 'INVOICE', { x: COL.amount, size: 16, font, color: MUTED, align: 'right' })
  cur.y -= 15
  for (const line of wrap(doc.shopAddress, font, 9, 300)) {
    draw(cur, line, { x: MARGIN, size: 9, font, color: MUTED })
    cur.y -= 12
  }
  cur.y -= 10
  rule()
  cur.y -= 18

  // ── The order, and who it is for ──
  const detail = (label: string, value: string) => {
    if (!value) return
    ensure(28)
    draw(cur, label.toUpperCase(), { x: MARGIN, size: 8, font, color: MUTED })
    const lines = wrap(value, font, 10, PAGE.width - MARGIN - 150)
    for (const line of lines) {
      draw(cur, line, { x: MARGIN + 96, size: 10, font })
      cur.y -= 13
    }
    // A value that wrapped to nothing still consumed its label's row.
    if (lines.length === 0) cur.y -= 13
  }

  detail('Order no.', doc.orderNumber)
  detail('Placed', doc.placed)
  detail('Method', doc.method)
  detail('Date', doc.fulfilDate)
  detail('Billed to', doc.customerName)
  detail('Address', doc.address)

  cur.y -= 8
  columnHeader()

  // ── Lines ──
  for (const line of doc.lines) {
    const nameLines = wrap(line.name, font, 10, COL.qty - COL.item - 24)
    const optionLines = line.options ? wrap(line.options, font, 8.5, COL.qty - COL.item - 36) : []
    ensure(nameLines.length * 13 + optionLines.length * 11 + 8, true)

    const top = cur.y
    nameLines.forEach((l, i) => {
      draw(cur, l, { x: COL.item, size: 10, font })
      if (i < nameLines.length - 1) cur.y -= 13
    })
    // Qty, unit and amount sit on the FIRST line of a wrapped name, where the eye expects them.
    const back = cur.y
    cur.y = top
    draw(cur, String(line.qty), { x: COL.qty, size: 10, font, align: 'right' })
    draw(cur, line.unitText, { x: COL.unit, size: 10, font, align: 'right' })
    draw(cur, line.amountText, { x: COL.amount, size: 10, font, align: 'right' })
    cur.y = back - 13

    for (const l of optionLines) {
      draw(cur, l, { x: COL.item + 12, size: 8.5, font, color: MUTED })
      cur.y -= 11
    }
    cur.y -= 3
  }

  // ── Money ──
  ensure(doc.money.length * 16 + 24, true)
  cur.y -= 4
  rule()
  cur.y -= 16
  for (const row of doc.money) {
    const size = row.strong ? 12 : 10
    if (row.strong) {
      cur.y -= 4
      rule()
      cur.y -= 16
    }
    draw(cur, row.label, { x: COL.unit, size, font, color: row.strong ? INK : MUTED, align: 'right' })
    draw(cur, row.text, { x: COL.amount, size, font, align: 'right' })
    cur.y -= 16
  }

  // ── Payment instructions ──
  if (doc.payment.length > 0) {
    const block = doc.payment.flatMap((p) => wrap(p, font, 9, PAGE.width - MARGIN * 2))
    ensure(block.length * 12 + 30)
    cur.y -= 12
    draw(cur, 'PAYMENT', { x: MARGIN, size: 8, font, color: MUTED })
    cur.y -= 14
    for (const line of block) {
      draw(cur, line, { x: MARGIN, size: 9, font, color: MUTED })
      cur.y -= 12
    }
  }

  return pdf.save()
}
