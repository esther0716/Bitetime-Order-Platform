// The picker is where duplicate-name judgement lives (CONTEXT.md → Product copy): the write path
// does dumb inserts, so these defaults are the only thing standing between a re-run and a doubled
// menu. Pure and unit-tested for the same reason menuImportRows.ts is.
import { describe, it, expect } from 'vitest'
import { copyPickerRows, filterShops, optionGroupSummary } from './copyPickerRows'

const src = (id: string, name: string, over: Record<string, unknown> = {}) =>
  ({ id, name, price: 10, active: true, ...over })

describe('optionGroupSummary', () => {
  const groups = [
    {
      id: 'g1', name: 'Size', name_zh: '尺寸', minSelect: 1, maxSelect: 1, maxPerOption: null,
      active: true,
      options: [
        { id: 'o1', name: 'Small', delta: 0, active: true },
        { id: 'o2', name: 'Large', delta: 2, active: true },
      ],
    },
    {
      id: 'g2', name: 'Milk', minSelect: 0, maxSelect: 1, maxPerOption: null, active: false,
      options: [{ id: 'o3', name: 'Oat', delta: 1, active: true }],
    },
  ]

  it('names each group with its option count, in the reading language', () => {
    expect(optionGroupSummary(groups, 'en')).toEqual(['Size (2)', 'Milk (1)'])
    expect(optionGroupSummary(groups, 'zh')).toEqual(['尺寸 (2)', 'Milk (1)'])
  })

  it('reads a raw jsonb value and answers empty for a product without options', () => {
    expect(optionGroupSummary([], 'en')).toEqual([])
    expect(optionGroupSummary(undefined, 'en')).toEqual([])
    expect(optionGroupSummary('not json', 'en')).toEqual([])
  })
})

describe('filterShops', () => {
  const shops = [
    { id: 'a', name: 'Uncle Lim Kopitiam', slug: 'uncle-lim' },
    { id: 'b', name: 'Demo Pro Bakery', slug: 'demo-pro' },
    { id: 'c', name: '面包店', slug: 'mianbao' },
  ]

  it('matches on name or slug, case- and space-blind', () => {
    expect(filterShops(shops, '  KOPI ').map(s => s.id)).toEqual(['a'])
    expect(filterShops(shops, 'demo-p').map(s => s.id)).toEqual(['b'])
    expect(filterShops(shops, '面包').map(s => s.id)).toEqual(['c'])
  })

  it('returns everything for a blank query', () => {
    expect(filterShops(shops, '   ')).toEqual(shops)
  })
})

describe('copyPickerRows', () => {
  it('checks every product by default when the target has nothing', () => {
    const rows = copyPickerRows([src('a', 'Kopi'), src('b', 'Teh')], [])
    expect(rows.map(r => [r.id, r.duplicate, r.include])).toEqual([
      ['a', false, true],
      ['b', false, true],
    ])
  })

  it('badges a name the target already holds, case- and space-blind, and unchecks it', () => {
    const rows = copyPickerRows(
      [src('a', 'Kopi'), src('b', 'Teh')],
      [src('t1', '  KOPI ')],
    )
    expect(rows.map(r => [r.id, r.duplicate, r.include])).toEqual([
      ['a', true, false],
      ['b', false, true],
    ])
  })

  it('keeps the source order and carries the display fields', () => {
    const rows = copyPickerRows(
      [src('a', 'Kopi', { name_zh: '咖啡', price: 5, active: false, image_urls: ['p'] })],
      [],
    )
    expect(rows[0]).toMatchObject({
      id: 'a', name: 'Kopi', name_zh: '咖啡', price: 5, active: false,
    })
  })
})
