import { describe, it, expect } from 'vitest'
import { hexToHsl, hslToHex, hexToRgb } from './hsl'

describe('hexToHsl', () => {
  it('reads the platform accent', () => {
    const { h, s, l } = hexToHsl('#7A1028')
    expect(h).toBeCloseTo(346.4, 0)
    expect(s).toBeCloseTo(0.768, 2)
    expect(l).toBeCloseTo(0.271, 2)
  })

  it('reads a pure grey as having no saturation', () => {
    const pure = hexToHsl('#808080')
    expect(pure.s).toBe(0)
    expect(pure.l).toBeCloseTo(0.502, 2)
    // #3F3F46 is a WARM grey, not neutral — it keeps a little saturation, which is what lets a
    // shop pick it and still get a ramp with a hue rather than seven identical greys.
    expect(hexToHsl('#3F3F46').s).toBeGreaterThan(0)
  })

  it('accepts the three-digit form and a missing hash', () => {
    expect(hexToHsl('#fff').l).toBe(1)
    expect(hexToHsl('000').l).toBe(0)
  })

  it('throws on anything that is not a hex colour', () => {
    expect(() => hexToHsl('red')).toThrow()
    expect(() => hexToHsl('#12345')).toThrow()
  })
})

describe('hslToHex', () => {
  it('round-trips every step of the platform ramp', () => {
    for (const hex of ['#FDF0F2', '#F5E6E8', '#EBCDD3', '#D4708A', '#7A1028', '#550A1A', '#3F0713']) {
      const { h, s, l } = hexToHsl(hex)
      expect(hslToHex(h, s, l)).toBe(hex)
    }
  })

  it('clamps saturation and lightness rather than producing junk', () => {
    expect(hslToHex(346, 1.4, 0.5)).toBe(hslToHex(346, 1, 0.5))
    expect(hslToHex(346, 0.8, 1.7)).toBe('#FFFFFF')
    expect(hslToHex(346, 0.8, -0.2)).toBe('#000000')
  })

  it('wraps hue, so arithmetic on it never needs a guard at the call site', () => {
    expect(hslToHex(370, 0.5, 0.5)).toBe(hslToHex(10, 0.5, 0.5))
    expect(hslToHex(-10, 0.5, 0.5)).toBe(hslToHex(350, 0.5, 0.5))
  })
})

describe('hexToRgb', () => {
  it('splits the channels', () => {
    expect(hexToRgb('#7A1028')).toEqual([122, 16, 40])
  })
})
