import { describe, it, expect, afterEach, vi } from 'vitest'
import { praxorSettings } from './config'

afterEach(() => { vi.unstubAllEnvs() })

describe('praxorSettings', () => {
  it('is off when the site id is unset', () => {
    vi.stubEnv('VITE_PRAXOR_SITE_ID', '')
    expect(praxorSettings()).toBeNull()
  })

  it('is off when the site id is whitespace, so a stray space cannot half-enable it', () => {
    vi.stubEnv('VITE_PRAXOR_SITE_ID', '   ')
    expect(praxorSettings()).toBeNull()
  })

  it('trims a site id that a dashboard copy-paste padded', () => {
    vi.stubEnv('VITE_PRAXOR_SITE_ID', ' site_123 ')
    vi.stubEnv('VITE_PRAXOR_API_URL', '')
    expect(praxorSettings()).toEqual({ siteId: 'site_123' })
  })

  it('drops a blank API URL rather than passing it on, because initPraxor throws on one', () => {
    vi.stubEnv('VITE_PRAXOR_SITE_ID', 'site_123')
    vi.stubEnv('VITE_PRAXOR_API_URL', '   ')
    expect(praxorSettings()).toEqual({ siteId: 'site_123' })
  })

  it('returns a self-hosted API URL when one is set', () => {
    vi.stubEnv('VITE_PRAXOR_SITE_ID', 'site_123')
    vi.stubEnv('VITE_PRAXOR_API_URL', 'http://localhost:3001')
    expect(praxorSettings()).toEqual({ siteId: 'site_123', apiUrl: 'http://localhost:3001' })
  })
})
