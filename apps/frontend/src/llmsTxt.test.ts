import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { ROUTE_META } from './routeMeta'

// public/llms.txt is the plain-text index an LLM crawler reads instead of executing the app
// (llmstxt.org). Nothing imports it and no build step generates it, so it drifts silently: /features
// and /faq shipped with their own prerendered pages, their own ROUTE_META entries and their own
// sitemap rows, and llms.txt still listed only / and /pricing — an agent asked what TinyOrder does
// was reading a two-page site.
//
// The rule pinned here is narrow on purpose. llms.txt is PROSE, not a route table: it carries facts
// (no commission, cardless trial, EN/ZH) that live nowhere else, and most of its value is in
// sentences no test can assert. What a test CAN hold is that every page we bothered to give a
// title and a prerendered file to is also reachable from the file that points crawlers at them.

const llms = readFileSync(path.resolve(__dirname, '../public/llms.txt'), 'utf8')

const ORIGIN = 'https://tinyorder.shop'

describe('public/llms.txt', () => {
  it('links every prerendered marketing route', () => {
    for (const route of Object.keys(ROUTE_META)) {
      // `/` is listed as the bare origin with its trailing slash; the rest append their path.
      const url = route === '/' ? `${ORIGIN}/` : `${ORIGIN}${route}`
      expect(llms, `${route} has a ROUTE_META entry and a prerendered page, but llms.txt never links it`)
        .toContain(`(${url})`)
    }
  })

  it('uses absolute URLs only', () => {
    // A crawler fetches this file on its own and has no base to resolve `/pricing` against.
    const links = [...llms.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1])
    expect(links.length).toBeGreaterThan(0)
    for (const href of links) {
      expect(href, `${href} is relative — llms.txt is read detached from the page it sits under`)
        .toMatch(/^https:\/\//)
    }
  })

  it('keeps the H1 and the blockquote summary the format expects', () => {
    const lines = llms.split('\n')
    expect(lines[0]).toBe('# TinyOrder')
    expect(lines.find(l => l.startsWith('>')), 'no `>` summary line').toBeDefined()
  })
})
