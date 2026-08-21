import { describe, it, expect } from 'vitest'
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import * as fontkitNs from 'fontkit'
import { canIssueInvoice } from '@bitetime/shared'
import {
  invoiceSubtotal,
  invoiceFileName,
  invoiceQrUrl,
  buildInvoice,
  renderInvoicePdf,
} from '../../src/invoice.js'
import { invoiceFont } from '../../src/invoiceFont.js'

const MERCHANT = {
  name: 'Kedai Kek',
  pickup_address: '12 Jalan Ampang, 50450 Kuala Lumpur',
  origin_address: null,
  payment_bank: 'Maybank 5141 2233 4455 (Kedai Kek Sdn Bhd)',
  payment_note: 'Transfer, then send us the slip.',
}

/** A region-priced delivery order with a voucher and tax — the busiest shape. */
const ORDER = {
  order_number: 'KE-260820-0051',
  created_at: '2026-08-20T04:30:00.000Z',
  status: 'completed',
  mode: 'delivery',
  fulfil_date: '2026-08-22',
  customer_name: 'Siti',
  currency: 'MYR',
  address: { line1: '9 Jalan Bukit', postcode: '43000', city: 'Kajang', state: 'Selangor' },
  items: [
    { id: 'p1', name: 'Butter cake', qty: 2, price: 18 },
    { id: 'p2', name: 'Latte', qty: 1, price: 15, selections: [
      { groupName: 'Milk', optionName: 'Oat milk', qty: 1, delta: 3 },
      { groupName: 'Sugar', optionName: 'No sugar', qty: 1, delta: 0 },
    ] },
  ],
  shipping_fee: 8,
  discount: 5,
  tax: 3.24,
  tax_rate: 6,
  total: 57.24,
  delivery_distance_km: null,
}

describe('canIssueInvoice', () => {
  it('issues from new onward', () => {
    for (const s of ['new', 'preparing', 'ready', 'completed']) {
      expect(canIssueInvoice(s)).toBe(true)
    }
  })

  // The shop has confirmed nothing yet, and nothing happened — two different refusals for the
  // customer, one answer here.
  it('refuses pending_payment and cancelled', () => {
    expect(canIssueInvoice('pending_payment')).toBe(false)
    expect(canIssueInvoice('cancelled')).toBe(false)
  })

  // An unrecognised status is a status this file has not been taught, not a licence to issue.
  it('refuses an unknown or missing status', () => {
    expect(canIssueInvoice('refunded')).toBe(false)
    expect(canIssueInvoice(null)).toBe(false)
    expect(canIssueInvoice(undefined)).toBe(false)
  })
})

describe('invoiceSubtotal', () => {
  it('sums the printed lines', () => {
    expect(invoiceSubtotal(ORDER.items)).toBe(51)
  })

  // A split promo writes TWO entries under one product id; both count.
  it('counts every entry, including a promo split', () => {
    const items = [
      { id: 'p1', name: 'Bun', qty: 3, price: 4, promo: true },
      { id: 'p1', name: 'Bun', qty: 2, price: 5 },
    ]
    expect(invoiceSubtotal(items)).toBe(22)
  })

  // pricing.ts rounds each lineTotal before summing, and the invoice prints each line rounded.
  // Summing unrounded products would disagree with the column printed above the sum.
  it('rounds each line before summing', () => {
    const items = [
      { id: 'a', name: 'a', qty: 3, price: 0.335 },
      { id: 'b', name: 'b', qty: 3, price: 0.335 },
    ]
    expect(invoiceSubtotal(items)).toBe(2.02)
  })

  it('reads a missing or empty item list as zero', () => {
    expect(invoiceSubtotal(null)).toBe(0)
    expect(invoiceSubtotal(undefined)).toBe(0)
    expect(invoiceSubtotal([])).toBe(0)
  })
})

