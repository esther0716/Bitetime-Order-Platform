import { describe, it, expect } from 'vitest'
import { BLANK_VOUCHER, voucherToForm, formToRules, voucherDraftChanged } from './voucherDraft'
import type { Voucher } from '../types'

const plain: Voucher = { id: 'v1', code: 'SAVE10', type: 'percent', value: 10, maxUses: null, perCustomerLimit: 1, expiresOn: null, minOrder: null }

describe('voucherToForm', () => {
  it('opens a plain voucher with every limit box unticked', () => {
    const f = voucherToForm(plain)
    expect(f).toMatchObject({ code: 'SAVE10', active: true, kind: 'percent', amount: '10' })
    expect([f.limitTotal, f.limitPerCustomer, f.limitExpiry, f.limitMinOrder]).toEqual([false, false, false, false])
    // The blank form's suggestion, so ticking "reusable" later does not offer "1".
    expect(f.perCustomerLimit).toBe(BLANK_VOUCHER.perCustomerLimit)
  })

  it('ticks exactly the boxes the row holds a rule for', () => {
    const f = voucherToForm({ ...plain, type: 'fixed', value: 5.5, maxUses: 40, perCustomerLimit: 3, expiresOn: '2026-12-31', minOrder: 30 })
    expect(f).toMatchObject({
      kind: 'fixed', amount: '5.5',
      limitTotal: true, maxUses: '40',
      limitPerCustomer: true, perCustomerLimit: '3',
      limitExpiry: true, expiresOn: '2026-12-31',
      limitMinOrder: true, minOrder: '30',
    })
  })

  it('opens a paused voucher with its switch off', () => {
    expect(voucherToForm({ ...plain, active: false }).active).toBe(false)
  })

  it('shows an unlimited per-customer voucher as reusable with a blank count', () => {
    const f = voucherToForm({ ...plain, maxUses: 100, perCustomerLimit: null })
    expect(f.limitPerCustomer).toBe(true)
    expect(f.perCustomerLimit).toBe('')
  })

  it('round-trips through the rules it sends', () => {
    const v: Voucher = { ...plain, type: 'fixed', value: 5, maxUses: 40, perCustomerLimit: null, expiresOn: '2026-12-31', minOrder: 30 }
    expect(formToRules(voucherToForm(v))).toEqual({
      kind: 'fixed', amount: 5, maxUses: 40, perCustomerLimit: null, expiresOn: '2026-12-31', minOrder: 30,
    })
    expect(formToRules(voucherToForm(plain))).toEqual({
      kind: 'percent', amount: 10, maxUses: null, perCustomerLimit: 1, expiresOn: null, minOrder: null,
    })
  })
})

describe('formToRules', () => {
  it('sends the off value for an unticked box, whatever sits behind it', () => {
    const r = formToRules({ ...BLANK_VOUCHER, amount: '10', maxUses: '5', perCustomerLimit: '9', expiresOn: '2026-12-31', minOrder: '30' })
    expect(r).toEqual({ kind: 'percent', amount: 10, maxUses: null, perCustomerLimit: 1, expiresOn: null, minOrder: null })
  })

  it('sends unlimited per customer for a ticked box with a blank count', () => {
    expect(formToRules({ ...BLANK_VOUCHER, amount: '10', limitPerCustomer: true, perCustomerLimit: '' }).perCustomerLimit).toBeNull()
  })
})

describe('voucherDraftChanged', () => {
  it('is quiet about text typed behind a box that was then unticked', () => {
    const seeded = voucherToForm(plain)
    expect(voucherDraftChanged({ ...seeded, expiresOn: '2026-12-31' }, seeded)).toBe(false)
  })

  it('notices a changed amount, a ticked box, and a changed code', () => {
    const seeded = voucherToForm(plain)
    expect(voucherDraftChanged({ ...seeded, amount: '15' }, seeded)).toBe(true)
    expect(voucherDraftChanged({ ...seeded, limitExpiry: true, expiresOn: '2026-12-31' }, seeded)).toBe(true)
    expect(voucherDraftChanged({ ...seeded, code: 'OTHER' }, seeded)).toBe(true)
    expect(voucherDraftChanged({ ...seeded, active: false }, seeded)).toBe(true)
  })
})
