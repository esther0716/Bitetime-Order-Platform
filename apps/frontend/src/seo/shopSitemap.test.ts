// The shop sitemap's response (#253): active shops only, enumerated at request time — the pure
// half of the /sitemap-shops.xml function, 503 rule included.
import { describe, it, expect } from 'vitest'
import { buildShopSitemap } from './shopSitemap'

describe('buildShopSitemap', () => {
  it('renders one absolute URL per shop', () => {
    const res = buildShopSitemap('https://tinyorder.shop', ['aunty-b', 'uncle-lim'])
    expect(res.status).toBe(200)
    expect(res.headers['Content-Type']).toContain('application/xml')
    expect(res.body).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(res.body).toContain('<loc>https://tinyorder.shop/s/aunty-b</loc>')
    expect(res.body).toContain('<loc>https://tinyorder.shop/s/uncle-lim</loc>')
    expect(res.body.match(/<url>/g)).toHaveLength(2)
  })

  it('renders an empty urlset for a real answer of no shops', () => {
    const res = buildShopSitemap('https://tinyorder.shop', [])
    expect(res.status).toBe(200)
    expect(res.body).toContain('<urlset')
    expect(res.body).not.toContain('<url>')
  })

  it('answers could-not-ask with a 503 and no URL list — never an empty 200', () => {
    const res = buildShopSitemap('https://tinyorder.shop', null)
    expect(res.status).toBe(503)
    expect(res.headers['Retry-After']).toBe('300')
    expect(res.body).not.toContain('<urlset')
  })

  it('escapes anything XML-hostile in a slug', () => {
    const res = buildShopSitemap('https://tinyorder.shop', ['a&b'])
    expect(res.body).toContain('a&amp;b')
    expect(res.body).not.toContain('<loc>https://tinyorder.shop/s/a&b</loc>')
  })
})
