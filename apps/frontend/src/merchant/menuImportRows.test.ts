import { describe, it, expect } from 'vitest'
import { MAX_MENU_CATEGORIES, type MenuCategory } from '@bitetime/shared'
import { buildRows, matchCategory, newCategoryLabels } from './menuImportRows'
import type { MenuDraftItem } from '../store'

const item = (name: string, category_label?: string): MenuDraftItem => ({
  name, price_text: '2.00', price: 2, category_label,
})

const cat = (id: string, name: string, name_zh?: string): MenuCategory => ({ id, name, name_zh, active: true })

describe('matchCategory', () => {
  it('matches on name, case- and space-blind', () => {
    expect(matchCategory([cat('a', 'Hot Drinks')], '  hot drinks ')).toBe('a')
  })

  it('matches on the Chinese name too', () => {
    expect(matchCategory([cat('a', 'Hot Drinks', '热饮')], '热饮')).toBe('a')
  })

  it('refuses a near miss rather than filing it wrong', () => {
    expect(matchCategory([cat('a', 'Hot Drinks')], 'Hot Drink')).toBe('')
  })

  it('returns no match for a missing label', () => {
    expect(matchCategory([cat('a', 'Hot Drinks')], undefined)).toBe('')
  })
})

describe('buildRows', () => {
  it('includes every draft and keeps its fields', () => {
    const rows = buildRows([item('Espresso'), item('Doppio')], [])
    expect(rows.map(r => r.include)).toEqual([true, true])
    expect(rows.map(r => r.name)).toEqual(['Espresso', 'Doppio'])
    expect(rows.map(r => r.key)).toEqual(['0-Espresso', '1-Doppio'])
  })

  it('files a draft into a section the shop already holds, and queues nothing', () => {
    const rows = buildRows([item('Espresso', 'hot drinks')], [cat('a', 'Hot Drinks')])
    expect(rows[0].category_id).toBe('a')
    expect(rows[0].newCategory).toBe('')
  })

  it('queues a heading the shop does not hold', () => {
    const rows = buildRows([item('Espresso', 'Coffee')], [])
    expect(rows[0].category_id).toBe('')
    expect(rows[0].newCategory).toBe('Coffee')
  })

  it('queues nothing for a draft with no heading', () => {
    const rows = buildRows([item('Espresso')], [])
    expect(rows[0].newCategory).toBe('')
  })

  it('gives every row under one heading the same spelling of it', () => {
    const rows = buildRows([item('Espresso', 'Coffee'), item('Doppio', ' coffee ')], [])
    expect(rows.map(r => r.newCategory)).toEqual(['Coffee', 'Coffee'])
  })

  it('stops queueing at the category cap, counting the shop’s own sections', () => {
    const held = Array.from({ length: MAX_MENU_CATEGORIES - 1 }, (_, i) => cat(`c${i}`, `Held ${i}`))
    const rows = buildRows([item('A', 'New One'), item('B', 'New Two')], held)
    expect(rows.map(r => r.newCategory)).toEqual(['New One', ''])
  })

  it('queues nothing when the shop is already at the cap', () => {
    const held = Array.from({ length: MAX_MENU_CATEGORIES }, (_, i) => cat(`c${i}`, `Held ${i}`))
    const rows = buildRows([item('A', 'New One')], held)
    expect(rows[0].newCategory).toBe('')
  })
})

describe('newCategoryLabels', () => {
  it('lists each missing heading once, in the order the menu printed them', () => {
    const rows = buildRows(
      [item('A', 'Coffee'), item('B', 'Cakes'), item('C', ' coffee ')],
      [],
    )
    expect(newCategoryLabels(rows, [])).toEqual(['Coffee', 'Cakes'])
  })

  it('leaves out a heading the shop already holds', () => {
    const held = [cat('a', 'Coffee')]
    const rows = buildRows([item('A', 'Coffee'), item('B', 'Cakes')], held)
    expect(newCategoryLabels(rows, held)).toEqual(['Cakes'])
  })

  it('still offers a heading the cap left unqueued', () => {
    const held = Array.from({ length: MAX_MENU_CATEGORIES }, (_, i) => cat(`c${i}`, `Held ${i}`))
    const rows = buildRows([item('A', 'New One')], held)
    expect(rows[0].newCategory).toBe('')
    expect(newCategoryLabels(rows, held)).toEqual(['New One'])
  })
})
