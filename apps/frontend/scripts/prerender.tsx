// Bake the marketing pages into the HTML files that serve them.
//
// WHY: the app ships one near-empty `<div id="root">` and builds every word in the browser. Google
// executes JavaScript and sees the finished page; most of the LLM crawlers do not, so to them a
// marketing page reads as a blank document with a title. This step renders each marketing route to
// static markup at build time so the words are in the file.
//
// WHY A FILE PER ROUTE: the empty shell every non-prerendered route needs is `app.html`, which
// vercel.json rewrites everything to. Baking landing markup into a file that also serves /s/<slug>
// would hand a crawler the marketing page as the content of every shop, so each prerendered route
// gets a file nothing else is served from.
//
// AND EACH ONE NEEDS ITS OWN REWRITE. Vercel checks the filesystem before `rewrites`, but it does
// NOT try `<path>.html` for an extensionless request unless `cleanUrls` is on — so `/pricing` does
// not find `pricing.html` on its own, and the catch-all `/(.*)` → `/app.html` swallows it. `/` is
// the exception, and the reason this is easy to get wrong: it resolves to `index.html` as the
// directory index, before any rewrite. Everything else needs an explicit
// `{ source: '/x', destination: '/x.html' }` ABOVE the catch-all in apps/frontend/vercel.json.
// vercelRewrites.test.ts fails the build if one is missing.
//
// The symptom when it IS missing hides itself: the route still works in a browser, because React
// boots and renders it client-side. Only the served bytes differ — which is all a JS-less crawler
// ever sees, and the entire reason this file exists.
//
// WHY MORE THAN ONE ROUTE (#169): a sitelink's label is the target page's `<title>` and its snippet
// is that page's meta description, so a site served entirely out of one shell offers Google exactly
// one candidate. Adding a marketing page means adding it HERE, to AppRouter, to routeMeta.ts and to
// vercel.json's rewrites.
//
// The render is safe without a database or a backend because `renderToStaticMarkup` never runs
// effects: SessionProvider renders its initial state (nothing loaded yet, which is the same first
// paint a real visitor gets) and usePlatformPricing returns FALLBACK_PRICING. Nothing here talks to
// Supabase or Stripe, and the build stays offline.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { SessionProvider } from '../src/SessionContext'
import { TooltipProvider } from '../src/components/ui/tooltip'
import Landing from '../src/marketing/Landing'
import Pricing from '../src/marketing/Pricing'
import FeaturesPage from '../src/marketing/FeaturesPage'
import FaqPage from '../src/marketing/FaqPage'
import UseCasePage from '../src/marketing/UseCasePage'
import { USE_CASES, pathForUseCase } from '../src/marketing/useCases'
import SampleShopsPage from '../src/marketing/SampleShopsPage'
import SignupScreen from '../src/merchant/SignupScreen'
import LoginScreen from '../src/merchant/LoginScreen'
import TermsPage from '../src/legal/TermsPage'
import PrivacyPage from '../src/legal/PrivacyPage'
import { faqStructuredData, faqStructuredDataForUseCase } from '../src/marketing/structuredData'
import { ROUTE_META } from '../src/routeMeta'
import { SITE_URL } from '../src/site'

const dist = path.resolve(process.cwd(), 'dist')
const ROOT_DIV = '<div id="root"></div>'

interface PrerenderRoute {
  /** The path Vercel will serve the file at, and the ROUTE_META key. */
  path: string
  /** The file to write under dist/. `/` must be index.html — see the note above. */
  file: string
  element: ReactElement
  /**
   * Extra `<head>` markup this route owns. The FAQ block belongs to `/faq` alone: index.html is
   * one of several files served for exactly one path each, and a FAQPage claiming to describe
   * /pricing — or a storefront — is the same mistake as a hardcoded canonical tag. See
   * structuredData.ts.
   */
  head?: string
}

// The FAQ markup the /faq route otherwise injects from an effect, so a crawler that does not run
// JavaScript gets it too. English, because that is what an unswitched page renders; the effect in
// structuredData.ts adopts this element and rewrites it if the visitor is reading Chinese.
const faqLd =
  `<script type="application/ld+json" data-structured-data="faq">` +
  `${JSON.stringify(faqStructuredData('en'))}</script>`

// The guarded and lazy() wrappers AppRouter puts around some of these are dropped on purpose, the
// same way the Routes switch is: RedirectSignedInMerchant reads a session that does not exist in a
// build, and Suspense cannot resolve here. What renders is the signed-out first paint, which is
// the only state a crawler can ever be in.
const ROUTES: PrerenderRoute[] = [
  { path: '/', file: 'index.html', element: <Landing /> },
  { path: '/pricing', file: 'pricing.html', element: <Pricing /> },
  { path: '/features', file: 'features.html', element: <FeaturesPage /> },
  { path: '/faq', file: 'faq.html', element: <FaqPage />, head: faqLd },
  // The business-type pages, one file each under dist/for/. Their questions are baked in the same
  // way and for the same reason as /faq's — English, rewritten by the effect for a Chinese reader —
  // and each one carries its own @id, so four pages are four pages to a crawler (#214).
  ...USE_CASES.map(useCase => ({
    path: pathForUseCase(useCase.slug),
    // `<route path>.html`, derived from the same helper the route is: vercelRewrites.test.ts pins
    // the rewrite destination to exactly that, so a second spelling of `/for/` here is a file
    // Vercel rewrites to and cannot find.
    file: `${pathForUseCase(useCase.slug).replace(/^\//, '')}.html`,
    element: <UseCasePage useCase={useCase} />,
    head:
      `<script type="application/ld+json" data-structured-data="faq">` +
      `${JSON.stringify(faqStructuredDataForUseCase(useCase, 'en'))}</script>`,
  })),
  // The shop list this page is named after is NOT in the bytes and cannot be: useSampleShops reads
  // it in an effect, which never runs here, and reading the database at build time would make a
  // build that cannot reach it ship a page saying there are no shops. So the carousel slot renders
  // empty (`loading` starts true, which is also what a real visitor's first paint shows) and what
  // bakes is the heading, the intro line, the nav and the footer.
  { path: '/sample-shops', file: 'sample-shops.html', element: <SampleShopsPage /> },
  // Not marketing pages, and prerendered for a narrower reason than the four above: they are in
  // sitemap.xml, so they get crawled, and app.html would hand each of them the HOMEPAGE's title,
  // description and (being the shell) no canonical at all. Bare `/merchant/signup` only — the
  // plan/cycle segments are a preselection of this same page, collapsed by canonicalPath.
  { path: '/merchant/signup', file: 'merchant/signup.html', element: <SignupScreen /> },
  { path: '/merchant/login', file: 'merchant/login.html', element: <LoginScreen /> },
  { path: '/terms', file: 'terms.html', element: <TermsPage /> },
  { path: '/privacy', file: 'privacy.html', element: <PrivacyPage /> },
]

