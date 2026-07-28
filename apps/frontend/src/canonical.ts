// The canonical URL of whatever route is showing.
//
// This CANNOT be a static tag in index.html. vercel.json rewrites every path to that one file,
// so a hardcoded `<link rel="canonical" href="https://tinyorder.shop/">` would tell Google that
// every storefront, every legal page and every dashboard route IS the marketing homepage — which
// is not a missing-tag problem, it is a de-index-every-shop problem. The tag has to name the URL
// the visitor actually asked for, so it is written at runtime, per route.
//
// This is exactly the reason `og:url` is still absent (see the comment in index.html) and must
// stay absent: link-preview scrapers do not run JavaScript, so a runtime og:url would be invisible
// to them, while Google renders the page and does see this one.

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * The URL a route should declare as its own.
 *
 * Query and hash are dropped: `?plan=pro&billing=yearly`, `?shop=<slug>` and a recovery link's
 * token are all the same page as the path without them, and a token in a canonical tag is a
 * token in Google's index. A trailing slash is dropped too, so `/s/mei/` and `/s/mei` cannot
 * be indexed as two pages — except at the root, where the slash IS the path.
 */
export function canonicalUrl(origin: string, pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return `${origin.replace(/\/+$/, '')}${path || '/'}`
}

/** Keeps a single `<link rel="canonical">` in `<head>` pointed at the current route. */
export function useCanonical(): void {
  const { pathname } = useLocation()
  useEffect(() => {
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'canonical'
      document.head.appendChild(link)
    }
    link.href = canonicalUrl(window.location.origin, pathname)
  }, [pathname])
}
