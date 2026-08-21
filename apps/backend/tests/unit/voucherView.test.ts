import { describe, it, expect } from 'vitest'
import { voucherPublicView, voucherMerchantView } from '../../src/voucherView.js'

const ROW = {
  id: 'v1',
  code: 'BITE-K7M2P',
  kind: 'percent',
  amount: 20,
  max_uses: 3,
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

  it('answers already_used from the caller own verified email, case-insensitively', () => {
    expect(voucherPublicView(ROW, 'ALICE@example.com').already_used).toBe(true)
    expect(voucherPublicView(ROW, 'carol@example.com').already_used).toBe(false)
  })

  it('omits already_used entirely for a caller with no identity', () => {
    // Absent, not false. A signed-out caller has not been told "no" — they have not been asked,
    // and they cannot redeem at all until they sign in.
    expect('already_used' in voucherPublicView(ROW, null)).toBe(false)
    expect('already_used' in voucherPublicView(ROW, '   ')).toBe(false)
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

  it('does not leak a redeemer through already_used either', () => {
    // The merchant view has no caller identity and must not grow one: "has alice redeemed this?"
    // is a question about a person, and the shop boundary says a shop cannot ask it.
    expect('already_used' in voucherMerchantView(ROW)).toBe(false)
  })
})
