// tests/unit/deviceLabel.test.ts
// The browser and platform a merchant reads in Settings → Devices. Pure, so it runs under
// `pnpm test`.
//
// It returns the two names as PARTS and never the sentence joining them: the join is prose, and
// prose is `t(en, zh)`'s job in the browser. A finished English string here would be untranslatable.
import { describe, it, expect } from 'vitest'
import { deviceIdentity } from '../../src/deviceLabel.js'

describe('deviceIdentity', () => {
  it('reads Chrome on macOS', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    expect(deviceIdentity(ua)).toEqual({ browser: 'Chrome', platform: 'macOS' })
  })

  it('reads Safari on iPhone', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
    expect(deviceIdentity(ua)).toEqual({ browser: 'Safari', platform: 'iPhone' })
  })

  it('reads Chrome on Android', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    expect(deviceIdentity(ua)).toEqual({ browser: 'Chrome', platform: 'Android' })
  })

  it('reads Edge on Windows, and does not call it Chrome', () => {
    // Edge's agent contains the whole Chrome agent. Order of checks is the entire test.
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
    expect(deviceIdentity(ua)).toEqual({ browser: 'Edge', platform: 'Windows' })
  })

  it('reads Firefox on Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0'
    expect(deviceIdentity(ua)).toEqual({ browser: 'Firefox', platform: 'Windows' })
  })

  it('reads Safari on iPad, not on macOS', () => {
    // An iPad's agent says "like Mac OS X", so iPad has to be tested first.
    const ua = 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/604.1'
    expect(deviceIdentity(ua)).toEqual({ browser: 'Safari', platform: 'iPad' })
  })

  it('returns the browser alone when the platform is unknown', () => {
    expect(deviceIdentity('Mozilla/5.0 (Unknown) Firefox/130.0')).toEqual({ browser: 'Firefox', platform: null })
  })

  it('returns the platform alone when the browser is unknown', () => {
    expect(deviceIdentity('curl/8.7.1 (Macintosh; Intel Mac OS X 10_15_7)')).toEqual({ browser: null, platform: 'macOS' })
  })

  it('returns nulls rather than guessing, so the caller can say so in the reader’s language', () => {
    expect(deviceIdentity('curl/8.7.1')).toEqual({ browser: null, platform: null })
    expect(deviceIdentity('')).toEqual({ browser: null, platform: null })
    expect(deviceIdentity(null)).toEqual({ browser: null, platform: null })
  })
})
