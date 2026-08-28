// The storefront findability document (#253, ADR 0022).
//
// The pure half of the edge function that serves /s/:slug: given the SPA shell, the requested
// URL and a resolution of the slug, decide the served bytes. Everything a crawler reads is
// decided here — per-shop <title>, meta description, canonical, og: tags and LocalBusiness
// JSON-LD — so it is unit-testable without a network. The function around it stays a thin
// fetch-and-call shell that fails open to the untouched shell on any error.
//
// The body stays the shell: humans get exactly the app they got before, and only the head
// differs. That is the whole design — see the ADR for what was rejected and why.
import { menuCategoriesFromRow } from '@bitetime/shared'

export interface StorefrontShop {
  name: string
  slug: string
  status: string
  description?: string | null
  currency?: string | null
  pickup_address?: string | null
  product_categories?: unknown
}

export interface StorefrontProduct {
  name: string
  price: number
}

export type StorefrontResolution =
  | { kind: 'shop'; shop: StorefrontShop; products: StorefrontProduct[] }
  | { kind: 'moved'; movedTo: string }
  | { kind: 'not-found' }

export interface StorefrontRequest {
  /** Scheme + host, no trailing slash — e.g. https://tinyorder.shop */
  origin: string
  slug: string
  /** Anything after /s/<slug>/ — canonicalised onto the shop root, preserved on redirects. */
  subpath?: string
}

export interface StorefrontDocument {
  status: number
  headers: Record<string, string>
  body: string
}

/** How many products the JSON-LD offers — the shop's own sort order decides which lead. */
export const OFFER_CAP = 20

const CACHE = 'public, s-maxage=300, stale-while-revalidate=604800'
const HTML = 'text/html; charset=utf-8'

// Merchant-controlled text lands in head markup and must never break out of it. `'` stays
// unescaped on purpose: every attribute this module writes is double-quoted.
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Inside a <script> block the ONLY dangerous sequence is a closing tag; escaping every `<`
// (legal inside JSON strings) closes that without changing what JSON.parse reads.
const jsonForScriptTag = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

export function buildStorefrontDocument(
  shell: string,
  req: StorefrontRequest,
  resolution: StorefrontResolution,
): StorefrontDocument {
  if (resolution.kind === 'not-found') {
    return { status: 404, headers: { 'Content-Type': HTML, 'Cache-Control': CACHE }, body: shell }
  }

  if (resolution.kind === 'moved') {
    const sub = req.subpath ? `/${req.subpath}` : ''
    return {
      status: 301,
      headers: {
        Location: `${req.origin}/s/${encodeURIComponent(resolution.movedTo)}${sub}`,
        'Cache-Control': CACHE,
      },
      body: '',
    }
  }

  const { shop, products } = resolution
  const canonical = `${req.origin}/s/${encodeURIComponent(shop.slug)}`
  const title = `${shop.name} | TinyOrder`
  const description = shopDescription(shop)

  let body = shell
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(
      /<meta name="description" content="[^"]*" \/>/,
      `<meta name="description" content="${escapeHtml(description)}" />`,
    )
    .replace(
      /<meta property="og:title" content="[^"]*" \/>/,
      `<meta property="og:title" content="${escapeHtml(title)}" />`,
    )
    .replace(
      /<meta property="og:description" content="[^"]*" \/>/,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
    )

  const inject = [
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    ...(shop.status === 'active' ? [] : ['<meta name="robots" content="noindex" />']),
    `<script type="application/ld+json">${jsonForScriptTag(jsonLd(shop, products, canonical, description))}</script>`,
  ].join('\n    ')
  // A shell with no </head> is not a shell we understand — serve it untouched (fail open)
  // rather than guess where the tags belong.
  body = body.includes('</head>') ? body.replace('</head>', `    ${inject}\n  </head>`) : shell

  return { status: 200, headers: { 'Content-Type': HTML, 'Cache-Control': CACHE }, body }
}

function shopDescription(shop: StorefrontShop): string {
  const own = shop.description?.trim()
  if (own) return own
  const categories = menuCategoriesFromRow(shop.product_categories)
    .filter((c) => c.active)
    .map((c) => c.name)
    .slice(0, 4)
  const menu = categories.length ? ` ${categories.join(', ')}.` : ''
  return `Order online from ${shop.name}.${menu} Every order in one place, on TinyOrder.`
}

function jsonLd(
  shop: StorefrontShop,
  products: StorefrontProduct[],
  canonical: string,
  description: string,
) {
  const currency = shop.currency || 'MYR'
  const offers = products.slice(0, OFFER_CAP).map((p) => ({
    '@type': 'Offer',
    price: p.price,
    priceCurrency: currency,
    itemOffered: { '@type': 'Product', name: p.name },
  }))
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: shop.name,
    description,
    url: canonical,
    ...(shop.pickup_address ? { address: shop.pickup_address } : {}),
    ...(offers.length ? { makesOffer: offers } : {}),
  }
}
