import { describe, it, expect } from 'vitest'
import { fulfilmentLabel, feeLineLabel } from './fulfilmentLabel'

const en = (e: string) => e
const zh = (_e: string, z?: string) => z ?? _e

describe('fulfilmentLabel', () => {
  it('names each method in both languages', () => {
    expect(fulfilmentLabel('pickup', en)).toBe('Pickup')
    expect(fulfilmentLabel('delivery', en)).toBe('Delivery')
    expect(fulfilmentLabel('express', en)).toBe('Express delivery')
    expect(fulfilmentLabel('pickup', zh)).toBe('自取')
    expect(fulfilmentLabel('delivery', zh)).toBe('送货')
    expect(fulfilmentLabel('express', zh)).toBe('快速配送')
  })

  it('renders an unknown mode capitalised rather than blank', () => {
    // Rows written by older builds still have to say something in the dashboard.
    expect(fulfilmentLabel('sameday', en)).toBe('Sameday')
  })

  it('renders a missing mode as an em dash', () => {
    expect(fulfilmentLabel(null, en)).toBe('—')
    expect(fulfilmentLabel(undefined, en)).toBe('—')
  })
})

describe('feeLineLabel', () => {
  it('names the method on the fee line, and appends the distance it charged for', () => {
    expect(feeLineLabel('express', 25.2, en)).toBe('Express delivery fee (25.2 km)')
    expect(feeLineLabel('express', 25.2, zh)).toBe('快速配送费（25.2 公里）')
  })

  it('omits the distance when there is none', () => {
    // A region-priced order has no distance, and a line reading "(0.0 km)" would be a lie about
    // what produced the money.
    expect(feeLineLabel('delivery', null, en)).toBe('Delivery fee')
    expect(feeLineLabel('delivery', null, zh)).toBe('送货费')
  })

  it('refuses a distance on a region-priced order even when handed one', () => {
    // #128. The METHOD decides whether a fee was priced by distance, never the presence of a km
    // argument. A quote belongs to the ADDRESS and deliberately survives a method switch (#101
    // review, Finding 2), so a customer who quoted an express fee and then chose flat `delivery`
    // still holds one — and the summary printed `Delivery fee (13.9 km)` next to an RM 8.00 flat
    // rate that the kilometres played no part in producing.
    expect(feeLineLabel('delivery', 13.9, en)).toBe('Delivery fee')
    expect(feeLineLabel('delivery', 13.9, zh)).toBe('送货费')
  })

  it('names no distance on a pickup order, which has no fee line to reconcile', () => {
    expect(feeLineLabel('pickup', 13.9, en)).toBe('Delivery fee')
  })

  it('treats an unknown mode as not distance-priced', () => {
    // An old row from before a method was renamed must not start naming kilometres it cannot
    // account for.
    expect(feeLineLabel('sameday', 13.9, en)).toBe('Delivery fee')
    expect(feeLineLabel(null, 13.9, en)).toBe('Delivery fee')
  })
})
