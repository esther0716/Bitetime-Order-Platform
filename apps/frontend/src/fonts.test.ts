import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The join between src/index.css (@font-face), index.html (preload) and public/fonts/ (the files).
// Nothing type-checks it and nothing about the page LOOKS broken when it breaks: a woff2 that 404s
// makes the browser fall through to the next family in the stack, which is the metric-matched
// 'Poppins Fallback' — deliberately built to occupy the same space as the real face. The page keeps
// its layout, keeps its line breaks, and quietly renders in Arial. This is the check that notices.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const css = read('./index.css')
const html = read('../index.html')

const declared = [...css.matchAll(/url\('(\/fonts\/[^']+)'\)/g)].map(m => m[1])
const preloaded = [...html.matchAll(/<link rel="preload" as="font"[^>]*href="([^"]+)"[^>]*>/g)]
  .map(m => m[1])

describe('self-hosted webfonts', () => {
  it('declares faces at all — the @font-face rules are what make Poppins Poppins', () => {
    expect(declared.length).toBeGreaterThan(0)
  })

  it('ships every file it declares', () => {
    for (const href of declared) {
      const path = fileURLToPath(new URL(`../public${href}`, import.meta.url))
      expect(existsSync(path), `${href} is declared in index.css but not in public/fonts/`).toBe(true)
    }
  })

  it('preloads only faces it also declares', () => {
    // A preload for a URL no rule ever asks for is a file downloaded at High priority and then
    // dropped unused — the exact opposite of the point, on the connection that can least afford it.
    // Chrome says so in the console; nobody reads the console of a production build.
    expect(preloaded.length).toBeGreaterThan(0)
    for (const href of preloaded) {
      expect(declared, `${href} is preloaded but no @font-face uses it`).toContain(href)
    }
  })

  it('preloads them crossorigin', () => {
    // Fonts are fetched in CORS mode even same-origin. A preload without `crossorigin` is a
    // DIFFERENT cache entry from the request the font rule makes, so the file is fetched twice and
    // the second fetch is the one that counts — a pure regression dressed as an optimisation.
    const tags = html.match(/<link rel="preload" as="font"[^>]*>/g) ?? []
    for (const tag of tags) expect(tag, tag).toContain('crossorigin')
  })

  it('asks the browser for no font stylesheet on a third-party origin', () => {
    // The whole reason the files are here. fonts.googleapis.com's stylesheet is render-blocking on
    // a cold origin — measured at 793ms of a 2.75s mobile FCP for 1KB of CSS — and the woff2 it
    // names is a second cold origin one trip further down. Both are off the critical path now, and
    // a `<link rel=stylesheet>` back to Google would put them there again without changing how the
    // page looks. src/cjkFont.ts is the one deliberate exception and injects its link at runtime,
    // only for a visitor actually reading Chinese, so it is not in this file.
    expect(html).not.toMatch(/<link[^>]+fonts\.(googleapis|gstatic)\.com/)
  })
})
