import { describe, it, expect } from 'vitest'
import {
  arrangeMenu, reseedCategories, moveProduct, moveCategory, findProduct, resolveDropTarget,
  categoriesOf, productOrderPatch, arrangementKeys, categoryDragId, blockDropId,
} from './menuArrangement'
import type { MenuCategory } from '@bitetime/shared'

const cat = (id: string, over: Partial<MenuCategory> = {}): MenuCategory =>
  ({ id, name: id, active: true, ...over })

const prod = (id: string, category_id: string | null = null) => ({ id, category_id })

const CAKES = cat('cakes')
const TEA = cat('tea')
const HIDDEN = cat('hidden', { active: false })

describe('arrangeMenu', () => {
  it('puts each product in its own section, in the order given', () => {
    const blocks = arrangeMenu(
      [prod('p1', 'cakes'), prod('p2', 'tea'), prod('p3', 'cakes')],
      [CAKES, TEA],
    )
    expect(blocks.map(b => b.category?.id ?? null)).toEqual(['cakes', 'tea', null])
    expect(blocks[0]!.products.map(p => p.id)).toEqual(['p1', 'p3'])
    expect(blocks[1]!.products.map(p => p.id)).toEqual(['p2'])
    expect(blocks[2]!.products).toEqual([])
  })

  // The merchant's question is "where is everything filed", not "what does a customer see", so a
  // hidden section is a section here — a merchant must be able to file into one.
  it('keeps hidden categories, unlike menuSections', () => {
    const blocks = arrangeMenu([prod('p1', 'hidden')], [HIDDEN])
    expect(blocks[0]!.category!.id).toBe('hidden')
    expect(blocks[0]!.products.map(p => p.id)).toEqual(['p1'])
  })

  it('keeps an empty category, so there is somewhere to drop', () => {
    const blocks = arrangeMenu([], [CAKES])
    expect(blocks.map(b => b.category?.id ?? null)).toEqual(['cakes', null])
  })

  it('drops a product with a dangling category id into the trailing block', () => {
    const blocks = arrangeMenu([prod('p1', 'deleted')], [CAKES])
    expect(blocks[1]!.products.map(p => p.id)).toEqual(['p1'])
  })

  it('always ends with the trailing block, even for a shop with no categories', () => {
    const blocks = arrangeMenu([prod('p1')], [])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.category).toBeNull()
  })
})

describe('moveProduct', () => {
  const blocks = arrangeMenu([prod('p1', 'cakes'), prod('p2', 'cakes'), prod('p3')], [CAKES])

  it('moves an item inside its own section', () => {
    const next = moveProduct(blocks, { block: 0, index: 0 }, { block: 0, index: 1 })
    expect(next[0]!.products.map(p => p.id)).toEqual(['p2', 'p1'])
  })

  it('moves an item into another section', () => {
    const next = moveProduct(blocks, { block: 1, index: 0 }, { block: 0, index: 0 })
    expect(next[0]!.products.map(p => p.id)).toEqual(['p3', 'p1', 'p2'])
    expect(next[1]!.products).toEqual([])
  })

  it('clamps an index past the end of the target', () => {
    const next = moveProduct(blocks, { block: 0, index: 0 }, { block: 1, index: 99 })
    expect(next[1]!.products.map(p => p.id)).toEqual(['p3', 'p1'])
  })

  // The trailing block is a real target: this is how a merchant takes a product out of every
  // section, and the save is what then clears its stored category id.
  it('moves an item into the trailing block, where it belongs to no category', () => {
    const next = moveProduct(blocks, { block: 0, index: 0 }, { block: 1, index: 0 })
    expect(next[1]!.products.map(p => p.id)).toEqual(['p1', 'p3'])
    expect(productOrderPatch(next).find(p => p.id === 'p1')!.category_id).toBeNull()
  })

  // Filing into a switched-off section is ALLOWED — that is what a seasonal section is for. The
  // storefront still shows the product, in the trailing block, because `menuSections` reads
  // `active`; this module's job is only to let the merchant put it there.
  it('moves an item into a hidden section', () => {
    const withHidden = arrangeMenu([prod('p1', 'cakes'), prod('p2')], [CAKES, HIDDEN])
    const next = moveProduct(withHidden, { block: 0, index: 0 }, { block: 1, index: 0 })
    expect(next[1]!.category!.active).toBe(false)
    expect(next[1]!.products.map(p => p.id)).toEqual(['p1'])
    expect(productOrderPatch(next).find(p => p.id === 'p1')!.category_id).toBe('hidden')
  })

  it('returns the same list for a slot that names nothing', () => {
    expect(moveProduct(blocks, { block: 9, index: 0 }, { block: 0, index: 0 })).toBe(blocks)
    expect(moveProduct(blocks, { block: 0, index: 9 }, { block: 0, index: 0 })).toBe(blocks)
  })

  it('does not mutate the list it was given', () => {
    moveProduct(blocks, { block: 0, index: 0 }, { block: 1, index: 0 })
    expect(blocks[0]!.products.map(p => p.id)).toEqual(['p1', 'p2'])
  })
})

