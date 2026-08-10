// The canonical URL of whatever route is showing.
//
// This CANNOT be a static tag in index.html. vercel.json rewrites every path to that one file,
// so a hardcoded `<link rel="canonical" href="https://tinyorder.shop/">` would tell Google that
// every storefront, every legal page and every dashboard route IS the marketing homepage — which
// is not a missing-tag problem, it is a de-index-every-shop problem. The tag has to name the URL
// the visitor actually asked for, so it is written at runtime, per route.
//
// This is the reason `og:url` is absent from index.html (see the comment there): link-preview
// scrapers do not run JavaScript, so a runtime og:url would be invisible to them, while Google
// renders the page and does see this one. The homepage is the exception and carries both tags
// statically — scripts/prerender.tsx writes them into the copy of index.html that only `/` is
// served from — and this effect ADOPTS that canonical rather than adding a second.

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Route bases whose trailing path segments PRESELECT something rather than address another page.
 *
 * `/merchant/signup/pro/yearly` is the signup form with a different plan highlighted — the same
 * page as `/merchant/signup`, not a fourth one. Left alone, the landing page's four pricing CTAs
 * would offer search engines four URLs for one form, which compete with each other and split
 * whatever authority the page has, and only one of which is in sitemap.xml.
 *
 * Why the selection is in the path at all: a `?plan=basic&billing=monthly` href is what a link
 * auditor — and a human reading a URL out loud — scores as unfriendly. The query form still works
 * (SignupScreen accepts either), which is what keeps Stripe's `cancel_url` and any link already
 * sitting in an inbox pointing somewhere real.
 */
export const PRESELECTION_ROUTES = ['/merchant/signup']

/** The path a route should be indexed under: itself, unless it is a preselection of another. */
export function canonicalPath(pathname: string): string {
  return (
    PRESELECTION_ROUTES.find(base => pathname === base || pathname.startsWith(`${base}/`)) ??
    pathname
  )
}

/**
 * The URL a route should declare as its own.
 *
 * Query and hash are dropped: `?ref=<code>`, `?shop=<slug>` and a recovery link's token are all
 * the same page as the path without them, and a token in a canonical tag is a token in Google's
 * index. A trailing slash is dropped too, so `/s/mei/` and `/s/mei` cannot be indexed as two
 * pages — except at the root, where the slash IS the path.
 */
export function canonicalUrl(origin: string, pathname: string): string {
  const collapsed = canonicalPath(pathname)
  const path = collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed
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
