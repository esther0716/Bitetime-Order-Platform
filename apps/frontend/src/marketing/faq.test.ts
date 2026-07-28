import { describe, it, expect } from 'vitest'
import { FAQ } from './faq'

// The FAQ is the one part of the legal/marketing work that is BILINGUAL, and a half-translated
// entry is invisible to the compiler: both fields are strings, so an entry carrying English in
// its Chinese slot type-checks perfectly and ships inside a Chinese page. That is what this
// file exists to catch — nothing here tests rendering.

describe('FAQ content', () => {
  it('has entries', () => {
    expect(FAQ.length).toBeGreaterThan(0)
  })

  it('gives every entry a question and an answer in both languages', () => {
    for (const [i, entry] of FAQ.entries()) {
      for (const field of ['q', 'a'] as const) {
        expect(entry[field].en.trim(), `entry ${i} ${field}.en`).not.toBe('')
        expect(entry[field].zh.trim(), `entry ${i} ${field}.zh`).not.toBe('')
      }
    }
  })

  it('never repeats the English as the Chinese — what a forgotten translation looks like', () => {
    for (const [i, entry] of FAQ.entries()) {
      expect(entry.q.zh, `entry ${i} question is untranslated`).not.toBe(entry.q.en)
      expect(entry.a.zh, `entry ${i} answer is untranslated`).not.toBe(entry.a.en)
    }
  })

  it('gives every entry a Chinese answer that actually contains Chinese', () => {
    // A distinct string is not proof of translation; a Han character is.
    for (const [i, entry] of FAQ.entries()) {
      expect(entry.q.zh, `entry ${i} question`).toMatch(/[一-鿿]/)
      expect(entry.a.zh, `entry ${i} answer`).toMatch(/[一-鿿]/)
    }
  })

  it('keys every entry uniquely, so the accordion can track which panel is open', () => {
    const ids = FAQ.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
