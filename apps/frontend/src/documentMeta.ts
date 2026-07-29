// The `<title>` / `<meta name="description">` of whatever route is showing, at runtime.
//
// Same problem and same shape as canonical.ts, and mounted in the same place — once, in AppRouter,
// beside useCanonical. vercel.json serves one shell for every path, so the tags baked into that
// file are true of the homepage and of nothing else. The build now writes a per-route file for the
// routes in ROUTE_META (scripts/prerender.tsx), which covers the crawler and the cold load; this
// hook covers the OTHER arrival, a visitor who clicked a link and whose document is whichever file
// they happened to land on first.
//
// FALLING BACK TO THE SERVED DOCUMENT'S OWN TAGS is the part that is easy to leave out and wrong
// to. Nothing else in the app sets a title, so a route with no entry of its own must be given the
// shell's back — otherwise a visitor who reads /pricing and then opens a shop is looking at a tab
// that still says "Pricing", and their history and any bookmark record it that way too.

import { useEffect } from 'react'
import { ROUTE_META, type RouteMeta } from './routeMeta'

/** The tags as the served document had them, captured before this hook first overwrites them. */
let shellMeta: RouteMeta | null = null

function descriptionTag(): HTMLMetaElement {
  let tag = document.head.querySelector<HTMLMetaElement>('meta[name="description"]')
  if (!tag) {
    tag = document.createElement('meta')
    tag.name = 'description'
    document.head.appendChild(tag)
  }
  return tag
}

/**
 * Keeps the document's title and description matching the route being shown.
 *
 * The fallback is the SERVED document's own tags, snapshotted on first run, not ROUTE_META['/'] —
 * because the file this tab was served may be `pricing.html`, where restoring the homepage's tags
 * would be a different wrong answer rather than the absence of one.
 */
export function useDocumentMeta(pathname: string): void {
  useEffect(() => {
    shellMeta ??= { title: document.title, description: descriptionTag().content }
    const meta = ROUTE_META[pathname] ?? shellMeta
    document.title = meta.title
    descriptionTag().content = meta.description
  }, [pathname])
}
