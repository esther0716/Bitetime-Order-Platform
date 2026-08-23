import { describe, it, expect } from 'vitest'
import { draftChanged } from './productDraft'

const base = {
  form: {
    name: 'Butter Cake', name_zh: '牛油蛋糕', descr: '', price: '45', unit: 'pcs',
    unit_quantity: 1, active: true,
    promo_price: '', promo_limit: '', promo_end: '', category_id: 'cat-1',
  },
  images: ['a.png'],
  optionGroups: [{ id: 'g1', name: 'Size', options: [{ id: 'o1', name: 'L', price: 2 }] }] as any,
}

const withForm = (patch: Record<string, unknown>) => ({ ...base, form: { ...base.form, ...patch } })

describe('draftChanged', () => {
  it('reports nothing changed when the draft still matches what was seeded', () => {
    expect(draftChanged(base, base)).toBe(false)
  })

  // The seed writes `unit_quantity` as the row's number; the input hands back a string. Same
  // quantity, and a merchant who only opened the form has not typed anything.
  it('does not treat a number and its own string as a change', () => {
    expect(draftChanged(withForm({ unit_quantity: '1' }), base)).toBe(false)
  })

  it('sees a renamed product', () => {
    expect(draftChanged(withForm({ name: 'Butter Cake ' }), base)).toBe(true)
  })

  it('sees a new price', () => {
    expect(draftChanged(withForm({ price: '46' }), base)).toBe(true)
  })

  it('sees a promo the merchant just typed', () => {
    expect(draftChanged(withForm({ promo_price: '39.9' }), base)).toBe(true)
  })

  it('sees the visibility toggle flipped', () => {
    expect(draftChanged(withForm({ active: false }), base)).toBe(true)
  })

  it('sees a category change, including back to no category', () => {
    expect(draftChanged(withForm({ category_id: '' }), base)).toBe(true)
  })

  it('sees a photo added', () => {
    expect(draftChanged({ ...base, images: ['a.png', 'b.png'] }, base)).toBe(true)
  })

  it('sees a photo removed', () => {
    expect(draftChanged({ ...base, images: [] }, base)).toBe(true)
  })

  it('sees an option group edited', () => {
    const edited = [{ id: 'g1', name: 'Size', options: [{ id: 'o1', name: 'L', price: 3 }] }] as any
    expect(draftChanged({ ...base, optionGroups: edited }, base)).toBe(true)
  })

  it('ignores the key order the two objects were built in', () => {
    const reordered = {
      ...base,
      form: {
        category_id: 'cat-1', promo_end: '', promo_limit: '', promo_price: '',
        active: true, unit_quantity: 1, unit: 'pcs', price: '45', descr: '',
        name_zh: '牛油蛋糕', name: 'Butter Cake',
      },
    }
    expect(draftChanged(reordered, base)).toBe(false)
  })

  // An add-mode form the merchant opened and closed again. Nothing typed, nothing to warn about.
  it('reports nothing changed for an untouched blank form', () => {
    const blank = {
      form: {
        name: '', name_zh: '', descr: '', price: '', unit: 'pcs', unit_quantity: 1, active: true,
        promo_price: '', promo_limit: '', promo_end: '', category_id: '',
      },
      images: [],
      optionGroups: [] as any,
    }
    expect(draftChanged(blank, blank)).toBe(false)
  })
})