describe('buildInvoice', () => {
  it('reconciles: subtotal + fee − voucher + tax = total', () => {
    const doc = buildInvoice(ORDER, MERCHANT)
    const money = Object.fromEntries(doc.money.map(r => [r.label, r.amount]))
    expect(money['Subtotal']).toBe(51)
    expect(money['Delivery fee']).toBe(8)
    expect(money['Voucher']).toBe(-5)
    expect(money['Tax (6%)']).toBe(3.24)
    expect(money['Total']).toBe(57.24)
    const sum = doc.money.filter(r => r.label !== 'Total').reduce((s, r) => s + r.amount, 0)
    expect(Number(sum.toFixed(2))).toBe(money['Total'])
  })

  it('names the fee after the method, with the km that produced it', () => {
    const express = buildInvoice(
      { ...ORDER, mode: 'express', delivery_distance_km: 25.2 },
      MERCHANT,
    )
    expect(express.money.some(r => r.label === 'Express delivery fee (25.2 km)')).toBe(true)
  })

  // A region-priced order has no distance, and printing one would be a lie about what produced
  // the money.
  it('drops the km when the method is not distance-priced', () => {
    const doc = buildInvoice({ ...ORDER, mode: 'delivery', delivery_distance_km: 13.9 }, MERCHANT)
    expect(doc.money.some(r => r.label === 'Delivery fee')).toBe(true)
    expect(doc.money.some(r => r.label.includes('km'))).toBe(false)
  })

  it('omits a fee, a voucher and a tax row that are not there', () => {
    const doc = buildInvoice(
      { ...ORDER, mode: 'pickup', address: null, shipping_fee: 0, discount: 0, tax: 0, tax_rate: 0, total: 51 },
      MERCHANT,
    )
    const labels = doc.money.map(r => r.label)
    expect(labels).toEqual(['Subtotal', 'Total'])
  })

  // A pickup invoice must not carry an address the customer never gave for this order.
  // A CALENDAR date, read as a person reads it, and never turned into an instant — that would
  // print the day before for a reader in another zone.
  it('prints the fulfil date as a calendar date', () => {
    expect(buildInvoice(ORDER, MERCHANT).fulfilDate).toBe('22 Aug 2026')
    expect(buildInvoice({ ...ORDER, fulfil_date: null }, MERCHANT).fulfilDate).toBe('')
  })

  it('prints the address on delivery and never on pickup', () => {
    expect(buildInvoice(ORDER, MERCHANT).address).toContain('Jalan Bukit')
    expect(buildInvoice({ ...ORDER, mode: 'pickup' }, MERCHANT).address).toBe('')
  })

  it('prints each chosen option with the delta that was charged', () => {
    const doc = buildInvoice(ORDER, MERCHANT)
    const latte = doc.lines[1]
    expect(latte.options).toBe('Oat milk ×1 (+RM 3.00), No sugar ×1')
  })

  // Rows written before menu options carry no `selections` key at all. Absent reads as no
  // options, never as a crash.
  it('reads a line with no selections as a line with no options', () => {
    const doc = buildInvoice(ORDER, MERCHANT)
    expect(doc.lines[0].options).toBe('')
  })

  it('states the money in the order’s own currency, never the shop’s current one', () => {
    const doc = buildInvoice({ ...ORDER, currency: 'SGD' }, MERCHANT)
    expect(doc.money[0].text).toBe('S$ 51.00')
  })

  it('carries the shop address, falling back to the routing origin', () => {
    expect(buildInvoice(ORDER, MERCHANT).shopAddress).toContain('Jalan Ampang')
    const distanceShop = { ...MERCHANT, pickup_address: null, origin_address: '1 Jalan Asal' }
    expect(buildInvoice(ORDER, distanceShop).shopAddress).toBe('1 Jalan Asal')
    const noShopAddress = { ...MERCHANT, pickup_address: null, origin_address: null }
    expect(buildInvoice(ORDER, noShopAddress).shopAddress).toBe('')
  })

  it('carries the payment instructions when the shop has them', () => {
    const doc = buildInvoice(ORDER, MERCHANT)
    expect(doc.payment).toEqual([MERCHANT.payment_bank, MERCHANT.payment_note])
    expect(buildInvoice(ORDER, { ...MERCHANT, payment_bank: null, payment_note: null }).payment).toEqual([])
  })

  // Paper goes stale and an order does not. Status, courier and AWB are absent by design; the
  // customer's phone is absent because the document travels.
  it('states nothing about status, courier or the customer’s phone', () => {
    const doc = buildInvoice(
      { ...ORDER, courier: 'jnt', tracking_number: 'JT123', customer_wa: '0123456789' },
      MERCHANT,
    )
    const text = JSON.stringify(doc)
    expect(text).not.toContain('completed')
    expect(text).not.toContain('JT123')
    expect(text).not.toContain('0123456789')
  })
})

