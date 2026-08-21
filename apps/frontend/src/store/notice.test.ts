import { describe, it, expect } from 'vitest'
import { noticeText, voucherErrorText, type Notice, type NoticeCtx } from './notice'

const en = (e: string) => e
const zh = (_e: string, z?: string) => z ?? _e

const ctx = (over: Partial<NoticeCtx> = {}): NoticeCtx =>
  ({ t: en, currency: 'MYR', pickupEscape: false, canRequote: false, ...over })

describe('noticeText', () => {
  it('renders every kind in both languages', () => {
    // The property that matters is not the wording — it is that NOTHING is stored pre-rendered,
    // so each of these is produced fresh from the language in force at paint time (#134).
    const cases: Notice[] = [
      { kind: 'voucher_checking' },
      { kind: 'voucher_error', code: 'invalid' },
      { kind: 'voucher_applied', type: 'percent', value: 10 },
      { kind: 'voucher_signed_out', voucherCode: 'SAVE10' },
      { kind: 'voucher_gone' },
      { kind: 'order_refusal', code: 'price_changed' },
    ]
    for (const n of cases) {
      const english = noticeText(n, ctx({ t: en }))
      const chinese = noticeText(n, ctx({ t: zh }))
      expect(english).not.toBe('')
      expect(chinese).not.toBe('')
      // Every one of these has real Chinese copy, so the two must actually differ.
      expect(chinese).not.toBe(english)
    }
  })

  it('names the voucher that a sign-out confiscated', () => {
    const n: Notice = { kind: 'voucher_signed_out', voucherCode: 'SAVE10' }
    expect(noticeText(n, ctx({ t: en }))).toContain('SAVE10')
    expect(noticeText(n, ctx({ t: zh }))).toContain('SAVE10')
  })

  it('formats an applied money discount in the shop’s own currency', () => {
    // The second thing a stored sentence froze: a shop's currency is not the customer's language,
    // and both were baked in at the moment the voucher was applied.
    const n: Notice = { kind: 'voucher_applied', type: 'amount', value: 5 }
    expect(noticeText(n, ctx({ currency: 'MYR' }))).toContain('RM')
    expect(noticeText(n, ctx({ currency: 'SGD' }))).not.toContain('RM')
  })

  it('prints a percent discount as a bare number, with no currency at all', () => {
    const n: Notice = { kind: 'voucher_applied', type: 'percent', value: 10 }
    expect(noticeText(n, ctx())).toContain('10%')
    expect(noticeText(n, ctx())).not.toContain('RM')
  })

  it('defers a refusal’s copy to orderRefusal.ts, context and all', () => {
    // Not just the language: `pickupEscape` can turn on under a merchant refresh, and a stored
    // sentence would go on withholding an escape the shop now offers.
    const n: Notice = { kind: 'order_refusal', code: 'distance_lookup_failed' }
    const withEscape = noticeText(n, ctx({ pickupEscape: true }))
    const without = noticeText(n, ctx({ pickupEscape: false }))
    expect(withEscape).not.toBe(without)
    expect(withEscape.toLowerCase()).toContain('pickup')
  })

  it('renders an unknown refusal as a sentence rather than a raw code', () => {
    // A deployed browser is always older than the server.
    const n: Notice = { kind: 'order_refusal', code: undefined }
    expect(noticeText(n, ctx())).toBe('Failed to place order. Please try again.')
  })
})

describe('voucherErrorText', () => {
  it('says which refusal it was', () => {
    expect(voucherErrorText('invalid', en)).toContain('Invalid')
    expect(voucherErrorText('fully_used', en)).toContain('fully redeemed')
    expect(voucherErrorText('customer_limit_reached', en)).toContain('as many times as allowed')
    expect(voucherErrorText('expired', en)).toContain('expired')
    expect(voucherErrorText('min_order', en)).toContain('minimum')
  })

  it('says nothing for a code it does not know', () => {
    expect(voucherErrorText('something_new' as never, en)).toBe('')
  })
})
