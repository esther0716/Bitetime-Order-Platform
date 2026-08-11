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
    title: 'Pricing — One Plan, Everything Included | TinyOrder',
    description:
      'Simple monthly pricing with no commission on your orders. See everything the plan includes, and start free for 7 days without a card.',
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
  // The one prerendered page whose MAIN CONTENT cannot be baked: the shop list is read from the
  // database in the browser, and a build must never reach for it (a build that cannot would ship a
  // page stating there are no shops). What bakes is the heading, the intro line and the chrome —
  // thin, and still strictly more than app.html's homepage title with no canonical under it.
  '/sample-shops': {
    title: 'Sample Shops — Real Storefronts Built on TinyOrder',
    description:
      'See real shops that take orders with TinyOrder. Open their storefront pages to know what yours can look like before you open one of your own.',
  },
  // The two app pages sitemap.xml lists. They are not marketing pages, and they are here for a
  // narrower reason: a crawler that reaches them gets the file it is served, and without an entry
  // that file is app.html — whose title and description are the homepage's. Four sitemap URLs all
  // claiming to BE the homepage is the #169 failure again, on the routes prerendering did not
  // cover. Only `/merchant/signup` bare: the plan and cycle segments are one page (canonicalPath).
  '/merchant/signup': {
    title: 'Sign Up — Start Your Food Shop Free | TinyOrder',
    description:
      'Create your shop page in minutes. No card for the 7-day trial and no commission on your orders. Pick a plan and start taking orders today.',
  },
  '/merchant/login': {
    title: 'Log In to Your Shop Dashboard | TinyOrder',
    description:
      'Sign in to TinyOrder to read the orders that came in, change your menu and manage your shop page. Forgot your password? Reset it from here.',
  },
  // The legal documents. Public, linked from every footer, and reachable while a shop is
  // suspended — see the routes in AppRouter.tsx.
  '/terms': {
    title: 'Terms of Service | TinyOrder',
    description:
      'The terms for using TinyOrder to run your shop: your account, who sells to your customers, payment, refunds and how either side can end the service.',
  },
  '/privacy': {
    title: 'Privacy Policy | TinyOrder',
    description:
      'What TinyOrder holds about shop owners and their customers, why we hold it, who can read it, and how to ask us to delete it. Written in plain English.',
  },
  // The four business-type pages, spread in from the module that holds their copy. Written there
  // rather than here because a page's title and its first paragraph are one piece of writing, and
  // splitting them across two files is how they drift. Everything this table's consumers need is
  // still here: prerender.tsx, useDocumentMeta, vercelRewrites.test.ts and llmsTxt.test.ts all read
  // ROUTE_META and none of them can tell the difference.
  ...Object.fromEntries(USE_CASES.map(useCase => [pathForUseCase(useCase.slug), useCase.meta])),
}