describe('invoiceQrUrl', () => {
  it('points at this order’s own lookup, with the number filled in', () => {
    expect(invoiceQrUrl(ORDER, { ...MERCHANT, slug: 'kedai-kek' }, 'https://tinyorder.test'))
      .toBe('https://tinyorder.test/invoice?shop=kedai-kek&order=KE-260820-0051')
  })

  // The paper is forwarded, photographed and left on counters. A link that fetched the document
  // by itself would make the paper the credential — the phone stays out of it (ADR 0018).
  it('carries no phone and nothing else that would open the door', () => {
    const url = invoiceQrUrl(
      { ...ORDER, customer_wa: '0123456789', customer_phone_key: '23456789' },
      { ...MERCHANT, slug: 'kedai-kek' },
      'https://tinyorder.test',
    )
    expect(url).not.toContain('0123456789')
    expect(url).not.toContain('23456789')
    expect(url).not.toContain('phone')
  })

  it('tolerates a trailing slash on the frontend url, and escapes what it interpolates', () => {
    expect(invoiceQrUrl(ORDER, { ...MERCHANT, slug: 'kedai-kek' }, 'https://tinyorder.test/'))
      .toBe('https://tinyorder.test/invoice?shop=kedai-kek&order=KE-260820-0051')
    expect(invoiceQrUrl({ ...ORDER, order_number: 'A B&C' }, { ...MERCHANT, slug: 'a b' }, 'https://x.test'))
      .toBe('https://x.test/invoice?shop=a%20b&order=A%20B%26C')
  })
})

describe('invoiceFileName', () => {
  it('names the file after the order', () => {
    expect(invoiceFileName('KE-260820-0051')).toBe('Invoice-KE-260820-0051.pdf')
  })

  // The name reaches a Content-Disposition header, so anything that could break out of it goes.
  it('keeps the name to characters a header can carry', () => {
    expect(invoiceFileName('KE"; rm -rf /')).toBe('Invoice-KE-rm-rf.pdf')
    expect(invoiceFileName('')).toBe('Invoice.pdf')
  })
})

const fontkit = (fontkitNs as unknown as { default?: typeof fontkitNs }).default ?? fontkitNs

/**
 * The embedded font subset, pulled back out of a rendered PDF.
 *
 * This exists because of a bug that every other assertion in this file sailed past.
 * `@pdf-lib/fontkit` — the package pdf-lib's own README tells you to register — subsets Noto Sans
 * SC into a font whose glyf entries are EMPTY for most glyphs. No error, no warning: the PDF
 * opens, the layout is right, the text selects and copies correctly, and two thirds of the
 * letters are not drawn. "Sunny Bakes INVOICE" printed as "Su INV I".
 *
 * Byte-count assertions cannot see that. Reading the subset back can.
 */
function embeddedFont(pdfBytes: Uint8Array) {
  return PDFDocument.load(pdfBytes).then((pdf) => {
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue
      const bytes = decodePDFRawStream(obj).decode()
      // Either sfnt tag a TrueType outline font can carry: the version number, or the literal
      // 'true' — fontkit's subsetter writes the second one.
      const tag = String.fromCharCode(...bytes.slice(0, 4))
      const version = bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0
      if (version || tag === 'true') {
        return (fontkit as unknown as { create: (b: Uint8Array) => any }).create(bytes)
      }
    }
    throw new Error('no embedded TrueType font found in the PDF')
  })
}

