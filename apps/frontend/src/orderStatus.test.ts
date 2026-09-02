import { describe, it, expect } from 'vitest'
import { ORDER_STATUSES, STATUS_LABELS, STATUS_BADGE, isStatusFinal } from './orderStatus'

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
    const allowed = /^(bg-(info|warning|success|danger|neutral)-|text-(info|warning|success|danger|neutral)-|text-white$|border-)/
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

  it.each([
    ['new', 'preparing', /info/],
    ['ready', 'completed', /success/],
  ])('gives %s and %s the same hue but different weight', (solid, subtle, hue) => {
    expect(classOf(solid)).toMatch(hue)
    expect(classOf(subtle)).toMatch(hue)
    expect(classOf(solid)).not.toBe(classOf(subtle))
    // The solid one is the one still waiting on the merchant.
    expect(classOf(solid)).toMatch(/text-white/)
    expect(classOf(subtle)).not.toMatch(/text-white/)
  })

  it('maps the remaining statuses to their own tones', () => {
    expect(classOf('pending_payment')).toMatch(/warning/)
    expect(classOf('cancelled')).toMatch(/danger/)
  })

  /* Neutral is the unknown-status treatment. If a real status takes it back, an unrecognised
     one becomes indistinguishable from that status instead of visibly untaught. */
  it('leaves the neutral tone to unrecognised statuses only', () => {
    for (const s of ORDER_STATUSES) expect(classOf(s), s).not.toMatch(/neutral/)
  })
})

/* ADR 0024. `completed` is the one status the merchant cannot move off, because the move it
   stops — completed → cancelled — hands back the voucher use on delivered goods (ADR 0023).
   `cancelled` must stay changeable or ADR 0023's un-cancel dies with it. */
describe('isStatusFinal', () => {
  it('freezes completed', () => {
    expect(isStatusFinal('completed')).toBe(true)
  })

  it('leaves every other status changeable, cancelled included', () => {
    for (const s of ORDER_STATUSES.filter(s => s !== 'completed')) {
      expect(isStatusFinal(s)).toBe(false)
    }
  })

  it('treats an absent status as changeable', () => {
    expect(isStatusFinal(null)).toBe(false)
    expect(isStatusFinal(undefined)).toBe(false)
    expect(isStatusFinal('')).toBe(false)
  })
})
