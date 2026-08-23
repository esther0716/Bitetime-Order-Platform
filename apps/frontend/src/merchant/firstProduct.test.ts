import { describe, it, expect } from 'vitest'
import { firstProductAdded } from './firstProduct'

describe('firstProductAdded (#102 activation signal)', () => {
  it('reports the first product a shop ever saves', () => {
    expect(firstProductAdded(0, 1)).toBe(true)
  })

  it('reports once for a menu import that lands many products at once', () => {
    expect(firstProductAdded(0, 15)).toBe(true)
  })

  it('stays silent for a shop that already had products', () => {
    expect(firstProductAdded(3, 4)).toBe(false)
  })

  it('stays silent when the count did not move', () => {
    expect(firstProductAdded(0, 0)).toBe(false)
  })

  it('stays silent when products were deleted', () => {
    expect(firstProductAdded(1, 0)).toBe(false)
  })
})