describe('renderInvoicePdf', () => {
  const font = invoiceFont()
  // A stand-in for `env.frontendUrl`, which this module never reads — see `renderInvoicePdf`.
  const opts = { font, frontendUrl: 'https://tinyorder.test' }

  it('emits a PDF', async () => {
    const bytes = await renderInvoicePdf(ORDER, MERCHANT, opts)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(1000)
  })

  // The labels are English, but a shop and its products routinely carry Chinese in the base
  // `name` column — a latin-only face would render tofu for exactly those shops.
  it('renders Chinese names without dropping them', async () => {
    const bytes = await renderInvoicePdf(
      { ...ORDER, items: [{ id: 'p1', name: '拿铁咖啡', qty: 1, price: 15 }] },
      { ...MERCHANT, name: '小食堂 Kopitiam' },
      opts,
    )
    expect(bytes.length).toBeGreaterThan(1000)
  })

  // Shop names carry emoji. An unencodable glyph must degrade, never throw — the merchant would
  // meet it as a broken feature with no way to know why.
  it('survives a character the font has no glyph for', async () => {
    await expect(
      renderInvoicePdf({ ...ORDER, customer_name: 'Siti 🍰' }, { ...MERCHANT, name: '🍰 Cakes' }, opts),
    ).resolves.toBeInstanceOf(Uint8Array)
  })

  // THE regression test for the subsetting bug in `pdfFontkit.ts`.
  //
  // Every distinct character the document prints must arrive as a glyph WITH AN OUTLINE. Counting
  // is what makes this precise: the source face is asked how many of those characters it draws,
  // and the embedded subset must draw the same number. `@pdf-lib/fontkit` produced 10 where 39
  // were needed, and every other assertion in this file passed while it did.
  it('embeds an outline for every character the invoice prints', async () => {
    const doc = buildInvoice(ORDER, MERCHANT)
    const printed = [
      doc.shopName, doc.shopAddress, doc.orderNumber, doc.placed, doc.method, doc.fulfilDate,
      doc.customerName, doc.address,
      ...doc.lines.flatMap(l => [l.name, l.options, String(l.qty), l.unitText, l.amountText]),
      ...doc.money.flatMap(m => [m.label, m.text]),
      ...doc.payment,
      'INVOICE FROM ORDER NO. AMOUNT DATE & TIME FOR METHOD BILLED TO ADDRESS PAYMENT TOTAL',
      'Scan to get this invoice again',
    ].join('')

    const source = (fontkit as unknown as { create: (b: Uint8Array) => any }).create(font)
    const drawnGlyphs = new Set<number>()
    for (const glyph of source.layout(printed).glyphs) {
      if (glyph.path.commands.length > 0) drawnGlyphs.add(glyph.id)
    }
    expect(drawnGlyphs.size).toBeGreaterThan(30)

    const embedded = await embeddedFont(await renderInvoicePdf(ORDER, MERCHANT, opts))
    let outlined = 0
    for (let gid = 0; gid < embedded.numGlyphs; gid += 1) {
      if (embedded.getGlyph(gid).path.commands.length > 0) outlined += 1
    }
    expect(outlined).toBeGreaterThanOrEqual(drawnGlyphs.size)
  })

  // The same check for Chinese, which is the reason the CJK face is embedded at all.
  it('embeds Chinese glyphs with outlines, not blanks', async () => {
    const bytes = await renderInvoicePdf(
      { ...ORDER, items: [{ id: 'p1', name: '拿铁咖啡', qty: 1, price: 15 }] },
      { ...MERCHANT, name: '小食堂' },
      opts,
    )
    const embedded = await embeddedFont(bytes)
    const outlined = Array.from({ length: embedded.numGlyphs }, (_, i) => embedded.getGlyph(i))
      .filter(g => g.path.commands.length > 0)
    // Seven distinct Chinese characters are on this page, on top of the Latin ones.
    expect(outlined.length).toBeGreaterThanOrEqual(7)
  })

  // The ticket grows down to a sheet's worth and then CONTINUES. A metre-long page is one no
  // viewer can read and no printer can place; a second ticket page is both.
  it('keeps a short order on one page', async () => {
    const pdf = await PDFDocument.load(await renderInvoicePdf(ORDER, MERCHANT, opts))
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getPage(0).getWidth()).toBe(226)
    expect(pdf.getPage(0).getHeight()).toBeLessThanOrEqual(842)
  })

  it('continues onto further pages rather than growing without bound', async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`, name: `Item number ${i}`, qty: 1, price: 3,
    }))
    const pdf = await PDFDocument.load(
      await renderInvoicePdf({ ...ORDER, items, total: 129.24 }, MERCHANT, opts),
    )

    expect(pdf.getPageCount()).toBeGreaterThan(1)
    for (const page of pdf.getPages()) {
      // The till-roll width never changes, and no page may exceed a sheet.
      expect(page.getWidth()).toBe(226)
      expect(page.getHeight()).toBeLessThanOrEqual(842)
    }
  })

  // A wrapping name, a long option line and a payment note are the three things that push a
  // block's height around; none of them may push a block off the bottom of its page.
  it('never lets a block overflow the page it was placed on', async () => {
    const items = Array.from({ length: 18 }, (_, i) => ({
      id: `p${i}`,
      name: `A deliberately long product name number ${i} that will wrap across lines`,
      qty: 2, price: 7.5,
      selections: [{ groupName: 'Milk', optionName: `Oat milk option ${i}`, qty: 1, delta: 3 }],
    }))
    const pdf = await PDFDocument.load(
      await renderInvoicePdf({ ...ORDER, items, total: 300 }, MERCHANT, opts),
    )
    for (const page of pdf.getPages()) expect(page.getHeight()).toBeLessThanOrEqual(842)
  })

  // The order's payment note is free text a merchant types, newlines and all.
  it('accepts a multi-line payment note', async () => {
    await expect(
      renderInvoicePdf(ORDER, { ...MERCHANT, payment_note: 'Line one\nLine two\n\nLine four' }, opts),
    ).resolves.toBeInstanceOf(Uint8Array)
  })
})
