// The shop sitemap function (#253): /sitemap-shops.xml, rewritten here by vercel.json. Active
// shops come from the backend's storefront index; the whole response — the XML, the caching,
// and the 503-never-empty-200 rule — is the pure builder's. This file only fetches.
import { buildShopSitemap } from '../src/seo/shopSitemap'
import { requestOrigin, backendUrl } from '../src/seo/edge'

export async function GET(request: Request): Promise<Response> {
  const api = backendUrl()
  let slugs: string[] | null = null
  if (api) {
    try {
      const res = await fetch(`${api}/api/storefront-index`)
      if (res.ok) {
        const { shops } = (await res.json()) as { shops: { slug: string }[] }
        slugs = shops.map((s) => s.slug)
      }
    } catch {
      slugs = null
    }
  }
  const doc = buildShopSitemap(requestOrigin(request), slugs)
  return new Response(doc.body, { status: doc.status, headers: doc.headers })
}
