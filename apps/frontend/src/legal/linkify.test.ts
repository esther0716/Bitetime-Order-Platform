import { describe, it, expect } from 'vitest'
import { splitOnEmails } from './linkify'
import { TERMS, PRIVACY } from './documents'
import { LEGAL_ENTITY } from './entity'

describe('splitOnEmails', () => {
  it('returns one text run when there is no address', () => {
    expect(splitOnEmails('These terms are governed by the laws of Malaysia.')).toEqual([
      { type: 'text', value: 'These terms are governed by the laws of Malaysia.' },
    ])
  })

  it('splits an address out of the sentence around it', () => {
    expect(splitOnEmails('Write to support@tinyorder.shop for help')).toEqual([
      { type: 'text', value: 'Write to ' },
      { type: 'email', value: 'support@tinyorder.shop' },
      { type: 'text', value: ' for help' },
    ])
  })

  it('leaves a trailing full stop out of the address', () => {
    // The regression this exists for: `mailto:support@tinyorder.shop.` is a different, invalid
    // address, and the sentence would lose its full stop on screen.
    const runs = splitOnEmails('You can reach us at support@tinyorder.shop.')
    expect(runs).toEqual([
      { type: 'text', value: 'You can reach us at ' },
      { type: 'email', value: 'support@tinyorder.shop' },
      { type: 'text', value: '.' },
    ])
  })

  it('handles more than one address in a paragraph', () => {
    const runs = splitOnEmails('a@b.com and c@d.com')
    expect(runs.filter((r) => r.type === 'email').map((r) => r.value)).toEqual(['a@b.com', 'c@d.com'])
  })

  it('reassembles to exactly the original text', () => {
    // The property that matters most: linkifying must never lose or duplicate a character of a
    // legal document.
    for (const doc of [TERMS, PRIVACY]) {
      for (const section of doc.sections) {
        for (const para of section.body) {
          expect(splitOnEmails(para).map((r) => r.value).join('')).toBe(para)
        }
      }
    }
  })

  it('finds the contact address everywhere the documents print it', () => {
    const withEmail = [...TERMS.sections, ...PRIVACY.sections]
      .flatMap((s) => s.body)
      .filter((p) => p.includes(LEGAL_ENTITY.email))
    expect(withEmail.length).toBeGreaterThan(0)
    for (const para of withEmail) {
      expect(splitOnEmails(para).some((r) => r.type === 'email' && r.value === LEGAL_ENTITY.email)).toBe(true)
    }
  })
})
