// The shop sitemap's XML (#253): active shops only, enumerated at request time — the pure half
// of the /sitemap-shops.xml function. The 503-on-failure rule lives in the function, not here:
// this module only ever sees a list it can render.
import { describe, it, expect } from 'vitest'
import { buildShopSitemap } from './shopSitemap'

describe('buildShopSitemap', () => {
  it('renders one absolute URL per shop', () => {
    const xml = buildShopSitemap('https://tinyorder.shop', ['aunty-b', 'uncle-lim'])
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<loc>https://tinyorder.shop/s/aunty-b</loc>')
    expect(xml).toContain('<loc>https://tinyorder.shop/s/uncle-lim</loc>')
    expect(xml.match(/<url>/g)).toHaveLength(2)
  })

  it('renders an empty urlset for no shops', () => {
    const xml = buildShopSitemap('https://tinyorder.shop', [])
    expect(xml).toContain('<urlset')
    expect(xml).not.toContain('<url>')
  })

  it('escapes anything XML-hostile in a slug', () => {
    const xml = buildShopSitemap('https://tinyorder.shop', ['a&b'])
    expect(xml).toContain('a&amp;b')
    expect(xml).not.toContain('<loc>https://tinyorder.shop/s/a&b</loc>')
  })
})
