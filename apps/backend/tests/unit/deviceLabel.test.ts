// tests/unit/deviceLabel.test.ts
// The user-agent string a merchant reads in Settings → Devices. Pure, so it runs under `pnpm test`.
import { describe, it, expect } from 'vitest'
import { deviceLabel } from '../../src/deviceLabel.js'

describe('deviceLabel', () => {
  it('reads Chrome on macOS', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    expect(deviceLabel(ua)).toBe('Chrome on macOS')
  })

  it('reads Safari on iPhone', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
    expect(deviceLabel(ua)).toBe('Safari on iPhone')
  })

  it('reads Chrome on Android', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    expect(deviceLabel(ua)).toBe('Chrome on Android')
  })

  it('reads Edge on Windows, and does not call it Chrome', () => {
    // Edge's agent contains the whole Chrome agent. Order of checks is the entire test.
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
    expect(deviceLabel(ua)).toBe('Edge on Windows')
  })

  it('reads Firefox on Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0'
    expect(deviceLabel(ua)).toBe('Firefox on Windows')
  })

  it('reads Safari on iPad', () => {
    const ua = 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/604.1'
    expect(deviceLabel(ua)).toBe('Safari on iPad')
  })

  it('names the browser alone when the platform is unknown', () => {
    expect(deviceLabel('Mozilla/5.0 (Unknown) Firefox/130.0')).toBe('Firefox')
  })

  it('names the platform alone when the browser is unknown', () => {
    expect(deviceLabel('curl/8.7.1 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macOS')
  })

  it('returns Unknown device rather than guessing', () => {
    expect(deviceLabel('curl/8.7.1')).toBe('Unknown device')
    expect(deviceLabel('')).toBe('Unknown device')
    expect(deviceLabel(null)).toBe('Unknown device')
  })
})
