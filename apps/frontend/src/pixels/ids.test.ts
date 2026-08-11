import { describe, it, expect, afterEach, vi } from 'vitest'
import { platformPixelIds, hasAnyPixel } from './ids'

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
