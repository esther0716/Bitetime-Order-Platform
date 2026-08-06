import { describe, it, expect } from 'vitest'
import { defaultReactivation, yearlySavingPercent } from './reactivationChoice'

describe('defaultReactivation', () => {
  it('starts on the tier and cycle the shop last had', () => {
    expect(defaultReactivation({ plan: 'pro', billing_cycle: 'yearly' }))
      .toEqual({ plan: 'pro', cycle: 'yearly' })
  })

  // A NULL plan column reads as basic everywhere else — the Pro gate is `plan === 'pro'` and
  // nothing else — and must here.
  it('reads a missing plan or cycle as basic and monthly', () => {
    expect(defaultReactivation({ plan: null, billing_cycle: null }))
      .toEqual({ plan: 'basic', cycle: 'monthly' })
    expect(defaultReactivation(null)).toEqual({ plan: 'basic', cycle: 'monthly' })
    expect(defaultReactivation(undefined)).toEqual({ plan: 'basic', cycle: 'monthly' })
  })

  // LOAD-BEARING. This value is posted straight to /api/checkout, which refuses anything outside
  // its own allowlist — so an unrecognised column must be normalised, never passed through.
  it('normalises an unrecognised value rather than passing it on', () => {
    expect(defaultReactivation({ plan: 'enterprise', billing_cycle: 'weekly' }))
      .toEqual({ plan: 'basic', cycle: 'monthly' })
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
