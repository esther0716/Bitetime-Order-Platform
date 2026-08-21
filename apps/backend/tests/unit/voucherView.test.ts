import { describe, it, expect } from 'vitest'
import { voucherPublicView, voucherMerchantView } from '../../src/voucherView.js'

const ROW = {
  id: 'v1',
  code: 'BITE-K7M2P',
  kind: 'percent',
  amount: 20,
  max_uses: 3,
  per_customer_limit: 1,
  used_by: ['alice@example.com', 'bob@example.com'],
}

// The property both views exist to hold. Asserted by SCANNING the serialised response rather
// than by naming a field, because the failure mode is a field someone ADDS later — a `used_by`
// passed through, a `redeemers` convenience, a spread of the row. Naming `used_by` would not
// catch any of those; looking for the address does.
function leaks(view: unknown): boolean {
  return JSON.stringify(view).includes('@example.com')
}

describe('voucherPublicView', () => {
  it('never carries a redeemer address', () => {
    expect(leaks(voucherPublicView(ROW, null))).toBe(false)
    expect(leaks(voucherPublicView(ROW, 'alice@example.com'))).toBe(false)
  })

  it('carries what pricing needs', () => {
    const v = voucherPublicView(ROW, null)
    expect(v.code).toBe('BITE-K7M2P')
    expect(v.kind).toBe('percent')
    expect(v.amount).toBe(20)
    expect(v.max_uses).toBe(3)
  })

  it('answers customer_limit_reached from the caller own verified email, case-insensitively', () => {
    expect(voucherPublicView(ROW, 'ALICE@example.com').customer_limit_reached).toBe(true)
    expect(voucherPublicView(ROW, 'carol@example.com').customer_limit_reached).toBe(false)
  })

  it('counts against the per-customer limit rather than testing membership', () => {
    // The rule #241 asked for. Under a limit of 3, a customer holding 2 redemptions is NOT done —
    // which is exactly what the old membership test got wrong.
    const reusable = { ...ROW, per_customer_limit: 3, max_uses: null }
    expect(voucherPublicView(reusable, 'alice@example.com', 2).customer_limit_reached).toBe(false)
    expect(voucherPublicView(reusable, 'alice@example.com', 3).customer_limit_reached).toBe(true)
  })

  it('reads a null per_customer_limit as unlimited, never as reached', () => {
    const unlimited = { ...ROW, per_customer_limit: null, max_uses: 100 }
    expect(voucherPublicView(unlimited, 'alice@example.com', 99).customer_limit_reached).toBe(false)
  })

  it('omits customer_limit_reached entirely for a caller with no identity', () => {
    // Absent, not false. A signed-out caller has not been told "no" — they have not been asked,
    // and they cannot redeem at all until they sign in.
    expect('customer_limit_reached' in voucherPublicView(ROW, null)).toBe(false)
    expect('customer_limit_reached' in voucherPublicView(ROW, '   ')).toBe(false)
  })

  it('carries the restrictions the storefront prices and refuses on', () => {
    const v = voucherPublicView({ ...ROW, expires_at: '2026-08-31T15:59:59.999Z', min_order: '50' }, null)
    expect(v.expires_at).toBe('2026-08-31T15:59:59.999Z')
    expect(v.min_order).toBe('50')
    expect(v.per_customer_limit).toBe(1)
  })

  it('reads a null max_uses as unlimited, and 0 as redeemable by nobody', () => {
    expect(voucherPublicView({ ...ROW, max_uses: null }, null).fully_used).toBe(false)
    expect(voucherPublicView({ ...ROW, max_uses: 0 }, null).fully_used).toBe(true)
    expect(voucherPublicView({ ...ROW, max_uses: 2 }, null).fully_used).toBe(true)
    expect(voucherPublicView({ ...ROW, max_uses: 3 }, null).fully_used).toBe(false)
  })

  it('survives a used_by that is not a list of strings', () => {
    // jsonb holds whatever it was ever given, and this row is read on the checkout path.
    expect(voucherPublicView({ ...ROW, used_by: null }, null).fully_used).toBe(false)
    expect(voucherPublicView({ ...ROW, used_by: 'nope' }, null).fully_used).toBe(false)
    expect(voucherMerchantView({ ...ROW, used_by: [1, null, 'a@b.com'] }).used_count).toBe(1)
  })
})

describe('voucherMerchantView', () => {
  // The create response is where the tenancy invariant is observable: POST forces merchant_id
  // from the route and never reads it from the body. Drop the field and the API test proving a
  // crafted body cannot plant a voucher under a stranger's shop passes on `undefined`.
  it('keeps merchant_id', () => {
    expect(voucherMerchantView({ ...ROW, merchant_id: 'm1' }).merchant_id).toBe('m1')
  })

  it('gives the shop a count and never the redeemers', () => {
    const v = voucherMerchantView(ROW)
    expect(v.used_count).toBe(2)
    expect(leaks(v)).toBe(false)
  })

  it('does not leak a redeemer through customer_limit_reached either', () => {
    // The merchant view has no caller identity and must not grow one: "has alice redeemed this?"
    // is a question about a person, and the shop boundary says a shop cannot ask it.
    expect('customer_limit_reached' in voucherMerchantView(ROW)).toBe(false)
  })

  it('shows the expiry back as the shop-local date the merchant typed', () => {
    // Not a slice of the ISO string: east of UTC the instant sits on the previous calendar day.
    const v = voucherMerchantView({ ...ROW, expires_at: '2026-08-31T15:59:59.999Z' }, 'Asia/Kuala_Lumpur')
    expect(v.expires_on).toBe('2026-08-31')
    expect(voucherMerchantView(ROW, 'Asia/Kuala_Lumpur').expires_on).toBeNull()
  })

  it('prefers a counted redemption total over the used_by length', () => {
    expect(voucherMerchantView(ROW, 'UTC', 7).used_count).toBe(7)
  })
})
