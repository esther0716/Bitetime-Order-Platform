import { describe, it, expect } from 'vitest'
import { VERTICALS } from './verticals'

// Same reason as faq.test.ts and features.test.ts: both language fields are strings, so an entry
// carrying English in its Chinese slot type-checks perfectly and ships inside a Chinese page.
// Nothing here tests rendering.

describe('VERTICALS content', () => {
  it('has entries', () => {
    expect(VERTICALS.length).toBeGreaterThan(0)
  })

  it('gives every entry a word in both languages', () => {
    for (const [i, entry] of VERTICALS.entries()) {
      for (const field of ['en', 'zh'] as const) {
        expect(entry[field].text.trim(), `entry ${i} ${field}`).not.toBe('')
      }
    }
  })

  it('never repeats the English as the Chinese — what a forgotten translation looks like', () => {
    for (const [i, entry] of VERTICALS.entries()) {
      expect(entry.zh.text, `entry ${i} is untranslated`).not.toBe(entry.en.text)
    }
  })

  it('gives every entry Chinese that actually contains Chinese', () => {
    // A distinct string is not proof of translation; a Han character is.
    for (const [i, entry] of VERTICALS.entries()) {
      expect(entry.zh.text, `entry ${i}`).toMatch(/[一-鿿]/)
    }
  })

  // The slot animates to this width, so a missing or zero value collapses the word to nothing.
  // A wrong-but-positive value only costs a few px of gap, which is why this checks presence
  // rather than accuracy — accuracy is a browser measurement, recorded in verticals.ts.
  it('gives every word a positive slot width in both languages', () => {
    for (const [i, entry] of VERTICALS.entries()) {
      for (const field of ['en', 'zh'] as const) {
        expect(entry[field].em, `entry ${i} ${field}.em`).toBeGreaterThan(0)
      }
    }
  })

  it('keys every entry uniquely, so the rotation has stable keys', () => {
    const ids = VERTICALS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // The prerender pin. scripts/prerender.tsx writes static landing markup over dist/index.html,
  // so index 0 is the only word a crawler that does not run JS ever sees. It has to be the word
  // index.html's <title> and meta description are built around.
  it('leads with food, the word the prerenderer freezes into dist/index.html', () => {
    expect(VERTICALS[0].id).toBe('food')
    expect(VERTICALS[0].en.text).toBe('food')
  })
})
