import { describe, it, expect } from 'vitest'
import { ORDER_STATUSES, STATUS_LABELS, STATUS_BADGE } from './orderStatus'

describe('order statuses', () => {
  it('still has all six members', () => {
    expect(ORDER_STATUSES).toEqual([
      'pending_payment', 'new', 'preparing', 'ready', 'completed', 'cancelled',
    ])
  })

  it('labels every status in both languages', () => {
    for (const s of ORDER_STATUSES) {
      expect(STATUS_LABELS[s]?.en).toBeTruthy()
      expect(STATUS_LABELS[s]?.zh).toBeTruthy()
    }
  })

  it('styles every status', () => {
    for (const s of ORDER_STATUSES) {
      expect(STATUS_BADGE[s]).toBeDefined()
    }
  })
})

/* The reskin collapsed six colour families to four. These assertions pin the
   mapping so a later edit cannot quietly reintroduce a fifth hue. */
describe('the four-tone vocabulary', () => {
  const classOf = (s: string) => STATUS_BADGE[s].className ?? ''

  it('uses only the four sanctioned tone families', () => {
    const allowed = /^(bg-(info|warn|success|danger|neutral)-|text-(info|warn|success|danger|neutral)-|text-white$|border-)/
    for (const s of ORDER_STATUSES) {
      for (const cls of classOf(s).split(/\s+/).filter(Boolean)) {
        expect(cls, `${s} → ${cls}`).toMatch(allowed)
      }
    }
  })

  it('has no purple/plum family left', () => {
    for (const s of ORDER_STATUSES) {
      expect(classOf(s)).not.toMatch(/prep/)
    }
  })

  it('gives new and preparing the same hue but different weight', () => {
    expect(classOf('new')).toMatch(/info/)
    expect(classOf('preparing')).toMatch(/info/)
    expect(classOf('new')).not.toBe(classOf('preparing'))
  })

  it('maps the remaining statuses to their own tones', () => {
    expect(classOf('pending_payment')).toMatch(/warn/)
    expect(classOf('ready')).toMatch(/success/)
    expect(classOf('completed')).toMatch(/neutral/)
    expect(classOf('cancelled')).toMatch(/danger/)
  })
})
