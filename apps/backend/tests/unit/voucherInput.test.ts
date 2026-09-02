// The one body parser both voucher write routes share. Pinned here so a rule that create enforces
// cannot be forgotten by edit — the two read the same six fields through this function.
import { describe, it, expect } from 'vitest'
import { parseVoucherRules } from '../../src/voucherInput.js'

const KL = 'Asia/Kuala_Lumpur'

function rules(b: unknown, tz = KL) {
  const r = parseVoucherRules(b, tz)
  if (!r.ok) throw new Error(`refused: ${r.error}`)
  return r.rules
}
function refusal(b: unknown, tz = KL) {
  const r = parseVoucherRules(b, tz)
  if (r.ok) throw new Error('accepted')
  return r.error
}

describe('parseVoucherRules', () => {
  it('reads the plain voucher: one each, no cap, no expiry, no minimum', () => {
    expect(rules({ kind: 'percent', amount: 10 })).toEqual({
      kind: 'percent', amount: 10, max_uses: null, per_customer_limit: 1, expires_at: null, min_order: null,
    })
  })

  it('never reads a code — it is written once and belongs to the create route', () => {
    expect(rules({ kind: 'fixed', amount: 5, code: 'SAVE' })).not.toHaveProperty('code')
  })

  it('refuses a discount it cannot price', () => {
    expect(refusal({ kind: 'bogo', amount: 1 })).toBe('Invalid discount')
    expect(refusal({ kind: 'percent', amount: 'ten' })).toBe('Invalid discount')
    expect(refusal({ kind: 'fixed', amount: -5 })).toBe('Invalid discount')
    expect(refusal({ amount: 5 })).toBe('Invalid discount')
  })

  it('treats an ABSENT per-customer limit as one each and an explicit null as unlimited', () => {
    expect(rules({ kind: 'fixed', amount: 5 }).per_customer_limit).toBe(1)
    expect(rules({ kind: 'fixed', amount: 5, perCustomerLimit: null, maxUses: 100 }).per_customer_limit).toBeNull()
    expect(rules({ kind: 'fixed', amount: 5, perCustomerLimit: '' , maxUses: 100 }).per_customer_limit).toBeNull()
  })

  it('refuses unlimited per customer AND unlimited in total', () => {
    expect(refusal({ kind: 'fixed', amount: 5, perCustomerLimit: null, maxUses: null })).toBe('unbounded_voucher')
  })

  it('refuses a limit below one, and a negative minimum', () => {
    expect(refusal({ kind: 'fixed', amount: 5, perCustomerLimit: 0 })).toBe('Invalid limit')
    expect(refusal({ kind: 'fixed', amount: 5, maxUses: -3 })).toBe('Invalid limit')
    expect(refusal({ kind: 'fixed', amount: 5, maxUses: 2.5 })).toBe('Invalid limit')
    expect(refusal({ kind: 'fixed', amount: 5, minOrder: -1 })).toBe('Invalid minimum order')
  })

  it('resolves the merchant’s DATE to the last instant of that day on the shop clock', () => {
    const r = rules({ kind: 'fixed', amount: 5, expiresOn: '2026-08-31' })
    expect(new Date(r.expires_at!).toISOString()).toBe('2026-08-31T15:59:59.999Z')
  })

  it('refuses a present-but-unparseable expiry rather than dropping it', () => {
    expect(refusal({ kind: 'fixed', amount: 5, expiresOn: '31/08/2026' })).toBe('Invalid expiry date')
    expect(rules({ kind: 'fixed', amount: 5, expiresOn: '' }).expires_at).toBeNull()
    expect(rules({ kind: 'fixed', amount: 5, expiresOn: null }).expires_at).toBeNull()
  })

  it('coerces the numbers a form sends as strings', () => {
    expect(rules({ kind: 'fixed', amount: '5.50', maxUses: '100', minOrder: '30' })).toMatchObject({
      amount: 5.5, max_uses: 100, min_order: 30,
    })
  })
})
