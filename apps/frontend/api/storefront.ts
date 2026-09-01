// The storefront edge function (#253, ADR 0022): serves /s/:slug (and subpaths) by injecting a
// per-shop head into THIS deploy's SPA shell. vercel.json rewrites the storefront paths here;
// the shell is fetched from our own origin, so it can never drift from the deploy that serves
// it. Every decision about the served bytes lives in the pure builder — this file only fetches.
//
// FAIL-OPEN IS THE CONTRACT: any error — backend down, shell unfetchable, bad config — must end
// in the untouched shell with today's behaviour, never a broken storefront. The cost is that
// total breakage is invisible in a browser; the seo-canary script and the rewrite pin test are
// the detection (see the spec's Testing Decisions).
import {
  buildStorefrontDocument,
  type StorefrontResolution,
  type StorefrontShop,
  type StorefrontProduct,
} from '../src/seo/storefrontDocument.js'
import { requestOrigin, backendUrl } from '../src/seo/edge.js'

// One in-flight shell fetch per warm function instance; cleared on failure so a blip does not
// pin an error for the instance's lifetime.
let shellPromise: Promise<string> | null = null
function getShell(origin: string): Promise<string> {
  shellPromise ??= fetch(`${origin}/app.html`).then((r) => {
    if (!r.ok) throw new Error(`shell fetch: ${r.status}`)
    return r.text()
  })
  return shellPromise.catch((e) => {
    shellPromise = null
    throw e
  })
}

// Not the backend's resolveSlug (which INVENTS a slug for a new shop) — this one asks what an
// existing slug currently names: a shop, a redirect, or nothing.
async function resolveShop(api: string, slug: string): Promise<StorefrontResolution> {
  const res = await fetch(`${api}/api/merchants/${encodeURIComponent(slug)}`)
  if (!res.ok) throw new Error(`merchant lookup: ${res.status}`)
  const row = (await res.json()) as
    | (StorefrontShop & { id: string })
    | { moved_to: string }
    | null
  if (!row) return { kind: 'not-found' }
  if ('moved_to' in row) return { kind: 'moved', movedTo: row.moved_to }
  // Products feed the JSON-LD offers only — a failed read costs the offers, not the page.
  let products: StorefrontProduct[] = []
  try {
    const p = await fetch(`${api}/api/merchants/${row.id}/products`)
    if (p.ok) products = (await p.json()) as StorefrontProduct[]
  } catch {
    products = []
  }
  return { kind: 'shop', shop: row, products }
}

export async function GET(request: Request): Promise<Response> {
  const origin = requestOrigin(request)
  const url = new URL(request.url)
  const slug = (url.searchParams.get('slug') ?? '').trim().toLowerCase()
  const subpath = url.searchParams.get('subpath') ?? undefined

  let shell: string
  try {
    shell = await getShell(origin)
  } catch {
    // No shell means nothing to fail open INTO. A plain 503 with retry beats serving nothing;
    // in practice a same-origin static fetch failing while this function runs means the
    // deployment itself is unhealthy.
    return new Response('temporarily unavailable', { status: 503, headers: { 'Retry-After': '30' } })
  }

  const failOpen = () =>
    new Response(shell, {
      status: 200,
      // no-store: a backend blip must not pin the headless shell at the CDN for five minutes.
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })

  const api = backendUrl()
  if (!api || !slug) return failOpen()

  try {
    const resolution = await resolveShop(api, slug)
    const doc = buildStorefrontDocument(shell, { origin, slug, subpath }, resolution)
    return new Response(doc.body || null, { status: doc.status, headers: doc.headers })
  } catch {
    return failOpen()
  }
}
