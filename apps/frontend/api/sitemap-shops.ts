// The shop sitemap function (#253): /sitemap-shops.xml, rewritten here by vercel.json. Active
// shops come from the backend's storefront index; the XML is the pure builder's.
//
// A failure is a 503, NEVER an empty 200 — a 200 with zero URLs tells Google every shop page
// is gone, which is the one lie this endpoint must not tell. (The hand-maintained
// public/sitemap.xml covers the platform's own pages; see its comment for why shops are not
// listed there.)
import { buildShopSitemap } from '../src/seo/shopSitemap'

export async function GET(request: Request): Promise<Response> {
  const api = process.env.VITE_API_URL
  const unavailable = () =>
    new Response('temporarily unavailable', { status: 503, headers: { 'Retry-After': '300' } })
  if (!api) return unavailable()

  try {
    const res = await fetch(`${api}/api/storefront-index`)
    if (!res.ok) return unavailable()
    const { shops } = (await res.json()) as { shops: { slug: string }[] }

    const url = new URL(request.url)
    const host = request.headers.get('x-forwarded-host') ?? url.host
    const proto = request.headers.get('x-forwarded-proto') ?? 'https'
    const xml = buildShopSitemap(`${proto}://${host}`, shops.map((s) => s.slug))
    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch {
    return unavailable()
  }
}
