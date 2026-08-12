# Praxor analytics on the platform's own pages

**Date:** 2026-08-12
**Status:** approved, not implemented

## What this is

TinyOrder measures its own pages with `@vercel/analytics` today. This change replaces that with
`praxor`, the first-party analytics client for Praxor Analytics, and adds named product events for
the merchant funnel.

Praxor is our own system. It sets no cookie. It stores one server-computed visitor hash in
`sessionStorage` under `praxor_vid`, and that hash is scoped to the tab. The privacy policy already
describes this kind of measurement, so this change adds no new consent question and no new banner.

## Scope

Praxor reports on the platform's own pages only. It reports nothing from a shop's storefront.

| Route | Reported |
|---|---|
| `/`, `/pricing`, `/features`, `/faq`, use-case pages, `/sample-shops`, `/terms`, `/privacy`, `/releases/:tag` | yes |
| `/merchant/signup`, `/merchant/login`, `/merchant` and its tabs | yes |
| `/admin`, `/admin/merchants` | yes |
| `/s/:slug/*` | **no** |
| `/reset-password` | **no** |

A storefront visitor is the merchant's customer, not ours. `/reset-password` is role-blind and a
customer reaches it, so it stays out for the same reason. This is the rule `pixels/decision.ts`
already holds for the advertising pixels, restated for a wider but still platform-only set of pages.

## Why the SDK's automatic capture stays off

`praxor` captures pageviews by patching `window.history.pushState` and `replaceState`, and it
captures outbound clicks with a listener on `document`. Both are global to the page. Neither can be
told to ignore `/s/:slug`.

This app is one single-page application. A visitor moves from `/pricing` to a storefront without a
document load. With automatic capture on, that storefront navigation reports a pageview from a
merchant customer's browser, which is exactly what the scope rule above forbids.

The client is therefore created with `autoCapturePageviews: false` and `trackOutboundLinks: false`,
and this app sends each pageview itself from a route effect that the scope rule gates.

## Module: `apps/frontend/src/analytics/`

The module mirrors `src/pixels/`: pure rules in their own files, one hook that knows this is the
platform's own measurement.

| File | Purpose |
|---|---|
| `config.ts` | Reads `VITE_PRAXOR_SITE_ID` and the optional `VITE_PRAXOR_API_URL`. Returns `null` when the site id is absent or blank. Pure. |
| `scope.ts` | `isPlatformPath(pathname)` — the table above as one predicate. Pure. |
| `events.ts` | The `AnalyticsEvent` union, its property types, and `trackEvent()`. |
| `useAnalytics.ts` | Creates the client, sends pageviews, listens for CTA clicks. Mounted once. |

### `config.ts`

`VITE_PRAXOR_SITE_ID` follows the pattern in `pixels/ids.ts`: an unset or blank value means the
feature is not configured. Praxor is then never created, so a development run and a preview build
send nothing and log no failed request.

`VITE_PRAXOR_API_URL` overrides the SDK default `https://api.praxor.dev`. It exists for a local
Praxor instance. `initPraxor` throws on a value that is not an absolute URL, so a blank value must
be dropped rather than passed through.

### `scope.ts`

```ts
export function isPlatformPath(pathname: string): boolean
```

False for a path under `/s/`, false for `/reset-password`, true for everything else. An allow-list
is wrong here: a new platform page must be measured the day it ships, and only the two exclusions
are deliberate. `marketingPaths.ts` cannot be reused — it answers a narrower question (is this a
published page with its own title?) and it excludes the whole merchant dashboard.

### `events.ts`

The event set is a union, not a string, for the reason `pixels/track.ts` gives: adding an event is
then a type error at every call site until someone edits this file.

| Event | Properties | Where it fires |
|---|---|---|
| `merchant_signup` | `{ billing }` | `merchant/SignupScreen.tsx`, after `createMerchant` returns ok, beside the existing `pixelTrack('CompleteRegistration')` |
| `trial_started` | none | Same call site, and only when the created shop's status is `active`. A `pending` shop means Stripe refused, so no trial started |
| `merchant_login` | none | `merchant/LoginScreen.tsx`, after `signIn` resolves |
| `billing_checkout_started` | `{ billing, from }` | The two `startCheckout` call sites: `merchant/SubscriptionTab.tsx` (`from: 'subscription'`) and `merchant/SuspendedScreen.tsx` (`from: 'suspended'`) |
| `cta_click` | `{ from, cta, billing? }` | The delegated listener described below |

No payload carries a name, an email address, a contact number, a shop slug or an order. `billing` is
`monthly` or `yearly` — the two words the pricing page already shows. There is no `plan` property:
one plan remains after the basic plan was removed.

