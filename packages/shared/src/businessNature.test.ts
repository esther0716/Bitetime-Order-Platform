import { describe, it, expect } from 'vitest'
import { BUSINESS_NATURES, isBusinessNature } from './businessNature.js'

describe('BUSINESS_NATURES', () => {
  it('holds no duplicates', () => {
    expect(new Set(BUSINESS_NATURES).size).toBe(BUSINESS_NATURES.length)
  })

  // The codes are stored in `merchants.business_nature` and grouped on by the admin
  // Overview. Renaming one silently re-buckets every shop already carrying it, so the
  // list is pinned here rather than merely spot-checked.
  it('is exactly the list the CHECK constraint and the dropdowns share', () => {
    expect([...BUSINESS_NATURES]).toEqual([
      'bakery', 'restaurant', 'beverages', 'grocery',
      'catering', 'snacks', 'florist', 'other',
    ])
  })
})

describe('isBusinessNature', () => {
  it('accepts every code in the list', () => {
    for (const code of BUSINESS_NATURES) expect(isBusinessNature(code)).toBe(true)
  })

  it('refuses anything else', () => {
    expect(isBusinessNature('Bakery')).toBe(false)   // codes are lower-case, exactly
    expect(isBusinessNature('cake shop')).toBe(false)
    expect(isBusinessNature('')).toBe(false)
    expect(isBusinessNature(null)).toBe(false)
    expect(isBusinessNature(undefined)).toBe(false)
    expect(isBusinessNature(1)).toBe(false)
    expect(isBusinessNature(['bakery'])).toBe(false)
  })
})
