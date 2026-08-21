import { describe, it, expect } from 'vitest'
import { invoiceLookupUrl, invoiceWaMessage, invoiceWaShareHref } from './invoiceShare'

const en = (e: string) => e
const zh = (_e: string, z?: string) => z ?? _e

describe('invoiceLookupUrl', () => {
  it('points at the guest invoice door, carrying the shop and the order', () => {
    expect(invoiceLookupUrl('https://tinyorder.vercel.app', 'sunny-bakes', 'SB-260820-0050'))
      .toBe('https://tinyorder.vercel.app/invoice?shop=sunny-bakes&order=SB-260820-0050')
  })

  it('encodes a slug and an order number rather than letting either break the query', () => {
    // A slug is generated and a number is machine-made, so neither is expected to need this.
    // It is here because a link that silently loses its `&order=` looks exactly like a working
    // link until the customer taps it.
    expect(invoiceLookupUrl('https://x.test', 'a&b', 'C D?e'))
      .toBe('https://x.test/invoice?shop=a%26b&order=C%20D%3Fe')
  })

  it('never doubles the slash when the origin carries a trailing one', () => {
    expect(invoiceLookupUrl('https://x.test/', 's', 'N')).toBe('https://x.test/invoice?shop=s&order=N')
  })
})

describe('invoiceWaMessage', () => {
  const order = {
    shopName: 'Sunny Bakes',
    customerName: 'Invoice Verify',
    orderNumber: 'SB-260820-0050',
    url: 'https://x.test/invoice?shop=sunny-bakes&order=SB-260820-0050',
  }

  it('names the shop, the order and the link', () => {
    const msg = invoiceWaMessage(order, en)
    expect(msg).toContain('Sunny Bakes')
    expect(msg).toContain('SB-260820-0050')
    expect(msg).toContain(order.url)
  })

  it('greets the customer by name when the order carries one', () => {
    expect(invoiceWaMessage(order, en)).toContain('Hi Invoice Verify')
  })

  it('greets without a name rather than greeting an empty space', () => {
    const msg = invoiceWaMessage({ ...order, customerName: null }, en)
    expect(msg).not.toContain('Hi ,')
    expect(msg.startsWith('Hi,')).toBe(true)
  })

  it('writes the sentence in the language the merchant is reading', () => {
    const msg = invoiceWaMessage(order, zh)
    expect(msg).toContain('账单')
    expect(msg).toContain(order.url)
  })

  it('ends with the link, so WhatsApp shows the preview under the message', () => {
    expect(invoiceWaMessage(order, en).endsWith(order.url)).toBe(true)
  })
})

describe('invoiceWaShareHref', () => {
  it('opens the customer chat with the message already typed', () => {
    expect(invoiceWaShareHref('+60 12-777 8888', 'hello'))
      .toBe('https://wa.me/60127778888?text=hello')
  })

  it('dials the international form of a locally typed number', () => {
    // The leading trunk zero is REPLACED by 60. `wa.me/0198765432` is a link to nobody.
    expect(invoiceWaShareHref('0198765432', 'x')).toBe('https://wa.me/60198765432?text=x')
  })

  it('encodes the message, so its line breaks and its link survive the query', () => {
    const href = invoiceWaShareHref('60127778888', 'Hi\nsee https://x.test/invoice?shop=s&order=N')!
    expect(href).toBe(
      'https://wa.me/60127778888?text=Hi%0Asee%20https%3A%2F%2Fx.test%2Finvoice%3Fshop%3Ds%26order%3DN',
    )
  })

  it('is null when there is nothing dialable, so no button is drawn', () => {
    expect(invoiceWaShareHref('n/a', 'x')).toBe(null)
    expect(invoiceWaShareHref('', 'x')).toBe(null)
  })
})