`trackEvent()` wraps the SDK call and swallows a throw, for the reason `pixels/track.ts` gives: these
fire from click handlers, and a throw there trades a missing measurement for a broken page. It is
also a no-op when Praxor is not configured.

Analytics stays out of `store.ts`. That file is the data layer, and a `startCheckout` that also
reports would make every future caller report too, whether it should or not.

### `useAnalytics.ts`

Mounted once in `AppRouter`, beside `usePixels`.

1. **Create.** An effect creates the client once with `initPraxor({ siteId, apiUrl,
   autoCapturePageviews: false, trackOutboundLinks: false })`. Nothing runs at module scope, so the
   prerender stays offline; `scripts/prerender.tsx` renders each route element directly and never
   mounts `AppRouter`, and `renderToStaticMarkup` fires no effect either way.
2. **Pageviews.** A second effect calls `praxor.trackPageview(pathname)` on each `pathname` change,
   and only when `isPlatformPath(pathname)` is true. The path is passed explicitly rather than left
   to the SDK, because the SDK reads `window.location.pathname` at send time and React Router has
   already changed it — the two agree today, and an explicit path cannot drift.
3. **CTA clicks.** One delegated `click` listener on `document`. It looks for
   `event.target.closest('a[href^="/merchant/signup"]')` and reports `cta_click` with `from` =
   the current pathname, `cta` = the link's `data-cta` attribute or `'link'`, and `billing` = the
   billing segment of the href when the href carries one (`/merchant/signup/yearly`).

The listener is what makes this cheap: the signup CTA appears in seven components
(`Landing.tsx` three times, `Pricing.tsx`, `PricingCards.tsx`, `FeaturesPage.tsx`, `FaqPage.tsx`,
`UseCasePage.tsx`), and none of them needs an import or a handler. Adding `data-cta="hero"` to a
link is a one-attribute edit when a page needs to tell its CTAs apart, and the event still arrives
without it.

The listener is added only while the current path is in scope, so a click on a storefront reports
nothing.

## What `@vercel/analytics` leaves behind

- `main.tsx` drops the `Analytics` import and element.
- `package.json` drops the dependency.
- `legal/documents.ts:251` loses the words "and by our hosting provider". The sentence then reads:
  "That measurement is done by our own systems, does not identify you, and does not follow you to
  other websites." `legal/legal.test.ts` must still pass.

**Accepted risk.** Between the deploy and the first confirmed Praxor data, this app has no pageview
measurement at all. The user accepted this rather than run both for a release.

## What this change does not do

- **No revenue attribution.** Praxor can attribute revenue when `praxorVisitorId` rides along in
  Stripe metadata. That touches `POST /api/checkout` and the backend session create, and it is a
  separate change. The visitor id is `sessionStorage`-scoped, so a merchant who upgrades in a new
  tab has none, and that alone deserves its own design.
- **No `sample_shop_opened` event.** The sample shops are deliberately not clickable —
  `SampleShopsCarousel.tsx` states it and holds no `<a>` or `<Link>` — so there is no shop to open
  and no event to report.
- **No storefront measurement.** A shop's own storefront analytics would be a per-shop feature with
  its own consent question, in the shape of the merchant pixels (#220).
- **No consent gate and no Do Not Track check.** First-party measurement, no cookie, no
  cross-site identity.

## Tests

Vitest, beside the module, in the repo's existing style. Pure logic only; the UI is proven by
running the app.

| File | Asserts |
|---|---|
| `scope.test.ts` | The route table above, as a truth table. `/s/kopi-corner`, `/s/kopi-corner/track/x` and `/reset-password` are false; each platform path is true |
| `config.test.ts` | A missing, blank or whitespace site id yields `null`; a blank API URL is dropped rather than passed; a set pair is returned |
| `events.test.ts` | `trackEvent` is a no-op when Praxor is not configured, and swallows a throw from the client |

## Verification

Per CLAUDE.md, the UI is proven by running the app.

1. Run the frontend with `VITE_PRAXOR_SITE_ID` set and `VITE_PRAXOR_API_URL` pointed at a local
   Praxor, or watch the network tab against the real endpoint.
2. Load `/`, move to `/pricing`, click the hero CTA. Expect two pageviews and one `cta_click`.
3. Complete a merchant signup. Expect `merchant_signup` and `trial_started`.
4. Open a storefront at `/s/:slug`. Expect **no** request to the Praxor endpoint, on the initial
   load and on every in-storefront navigation.
5. Log in at `/merchant/login`. Expect `merchant_login` and a dashboard pageview.
