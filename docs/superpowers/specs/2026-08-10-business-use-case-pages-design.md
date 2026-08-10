# Business use-case pages — design

Issue: [#214](https://github.com/leongcheefai/Bitetime-Order-Platform/issues/214)
Date: 2026-08-10

## Problem

The marketing site answers "what is TinyOrder" (`/`), "what does it do" (`/features`), "what does
it cost" (`/pricing`) and "what do people ask" (`/faq`). It never answers **"is this for a person
like me"**. A home baker searching for a way to take cake pre-orders reads abstract copy about
"what you make" and has to do the translation themselves.

That gap costs twice. A visitor who cannot see their own trade in the page leaves; and the site
owns no page that matches the long-tail query the visitor actually typed ("order form for home
bakery", "take meal prep orders online"). The landing page cannot fix this — it is one page, and
naming four trades on it makes it vaguer, not more specific.

Reference for the shape: [take.app/industry/restaurants](https://www.take.app/industry/restaurants).

## Goal

Four pages, one per business type, each written for one reader. Each page is a real page — its own
`<title>`, its own meta description, its own prerendered HTML file, its own FAQ — so it is a
distinct entry in Google's index and a distinct sitelink candidate (#169), and so an LLM crawler
that runs no JavaScript reads the words.

## Non-goals

- **Testimonials.** No real quote from a merchant exists. Writing one is fabrication and is not on
  the table. If real quotes are collected later they are a separate change.
- **Per-vertical pricing tables.** Plan amounts resolve per region at runtime; a table baked into a
  build is a wrong price the moment they move. Each page links to `/pricing`.
- **Sample-shop embeds.** `useSampleShops` fetches client-side with no fallback data, so a
  prerendered page would ship an empty block — the same reason `/sample-shops` is not prerendered.
- **A `/for` hub page.** Four items do not need an index. Revisit past roughly six verticals.
- **Per-vertical screenshots.** Nothing to screenshot that `/features` does not already show.

## The four verticals

| Path | Reader |
|------|--------|
| `/for/home-bakers` | Cakes, cookies, bread. Pre-orders against a wanted date; boxes, dozens, trays. |
| `/for/home-kitchens` | Cooked food, weekly meal prep, frozen food. Repeat customers, cut-off times. |
| `/for/makers` | Craft, art, handmade goods, clothing. Small batches, made to order. |
| `/for/cafes-and-stalls` | Small cafés and market stalls taking pickup pre-orders and stall collection. |

URL shape is `/for/<slug>` — it reads as who the page is for, which is what the copy says out loud,
and the slug carries the keyword. Not `/industry/…` (reads corporate for a one-person home shop)
and not `/use-cases/…` (longer, weakest slug).

## Content model — `src/marketing/useCases.ts`

All copy lives as data, bilingual, in the same shape family as `faq.ts` and `features.ts`. A copy
change never touches layout, and a test can see every entry is translated.

```ts
export interface Copy { en: string; zh: string }

export interface UseCaseBlock { id: string; title: Copy; body: Copy }
export interface UseCaseFaqEntry { id: string; q: Copy; a: Copy }

export interface UseCase {
  /** Path is `/for/${slug}`. Kebab-case, unique. */
  slug: string
  /** Footer link and landing-card label. */
  label: Copy
  h1: Copy
  intro: Copy
  /** One line under the label on the landing strip. */
  cardBlurb: Copy
  /** 3–4 trade-specific story blocks. */
  blocks: UseCaseBlock[]
  /** 3–4 trade-specific questions. Never a question `/faq` already answers. */
  faq: UseCaseFaqEntry[]
  /** English `<title>` and description, spread into ROUTE_META. */
  meta: RouteMeta
}

export const USE_CASES: UseCase[]
export function useCasePath(slug: string): string   // `/for/${slug}`
```

### Truth constraint

The file header states it and the copy obeys it: a page may only claim what the product does. The
authoritative list is `public/llms.txt` — storefront link with photos and per-unit pricing;
EN/ZH product names; delivery fees flat, by region, or base plus rate per routed kilometre; pickup
and/or delivery; numbered orders carrying name, WhatsApp number, items, wanted date and total;
order status; customer order lookup; an email alert on every plan; an automatic customer list. Pro
adds Telegram alerts, vouchers, promotional prices, priority support.

No claim about who already sells here. `verticals.ts` carries the same note for the same reason:
no maker, no café and no meal-prep shop has been onboarded, so the copy positions TinyOrder for
that reader without asserting that reader is already a customer.

### What differs per vertical

The blocks are where the pages stop being four copies of one page. Each names the product
behaviour that trade cares about, in that trade's words:

- **home-bakers** — the wanted date on every order; per-unit pricing (box, dozen, tray, slice);
  one numbered list replacing a WhatsApp thread of "can I still order for Saturday".
- **home-kitchens** — repeat weekly orders; delivery fees by distance from the kitchen; the
  customer list that builds itself; order status (preparing / ready / done).
- **makers** — made-to-order lead time; per-piece and per-set pricing; photos on the storefront;
  no commission on a hand-made item whose margin cannot carry one.
- **cafes-and-stalls** — pickup as the default fulfilment; pre-orders collected before the stall
  opens; numbered orders read off a phone at the counter.

## Page — `src/marketing/UseCasePage.tsx`

One component, `({ useCase }: { useCase: UseCase })`, rendering any entry. Layout follows
`FeaturesPage.tsx`:

```
MarketingNav
h1 + intro                      (centred header section, max-w 720)
story blocks                    (stacked, Reveal-wrapped)
FAQ list                        (question + answer, plain — not the /faq accordion)
closing CTA                     (Start your shop → /merchant/signup)
  + links back to /features and /pricing
MarketingFooter
```

Imported **eagerly** in `AppRouter`, not behind `lazy()` — the same reason `Pricing`, `FeaturesPage`
and `FaqPage` are eager: the route is served a prerendered file, and a lazy boundary throws that
markup away on boot to show a spinner where a finished page already was.

`useTopOnRouteChange()` as every other marketing page. No `useCanonical` / `useDocumentMeta` — both
are mounted once in `AppRouter` and keyed on the pathname.

## Registration — six places

Three are derived from `USE_CASES`, so they cannot drift from the data:

| Place | How |
|-------|-----|
| `src/routeMeta.ts` | spread `USE_CASES` `meta` entries into `ROUTE_META`, keyed on `/for/<slug>` |
| `src/AppRouter.tsx` | `USE_CASES.map(u => <Route path={useCasePath(u.slug)} element={<UseCasePage useCase={u} />} />)` |
| `apps/frontend/scripts/prerender.tsx` | spread into `ROUTES`; each writes `dist/for/<slug>.html` |
| `apps/frontend/vercel.json` | four rewrites `/for/<slug>` → `/for/<slug>.html`, **above** the catch-all |
| `apps/frontend/public/sitemap.xml` | four `<url>` rows, `changefreq` monthly, `priority` 0.7 |
| `apps/frontend/public/llms.txt` | four links under `## Pages` |

`prerender.tsx` currently writes flat into `dist/`. It gains a `mkdirSync(path.dirname(target), { recursive: true })`
before each write, because `dist/for/` does not exist.

Deriving `ROUTE_META` from the data means the suites that already exist cover the new pages the
moment they are added: `routeMeta.test.ts` (title ≤65 chars, description ≤160, no duplicate titles),
`vercelRewrites.test.ts` (a rewrite exists, and sits above the catch-all), `llmsTxt.test.ts` (every
`ROUTE_META` key is linked from `llms.txt`). Only `vercel.json`, `sitemap.xml` and `llms.txt` are
hand-edited, and two of those three fail the build when forgotten.

## Structured data

`src/marketing/structuredData.ts` gains a second builder beside `faqStructuredData`:

```ts
export function useCaseFaqStructuredData(useCase: UseCase, lang: Lang): object
```

Same `FAQPage` shape, with `@id` = `${SITE_URL}/for/<slug>#faq`, `url` = `${SITE_URL}/for/<slug>`,
`isPartOf` and `publisher` pointing at the identity nodes in `index.html`, and `mainEntity` built
from `useCase.faq`. `useFaqStructuredData` generalises to accept the built object rather than
reading `FAQ` itself, keeping both behaviours that matter: it **adopts** the prerendered
`script[data-structured-data="faq"]` instead of appending a second one with the same `@id`, and it
removes the element on unmount so navigating to a storefront does not leave this page's FAQ behind
claiming to describe that shop.

`prerender.tsx` bakes each use-case page's block into its own file via the existing `head` field on
`PrerenderRoute` — English, as `/faq` does, because that is what an unswitched page renders and the
effect rewrites it for a Chinese reader.

Google has not shown FAQ rich results for ordinary sites since 2023, so this is not a rich-result
play. It is the most quotable form of the page for an LLM crawler, and it costs one function.

## Links in and out

- **Footer** (`MarketingChrome.tsx`): a new column, "Who it's for" / 「适合谁用」, with the four
  labels. Sitewide, so every page on the site links in and no use-case page is an orphan.
- **Landing** (`Landing.tsx`): a four-card strip above the closing CTA — label plus `cardBlurb`,
  each card a link.
- **Out of each page**: `/merchant/signup` (the CTA), plus `/features` and `/pricing` in the
  closing section. A page whose only outbound links point deeper is a dead end to a crawler
  working out which pages belong together.

## Tests

New `src/marketing/useCases.test.ts`, in the discipline of `verticals.test.ts` — content pins, no
rendering:

- every string field non-empty in both languages
- `zh` never equals `en` (what a forgotten translation looks like)
- every `zh` string contains a Han character (a distinct string is not proof of translation)
- slugs unique, kebab-case, and matching `/^[a-z0-9]+(-[a-z0-9]+)*$/`
- 3–4 `blocks` and 3–4 `faq` entries per vertical
- block ids and FAQ ids unique within an entry
- **no FAQ question duplicates one in `faq.ts`** — a page repeating `/faq` is the thin-content
  failure this whole design exists to avoid

`src/marketing/structuredData.test.ts` extended: `useCaseFaqStructuredData` returns a `FAQPage`
whose `mainEntity` matches the entry's FAQ, whose `@id` and `url` name the page, and which switches
language with `lang`.

No component tests. Per CLAUDE.md, UI is verified by running the app — the run-and-verify pass is
the four pages loading, the footer column and landing strip navigating to them, the language toggle
switching every string, and `pnpm build` producing `dist/for/<slug>.html` with the copy and the
JSON-LD in the bytes.

## Risks

- **Four pages built from one template read as duplicate content if the copy is lazy.** The
  mitigation is content, not code: distinct h1, intro, blocks and FAQ per vertical, pinned by the
  no-duplicate-question test. The shared layout is not the risk; shared sentences are.
- **`dist/for/` is a new directory in the build.** If `mkdirSync` is missed the build throws
  (`ENOENT`) rather than shipping quietly — the safe failure.
- **Chinese copy volume.** Four pages is roughly 40 new bilingual strings. The tests catch an
  untranslated string, not an awkward one.
