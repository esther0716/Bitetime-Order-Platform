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
    // is the empty SPA shell. `/` is served by index.html as the directory index and never reaches
    // this rule; everything without a rule of its own does. Point it at index.html and every
    // storefront is served the marketing page's markup as its initial content.
    //
    // The rules ABOVE it are the other prerendered routes, which each need one — Vercel does not
    // try `<path>.html` for an extensionless request unless `cleanUrls` is on, so without a rule
    // this catch-all serves /pricing the shell. That pairing is asserted against routeMeta.ts in
    // vercelRewrites.test.ts; here we only pin the last rule and its destination.
    const rewrites = config.rewrites as { source: string; destination: string }[]
    expect(rewrites[rewrites.length - 1]).toEqual({ source: '/(.*)', destination: '/app.html' })
    expect(rewrites.filter(r => r.destination === '/app.html')).toHaveLength(1)
  })

  it('caches the hashed assets forever, and does not cache the HTML that names them', () => {
    // Vite fingerprints everything under /assets, so a changed file is a changed URL and this
    // cache can never serve a stale one. Without the rule the deployment hands out
    // `max-age=0, must-revalidate` for every chunk — a conditional request per file per visit,
    // which on a phone is a round trip each for the CSS, the entry chunk and every route chunk
    // already sitting in the cache.
    //
    // `/fonts/` is the SAME rule for files Vite does NOT fingerprint. The self-hosted Poppins
    // woff2s live in `public/`, which Vite copies verbatim, so they reach the deployment with the
    // names src/index.css and the index.html preloads spell out — and without a rule of their own
    // they would be revalidated on every visit, which is exactly the round trip the preload exists
    // to remove. Their names carry family, weight and subset but no content hash, so THE FILES ARE
    // IMMUTABLE BY CONVENTION: replacing a face means giving it a new file name, not overwriting
    // one that visitors have frozen for a year.
    //
    // `/images/` is the third of the same kind, and carries the same obligation. The landing
    // page's three "How it works" screenshots live in `public/images/steps/` under plain names
    // with no content hash, so RE-SHOOTING ONE MEANS RENAMING IT. They are lazy and below the
    // fold, which is exactly the case a per-visit conditional request is pure waste for.
    expect(config.headers).toEqual([
      {
        source: '/assets/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/fonts/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/images/(.*)',
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
