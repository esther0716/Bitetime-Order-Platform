// The site's public identity, as a URL.
//
// Not `window.location.origin`: this is what the site CLAIMS to be, which has to be one stable
// value that a Vercel preview deployment and a laptop both agree on. A preview that declared
// itself the site would be a second copy of it in an index.
//
// Three other places already hardcode this same host and cannot import it — index.html (the
// og:image tags and the identity JSON-LD) and public/sitemap.xml are static assets, not modules.
// Change the host and all four move together.
export const SITE_URL = 'https://tinyorder.shop'
