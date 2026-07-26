import { describe, it, expect } from 'vitest'
import { TERMS, PRIVACY, REFUNDS_ANCHOR } from './documents'
import { LEGAL_ENTITY, hasUnfilledEntityDetails, isRegisteredEntity } from './entity'
import { draftCaveats } from './draftNotice'

const DOCUMENTS = [
  ['Terms', TERMS],
  ['Privacy', PRIVACY],
] as const

describe.each(DOCUMENTS)('%s document', (_name, doc) => {
  it('has a title and a last-updated date', () => {
    expect(doc.title.trim()).not.toBe('')
    expect(doc.lastUpdated.trim()).not.toBe('')
  })

  it('gives every section a heading and a body', () => {
    expect(doc.sections.length).toBeGreaterThan(0)
    for (const [i, section] of doc.sections.entries()) {
      expect(section.heading.trim(), `section ${i} heading`).not.toBe('')
      expect(section.body.length, `section ${i} body`).toBeGreaterThan(0)
      for (const para of section.body) expect(para.trim()).not.toBe('')
    }
  })

  it('gives every section a unique id, so each one can be linked to', () => {
    const ids = doc.sections.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('names English as the authoritative version, in those terms', () => {
    // The documents are English-only by decision; the page must SAY so, or a future translation
    // could be argued to control. Asserting the CLAIM, not merely the word "English" — the
    // documents mention English elsewhere, so a bare /English/ would pass on a page that had
    // lost this sentence entirely.
    const all = doc.sections.flatMap((s) => s.body).join(' ')
    expect(all).toMatch(/English version is the authoritative one and governs/)
  })
})

describe('the refund policy', () => {
  it('is a section of the Terms that can be linked to directly', () => {
    // Stripe expects a discoverable refund policy. The footer links this anchor, so a missing
    // section is a silently dead link rather than a visible error.
    expect(TERMS.sections.some((s) => s.id === REFUNDS_ANCHOR)).toBe(true)
  })
})

describe('the seller model', () => {
  it('is stated in the Terms — the shop sells the food, not the platform', () => {
    // The load-bearing claim of the whole document. If this text is ever dropped, the platform
    // has silently become a marketplace of record.
    const all = TERMS.sections.flatMap((s) => s.body).join(' ')
    expect(all).toMatch(/seller/i)
  })
})

describe('entity details', () => {
  it('reports unfilled placeholders while any bracket remains', () => {
    expect(hasUnfilledEntityDetails({ ...LEGAL_ENTITY, name: '[COMPANY NAME]' })).toBe(true)
  })

  it('reports nothing unfilled once every field is real', () => {
    expect(hasUnfilledEntityDetails({
      name: 'Example Sdn Bhd',
      registration: '202401234567 (1234567-A)',
      address: '1 Jalan Example, 43000 Kajang, Selangor',
      email: 'hello@example.com',
    })).toBe(false)
  })

  it('ships no remaining placeholders', () => {
    // Tracks the CURRENT state, and fails whenever it changes in either direction — that is the
    // point. A placeholder reappearing should be a deliberate act, not something noticed by a
    // customer reading "[CONTACT EMAIL]" on a live page.
    expect(hasUnfilledEntityDetails(LEGAL_ENTITY)).toBe(false)
  })
})

describe('the draft notice', () => {
  const REAL = {
    name: 'Praxor Studio Sdn Bhd',
    registration: '202401234567 (1234567-A)',
    address: '360, Jalan Ayer Tasek, Setapak, 53200 Kuala Lumpur',
    email: 'support@tinyorder.shop',
  }
  const ids = (...args: Parameters<typeof draftCaveats>) => draftCaveats(...args).map((c) => c.id)

  const UNREGISTERED = { ...REAL, registration: '[SSM REGISTRATION NO.]' }

  it('says the business is unregistered when it is', () => {
    expect(ids(UNREGISTERED, true)).toContain('registration')
  })

  it('does not claim visible blanks when the only gap is the registration', () => {
    // The regression this pins: while unregistered, the registration field is not RENDERED at
    // all, so a notice telling the reader to look for square brackets pointed at nothing.
    expect(ids(UNREGISTERED, true)).not.toContain('placeholders')
  })

  it('does flag a genuinely visible blank', () => {
    expect(ids({ ...REAL, address: '[REGISTERED ADDRESS]' }, true)).toContain('placeholders')
  })

  it('flags the missing legal review independently of everything else', () => {
    expect(ids(REAL, false)).toEqual(['review'])
  })

  it('disappears entirely once registered, filled in and reviewed', () => {
    expect(draftCaveats(REAL, true)).toEqual([])
  })
})

describe('registration status', () => {
  it('reads as unregistered while the number is still a placeholder', () => {
    expect(isRegisteredEntity({ ...LEGAL_ENTITY, registration: '[SSM REGISTRATION NO.]' })).toBe(false)
  })

  it('reads as registered once a number is present', () => {
    expect(isRegisteredEntity({ ...LEGAL_ENTITY, registration: '202401234567 (1234567-A)' })).toBe(true)
  })

  it('never claims company registration while unregistered', () => {
    // The documents describe a legal person. An unregistered trading name is not one, and the
    // sentence "a company registered in Malaysia" would be false — which in these two documents
    // is the whole failure, not a wording nit.
    const all = [...TERMS.sections, ...PRIVACY.sections].flatMap((s) => s.body).join(' ')
    if (isRegisteredEntity(LEGAL_ENTITY)) {
      expect(all).toMatch(/registration number/)
    } else {
      expect(all).not.toMatch(/registration number/)
      expect(all).not.toMatch(/a company registered in Malaysia/)
    }
  })

  it('does not say TinyOrder is operated by the business that operates TinyOrder', () => {
    // The two identity descriptions are worded for their own sentences. The Terms' reads after
    // "TinyOrder is operated by …", so repeating the operator role there is a tautology.
    const terms = TERMS.sections.flatMap((s) => s.body).join(' ')
    expect(terms).not.toMatch(/operated by [^.]*the business that operates TinyOrder/)
  })

  it('names the operator and a contact address either way', () => {
    const all = [...TERMS.sections, ...PRIVACY.sections].flatMap((s) => s.body).join(' ')
    expect(all).toContain(LEGAL_ENTITY.name)
    expect(all).toContain(LEGAL_ENTITY.email)
    expect(all).toContain(LEGAL_ENTITY.address)
  })
})
