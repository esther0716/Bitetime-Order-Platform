// The shop sitemap (#253): the second, function-served sitemap enumerating active shops, next
// to the hand-maintained public/sitemap.xml that lists the platform's own pages. The two lists
// have different owners and change rates — see the comment atop sitemap.xml for why shops were
// never listed there.
//
// The whole response is decided here, 503 included, so the one rule that matters is unit-pinned:
// a failure is a 503, NEVER an empty 200 — a 200 with zero URLs tells Google every shop page is
// gone. `null` means "could not ask"; an empty list is a real answer (no active shops).
//
// No <lastmod>: merchants carry no updated-at column, and a fabricated date is worse than none.
// (A recorded deviation from the spec — see ADR 0022.)

export interface ShopSitemapResponse {
  status: number
  headers: Record<string, string>
  body: string
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function buildShopSitemap(origin: string, slugs: string[] | null): ShopSitemapResponse {
  if (slugs === null) {
    return {
      status: 503,
      headers: { 'Retry-After': '300' },
      body: 'temporarily unavailable',
    }
  }
  const urls = slugs
    .map((slug) => `  <url>\n    <loc>${escapeXml(`${origin}/s/${slug}`)}</loc>\n  </url>`)
    .join('\n')
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...(urls ? [urls] : []),
    '</urlset>',
  ].join('\n') + '\n'
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
    body: xml,
  }
}