describe('moveCategory', () => {
  const blocks = arrangeMenu([prod('p1', 'cakes'), prod('p2', 'tea')], [CAKES, TEA])

  it('moves a section, carrying its products', () => {
    const next = moveCategory(blocks, 0, 1)
    expect(next.map(b => b.category?.id ?? null)).toEqual(['tea', 'cakes', null])
    expect(next[1]!.products.map(p => p.id)).toEqual(['p1'])
  })

  // The storefront draws the un-headed block last, so it is not a section that can be moved above
  // one.
  it('leaves the trailing block last', () => {
    expect(moveCategory(blocks, 1, 0)[2]!.category).toBeNull()
  })

  it('returns the same list for an index that names nothing', () => {
    expect(moveCategory(blocks, 0, 5)).toBe(blocks)
    expect(moveCategory(blocks, -1, 0)).toBe(blocks)
  })
})

describe('reseedCategories', () => {
  const blocks = arrangeMenu([prod('p1', 'cakes'), prod('p2', 'tea'), prod('p3')], [CAKES, TEA])

  // The merchant renames a section in the dialog while holding unsaved drags. The drags survive.
  it('keeps every product where the draft put it', () => {
    const next = reseedCategories(blocks, [cat('cakes', { name: 'Bakes' }), TEA])
    expect(next[0]!.category!.name).toBe('Bakes')
    expect(next[0]!.products.map(p => p.id)).toEqual(['p1'])
    expect(next[1]!.products.map(p => p.id)).toEqual(['p2'])
  })

  it('sends a deleted section’s products to the trailing block', () => {
    const next = reseedCategories(blocks, [TEA])
    expect(next.map(b => b.category?.id ?? null)).toEqual(['tea', null])
    expect(next[1]!.products.map(p => p.id)).toEqual(['p3', 'p1'])
  })

  it('adds a new section as an empty block, in its list position', () => {
    const next = reseedCategories(blocks, [cat('new'), CAKES, TEA])
    expect(next.map(b => b.category?.id ?? null)).toEqual(['new', 'cakes', 'tea', null])
    expect(next[0]!.products).toEqual([])
  })

  it('takes the category order from the list it is given', () => {
    expect(reseedCategories(blocks, [TEA, CAKES]).map(b => b.category?.id ?? null))
      .toEqual(['tea', 'cakes', null])
  })
})

describe('findProduct and resolveDropTarget', () => {
  const blocks = arrangeMenu([prod('p1', 'cakes'), prod('p2')], [CAKES, TEA])

  it('finds a product’s slot', () => {
    expect(findProduct(blocks, 'p1')).toEqual({ block: 0, index: 0 })
    expect(findProduct(blocks, 'p2')).toEqual({ block: 2, index: 0 })
    expect(findProduct(blocks, 'nope')).toBeNull()
  })

  it('reads a product id as that product’s slot', () => {
    expect(resolveDropTarget(blocks, 'p1')).toEqual({ block: 0, index: 0 })
  })

  it('reads a block’s droppable id as the end of that block', () => {
    expect(resolveDropTarget(blocks, blockDropId(1))).toEqual({ block: 1, index: 0 })
  })

  it('reads a category’s drag id as the end of that category’s block', () => {
    expect(resolveDropTarget(blocks, categoryDragId('cakes'))).toEqual({ block: 0, index: 1 })
  })

  it('reads an id that names nothing as no target', () => {
    expect(resolveDropTarget(blocks, blockDropId(9))).toBeNull()
    expect(resolveDropTarget(blocks, categoryDragId('gone'))).toBeNull()
    expect(resolveDropTarget(blocks, 'unknown')).toBeNull()
  })
})

describe('productOrderPatch', () => {
  it('numbers every product from zero, across every section in order', () => {
    const blocks = arrangeMenu([prod('p1', 'cakes'), prod('p2', 'tea'), prod('p3')], [CAKES, TEA])
    expect(productOrderPatch(blocks)).toEqual([
      { id: 'p1', sort: 0, category_id: 'cakes' },
      { id: 'p2', sort: 1, category_id: 'tea' },
      { id: 'p3', sort: 2, category_id: null },
    ])
  })

  // The whole list, never a diff: two browsers arranging one shop must be last-writer-wins rather
  // than two interleaved partial numberings.
  it('returns every product, including ones that did not move', () => {
    const blocks = arrangeMenu([prod('p1'), prod('p2')], [])
    const moved = moveProduct(blocks, { block: 0, index: 0 }, { block: 0, index: 1 })
    expect(productOrderPatch(moved).map(p => p.id)).toEqual(['p2', 'p1'])
  })

  it('is empty for an empty shop', () => {
    expect(productOrderPatch(arrangeMenu([], []))).toEqual([])
  })

  it('files a product into the section whose block it sits in, not its stored id', () => {
    const blocks = arrangeMenu([prod('p1', 'deleted')], [CAKES])
    expect(productOrderPatch(blocks)).toEqual([{ id: 'p1', sort: 0, category_id: null }])
  })
})

describe('categoriesOf and arrangementKeys', () => {
  const blocks = arrangeMenu([prod('p1', 'cakes')], [CAKES, TEA])

  it('lists the categories in draft order, without the trailing block', () => {
    expect(categoriesOf(blocks)).toEqual([CAKES, TEA])
  })

  it('gives two keys, so a section edit and an item drag are told apart', () => {
    const keys = arrangementKeys(blocks)
    expect(arrangementKeys(blocks)).toEqual(keys)
    expect(arrangementKeys(moveCategory(blocks, 0, 1)).categories).not.toBe(keys.categories)
    expect(arrangementKeys(reseedCategories(blocks, [cat('cakes', { name: 'Bakes' }), TEA])).products)
      .toBe(keys.products)
  })
})
