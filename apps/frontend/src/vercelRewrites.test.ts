import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { ROUTE_META } from './routeMeta'

// The join between routeMeta.ts, scripts/prerender.tsx and vercel.json — a rule no compiler can see
// and a browser cannot show you.
//
// Vercel checks the filesystem before `rewrites`, but it does NOT try `<path>.html` for an
// extensionless request unless `cleanUrls` is on. So a prerendered `dist/pricing.html` is NOT what
// answers `/pricing`: without an explicit rewrite the catch-all `/(.*)` → `/app.html` wins, and the
// route is served the empty shell. `/` is the one exception — it resolves to `index.html` as the
// directory index — which is exactly why the gap is easy to miss.
//
// The failure hides itself. The page still works in a browser, because React boots and renders the
// route client-side; only the SERVED BYTES differ. Those bytes are all a JS-less crawler ever gets,
// and shipping them empty defeats the whole prerender. This shipped once (#169, caught on a preview
// deploy) and is the reason this file exists.

interface VercelConfig {
  rewrites?: { source: string; destination: string }[]
}

const config: VercelConfig = JSON.parse(
  readFileSync(path.resolve(__dirname, '../vercel.json'), 'utf8'),
)

/** Prerendered routes that need a rewrite: every one except `/`, which the directory index covers. */
const needRewrite = Object.keys(ROUTE_META).filter(route => route !== '/')

describe('vercel.json rewrites', () => {
  it('sends every prerendered route to its own file', () => {
    for (const route of needRewrite) {
      const rule = config.rewrites?.find(r => r.source === route)
      expect(rule, `${route} has no rewrite — it would be served app.html, the empty shell`)
        .toBeDefined()
      expect(rule?.destination).toBe(`${route}.html`)
    }
  })

  it('keeps every one of them ABOVE the catch-all', () => {
    const rules = config.rewrites ?? []
    const catchAll = rules.findIndex(r => r.source === '/(.*)')
    expect(catchAll, 'no catch-all rewrite to app.html').toBeGreaterThanOrEqual(0)
    for (const route of needRewrite) {
      const at = rules.findIndex(r => r.source === route)
      expect(at, `${route} is below the catch-all, which matches first`).toBeLessThan(catchAll)
    }
  })

  it('still rewrites everything else to the shell', () => {
    const rules = config.rewrites ?? []
    expect(rules[rules.length - 1]).toEqual({ source: '/(.*)', destination: '/app.html' })
  })
})
