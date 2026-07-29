import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { ROUTE_META } from './routeMeta'

// ROUTE_META has two consumers that must agree with a THIRD thing neither of them imports:
// index.html, whose static <title> and description are the shell's — and therefore the fallback
// for every route without an entry here. These tests are the join.
//
// Nothing here renders anything. The failure they exist to catch is silent: an edit to index.html's
// title that leaves ROUTE_META['/'] behind retitles the homepage on the next build, because
// prerender.tsx writes ROUTE_META's copy over it and neither file mentions the other.

const shell = readFileSync(path.resolve(__dirname, '../index.html'), 'utf8')

describe('ROUTE_META', () => {
  it('titles the homepage exactly as index.html does', () => {
    const title = shell.match(/<title>([\s\S]*?)<\/title>/)?.[1]
    expect(title, 'no <title> in index.html').toBeTruthy()
    expect(ROUTE_META['/'].title).toBe(title)
  })

  it('describes the homepage exactly as index.html does', () => {
    const description = shell.match(/<meta name="description" content="([\s\S]*?)"\s*\/?>/)?.[1]
    expect(description, 'no <meta name="description"> in index.html').toBeTruthy()
    expect(ROUTE_META['/'].description).toBe(description)
  })

  // prerender.tsx replaces these two tags by regex. A shape it cannot match is a build that either
  // throws or — worse, if the guards were ever loosened — ships every page titled as the homepage.
  it('leaves index.html carrying the two tags prerender rewrites', () => {
    expect(shell).toMatch(/<title>[\s\S]*?<\/title>/)
    expect(shell).toMatch(/<meta name="description" content="[\s\S]*?"\s*\/?>/)
  })

  it('gives every route a title and a description', () => {
    for (const [route, meta] of Object.entries(ROUTE_META)) {
      expect(meta.title.trim(), `${route} title`).not.toBe('')
      expect(meta.description.trim(), `${route} description`).not.toBe('')
    }
  })

  // Not a style rule. Google truncates a snippet past roughly this length mid-sentence, and a
  // sitelink description that stops at a comma reads as a broken page.
  it('keeps every description short enough to be shown whole', () => {
    for (const [route, meta] of Object.entries(ROUTE_META)) {
      expect(meta.description.length, `${route} description is ${meta.description.length} chars`)
        .toBeLessThanOrEqual(160)
    }
  })

  // The label a sitelink is drawn from. Past ~60 characters Google shortens it, and what it drops
  // is the end — which is where the brand name is.
  it('keeps every title short enough to be shown whole', () => {
    for (const [route, meta] of Object.entries(ROUTE_META)) {
      expect(meta.title.length, `${route} title is ${meta.title.length} chars`)
        .toBeLessThanOrEqual(65)
    }
  })

  it('gives no two routes the same title — a duplicate is one sitelink candidate, not two', () => {
    const titles = Object.values(ROUTE_META).map(m => m.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('keys every route on a path starting with /', () => {
    for (const route of Object.keys(ROUTE_META)) {
      expect(route.startsWith('/'), `${route} is not a path`).toBe(true)
    }
  })
})
