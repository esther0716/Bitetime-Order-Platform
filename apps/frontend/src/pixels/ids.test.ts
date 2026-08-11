import { describe, it, expect, afterEach, vi } from 'vitest'
import { platformPixelIds, merchantPixelIds, hasAnyPixel } from './ids'

afterEach(() => { vi.unstubAllEnvs() })

describe('platformPixelIds', () => {
  it('reads nothing when neither variable is set', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '')
    vi.stubEnv('VITE_TIKTOK_PIXEL_ID', '')
    expect(platformPixelIds()).toEqual({ meta: undefined, tiktok: undefined })
  })

  it('reads each variable independently — one set, one pixel', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '123456789')
    vi.stubEnv('VITE_TIKTOK_PIXEL_ID', '')
    expect(platformPixelIds()).toEqual({ meta: '123456789', tiktok: undefined })
  })

  it('reads both when both are set', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '123456789')
    vi.stubEnv('VITE_TIKTOK_PIXEL_ID', 'CABCDEF')
    expect(platformPixelIds()).toEqual({ meta: '123456789', tiktok: 'CABCDEF' })
  })

  it('treats a whitespace-only value as unset, so a stray space cannot half-enable a pixel', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '   ')
    expect(platformPixelIds().meta).toBeUndefined()
  })

  it('trims a value that a dashboard copy-paste padded', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', ' 123456789 ')
    expect(platformPixelIds().meta).toBe('123456789')
  })
})

describe('merchantPixelIds', () => {
  it('reads nothing off a shop that has set neither', () => {
    expect(merchantPixelIds({})).toEqual({ meta: undefined, tiktok: undefined })
  })

  it('reads each column independently — one set, one pixel', () => {
    expect(merchantPixelIds({ meta_pixel_id: '123456789012345' }))
      .toEqual({ meta: '123456789012345', tiktok: undefined })
    expect(merchantPixelIds({ tiktok_pixel_id: 'CQ1234567890ABCDEFGH' }))
      .toEqual({ meta: undefined, tiktok: 'CQ1234567890ABCDEFGH' })
  })

  // Absent, null and blank are ONE state — no pixel. A row written before the columns existed
  // has neither; a merchant clearing the field sends ''. Reading them as three states is how a
  // shop initialises a pixel with no id and reports to nowhere.
  it('reads an absent column, a null and a blank as the same "no pixel"', () => {
    expect(merchantPixelIds({ meta_pixel_id: null }).meta).toBeUndefined()
    expect(merchantPixelIds({ meta_pixel_id: '' }).meta).toBeUndefined()
    expect(merchantPixelIds({ meta_pixel_id: '   ' }).meta).toBeUndefined()
  })

  it('answers for a shop that is not loaded yet without throwing', () => {
    expect(merchantPixelIds(null)).toEqual({ meta: undefined, tiktok: undefined })
    expect(merchantPixelIds(undefined)).toEqual({ meta: undefined, tiktok: undefined })
  })

  it('trims, because a dashboard copy-paste pads', () => {
    expect(merchantPixelIds({ meta_pixel_id: ' 123456789012345 ' }).meta).toBe('123456789012345')
  })
})

describe('hasAnyPixel', () => {
  it('is false when nothing is configured — the whole feature is then off', () => {
    expect(hasAnyPixel({})).toBe(false)
    expect(hasAnyPixel({ meta: undefined, tiktok: undefined })).toBe(false)
  })

  it('is true for either vendor alone', () => {
    expect(hasAnyPixel({ meta: '1' })).toBe(true)
    expect(hasAnyPixel({ tiktok: 'C1' })).toBe(true)
  })
})
