import { describe, it, expect } from 'vitest'
import type { MenuCategory } from '@bitetime/shared'
import { menuSections, findCategory } from './menuGroups'

const cat = (id: string, name: string, active = true): MenuCategory => ({ id, name, active })

// Only the two fields this module reads. The storefront hands it whole Products.
const prod = (id: string, category_id?: string | null) => ({ id, category_id })

const drinks = cat('c1', 'Beverage')
const cakes = cat('c2', 'Cake')

describe('menuSections', () => {
  // The load-bearing case: a shop that never opens the feature must get back exactly the flat
  // list it had before it existed — one section, no heading, in the order it was handed.
  it('returns one un-headed section when the shop has no categories', () => {
    const items = [prod('p1'), prod('p2')]
    expect(menuSections(items, [])).toEqual([{ category: null, products: items }])
  })

  it('is empty for an empty menu, categories or not', () => {
    expect(menuSections([], [])).toEqual([])
    expect(menuSections([], [drinks])).toEqual([])
  })

  it('renders categories in array order — the array IS the display order', () => {
    const latte = prod('p1', 'c1'), roll = prod('p2', 'c2')
    expect(menuSections([roll, latte], [drinks, cakes])).toEqual([
      { category: drinks, products: [latte] },
      { category: cakes, products: [roll] },
    ])
    expect(menuSections([roll, latte], [cakes, drinks])).toEqual([
      { category: cakes, products: [roll] },
      { category: drinks, products: [latte] },
    ])
  })

  it('keeps the given product order within a section', () => {
    const a = prod('p1', 'c1'), b = prod('p2', 'c1'), c = prod('p3', 'c1')
    expect(menuSections([c, a, b], [drinks])[0]!.products).toEqual([c, a, b])
  })

  // Uncategorized goes LAST and un-headed. Leading un-headed items would push the shop's own
  // sections down the page and read as a rendering fault.
  it('puts unfiled products in a trailing un-headed section', () => {
    const latte = prod('p1', 'c1'), mystery = prod('p2'), nulled = prod('p3', null)
    expect(menuSections([latte, mystery, nulled], [drinks])).toEqual([
      { category: drinks, products: [latte] },
      { category: null, products: [mystery, nulled] },
    ])
  })

  // The whole reason deleting a category rewrites no product row: a dangling id is not an error
  // state, it is the uncategorized state, and the product stays on sale either way.
  it('reads an id the shop no longer holds as uncategorized', () => {
    const orphan = prod('p1', 'deleted-category')
    expect(menuSections([orphan], [drinks])).toEqual([{ category: null, products: [orphan] }])
  })

  // A hidden category is hidden, never a hole in the menu — its products keep selling.
  it('drops an inactive category and spills its products to the trailing section', () => {
    const latte = prod('p1', 'c1'), roll = prod('p2', 'c2')
    expect(menuSections([latte, roll], [cat('c1', 'Beverage', false), cakes])).toEqual([
      { category: cakes, products: [roll] },
      { category: null, products: [latte] },
    ])
  })

  // Downgrade writes exactly this: every category inactive, no product touched. The result must
  // be indistinguishable from the shop that never had categories at all.
  it('renders the flat list again when every category is hidden', () => {
    const items = [prod('p1', 'c1'), prod('p2', 'c2')]
    expect(menuSections(items, [cat('c1', 'Beverage', false), cat('c2', 'Cake', false)]))
      .toEqual([{ category: null, products: items }])
  })

  // A heading with nothing under it is a blemish on someone's shop — the seasonal category made
  // in advance, the one whose items are all deactivated, the orphan left by a failed save.
  it('hides a category holding nothing', () => {
    expect(menuSections([prod('p1', 'c2')], [drinks, cakes]))
      .toEqual([{ category: cakes, products: [prod('p1', 'c2')] }])
  })

  it('omits the trailing section entirely when everything is filed', () => {
    expect(menuSections([prod('p1', 'c1')], [drinks]))
      .toEqual([{ category: drinks, products: [prod('p1', 'c1')] }])
  })
})

describe('findCategory', () => {
  // The dashboard names a product's section, and must name a HIDDEN one too — a merchant
  // reading their own product table needs to see where it is filed, not a blank.
  it('finds an active or hidden category by id', () => {
    const hidden = cat('c1', 'Beverage', false)
    expect(findCategory([hidden, cakes], 'c1')).toEqual(hidden)
    expect(findCategory([hidden, cakes], 'c2')).toEqual(cakes)
  })

  it('is null for no id, and for an id the shop no longer holds', () => {
    expect(findCategory([cakes], null)).toBeNull()
    expect(findCategory([cakes], undefined)).toBeNull()
    expect(findCategory([cakes], 'gone')).toBeNull()
  })
})
