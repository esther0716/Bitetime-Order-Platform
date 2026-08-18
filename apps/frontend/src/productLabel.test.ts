import { describe, it, expect } from 'vitest'
import { productName, productDescr, categoryName, shopDescr } from './productLabel'
import type { Merchant, Product } from './types'

const p = (over: Partial<Product> = {}): Product =>
  ({ id: 'p1', name: 'Cookie', price: 5, ...over })

describe('productName', () => {
  it('gives the English name to an English reader', () => {
    expect(productName(p({ name_zh: '曲奇' }), 'en')).toBe('Cookie')
  })

  it('gives the Chinese name to a Chinese reader', () => {
    expect(productName(p({ name_zh: '曲奇' }), 'zh')).toBe('曲奇')
  })

  // A merchant who filled only the English field must not get a blank heading in Chinese.
  it('falls back to the English name when there is no Chinese one', () => {
    expect(productName(p(), 'zh')).toBe('Cookie')
    expect(productName(p({ name_zh: '' }), 'zh')).toBe('Cookie')
  })
})

describe('productDescr', () => {
  it('picks the description the reader can read', () => {
    const row = p({ descr: 'soft-baked', descr_zh: '软焙' })
    expect(productDescr(row, 'en')).toBe('soft-baked')
    expect(productDescr(row, 'zh')).toBe('软焙')
  })

  it('falls back to the English description, then to an empty string', () => {
    expect(productDescr(p({ descr: 'soft-baked' }), 'zh')).toBe('soft-baked')
    expect(productDescr(p(), 'en')).toBe('')
  })
})

describe('categoryName', () => {
  it('picks the heading the reader can read, falling back to English', () => {
    expect(categoryName({ id: 'c1', name: 'Cakes', name_zh: '蛋糕', active: true }, 'zh')).toBe('蛋糕')
    expect(categoryName({ id: 'c1', name: 'Cakes', active: true }, 'zh')).toBe('Cakes')
    expect(categoryName({ id: 'c1', name: 'Cakes', name_zh: '蛋糕', active: true }, 'en')).toBe('Cakes')
  })
})

describe('shopDescr', () => {
  const shop = (over: Partial<Merchant> = {}): Merchant =>
    ({ id: 'm1', name: 'Aunty May', slug: 'aunty-may', status: 'active', ...over })

  it('picks the blurb the reader can read', () => {
    const row = shop({ description: 'Home-style kuih', description_zh: '家庭式糕点' })
    expect(shopDescr(row, 'en')).toBe('Home-style kuih')
    expect(shopDescr(row, 'zh')).toBe('家庭式糕点')
  })

  it('falls back to the English blurb when there is no Chinese one', () => {
    expect(shopDescr(shop({ description: 'Home-style kuih' }), 'zh')).toBe('Home-style kuih')
    expect(shopDescr(shop({ description: 'Home-style kuih', description_zh: null }), 'zh'))
      .toBe('Home-style kuih')
  })

  // A shop that wrote no blurb draws NO line, so both the absent column and the cleared one
  // must reduce to the same empty string the callers test against.
  it('gives an empty string for a shop with no description', () => {
    expect(shopDescr(shop(), 'en')).toBe('')
    expect(shopDescr(shop({ description: null, description_zh: null }), 'zh')).toBe('')
  })
})
