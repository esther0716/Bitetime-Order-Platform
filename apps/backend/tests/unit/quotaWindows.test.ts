// tests/unit/quotaWindows.test.ts
// The configured ceilings, as opposed to the sliding-window mechanism itself — that is
// tests/unit/rateLimit.test.ts, which injects a clock and rolls it.
//
// The windows in quotaWindows.ts bind `Date.now` at construction, so a test here cannot roll
// time. What it CAN pin is the number, which is the part that regresses silently: a limit edited
// from 20 to 2 during debugging looks identical in a diff review and only shows up as merchants
// being refused in production.
import { describe, it, expect } from 'vitest'
import { menuImportMerchantWindow } from '../../src/quotaWindows.js'

describe('menuImportMerchantWindow', () => {
  it('allows 20 imports for one shop and refuses the 21st', () => {
    const shop = 'shop-under-test'
    for (let i = 0; i < 20; i++) {
      expect(menuImportMerchantWindow.allow(shop), `import ${i + 1} should be allowed`).toBe(true)
    }
    expect(menuImportMerchantWindow.allow(shop)).toBe(false)
  })

  it('counts each shop separately', () => {
    const exhausted = 'shop-exhausted'
    for (let i = 0; i < 20; i++) menuImportMerchantWindow.allow(exhausted)
    expect(menuImportMerchantWindow.allow(exhausted)).toBe(false)
    // One shop reaching its ceiling must not close the feature for the next shop along.
    expect(menuImportMerchantWindow.allow('shop-untouched')).toBe(true)
  })
})
