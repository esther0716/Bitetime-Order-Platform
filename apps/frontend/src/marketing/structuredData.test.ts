import { describe, it, expect } from 'vitest'
import { landingStructuredData } from './structuredData'
import { FAQ } from './faq'

// Structured data fails silently: bad markup is not a crash, it is a page Google quietly stops
// trusting. These assert the two things that would actually break it — that every URL is absolute,
// and that the FAQ markup says what the accordion on the page says, in the language it says it in.

type Graph = { '@context': string; '@graph': Array<Record<string, any>> }

const node = (data: object, type: string) =>
  (data as Graph)['@graph'].find(n => n['@type'] === type)!

describe('landingStructuredData', () => {
  it('publishes the organisation, the site, the app and the FAQ', () => {
    const types = (landingStructuredData('https://tinyorder.shop', 'en') as Graph)['@graph'].map(
      n => n['@type'],
    )
    expect(types).toEqual(['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage'])
  })

  it('makes every url and @id absolute on the host that served the page', () => {
    const data = landingStructuredData('https://preview-123.vercel.app', 'en') as Graph
    const urls = data['@graph'].flatMap(n =>
      [n['@id'], n.url, n.logo?.url].filter(Boolean as unknown as (v: unknown) => v is string),
    )
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) expect(url).toMatch(/^https:\/\/preview-123\.vercel\.app\//)
  })

  it('does not double the slash when the origin carries one', () => {
    const org = node(landingStructuredData('https://tinyorder.shop/', 'en'), 'Organization')
    expect(org.url).toBe('https://tinyorder.shop/')
    expect(org['@id']).toBe('https://tinyorder.shop/#organization')
  })

  it('carries every FAQ entry, in the same order the page renders them', () => {
    const faq = node(landingStructuredData('https://tinyorder.shop', 'en'), 'FAQPage')
    expect(faq.mainEntity).toHaveLength(FAQ.length)
    expect(faq.mainEntity.map((q: any) => q.name)).toEqual(FAQ.map(e => e.q.en))
    expect(faq.mainEntity[0].acceptedAnswer.text).toBe(FAQ[0].a.en)
  })

  it('marks up the Chinese page in Chinese — markup that disagrees with the page is worse than none', () => {
    const data = landingStructuredData('https://tinyorder.shop', 'zh')
    const faq = node(data, 'FAQPage')
    expect(faq.inLanguage).toBe('zh')
    expect(faq.mainEntity.map((q: any) => q.name)).toEqual(FAQ.map(e => e.q.zh))
    expect(node(data, 'WebSite').inLanguage).toBe('zh')
  })

  it('states no price — the plan prices are resolved per region at runtime', () => {
    const json = JSON.stringify(landingStructuredData('https://tinyorder.shop', 'en'))
    expect(json).not.toContain('"offers"')
    expect(json).not.toContain('"price"')
  })
})