const shell = readFileSync(path.join(dist, 'index.html'), 'utf8')
if (!shell.includes(ROOT_DIV)) {
  throw new Error(`prerender: ${ROOT_DIV} not found in dist/index.html — did the entry markup change?`)
}

// Every route not listed above keeps the empty shell, untouched.
writeFileSync(path.join(dist, 'app.html'), shell)

/** Attribute-safe. Titles and descriptions are ours, but an unescaped quote would break the tag. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Replace the shell's `<title>`, or fail loudly rather than ship a page titled as the homepage.
 *
 * Tests the pattern rather than comparing before and after: the homepage's own entry is the shell's
 * title verbatim (routeMeta.test.ts pins them together), so a changed-or-not check would call the
 * one route that is always correct a build failure. */
function withTitle(html: string, title: string): string {
  const tag = /<title>[\s\S]*?<\/title>/
  if (!tag.test(html)) throw new Error('prerender: no <title> in the shell to replace')
  return html.replace(tag, `<title>${escapeHtml(title)}</title>`)
}

/** Same for the meta description, which is what a sitelink's snippet is drawn from. */
function withDescription(html: string, description: string): string {
  const tag = /<meta name="description" content="[\s\S]*?"\s*\/?>/
  if (!tag.test(html)) throw new Error('prerender: no <meta name="description"> in the shell to replace')
  return html.replace(tag, `<meta name="description" content="${escapeHtml(description)}" />`)
}

const kb = (s: string) => `${Math.round(Buffer.byteLength(s) / 1024)}kB`

for (const route of ROUTES) {
  const meta = ROUTE_META[route.path]
  if (!meta) throw new Error(`prerender: ${route.path} has no ROUTE_META entry to title it`)

  const markup = renderToStaticMarkup(
    // The same tree AppRouter builds for this path, minus the lazy() boundary and the Routes
    // switch: renderToStaticMarkup cannot suspend, so the page component is imported directly.
    <MemoryRouter initialEntries={[route.path]}>
      <SessionProvider>
        <TooltipProvider delay={200}>{route.element}</TooltipProvider>
      </SessionProvider>
    </MemoryRouter>,
  )

  // The scroll/stagger animations start at `opacity:0` and are revealed by JavaScript. In a
  // prerendered file that would be text nobody can read without JS — including a reader with it
  // switched off — so the starting state is opened up. It costs nothing at runtime: main.tsx uses
  // createRoot, not hydrateRoot, so React discards this markup and re-renders from scratch (with
  // the animations intact) the moment it boots.
  const visible = markup.replace(/opacity:0(?=[;"])/g, 'opacity:1')

  // The two head tags index.html cannot carry and these files can.
  //
  // Both are absent from index.html for the same stated reason: that file is the shell every
  // non-prerendered path is served from (as app.html), so a hardcoded URL in either would name the
  // homepage on a storefront. THESE files are served for exactly one path each — `/` as the
  // directory index, the rest through their own rewrite — which makes a per-route URL true here.
  //
  // `canonical` is otherwise written by an effect (src/canonical.ts), which Google runs and an LLM
  // crawler does not; useCanonical ADOPTS this element rather than appending a second, and rewrites
  // the href to the serving origin, so a preview deployment still declares itself and not
  // production. `og:url` had no runtime writer at all and could not have one that worked:
  // link-preview scrapers execute no JavaScript, which is the whole argument in index.html for
  // leaving it out. Prerendering is what removes that argument for these routes.
  const url = `${SITE_URL}${route.path}`
  const routeHead =
    `<link rel="canonical" href="${url}">\n    ` +
    `<meta property="og:url" content="${url}">` +
    (route.head ? `\n    ${route.head}` : '')

  const html = withDescription(withTitle(shell, meta.title), meta.description)
    .replace(ROOT_DIV, `<div id="root">${visible}</div>`)
    .replace('</head>', `${routeHead}\n  </head>`)

  // A route with a path segment in it writes into a subdirectory Vite never created — `dist/for/`
  // and `dist/merchant/` both. Without this the build throws ENOENT, which is the safe failure;
  // serving a path Vercel rewrites to a missing file would not be.
  const out = path.join(dist, route.file)
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, html)
  console.log(`prerender: dist/${route.file} ← ${route.path}, ${kb(visible)} of markup`)
}

console.log(`prerender: dist/app.html left as the ${kb(shell)} shell`)
