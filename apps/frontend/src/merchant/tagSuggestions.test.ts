import { describe, it, expect } from 'vitest'
import { tagSuggestions, mergeShopTags } from './tagSuggestions'

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
