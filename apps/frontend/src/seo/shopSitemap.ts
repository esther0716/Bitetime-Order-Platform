// The shop sitemap (#253): the second, function-served sitemap enumerating active shops, next
// to the hand-maintained public/sitemap.xml that lists the platform's own pages. The two lists
// have different owners and change rates — see the comment atop sitemap.xml for why shops were
// never listed there.
//
// No <lastmod>: merchants carry no updated-at column, and a fabricated date is worse than none.

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function buildShopSitemap(origin: string, slugs: string[]): string {
  const urls = slugs
    .map((slug) => `  <url>\n    <loc>${escapeXml(`${origin}/s/${slug}`)}</loc>\n  </url>`)
    .join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...(urls ? [urls] : []),
    '</urlset>',
  ].join('\n') + '\n'
}
