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
        expect(entry[field].trim(), `entry ${i} ${field}`).not.toBe('')
      }
    }
  })

  it('never repeats the English as the Chinese — what a forgotten translation looks like', () => {
    for (const [i, entry] of VERTICALS.entries()) {
      expect(entry.zh, `entry ${i} is untranslated`).not.toBe(entry.en)
    }
  })

  it('gives every entry Chinese that actually contains Chinese', () => {
    // A distinct string is not proof of translation; a Han character is.
    for (const [i, entry] of VERTICALS.entries()) {
      expect(entry.zh, `entry ${i}`).toMatch(/[一-鿿]/)
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
    expect(VERTICALS[0].en).toBe('food')
  })
})
