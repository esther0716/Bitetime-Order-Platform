import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// vercel.json is JSON: it cannot carry a comment, and Vercel REJECTS THE DEPLOYMENT for any key
// its schema does not know — which is how a `$comment` explaining the rule below failed a build
// rather than documenting it. So the rule is asserted here instead, where it can be stated in
// prose and still fail loudly.

const config = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
) as Record<string, unknown>

describe('vercel.json', () => {
  it('rewrites unmatched routes to the EMPTY shell, not the prerendered landing page', () => {
    // dist/index.html is the prerendered marketing page (scripts/prerender.tsx) and dist/app.html
    // is the empty SPA shell. Vercel checks the filesystem before rewrites, so `/` is served by
    // index.html and never reaches this rule; everything else does. Point it at index.html and
    // every storefront is served the marketing page's markup as its initial content.
    expect(config.rewrites).toEqual([{ source: '/(.*)', destination: '/app.html' }])
  })

  it('caches the hashed assets forever, and does not cache the HTML that names them', () => {
    // Vite fingerprints everything under /assets, so a changed file is a changed URL and this
    // cache can never serve a stale one. Without the rule the deployment hands out
    // `max-age=0, must-revalidate` for every chunk — a conditional request per file per visit,
    // which on a phone is a round trip each for the CSS, the entry chunk and every route chunk
    // already sitting in the cache.
    expect(config.headers).toEqual([
      {
        source: '/assets/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ])
    // The HTML is the file that names the hashes. Cache it and a deploy reaches nobody, so no
    // rule here may match it — `/assets/` is the whole of what is safe to freeze.
    const sources = (config.headers as { source: string }[]).map(h => h.source)
    expect(sources.some(s => /html|^\/\(\.\*\)$|^\/$/.test(s))).toBe(false)
  })

  it('carries only keys Vercel accepts — an unknown one fails the deployment, not the build', () => {
    expect(Object.keys(config).sort()).toEqual(['$schema', 'headers', 'rewrites'])
  })
})
