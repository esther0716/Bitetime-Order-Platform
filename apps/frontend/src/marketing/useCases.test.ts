import { describe, it, expect } from 'vitest'
import { USE_CASES, useCasePath } from './useCases'
import { FAQ } from './faq'

// Same reason as verticals.test.ts and faq.test.ts: both language fields are strings, so an entry
// carrying English in its Chinese slot type-checks perfectly and ships inside a Chinese page.
// Nothing here renders anything — these are content pins.

/** Every bilingual pair in one entry, flattened, so one loop can check them all. */
function pairs(useCase: (typeof USE_CASES)[number]) {
  return [
    { field: 'label', copy: useCase.label },
    { field: 'h1', copy: useCase.h1 },
    { field: 'intro', copy: useCase.intro },
    { field: 'cardBlurb', copy: useCase.cardBlurb },
    ...useCase.blocks.flatMap((b, i) => [
      { field: `blocks[${i}].title`, copy: b.title },
      { field: `blocks[${i}].body`, copy: b.body },
    ]),
    ...useCase.faq.flatMap((f, i) => [
      { field: `faq[${i}].q`, copy: f.q },
      { field: `faq[${i}].a`, copy: f.a },
    ]),
  ]
}

describe('USE_CASES content', () => {
  it('has the four verticals the design names', () => {
    expect(USE_CASES.map(u => u.slug)).toEqual([
      'home-bakers',
      'home-kitchens',
      'makers',
      'cafes-and-stalls',
    ])
  })

  it('never leaves a string blank in either language', () => {
    for (const useCase of USE_CASES) {
      for (const { field, copy } of pairs(useCase)) {
        expect(copy.en.trim(), `${useCase.slug} ${field}.en`).not.toBe('')
        expect(copy.zh.trim(), `${useCase.slug} ${field}.zh`).not.toBe('')
      }
    }
  })

  it('never repeats the English as the Chinese — what a forgotten translation looks like', () => {
    for (const useCase of USE_CASES) {
      for (const { field, copy } of pairs(useCase)) {
        expect(copy.zh, `${useCase.slug} ${field} is untranslated`).not.toBe(copy.en)
      }
    }
  })

  it('gives every Chinese string a Han character — a distinct string is not proof of translation', () => {
    for (const useCase of USE_CASES) {
      for (const { field, copy } of pairs(useCase)) {
        expect(copy.zh, `${useCase.slug} ${field}.zh`).toMatch(/[一-鿿]/)
      }
    }
  })

  it('keys every vertical on a unique kebab-case slug — the slug IS the URL', () => {
    const slugs = USE_CASES.map(u => u.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) {
      expect(slug, `${slug} is not kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('serves every vertical under /for', () => {
    expect(useCasePath('home-bakers')).toBe('/for/home-bakers')
  })

  // Fewer than three and the page is a stub; more than four and it stops being a page written for
  // one reader and becomes /features again.
  it('gives every vertical three or four story blocks and three or four questions', () => {
    for (const useCase of USE_CASES) {
      expect(useCase.blocks.length, `${useCase.slug} blocks`).toBeGreaterThanOrEqual(3)
      expect(useCase.blocks.length, `${useCase.slug} blocks`).toBeLessThanOrEqual(4)
      expect(useCase.faq.length, `${useCase.slug} faq`).toBeGreaterThanOrEqual(3)
      expect(useCase.faq.length, `${useCase.slug} faq`).toBeLessThanOrEqual(4)
    }
  })

  it('keys blocks and questions uniquely within a vertical, so React has stable keys', () => {
    for (const useCase of USE_CASES) {
      const blockIds = useCase.blocks.map(b => b.id)
      expect(new Set(blockIds).size, `${useCase.slug} block ids`).toBe(blockIds.length)
      const faqIds = useCase.faq.map(f => f.id)
      expect(new Set(faqIds).size, `${useCase.slug} faq ids`).toBe(faqIds.length)
    }
  })

  // THE thin-content pin. Four pages built from one template earn their place by what they say;
  // a page that re-asks /faq's questions is a fourth copy of /faq wearing a different title.
  it('never re-asks a question /faq already answers', () => {
    const asked = new Set(FAQ.flatMap(e => [e.q.en, e.q.zh]))
    for (const useCase of USE_CASES) {
      for (const entry of useCase.faq) {
        expect(asked.has(entry.q.en), `${useCase.slug} ${entry.id} duplicates /faq`).toBe(false)
        expect(asked.has(entry.q.zh), `${useCase.slug} ${entry.id} duplicates /faq`).toBe(false)
      }
    }
  })

  it('never re-asks the same question on two verticals', () => {
    const questions = USE_CASES.flatMap(u => u.faq.map(f => f.q.en))
    expect(new Set(questions).size).toBe(questions.length)
  })

  // ROUTE_META's own suite checks these once they are spread in. Checking them here is what makes
  // this module self-contained: a title written 20 characters too long is caught where it is
  // written, not three commits later.
  it('gives every vertical a title and description search results can show whole', () => {
    for (const useCase of USE_CASES) {
      expect(useCase.meta.title.length, `${useCase.slug} title`).toBeLessThanOrEqual(65)
      expect(useCase.meta.description.length, `${useCase.slug} description`).toBeLessThanOrEqual(160)
      expect(useCase.meta.title, `${useCase.slug} title`).toContain('TinyOrder')
    }
  })

  it('gives no two verticals the same title — a duplicate is one sitelink candidate, not two', () => {
    const titles = USE_CASES.map(u => u.meta.title)
    expect(new Set(titles).size).toBe(titles.length)
  })
})
