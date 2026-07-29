import { describe, it, expect } from 'vitest'
import { USE_CASES } from './useCases'

// Same reason as features.test.ts: both language fields are strings, so an entry carrying English
// in its Chinese slot type-checks perfectly and ships inside a Chinese page. Nothing here tests
// rendering.

describe('USE_CASES content', () => {
  it('has entries', () => {
    expect(USE_CASES.length).toBeGreaterThan(0)
  })

  it('gives every entry a title and a body in both languages', () => {
    for (const [i, entry] of USE_CASES.entries()) {
      for (const field of ['title', 'body'] as const) {
        expect(entry[field].en.trim(), `entry ${i} ${field}.en`).not.toBe('')
        expect(entry[field].zh.trim(), `entry ${i} ${field}.zh`).not.toBe('')
      }
    }
  })

  it('never repeats the English as the Chinese — what a forgotten translation looks like', () => {
    for (const [i, entry] of USE_CASES.entries()) {
      expect(entry.title.zh, `entry ${i} title is untranslated`).not.toBe(entry.title.en)
      expect(entry.body.zh, `entry ${i} body is untranslated`).not.toBe(entry.body.en)
    }
  })

  it('gives every entry Chinese that actually contains Chinese', () => {
    for (const [i, entry] of USE_CASES.entries()) {
      expect(entry.title.zh, `entry ${i} title`).toMatch(/[一-鿿]/)
      expect(entry.body.zh, `entry ${i} body`).toMatch(/[一-鿿]/)
    }
  })

  it('keys every entry uniquely, so the list has stable keys', () => {
    const ids = USE_CASES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
