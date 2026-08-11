import { describe, it, expect } from 'vitest'
import { defaultReactivation, yearlySavingPercent } from './reactivationChoice'

describe('defaultReactivation', () => {
  it('starts on the cycle the shop last paid on', () => {
    expect(defaultReactivation({ billing_cycle: 'yearly' })).toEqual({ cycle: 'yearly' })
  })

  it('reads a missing cycle as monthly', () => {
    expect(defaultReactivation({ billing_cycle: null })).toEqual({ cycle: 'monthly' })
    expect(defaultReactivation(null)).toEqual({ cycle: 'monthly' })
    expect(defaultReactivation(undefined)).toEqual({ cycle: 'monthly' })
  })

  // LOAD-BEARING. This value is posted straight to /api/checkout, which refuses anything outside
  // its own allowlist — so an unrecognised column must be normalised, never passed through.
  it('normalises an unrecognised value rather than passing it on', () => {
    expect(defaultReactivation({ billing_cycle: 'weekly' })).toEqual({ cycle: 'monthly' })
  })
})

describe('yearlySavingPercent', () => {
  it('reports the saving against twelve monthly payments', () => {
    // 9.99 × 12 = 119.88 against 99.90 — a saving of 19.98, or 17%.
    expect(yearlySavingPercent(9.99, 99.9)).toBe(17)
    expect(yearlySavingPercent(10, 100)).toBe(17)
  })

  // "Save 0%" is worse than no badge, and a negative one is a claim the page would have to
  // explain. Both come back as "say nothing".
  it('claims nothing when the yearly price is not actually cheaper', () => {
    expect(yearlySavingPercent(10, 120)).toBeNull()
    expect(yearlySavingPercent(10, 150)).toBeNull()
  })

  it('claims nothing on a missing or nonsense price', () => {
    expect(yearlySavingPercent(0, 100)).toBeNull()
    expect(yearlySavingPercent(10, 0)).toBeNull()
  })
})
