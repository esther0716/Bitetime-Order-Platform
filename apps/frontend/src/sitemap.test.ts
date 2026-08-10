import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { ROUTE_META } from './routeMeta'

// public/sitemap.xml is the last of the registration joins with nothing holding it: a page can have
// a ROUTE_META entry, a prerendered file, a rewrite and an llms.txt link, and still be missing from
// the file that tells a crawler it exists. Nothing imports it and no build step writes it, so it
// drifts exactly the way llms.txt drifted before llmsTxt.test.ts — silently, and only in the bytes.
//
// The rule pinned here is deliberately the same narrow one: every route we bothered to give a title
// and a prerendered file to is listed. What a sitemap says BEYOND that — lastmod, changefreq,
// priority — is editorial, changes without the routes changing, and is not a test's business.

const xml = readFileSync(path.resolve(__dirname, '../public/sitemap.xml'), 'utf8')

const ORIGIN = 'https://tinyorder.shop'

/** Every <loc> in the file, in document order. */
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim())

describe('public/sitemap.xml', () => {
  it('lists every prerendered marketing route', () => {
    for (const route of Object.keys(ROUTE_META)) {
      // `/` is listed as the bare origin with its trailing slash; the rest append their path.
      const url = route === '/' ? `${ORIGIN}/` : `${ORIGIN}${route}`
      expect(locs, `${route} has a ROUTE_META entry and a prerendered page, but sitemap.xml omits it`)
        .toContain(url)
    }
  })

  it('lists nothing twice — a duplicate <loc> is a malformed sitemap, not a stronger hint', () => {
    expect(new Set(locs).size).toBe(locs.length)
  })

  it('uses absolute URLs on the production host, as the sitemap protocol requires', () => {
    expect(locs.length).toBeGreaterThan(0)
    for (const url of locs) {
      expect(url, `${url} is not an absolute URL on ${ORIGIN}`).toMatch(
        new RegExp(`^${ORIGIN}/`),
      )
    }
  })

  it('lists no storefront — they appear and are suspended without a deploy', () => {
    // The header comment in sitemap.xml states this; a hand-added /s/<slug> row would be stale the
    // first time that shop changed its slug or was suspended.
    for (const url of locs) {
      expect(url, `${url} is a storefront`).not.toMatch(/\/s\//)
    }
  })
})
