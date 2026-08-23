import { describe, it, expect } from 'vitest'
import { ORDER_STATUSES } from '../../orderStatus'
import { nextStatus } from './nextStatus'

describe('nextStatus', () => {
  it('walks the working chain one step at a time', () => {
    expect(nextStatus('new')?.to).toBe('preparing')
    expect(nextStatus('preparing')?.to).toBe('ready')
    expect(nextStatus('ready')?.to).toBe('completed')
  })

  it('labels each step in both languages', () => {
    expect(nextStatus('new')).toMatchObject({ en: 'Start preparing →', zh: '开始备料 →' })
    expect(nextStatus('preparing')).toMatchObject({ en: 'Mark ready →', zh: '标记为已备好 →' })
    expect(nextStatus('ready')).toMatchObject({ en: 'Mark completed →', zh: '标记为已完成 →' })
  })

  it('offers no one-click advance out of pending_payment', () => {
    // To advance a pending_payment order is to say the money arrived. That decision goes
    // through the status list, where the merchant picks the value themselves.
    expect(nextStatus('pending_payment')).toBeNull()
  })

  it('offers no advance from a settled status', () => {
    expect(nextStatus('completed')).toBeNull()
    expect(nextStatus('cancelled')).toBeNull()
  })

  it('offers no advance for a status it has not been taught', () => {
    // Same rule as STATUS_BADGE's neutral fallback: an unknown status is untaught, not a
    // status to guess a successor for.
    expect(nextStatus('sameday')).toBeNull()
    expect(nextStatus(null)).toBeNull()
    expect(nextStatus(undefined)).toBeNull()
  })

  it('only ever names a status the app knows', () => {
    for (const s of ORDER_STATUSES) {
      const n = nextStatus(s)
      if (n) expect(ORDER_STATUSES).toContain(n.to)
    }
  })

  it('never skips a step in the ORDER_STATUSES order', () => {
    for (const s of ORDER_STATUSES) {
      const n = nextStatus(s)
      if (n) expect(ORDER_STATUSES.indexOf(n.to)).toBe(ORDER_STATUSES.indexOf(s) + 1)
    }
  })
})
