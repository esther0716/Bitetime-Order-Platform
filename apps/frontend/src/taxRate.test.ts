import { describe, it, expect } from 'vitest'
import { formatTaxRate } from './taxRate'

describe('formatTaxRate', () => {
  it('trims the trailing zeros a numeric(5,2) carries', () => {
    expect(formatTaxRate(6)).toBe('6')
    expect(formatTaxRate('6.00')).toBe('6')
    expect(formatTaxRate(6.5)).toBe('6.5')
    expect(formatTaxRate('6.50')).toBe('6.5')
  })

  it('falls back to 0 rather than printing NaN%', () => {
    expect(formatTaxRate(null)).toBe('0')
    expect(formatTaxRate(undefined)).toBe('0')
    expect(formatTaxRate('abc')).toBe('0')
  })
})
