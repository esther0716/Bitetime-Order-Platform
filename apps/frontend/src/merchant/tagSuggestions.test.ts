import { describe, it, expect } from 'vitest'
import { tagSuggestions, mergeShopTags, filterChips, TAG_CHIP_CAP } from './tagSuggestions'

describe('tagSuggestions', () => {
  it('offers the whole vocabulary before the merchant types anything', () => {
    expect(tagSuggestions(['office', 'vip'], [], '')).toEqual(['office', 'vip'])
  })

  it('drops tags this customer already carries — offering them would do nothing', () => {
    expect(tagSuggestions(['office', 'vip'], ['vip'], '')).toEqual(['office'])
  })

  it('narrows to what the draft is reaching for', () => {
    expect(tagSuggestions(['office', 'vip', 'wholesale'], [], 'ho')).toEqual(['wholesale'])
  })

  // The three spellings in the issue title. Each has to be findable from what a merchant
  // plausibly types, or the suggestion never gets the chance to prevent the duplicate.
  it('surfaces a differently-CASED spelling', () => {
    expect(tagSuggestions(['VIP'], [], 'vip')).toEqual(['VIP'])
  })

  it('surfaces a differently-PUNCTUATED spelling', () => {
    expect(tagSuggestions(['V.I.P.'], [], 'vip')).toEqual(['V.I.P.'])
  })

  it('surfaces all three spellings at once, so the collision is visible', () => {
    expect(tagSuggestions(['V.I.P.', 'VIP', 'vip'], [], 'vip')).toEqual(['V.I.P.', 'VIP', 'vip'])
  })

  it('matches in the other direction too — punctuation in the DRAFT', () => {
    expect(tagSuggestions(['VIP'], [], 'v.i.p.')).toEqual(['VIP'])
  })

  it('matches a Chinese tag rather than folding it to nothing', () => {
    expect(tagSuggestions(['熟客', 'vip'], [], '熟')).toEqual(['熟客'])
  })

  it('treats an all-punctuation draft as no draft, not as a match against everything', () => {
    expect(tagSuggestions(['office', 'vip'], [], '...')).toEqual(['office', 'vip'])
  })

  it('offers nothing when the shop has written nothing', () => {
    expect(tagSuggestions([], [], 'vip')).toEqual([])
  })

  it('keeps the order it was given — the backend already decided it', () => {
    expect(tagSuggestions(['apple', 'VIP', 'vip', 'zebra'], [], '')).toEqual(['apple', 'VIP', 'vip', 'zebra'])
  })
})

describe('mergeShopTags', () => {
  it('adds a newly written tag in its sorted place', () => {
    expect(mergeShopTags(['apple', 'zebra'], ['mango'])).toEqual(['apple', 'mango', 'zebra'])
  })

  it('sorts case-insensitively, so two spellings land side by side', () => {
    expect(mergeShopTags(['apple', 'zebra'], ['VIP', 'vip'])).toEqual(['apple', 'VIP', 'vip', 'zebra'])
  })

  it('keeps each spelling exactly as it was written', () => {
    expect(mergeShopTags([], ['V.I.P.', 'VIP'])).toEqual(['V.I.P.', 'VIP'])
  })

  it('returns the same array when nothing is new, so the chip row does not re-render', () => {
    const known = ['office', 'vip']
    expect(mergeShopTags(known, ['vip'])).toBe(known)
  })

  it('is additive — removing a tag from a customer does not retire it mid-session', () => {
    expect(mergeShopTags(['office', 'vip'], [])).toEqual(['office', 'vip'])
  })
})

describe('filterChips', () => {
  const many = Array.from({ length: 15 }, (_, i) => `tag${i}`)

  it('shows the whole vocabulary when it fits under the cap', () => {
    expect(filterChips(['office', 'vip'], null, false)).toEqual({ chips: ['office', 'vip'], hidden: 0 })
  })

  it('shows nothing when the shop has written nothing', () => {
    expect(filterChips([], null, false)).toEqual({ chips: [], hidden: 0 })
  })

  it('caps the row and counts what it held back', () => {
    const { chips, hidden } = filterChips(many, null, false)
    expect(chips).toEqual(many.slice(0, TAG_CHIP_CAP))
    expect(hidden).toBe(5)
  })

  // A filter the merchant cannot see is a list that looks like it is missing rows.
  it('pulls the selected tag in when it sorts past the cap', () => {
    const { chips } = filterChips(many, 'tag12', false)
    expect(chips).toContain('tag12')
  })

  // Appended, not moved: a row that reshuffles when you click it is a row you cannot click twice.
  it('appends the pulled-in tag rather than reordering the row', () => {
    const { chips } = filterChips(many, 'tag12', false)
    expect(chips).toEqual([...many.slice(0, TAG_CHIP_CAP), 'tag12'])
  })

  it('does not still count the pulled-in tag as hidden', () => {
    expect(filterChips(many, 'tag12', false).hidden).toBe(4)
  })

  it('leaves the row alone when the selected tag is already visible', () => {
    const { chips, hidden } = filterChips(many, 'tag3', false)
    expect(chips).toEqual(many.slice(0, TAG_CHIP_CAP))
    expect(hidden).toBe(5)
  })

  it('shows everything once expanded, with nothing left to ask for', () => {
    expect(filterChips(many, null, true)).toEqual({ chips: many, hidden: 0 })
  })

  // mergeShopTags is additive, so the vocabulary can run ahead of the server but never behind
  // it — and a selected tag the list no longer holds must stay clickable, or the filter is
  // stuck with nothing on screen to clear it with.
  it('keeps a selected tag the vocabulary no longer holds', () => {
    expect(filterChips(['office'], 'retired', false)).toEqual({ chips: ['office', 'retired'], hidden: 0 })
  })
})
