// The storefront findability canary (#253). The edge function FAILS OPEN — a broken function
// serves plain shells and every browser still works — so total breakage is invisible except to
// crawlers. This script is the runtime detection: fetch one shop's storefront and assert the
// served bytes carry an injected head, not the shell's default title.
//
//   FRONTEND_URL=https://tinyorder.shop CANARY_SLUG=<an active shop> \
//     pnpm --filter @bitetime/frontend seo:canary
//
// Run it after a deploy, against any active shop. Exit 0: injected head served. Exit 1: the
// shell's default title came back (fail-open is eating an error) or the fetch itself failed.

const base = (process.env.FRONTEND_URL ?? '').replace(/\/$/, '')
const slug = process.env.CANARY_SLUG ?? ''

if (!base || !slug) {
  console.error('seo-canary: set FRONTEND_URL and CANARY_SLUG (an active shop slug)')
  process.exit(1)
}

const url = `${base}/s/${slug}`
const res = await fetch(url, { redirect: 'follow' })
if (!res.ok) {
  console.error(`seo-canary: ${url} answered ${res.status}`)
  process.exit(1)
}
const html = await res.text()
const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''

if (!title.endsWith('| TinyOrder')) {
  console.error(`seo-canary: served title is "${title}" — the shell default, not an injected shop head.`)
  console.error('seo-canary: the storefront function is failing open. Check VITE_API_URL and the backend.')
  process.exit(1)
}
console.log(`seo-canary: ok — "${title}" served at ${url}`)
