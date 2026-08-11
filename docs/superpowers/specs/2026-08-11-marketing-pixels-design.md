# Meta and TikTok pixels on the marketing pages — design

Issue: [#217](https://github.com/leongcheefai/Bitetime-Order-Platform/issues/217)
Date: 2026-08-11

## Problem

TinyOrder cannot measure whether a paid ad produced a shop. Vercel Analytics and the self-hosted
`praxor` script both count visits, and neither can tell Meta or TikTok which click became a signup —
which is the only signal those platforms optimize a campaign on. Run an ad today and the money is
spent blind.

The issue text says "for optimize seo". That premise is wrong and the work proceeds anyway with the
correction stated: an advertising pixel has **no effect on search rankings**. It is conversion
tracking and retargeting for paid campaigns. This design is worth building only because paid ads are
planned; it buys nothing for organic search, and it costs two third-party scripts on a site whose
whole performance story (self-hosted fonts, prerendered routes, immutable assets) is about keeping
cold third-party origins off the critical path.

## Goal

Meta Pixel and TikTok Pixel on TinyOrder's own marketing pages, behind explicit consent, reporting
two things: a pageview, and a completed shop signup. Built so the follow-up merchant-pixel feature
reuses the machinery rather than reimplementing it.

## Non-goals

- **Storefronts (`/s/:slug`).** TinyOrder's pixels never fire there. Those are other merchants'
  customers; sending them to TinyOrder's ad accounts is harvesting, and `documents.ts` tells those
  customers we do not use their data for advertising.
- **Merchant-owned pixels.** The higher-value feature, and a separate spec — see *Follow-up* below.
- **Advanced matching / PII.** No email, phone, name or shop identity is sent to either vendor. Only
  behavioural data, which is what the consent text will claim and must therefore be all that is true.
- **A paid-subscription conversion event.** The paid flip is webhook-driven server-side; a
  browser-observed Stripe return is either inflated or missed. Revisit with the Conversions API if
  campaign optimization ever needs it.
- **Google Tag Manager or a commercial CMP.** Considered and rejected — see *Alternatives*.
- **Governing the existing analytics.** Vercel Analytics and `praxor` are first-party and cookieless
  and keep running regardless of the banner choice. The privacy text must not imply otherwise.

## Decisions

| Decision | Choice |
|---|---|
| Scope | Marketing pages only; never `/s/:slug`, `/merchant`, `/admin` |
| Consent | Banner; both pixels stay unloaded until Accept. Reject means the scripts never load |
| Events | `PageView` + `CompleteRegistration` |
| Pixel ids | `VITE_META_PIXEL_ID`, `VITE_TIKTOK_PIXEL_ID`; absent means the feature is fully off |
| Sequencing | This ships first; merchant pixels are a separate issue reusing this machinery |

## Alternatives considered

**Google Tag Manager container.** One script; both pixels configured in the GTM UI and gated by GTM
Consent Mode; new pixels without a deploy. Rejected: GTM is a third, heavier script that must load
*before* consent in order to do the gating, its configuration lives outside the repo where no test
can pin it, and the marketing-only rule would have to be rebuilt inside GTM as well.

**Commercial CMP (Cookiebot, Osano).** A maintained consent UI and an auto-blocking scanner, for a
monthly fee and a render-blocking script. Rejected: it solves a problem exactly two scripts' worth
of, and buys a dashboard no test can see.

## Module shape

```
src/pixels/
  ids.ts             type PixelIds = { meta?: string; tiktok?: string }
                     platformPixelIds(): PixelIds — reads import.meta.env
  marketingPaths.ts  isMarketingPath(pathname): boolean
  consent.ts         readConsent(scope), writeConsent(scope, choice)
  load.ts            loadPixels(ids: PixelIds) — injects the base snippets, idempotent
  track.ts           pixelPageView(), pixelTrack(event, params)
  ConsentBanner.tsx  props: onAccept, onReject
  usePixels.ts       the platform wiring, mounted in AppRouter
```

The seam that matters: **`loadPixels`, `track`, `consent` and the banner take their inputs as
arguments and know nothing about `import.meta.env` or about routes.** Only `usePixels.ts` and
`platformPixelIds()` know this is the platform. The merchant feature later adds
`useMerchantPixels.ts` — ids from `MerchantContext`, consent scope `shop:<slug>` — and reuses the
rest unchanged. Building the shared parts env-blind now is the entire reason this ships first.

### The marketing allowlist is derived, not maintained

`isMarketingPath` derives its set from `ROUTE_META`'s keys plus the use-case paths. Those already
*are* the public, individually-titled pages: `/`, `/pricing`, `/features`, `/faq`, `/sample-shops`,
`/for/*`, `/merchant/signup`, `/merchant/login`, `/terms`, `/privacy`.

Everything else is excluded because it has no entry — `/s/:slug`, `/merchant`, `/admin`,
`/reset-password`, `/releases/:tag`. A hand-written second list would drift the way a missing
`vercel.json` rewrite drifts (#169); deriving removes the drift instead of testing for it. A path
with dynamic segments matches on its route pattern, not on a literal string compare.

`/merchant/signup` is inside the allowlist deliberately: it is the page an ad lands on, and the
conversion happens there.

### Rules the module enforces

- **No id configured** → `usePixels` no-ops and the banner never renders. Dev, CI, Vitest and
  Playwright therefore need no stubs and never load a third-party script.
- **Path outside the allowlist** → no banner, no load, no events. Someone who lands directly on
  `/s/kopi-corner` sees nothing.
- **Consent `null` on a marketing path** → the banner shows and the scripts stay unloaded.
- **Consent `rejected`** → the scripts never load and the banner never returns.
- Each pixel is independent: set one env var, get one pixel.

## Consent storage and the banner

`localStorage` key `to_consent_v1`, value `{ scope, choice, ts }`, every access wrapped in
`try`/`catch` — Safari private mode throws on write, and `checkoutGate.ts` sets that precedent in
this repo. **Storage unavailable is treated as `null` forever**: the banner shows each visit and the
pixels never load. It fails closed.

The `v1` suffix exists so that adding a third vendor later can invalidate stored consent rather than
silently claiming someone agreed to something they never saw.

The banner is a bottom sheet, bilingual through `t(en, zh)`, with **Accept and Reject at equal
visual weight** — a greyed-out Reject is a dark pattern and is the specific thing regulators cite —
and a link to `/privacy`. It renders inside the existing `Suspense`/toaster layer so it never blocks
first paint.

It cannot reach the prerendered HTML: `scripts/prerender.tsx` renders each route element directly
rather than mounting `AppRouter`, and `renderToStaticMarkup` fires no effects. That matters because
a cookie banner baked into `dist/*.html` is page content to a JS-less crawler.

## Loading and events

- `loadPixels(ids)` injects each vendor's base snippet only for an id that is present, once, guarded
  by a module flag. Both snippets create their own `async` script tags, and injection happens only
  after Accept — so neither vendor is ever on the critical path or visible to the preload scanner.
- The snippets run `fbq('init', id)` and `ttq.load(id)` **without** the initial PageView the
  copy-paste versions include, so one code path owns pageviews instead of two.
- `pixelPageView()` fires `fbq('track','PageView')` and `ttq.page()`. `usePixels` calls it on every
  marketing route change **including the first one after consent**. Non-marketing routes fire
  nothing; the script stays in the document because an SPA cannot unload it, but it is never told
  anything.
- `pixelTrack('CompleteRegistration')` is called in `SignupScreen.tsx` immediately after
  `createMerchant` resolves ok, before either branch navigates. That covers Basic (→ `/merchant`)
  and Pro (→ Stripe Checkout) alike, because the shop exists at that moment in both.
- Every vendor call is guarded. `fbq` and `ttq` may be missing because an ad blocker killed the
  script, and a throw inside a pageview effect must not take down a route transition.

## Legal text

Required, not optional — the current text is false the moment a pixel loads. In
`src/legal/documents.ts`:

- **§3, the line "We do not sell personal data, and we do not use it for advertising."** Replaced by
  something true: we do not sell personal data; we do not use shop or order data for advertising; on
  our own marketing pages, and only if you agree, Meta and TikTok advertising pixels measure our
  advertising.
- **§4** — Meta Platforms and TikTok added to the named-providers list, scoped explicitly to the
  marketing pages and to consent.
- **A new short section on cookies and similar technologies**, because the banner links to
  `/privacy` and there must be something there to read.
- `legal.test.ts` extended; the effective-date and draft-notice machinery in `draftNotice.ts`
  handled per its existing rules.

Terms are untouched: this pixel is TinyOrder's own tracking of TinyOrder's own visitors.

## Tests

Vitest, pure, no network:

- `ids` — no env yields `{}`; one env var yields one id.
- `marketingPaths` — the derived set equals `ROUTE_META` ∪ use-case paths; `/s/x`, `/merchant`,
  `/admin`, `/reset-password`, `/releases/v1` are all false.
- `consent` — round-trip; unknown key yields `null`; a throwing `localStorage` yields `null` and
  does not throw.
- `load` — empty ids inject nothing; calling twice injects once.
- `track` — no-ops before load, and when `fbq`/`ttq` are absent.
- `legal.test.ts` — extended for the new and changed privacy sections.

The banner UI is verified by running the app, per CLAUDE.md. There are no component tests here.

## Known limits

- Consent is per-browser, not per-account. The same person on a second device sees the banner again.
  Standard, and not worth an account-linked store.
- Reject governs these two pixels only. Vercel Analytics and `praxor` keep running — both are
  first-party and cookieless, which is why that is defensible, and why the privacy text must not
  claim the banner covers all analytics.
- Nothing fires until real Meta and TikTok ad accounts exist and the env vars are set in Vercel.
  Until then this ships fully inert, which is the intended state.

## Follow-up: merchant pixels

The higher-value feature, and a separate issue and spec. A merchant running ads for their own shop
wants a pixel on their own storefront, firing on their own orders with their own order values. It is
also cleaner legally: `documents.ts` §1 already makes a shop separately responsible for the customer
data it receives, so a merchant's own pixel makes the merchant the data controller.

It is a bigger build:

| | This spec | Merchant pixels |
|---|---|---|
| Ids from | env vars | `merchants.meta_pixel_id` / `tiktok_pixel_id` — migration + ShopSettings UI |
| Fires on | marketing pages | `/s/:slug`, and only for shops that configure one |
| Events | PageView, CompleteRegistration | PageView, ViewContent, AddToCart, InitiateCheckout, Purchase with order value |
| Controller | TinyOrder | the merchant |
| Also needs | — | a Terms clause on merchant responsibility, a Pro plan gate, the banner extended to storefronts |

The cost to name when that spec is written: a shop that configures a pixel gets a cookie banner in
front of its customers, on the conversion path.
