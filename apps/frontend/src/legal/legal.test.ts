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

  it('names the operator and a contact email either way', () => {
    const all = [...TERMS.sections, ...PRIVACY.sections].flatMap((s) => s.body).join(' ')
    expect(all).toContain(LEGAL_ENTITY.name)
    expect(all).toContain(LEGAL_ENTITY.email)
  })
})

describe('advertising pixels', () => {
  const text = PRIVACY.sections.flatMap(s => s.body).join(' ')

  it('no longer claims we never use data for advertising, because we now do', () => {
    // The sentence this replaces was true until the marketing pages carried a pixel (#217). A
    // legal document that contradicts the code is the one failure this whole file exists to catch.
    expect(text).not.toContain('we do not use it for advertising')
  })

  it('still promises we do not sell personal data', () => {
    expect(text).toContain('We do not sell personal data')
  })

  it('names Meta as a recipient', () => {
    expect(text).toContain('Meta')
  })

  it('does NOT name TikTok, which receives nothing', () => {
    // Setting VITE_TIKTOK_PIXEL_ID means naming TikTok here FIRST. Naming a recipient of personal
    // data that receives none is as false as omitting one that does.
    expect(text).not.toContain('TikTok')
  })

  it('says the pixels are on our pages and not on a shop’s storefront', () => {
    // The sentence itself, not just the word — this is the promise pixels/decision.ts keeps, and
    // a notice that merely mentions storefronts somewhere would satisfy a looser assertion while
    // saying nothing.
    expect(text).toContain('It is never present on a shop\'s storefront.')
    expect(text).toContain('It receives nothing at all from a shop\'s storefront')
  })

  it('has a section about cookies that the consent banner can link a reader to', () => {
    const cookies = PRIVACY.sections.find(s => s.id === 'cookies')
    expect(cookies).toBeDefined()
    expect(cookies!.body.length).toBeGreaterThan(0)
  })

  it('numbers the privacy sections 1..n with no gap and no repeat', () => {
    const numbers = PRIVACY.sections.map(s => Number(s.heading.split('.')[0]))
    expect(numbers).toEqual(Array.from({ length: PRIVACY.sections.length }, (_, i) => i + 1))
  })
})

// The shop's OWN pixel (#220). A different controller, a different document: the Terms bind the
// merchant, and the privacy notice has to stop claiming no pixel can ever load on a storefront.
describe('a shop’s own advertising pixel', () => {
  const terms = TERMS.sections.flatMap(s => s.body).join(' ')
  const privacy = PRIVACY.sections.flatMap(s => s.body).join(' ')

  it('gives the merchant’s responsibility its own Terms section', () => {
    const section = TERMS.sections.find(s => s.id === 'shop-tracking')
    expect(section).toBeDefined()
    expect(section!.body.length).toBeGreaterThan(0)
  })

  it('says the tracking is the shop’s and not ours', () => {
    expect(terms).toContain('that tracking is yours and not ours')
  })

  it('puts disclosure and the platform’s own terms on the merchant', () => {
    expect(terms).toContain('tell your own customers about it')
    expect(terms).toContain('advertising platform\'s own terms')
  })

  // The signatures in pixels/track.ts are what enforce this — there is no parameter to pass a
  // name or a number through. The sentence must not promise more than they hold, nor less.
  it('states the limit on what is sent, matching what track.ts can send', () => {
    expect(terms).toContain('the pages viewed on your storefront and the value of an order')
    expect(terms).toContain('We do not send your customers\' names, contact numbers or addresses')
  })

  // A downgraded shop must always be able to switch its pixel off — the one place the write gate
  // deliberately departs from ADR 0013. Promised here, enforced by `pixelIdsChanged`.
  it('promises the pixel can be removed on any plan', () => {
    expect(terms).toContain('remove your pixel at any time in your shop settings, whatever plan you are on')
  })

  it('numbers the terms sections 1..n with no gap and no repeat', () => {
    const numbers = TERMS.sections.map(s => Number(s.heading.split('.')[0]))
    expect(numbers).toEqual(Array.from({ length: TERMS.sections.length }, (_, i) => i + 1))
  })

  // The privacy notice used to say advertising cookies are set "never on a shop's storefront",
  // full stop. True of OURS, and false as a whole the moment a merchant adds one of their own.
  it('no longer reads as a promise that no pixel can load on a storefront', () => {
    expect(privacy).toContain('A shop can also add its own advertising pixel to its storefront')
    expect(privacy).toContain('its storefront asks you separately')
  })

  it('still promises OUR pixels stay off a storefront', () => {
    expect(privacy).toContain('never on a shop\'s storefront')
  })
})
