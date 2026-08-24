import { describe, it, expect } from 'vitest'
import { normalizeBrandColor, PLATFORM_BRAND_COLOR } from './brandColor.js'

const ok = (v: unknown, value: string | null) =>
  expect(normalizeBrandColor(v)).toEqual({ ok: true, value })
const bad = (v: unknown) =>
  expect(normalizeBrandColor(v)).toEqual({ ok: false, error: 'malformed_brand_color' })

describe('normalizeBrandColor', () => {
  it('accepts a six-digit hex and stores it uppercased', () => {
    ok('#7a1028', '#7A1028')
    ok('#7A1028', '#7A1028')
  })

  // A merchant copying a colour out of a design tool gets a bare six digits as often as not.
  it('accepts a hex with no leading hash', () => {
    ok('7a1028', '#7A1028')
  })

  it('expands the three-digit form, which CSS accepts and the column should not store', () => {
    ok('#f0a', '#FF00AA')
  })

  it('trims, because a pasted value carries whitespace', () => {
    ok('  #7A1028  ', '#7A1028')
  })

  // Clearing the field is a real action: it is the only way back to the platform colour.
  it('reads every way of saying "use the default" as null', () => {
    ok(null, null)
    ok('', null)
    ok('   ', null)
  })

  it('refuses anything that is not a colour, rather than coercing it', () => {
    bad('red')
    bad('#12345')
    bad('#GGGGGG')
    bad('rgb(1,2,3)')
    bad(42)
    bad({})
    bad(['#7A1028'])
  })

  // The default is a value this package states once, so the picker and the derivation agree.
  it('names the platform accent', () => {
    expect(PLATFORM_BRAND_COLOR).toBe('#7A1028')
  })
})
