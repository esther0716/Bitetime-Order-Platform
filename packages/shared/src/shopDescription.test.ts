import { describe, it, expect } from 'vitest'
import {
  validateShopDescription, SHOP_DESCRIPTION_MAX, type ShopDescriptionError,
} from './shopDescription.js'

const ok = (v: unknown) => expect(validateShopDescription(v)).toBeNull()
const bad = (v: unknown, e: ShopDescriptionError) => expect(validateShopDescription(v)).toBe(e)

describe('validateShopDescription', () => {
  it('accepts an ordinary blurb', () => {
    ok('Home-style kuih, order a day ahead.')
  })

  it('accepts Chinese, which the cap counts by character not by byte', () => {
    ok('家庭式面包，请提前一天下单。')
    ok('字'.repeat(SHOP_DESCRIPTION_MAX))
    bad('字'.repeat(SHOP_DESCRIPTION_MAX + 1), 'description_too_long')
  })

  // Clearing the field is a real action, not a mistake: it is the only way back to a storefront
  // with no blurb under its name.
  it('accepts the two ways a merchant says "take it down"', () => {
    ok(null)
    ok('')
    ok('   ')
  })

  it('accepts absent — a PATCH that does not mention the field changes nothing', () => {
    ok(undefined)
  })

  it('measures the cap after trimming, so trailing whitespace never costs a character', () => {
    ok(`${'a'.repeat(SHOP_DESCRIPTION_MAX)}   `)
    bad('a'.repeat(SHOP_DESCRIPTION_MAX + 1), 'description_too_long')
  })

  it('refuses anything that is not a string', () => {
    bad(42, 'malformed_description')
    bad({ en: 'hi' }, 'malformed_description')
    bad(['hi'], 'malformed_description')
    bad(true, 'malformed_description')
  })
})
