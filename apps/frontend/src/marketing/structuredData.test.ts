import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { faqStructuredData } from './structuredData'
import { SITE_URL } from '../site'
import { FAQ } from './faq'

// Structured data fails silently: bad markup is not a crash, it is a page a search engine quietly
// stops trusting. These assert the things that would actually break it — that the FAQ markup says
// what the accordion says, in the language it says it in, and that it hangs off the identity the
// static block in index.html declares rather than inventing a second one.

describe('faqStructuredData', () => {
  it('is a FAQPage — identity lives in index.html, not here', () => {
    const data = faqStructuredData('en') as Record<string, any>
    expect(data['@type']).toBe('FAQPage')
    expect(JSON.stringify(data)).not.toContain('"Organization"')
  })

  it('names the /faq page it actually describes', () => {
    const data = faqStructuredData('en') as Record<string, any>
    expect(data.url).toBe(`${SITE_URL}/faq`)
  })

  it('hangs off the identity nodes index.html declares', () => {
    const data = faqStructuredData('en') as Record<string, any>
    expect(data.publisher['@id']).toBe(`${SITE_URL}/#organization`)
    expect(data.isPartOf['@id']).toBe(`${SITE_URL}/#website`)
  })

  it('carries every FAQ entry, in the same order the page renders them', () => {
    const data = faqStructuredData('en') as Record<string, any>
    expect(data.mainEntity).toHaveLength(FAQ.length)
    expect(data.mainEntity.map((q: any) => q.name)).toEqual(FAQ.map(e => e.q.en))
    expect(data.mainEntity[0].acceptedAnswer.text).toBe(FAQ[0].a.en)
  })

  it('marks up the Chinese page in Chinese — markup that disagrees with the page is worse than none', () => {
    const data = faqStructuredData('zh') as Record<string, any>
    expect(data.inLanguage).toBe('zh')
    expect(data.mainEntity.map((q: any) => q.name)).toEqual(FAQ.map(e => e.q.zh))
  })

  it('states no price — the plan prices are resolved per region at runtime', () => {
    const json = JSON.stringify(faqStructuredData('en'))
    expect(json).not.toContain('"offers"')
    expect(json).not.toContain('"price"')
  })
})

// The identity block is hand-written JSON inside an HTML file, where nothing type-checks it and a
// trailing comma is a silent parse failure — the exact failure the audit that asked for it would
// report as "no Organization schema" all over again.
describe('the identity block in index.html', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)

  it('exists and is valid JSON', () => {
    expect(block, 'no ld+json block in index.html').not.toBeNull()
    expect(() => JSON.parse(block![1])).not.toThrow()
  })

  it('declares an Organization the FAQ can point at', () => {
    const graph = JSON.parse(block![1])['@graph'] as Array<Record<string, any>>
    const org = graph.find(n => n['@type'] === 'Organization')
    expect(org, 'no Organization node').toBeDefined()
    expect(org!['@id']).toBe(`${SITE_URL}/#organization`)
    expect(org!.name).toBe('TinyOrder')
    expect(org!.logo.url).toMatch(/^https:\/\//)
  })

  it('uses the same host as SITE_URL everywhere, so the graph joins up', () => {
    const ids = JSON.stringify(JSON.parse(block![1])).match(/https?:\/\/[^"]+/g) ?? []
    expect(ids.length).toBeGreaterThan(0)
    for (const url of ids) {
      if (url.startsWith('https://schema.org')) continue
      expect(url, `${url} is not on SITE_URL`).toMatch(SITE_URL)
    }
  })
})
