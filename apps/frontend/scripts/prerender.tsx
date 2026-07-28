// Bake the landing page into the HTML that serves it.
//
// WHY: the app ships one near-empty `<div id="root">` and builds every word in the browser. Google
// executes JavaScript and sees the finished page; most of the LLM crawlers do not, so to them the
// marketing page reads as a blank document with a title. This step renders the landing route to
// static markup at build time so the words are in the file.
//
// WHY TWO FILES: on Vercel the filesystem is checked BEFORE `rewrites`, so `/` is always served by
// `dist/index.html` and no rewrite can redirect it elsewhere. The prerendered page therefore has to
// BE index.html, and the empty shell every other route needs becomes `app.html` — which vercel.json
// rewrites to. That split is the whole point: baking landing markup into the file that also serves
// /s/<slug> would hand a crawler the marketing page as the content of every shop.
//
// The render is safe without a database or a backend because `renderToStaticMarkup` never runs
// effects: SessionProvider renders its initial state (nothing loaded yet, which is the same first
// paint a real visitor gets) and usePlatformPricing returns FALLBACK_PRICING. Nothing here talks to
// Supabase or Stripe, and the build stays offline.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { SessionProvider } from '../src/SessionContext'
import { TooltipProvider } from '../src/components/ui/tooltip'
import Landing from '../src/marketing/Landing'
import { landingStructuredData } from '../src/marketing/structuredData'

const dist = path.resolve(process.cwd(), 'dist')
const ROOT_DIV = '<div id="root"></div>'

const shell = readFileSync(path.join(dist, 'index.html'), 'utf8')
if (!shell.includes(ROOT_DIV)) {
  throw new Error(`prerender: ${ROOT_DIV} not found in dist/index.html — did the entry markup change?`)
}

// Every route except `/` keeps the empty shell, untouched.
writeFileSync(path.join(dist, 'app.html'), shell)

const markup = renderToStaticMarkup(
  // The same tree AppRouter builds for "/", minus the lazy() boundary: renderToStaticMarkup cannot
  // suspend, so Landing is imported directly here.
  <MemoryRouter initialEntries={['/']}>
    <SessionProvider>
      <TooltipProvider delay={200}>
        <Landing />
      </TooltipProvider>
    </SessionProvider>
  </MemoryRouter>,
)

// The scroll/stagger animations start at `opacity:0` and are revealed by JavaScript. In the
// prerendered file that would be text nobody can read without JS — including a reader with it
// switched off — so the starting state is opened up. It costs nothing at runtime: main.tsx uses
// createRoot, not hydrateRoot, so React discards this markup and re-renders from scratch (with the
// animations intact) the moment it boots.
const visible = markup.replace(/opacity:0(?=[;"])/g, 'opacity:1')

// The FAQ markup, which the landing route otherwise injects from an effect — so a crawler that does
// not run JavaScript gets it too. Safe in THIS file and not in app.html, which is exactly the
// distinction the two-file split buys. English, because that is what an unswitched page renders;
// the effect in structuredData.ts adopts this element and rewrites it if the visitor is reading
// Chinese.
const faqLd =
  `<script type="application/ld+json" data-structured-data="landing-faq">` +
  `${JSON.stringify(landingStructuredData('en'))}</script>`

writeFileSync(
  path.join(dist, 'index.html'),
  shell.replace(ROOT_DIV, `<div id="root">${visible}</div>`).replace('</head>', `${faqLd}\n  </head>`),
)

const kb = (s: string) => `${Math.round(Buffer.byteLength(s) / 1024)}kB`
console.log(`prerender: dist/index.html ${kb(shell)} → ${kb(visible)} of landing markup, dist/app.html left as the shell`)
