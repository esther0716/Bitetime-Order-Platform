import { describe, it, expect } from 'vitest'
import { canUploadPaymentProof } from './paymentProof'
import { ORDER_STATUSES } from './orderStatus'

describe('canUploadPaymentProof', () => {
  it('offers the upload while the order is still live', () => {
    for (const status of ['pending_payment', 'new', 'preparing', 'ready']) {
      expect(canUploadPaymentProof(status)).toBe(true)
    }
  })

  // A slip on a cancelled order changes nothing — the intake rule only ever moves an order out
  // of pending_payment — and a completed one is settled. Offering it there promises a recovery
  // the app cannot deliver.
  it('refuses a settled order', () => {
    expect(canUploadPaymentProof('completed')).toBe(false)
    expect(canUploadPaymentProof('cancelled')).toBe(false)
  })

  it('refuses a status it has not been taught, and a missing one', () => {
    expect(canUploadPaymentProof('shipped')).toBe(false)
    expect(canUploadPaymentProof('')).toBe(false)
    expect(canUploadPaymentProof(null)).toBe(false)
    expect(canUploadPaymentProof(undefined)).toBe(false)
  })

  // The two lists must stay joined: a status added to the vocabulary is a decision this rule
  // has to make, and defaulting silently to "no upload" is how a new live status ends up
  // unable to receive a receipt with nothing failing.
  it('decides every status the app knows about', () => {
    const decided = [...['pending_payment', 'new', 'preparing', 'ready'], 'completed', 'cancelled']
    expect([...ORDER_STATUSES].sort()).toEqual([...decided].sort())
  })
})
