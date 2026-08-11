import { describe, it, expect } from 'vitest'
import {
  validateMenuCategories, categoryMatchKey, menuCategoriesFromRow,
  MAX_MENU_CATEGORIES, MENU_CATEGORY_NAME_MAX,
} from './menuCategories.js'
import type { MenuCategory } from './menuCategories.js'

const cat = (over: Partial<MenuCategory> = {}): MenuCategory =>
  ({ id: 'c1', name: 'Beverage', active: true, ...over })

describe('validateMenuCategories', () => {
  it('accepts an empty list — the shop that arranges nothing', () => {
    expect(validateMenuCategories([])).toBeNull()
  })

  it('accepts a well-formed list, with and without a Chinese name', () => {
    expect(validateMenuCategories([
      cat({ id: 'c1', name: 'Beverage', name_zh: '饮料' }),
      cat({ id: 'c2', name: 'Dessert' }),
    ])).toBeNull()
  })

  // Handed whatever a request body contained, so every read below is on an unchecked value.
  // `[{}]` reaching `c.name.trim()` is a 500 from inside a write endpoint, not a 400.
  it('refuses anything that is not a list', () => {
    expect(validateMenuCategories({} as never)).toBe('malformed_category')
    expect(validateMenuCategories(null as never)).toBe('malformed_category')
    expect(validateMenuCategories('[]' as never)).toBe('malformed_category')
  })

  it('refuses a member that is not an object, or is missing a field', () => {
    expect(validateMenuCategories([null as never])).toBe('malformed_category')
    expect(validateMenuCategories([{} as never])).toBe('malformed_category')
    expect(validateMenuCategories([{ id: 'c1', name: 'X' } as never])).toBe('malformed_category')
    expect(validateMenuCategories([cat({ id: '' })])).toBe('malformed_category')
    expect(validateMenuCategories([{ ...cat(), active: 'yes' } as never])).toBe('malformed_category')
    expect(validateMenuCategories([{ ...cat(), name: 42 } as never])).toBe('malformed_category')
    expect(validateMenuCategories([{ ...cat(), name_zh: 42 } as never])).toBe('malformed_category')
  })

  it('accepts name_zh absent, but not null', () => {
    expect(validateMenuCategories([cat()])).toBeNull()
    expect(validateMenuCategories([{ ...cat(), name_zh: undefined }])).toBeNull()
    expect(validateMenuCategories([{ ...cat(), name_zh: null } as never])).toBe('malformed_category')
  })

  // The storefront renders the name as a heading; a blank one is a section nobody can read.
  it('refuses a blank name in either language', () => {
    expect(validateMenuCategories([cat({ name: '   ' })])).toBe('blank_name')
    expect(validateMenuCategories([cat({ name: 'Cake', name_zh: '  ' })])).toBe('blank_name')
  })

  it('measures length after trimming, in both languages', () => {
    const at = 'x'.repeat(MENU_CATEGORY_NAME_MAX)
    expect(validateMenuCategories([cat({ name: `  ${at}  ` })])).toBeNull()
    expect(validateMenuCategories([cat({ name: at + 'x' })])).toBe('name_too_long')
    expect(validateMenuCategories([cat({ name: 'Cake', name_zh: at + 'x' })])).toBe('name_too_long')
  })

  it('caps the list', () => {
    const many = Array.from({ length: MAX_MENU_CATEGORIES }, (_, i) =>
      cat({ id: `c${i}`, name: `Cat ${i}` }))
    expect(validateMenuCategories(many)).toBeNull()
    expect(validateMenuCategories([...many, cat({ id: 'z', name: 'One more' })]))
      .toBe('too_many_categories')
  })

  it('refuses a duplicate id — products point at it, so two are unresolvable', () => {
    expect(validateMenuCategories([cat({ id: 'c1', name: 'A' }), cat({ id: 'c1', name: 'B' })]))
      .toBe('duplicate_category_id')
  })

  // Two identical headings on one menu is broken in a way two spellings of one customer TAG
  // is not — #150 surfaces that collision and lets the merchant judge it; here it is refused.
  it('refuses names that fold to the same key', () => {
    expect(validateMenuCategories([cat({ id: 'c1', name: 'Cakes' }), cat({ id: 'c2', name: 'cakes' })]))
      .toBe('duplicate_category_name')
    expect(validateMenuCategories([cat({ id: 'c1', name: 'Ice Cream' }), cat({ id: 'c2', name: 'ice-cream' })]))
      .toBe('duplicate_category_name')
  })

  it('folds the two languages independently', () => {
    // English distinct, Chinese identical — still a collision on the ZH storefront.
    expect(validateMenuCategories([
      cat({ id: 'c1', name: 'Cake', name_zh: '蛋糕' }),
      cat({ id: 'c2', name: 'Pastry', name_zh: '蛋糕' }),
    ])).toBe('duplicate_category_name')
    // A Chinese name on one and none on the other collides with nothing.
    expect(validateMenuCategories([
      cat({ id: 'c1', name: 'Cake', name_zh: '蛋糕' }),
      cat({ id: 'c2', name: 'Pastry' }),
    ])).toBeNull()
  })
})

describe('categoryMatchKey', () => {
  it('folds case, punctuation and whitespace', () => {
    expect(categoryMatchKey('Ice Cream')).toBe(categoryMatchKey('ice-cream'))
    expect(categoryMatchKey('  Cakes  ')).toBe(categoryMatchKey('cakes'))
  })

  // Stripping to ASCII would reduce 蛋糕 to the empty string and make every Chinese-named
  // category collide with every other — the silent failure tagSuggestions' fold exists to avoid.
  it('leaves a Chinese name matchable', () => {
    expect(categoryMatchKey('蛋糕')).toBe('蛋糕')
    expect(categoryMatchKey('蛋糕')).not.toBe(categoryMatchKey('饮料'))
    expect(categoryMatchKey('蛋糕')).not.toBe('')
  })
})

describe('menuCategoriesFromRow', () => {
  it('reads the column from either driver', () => {
    const list = [cat()]
    expect(menuCategoriesFromRow(list)).toEqual(list)          // PostgREST: parsed jsonb
    expect(menuCategoriesFromRow(JSON.stringify(list))).toEqual(list)  // postgres.js may hand a string
  })

  // Fails closed to "no categories" — a flat menu — never to a throw on the storefront.
  it('reads anything else as no categories', () => {
    expect(menuCategoriesFromRow(null)).toEqual([])
    expect(menuCategoriesFromRow(undefined)).toEqual([])
    expect(menuCategoriesFromRow('not json')).toEqual([])
    expect(menuCategoriesFromRow({ a: 1 })).toEqual([])
  })
})

