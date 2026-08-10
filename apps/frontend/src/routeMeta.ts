// The `<title>` and `<meta name="description">` of each page that has its own.
//
// ONE table, read by TWO consumers that must agree: scripts/prerender.tsx bakes these into the
// per-route HTML file the crawler downloads, and useDocumentMeta writes the same strings when a
// visitor reaches the route by clicking a link instead of loading the URL. A page whose baked title
// and clicked title disagree is a page Google and the person reading it see differently.
//
// WHY IT MATTERS BEYOND TIDINESS: a sitelink's LABEL is the target page's <title> and its snippet
// is that page's meta description. Every route served out of one shell shares index.html's
// homepage title, which is exactly one candidate label for the whole site — see issue #169.
//
// The entry for '/' must stay character-identical to the static tags in index.html: that file is
// the shell every other route is served from, so it is the fallback title for everything not listed
// here, and the two drifting apart would silently retitle the homepage on the next build.
// routeMeta.test.ts asserts the match.

import { USE_CASES, pathForUseCase } from './marketing/useCases'

export interface RouteMeta {
  /** Page title. Ends with the brand, because a sitelink label is read out of context. */
  title: string
  /** The sitelink snippet. Under ~155 characters or Google truncates it mid-sentence. */
  description: string
}

/**
 * Keyed by the path the route is served at — the same string prerender writes a file for and
 * `useDocumentMeta` looks itself up by. Not every route belongs here: a page with no distinct
 * title (a dashboard, a storefront, whose title is per-shop and not build-time knowable) keeps
 * index.html's and is deliberately absent.
 */
export const ROUTE_META: Record<string, RouteMeta> = {
  '/': {
    title: 'TinyOrder — Start Your Own Food Shop, Orders in One Place',
    description:
      'Start your own food shop online and keep every order in one place. TinyOrder takes orders for home kitchens, bakers, makers and small sellers. Free 7 days.',
  },
  '/pricing': {
    title: 'Pricing — Basic and Pro Plans for Your Shop | TinyOrder',
    description:
      'Simple monthly pricing with no commission on your orders. Compare Basic and Pro, see what each plan includes, and start free for 7 days without a card.',
  },
  '/features': {
    title: 'Features — Everything Your Shop Needs | TinyOrder',
    description:
      'A shop page you control, delivery fees that match how you deliver, numbered orders, instant alerts and a customer list that builds itself. See it all.',
  },
  '/faq': {
    title: 'FAQ — Answers for Shop Owners | TinyOrder',
    description:
      'What TinyOrder costs, how the free trial works, how customers pay you, and what Pro adds. The questions shop owners ask us before they sign up.',
  },
  // The four business-type pages, spread in from the module that holds their copy. Written there
  // rather than here because a page's title and its first paragraph are one piece of writing, and
  // splitting them across two files is how they drift. Everything this table's consumers need is
  // still here: prerender.tsx, useDocumentMeta, vercelRewrites.test.ts and llmsTxt.test.ts all read
  // ROUTE_META and none of them can tell the difference.
  ...Object.fromEntries(USE_CASES.map(useCase => [pathForUseCase(useCase.slug), useCase.meta])),
}
