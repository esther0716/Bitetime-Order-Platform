import { describe, it, expect } from 'vitest'
import { contrastRatio, relativeLuminance } from './contrast'

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5)
  })

  it('accepts shorthand and lowercase hex', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#FFF')).toBeCloseTo(1, 5)
  })
})

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2)
  })

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#7A1028', '#7A1028')).toBeCloseTo(1, 5)
  })

  it('is order-independent', () => {
    expect(contrastRatio('#7A1028', '#FAFAFA')).toBeCloseTo(
      contrastRatio('#FAFAFA', '#7A1028'),
      5,
    )
  })

  // Anchors the sRGB gamma curve against a known-good published value.
  it('matches the published ratio for #71717A on #FAFAFA', () => {
    expect(contrastRatio('#71717A', '#FAFAFA')).toBeCloseTo(4.62, 1)
  })

  it('throws on a malformed hex rather than returning a wrong number', () => {
    expect(() => contrastRatio('rebeccapurple', '#FFF')).toThrow(/hex/i)
  })
})
