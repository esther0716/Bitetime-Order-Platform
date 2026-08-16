# Praxor Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure TinyOrder's own pages with the `praxor` first-party analytics client, report five named merchant-funnel events, and remove `@vercel/analytics`.

**Architecture:** A new `apps/frontend/src/analytics/` module mirrors `src/pixels/`: pure rules in their own files (`config.ts`, `scope.ts`, `events.ts`) and one route-aware hook (`useAnalytics.ts`) mounted once in `AppRouter`. The SDK's automatic capture is switched OFF — it patches `history.pushState` globally and cannot ignore a storefront route — so the hook sends each pageview itself, gated by `isPlatformPath()`.

**Tech Stack:** React 19, React Router v7, Vite, TypeScript (strict), Vitest (`environment: 'node'`), `praxor@^0.1.0`.

**Spec:** `docs/superpowers/specs/2026-08-12-praxor-analytics-design.md`

## Global Constraints

- Praxor reports on platform pages only. It reports **nothing** from `/s/:slug` (a storefront) and nothing from `/reset-password`.
- The SDK client is always created with `autoCapturePageviews: false` and `trackOutboundLinks: false`. Never turn either on.
- No payload may carry a name, an email address, a contact number, a shop slug or an order. Allowed properties: `billing` (`'monthly' | 'yearly'`), `from`, `cta`.
- `VITE_PRAXOR_SITE_ID` unset, blank or whitespace means the feature is off: no client, no request, no log.
- Analytics calls never enter `store.ts`. That file is the data layer.
- Event property types must be declared with `type`, not `interface`. An `interface` has no implicit index signature and is therefore not assignable to the SDK's `EventProperties` (`Record<string, unknown>`), which is a compile error at the `client.track()` call.
- Repo commands run from the repo root: `pnpm --filter @bitetime/frontend test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`.
- Every file this plan creates carries a comment saying **why**, in the style of `src/pixels/*.ts`. A file with no reason written down is not finished.

---

### Task 1: Install the SDK and read its configuration

**Files:**
- Modify: `apps/frontend/package.json` (dependencies)
- Create: `apps/frontend/src/analytics/config.ts`
- Test: `apps/frontend/src/analytics/config.test.ts`
- Modify: `apps/frontend/.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type PraxorSettings = { siteId: string; apiUrl?: string }` and `export function praxorSettings(): PraxorSettings | null` from `src/analytics/config.ts`.

- [ ] **Step 1: Install the dependency**

Run from the repo root:

```bash
pnpm --filter @bitetime/frontend add praxor@^0.1.0
```

Expected: `praxor` appears in `apps/frontend/package.json` under `dependencies`, and `pnpm-lock.yaml` changes.

- [ ] **Step 2: Write the failing test**

Create `apps/frontend/src/analytics/config.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { praxorSettings } from './config'

afterEach(() => { vi.unstubAllEnvs() })

describe('praxorSettings', () => {
  it('is off when the site id is unset', () => {
    vi.stubEnv('VITE_PRAXOR_SITE_ID', '')
    expect(praxorSettings()).toBeNull()
  })

  it('is off when the site id is whitespace, so a stray space cannot half-enable it', () => {
    vi.stubEnv('VITE_PRAXOR_SITE_ID', '   ')
    expect(praxorSettings()).toBeNull()
  })

  it('trims a site id that a dashboard copy-paste padded', () => {
    vi.stubEnv('VITE_PRAXOR_SITE_ID', ' site_123 ')
    vi.stubEnv('VITE_PRAXOR_API_URL', '')
    expect(praxorSettings()).toEqual({ siteId: 'site_123' })
  })

  it('drops a blank API URL rather than passing it on, because initPraxor throws on one', () => {
    vi.stubEnv('VITE_PRAXOR_SITE_ID', 'site_123')
    vi.stubEnv('VITE_PRAXOR_API_URL', '   ')
    expect(praxorSettings()).toEqual({ siteId: 'site_123' })
  })

  it('returns a self-hosted API URL when one is set', () => {
    vi.stubEnv('VITE_PRAXOR_SITE_ID', 'site_123')
    vi.stubEnv('VITE_PRAXOR_API_URL', 'http://localhost:3001')
    expect(praxorSettings()).toEqual({ siteId: 'site_123', apiUrl: 'http://localhost:3001' })
  })
})
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `pnpm --filter @bitetime/frontend test -- src/analytics/config.test.ts`
Expected: FAIL — `Failed to resolve import "./config"`.

- [ ] **Step 4: Write the implementation**

Create `apps/frontend/src/analytics/config.ts`:

```ts
// WHETHER first-party analytics is configured at all, as data rather than as an `if` inside the
// hook. The same shape and the same trim as pixels/ids.ts, for the same reason: a Vercel variable
// set to a blank string is the shape of a half-finished configuration, and `''` would otherwise
// create a client that reports to a site id nobody owns.
//
// A site id is public — it ships in the page. The variable is a switch, not a secret.

export type PraxorSettings = {
  /** The site ID shown in the Praxor Analytics dashboard. */
  siteId: string
  /**
   * A self-hosted or local Praxor origin. ABSENT rather than blank when unset: `initPraxor`
   * throws on a value that is not an absolute URL, and a throw here would take the app down on
   * boot for a misconfigured environment variable.
   */
  apiUrl?: string
}

function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** The platform's settings, from the build environment. `null` means the feature is off. */
export function praxorSettings(): PraxorSettings | null {
  const siteId = configured(import.meta.env.VITE_PRAXOR_SITE_ID)
  if (!siteId) return null
  const apiUrl = configured(import.meta.env.VITE_PRAXOR_API_URL)
  return apiUrl ? { siteId, apiUrl } : { siteId }
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `pnpm --filter @bitetime/frontend test -- src/analytics/config.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Document the variables**

Append to `apps/frontend/.env.example`:

```
# First-party analytics (Praxor). Unset here on purpose: with no site id the client is never
# created, so a dev run, CI and the e2e run send nothing and log nothing. Set it in Vercel.
# VITE_PRAXOR_API_URL overrides the SDK default https://api.praxor.dev — a local Praxor only.
VITE_PRAXOR_SITE_ID=
VITE_PRAXOR_API_URL=
```

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/package.json apps/frontend/.env.example pnpm-lock.yaml \
        apps/frontend/src/analytics/config.ts apps/frontend/src/analytics/config.test.ts
git commit -m "feat(analytics): read the Praxor site id from the build environment"
```

---

### Task 2: The scope rule

**Files:**
- Create: `apps/frontend/src/analytics/scope.ts`
- Test: `apps/frontend/src/analytics/scope.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function isPlatformPath(pathname: string): boolean` from `src/analytics/scope.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/analytics/scope.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isPlatformPath } from './scope'

describe('the platform’s own pages', () => {
  it('measures the marketing pages', () => {
    expect(isPlatformPath('/')).toBe(true)
    expect(isPlatformPath('/pricing')).toBe(true)
    expect(isPlatformPath('/features')).toBe(true)
    expect(isPlatformPath('/sample-shops')).toBe(true)
    expect(isPlatformPath('/for/bakery')).toBe(true)
  })

  it('measures the legal documents and the release notes', () => {
    expect(isPlatformPath('/terms')).toBe(true)
    expect(isPlatformPath('/privacy')).toBe(true)
    expect(isPlatformPath('/releases/v1.2.0')).toBe(true)
  })

  it('measures the merchant app, which is where the funnel continues', () => {
    expect(isPlatformPath('/merchant/signup')).toBe(true)
    expect(isPlatformPath('/merchant/signup/yearly')).toBe(true)
    expect(isPlatformPath('/merchant/login')).toBe(true)
    expect(isPlatformPath('/merchant')).toBe(true)
    expect(isPlatformPath('/admin/merchants')).toBe(true)
  })
})

describe('pages that belong to somebody else', () => {
  // The rule this file exists for. A storefront visitor is the MERCHANT's customer, not ours, and
  // the app is one SPA — a visitor reaches a storefront from /pricing with no document load, so
  // without this rule the SDK's global history patch would report that navigation too.
  it('measures no storefront, on any path under it', () => {
    expect(isPlatformPath('/s/kopi-corner')).toBe(false)
    expect(isPlatformPath('/s/kopi-corner/')).toBe(false)
    expect(isPlatformPath('/s/kopi-corner/track/TC-260812-0050')).toBe(false)
  })

  it('measures no password reset, which is role-blind and reached by a shop’s customer', () => {
    expect(isPlatformPath('/reset-password')).toBe(false)
    expect(isPlatformPath('/reset-password?shop=kopi-corner')).toBe(false)
  })

  // `/s/` is a reserved platform segment (RESERVED_SLUGS), so no platform page can begin with it,
  // and a path that merely CONTAINS it is not a storefront.
  it('does not mistake a platform page whose name contains the segment', () => {
    expect(isPlatformPath('/sample-shops')).toBe(true)
    expect(isPlatformPath('/for/s-and-co')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @bitetime/frontend test -- src/analytics/scope.test.ts`
Expected: FAIL — `Failed to resolve import "./scope"`.

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/analytics/scope.ts`:

```ts
// WHERE first-party analytics may report.
//
// A DENY-list, and deliberately not the allow-list marketingPaths.ts uses. That file answers a
// narrower question — is this a published page with a title of its own? — which excludes the whole
// merchant dashboard, and this feature exists to measure the owner funnel through it. A new
// platform page must be measured the day it ships; only these two exclusions are deliberate.
//
// This rule is the whole reason the SDK's automatic capture stays off. `praxor` patches
// window.history.pushState and listens on document, both global to the page, and this app is one
// SPA: a visitor moves from /pricing to a storefront with no document load. Left to the SDK, that
// navigation reports a pageview out of a merchant customer's browser. See pixels/decision.ts,
// which holds the same line for the advertising pixels.

/** A storefront lives under this segment, which RESERVED_SLUGS keeps no shop from claiming. */
const STOREFRONT_PREFIX = '/s/'

/**
 * Role-blind and reached by a shop's customer after a recovery link, so it is not our page to
 * measure. Compared against the path only — a real pathname carries no query string, and a caller
 * passing a whole URL must still be answered correctly.
 */
const RESET_PASSWORD = '/reset-password'

/** Is this path one of TinyOrder's own pages? */
export function isPlatformPath(pathname: string): boolean {
  const path = pathname.split('?')[0].split('#')[0]
  if (path === STOREFRONT_PREFIX.slice(0, -1) || path.startsWith(STOREFRONT_PREFIX)) return false
  if (path === RESET_PASSWORD) return false
  return true
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @bitetime/frontend test -- src/analytics/scope.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/analytics/scope.ts apps/frontend/src/analytics/scope.test.ts
git commit -m "feat(analytics): keep first-party measurement off every storefront"
```

---

### Task 3: The event vocabulary

**Files:**
- Create: `apps/frontend/src/analytics/events.ts`
- Test: `apps/frontend/src/analytics/events.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, from `src/analytics/events.ts`:
  - `export type Billing = 'monthly' | 'yearly'`
  - `export type AnalyticsEvent = 'merchant_signup' | 'trial_started' | 'merchant_login' | 'billing_checkout_started' | 'cta_click'`
  - `export function setAnalyticsClient(next: PraxorClient | null): void`
  - `export function trackEvent<E extends AnalyticsEvent>(event: E, ...rest): void` — the second argument is required for `merchant_signup`, `billing_checkout_started` and `cta_click`, and absent for `trial_started` and `merchant_login`.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/analytics/events.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PraxorClient } from 'praxor'
import { setAnalyticsClient, trackEvent } from './events'

function fakeClient(track: PraxorClient['track']): PraxorClient {
  return {
    track,
    trackPageview: async () => {},
    getVisitorId: () => null,
    destroy: () => {},
  }
}

beforeEach(() => { setAnalyticsClient(null) })

describe('trackEvent', () => {
  it('does nothing at all when Praxor is not configured', () => {
    // No client set. The whole feature is off in dev, in CI and in Vitest, with no stubbing.
    expect(() => trackEvent('merchant_login')).not.toThrow()
  })

  it('sends the event name and its properties to the client', () => {
    const track = vi.fn()
    setAnalyticsClient(fakeClient(track))
    trackEvent('merchant_signup', { billing: 'yearly' })
    expect(track).toHaveBeenCalledWith('merchant_signup', { billing: 'yearly' })
  })

  it('sends an event that carries no properties', () => {
    const track = vi.fn()
    setAnalyticsClient(fakeClient(track))
    trackEvent('trial_started')
    expect(track).toHaveBeenCalledWith('trial_started', undefined)
  })

  // These fire from click handlers and from a submit handler. A throw there trades a missing
  // measurement for a broken checkout, which is the wrong trade. Same argument as pixels/track.ts.
  it('swallows a client that throws, because it is called from click handlers', () => {
    setAnalyticsClient(fakeClient(() => { throw new Error('ad blocker') }))
    expect(() => trackEvent('cta_click', { from: '/', cta: 'hero' })).not.toThrow()
  })

  it('stops sending once the client is cleared', () => {
    const track = vi.fn()
    setAnalyticsClient(fakeClient(track))
    setAnalyticsClient(null)
    trackEvent('merchant_login')
    expect(track).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @bitetime/frontend test -- src/analytics/events.test.ts`
Expected: FAIL — `Failed to resolve import "./events"`.

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/analytics/events.ts`:

```ts
// WHAT this app reports, and the only door to the SDK's `track`.
//
// A union rather than a string, for the reason pixels/track.ts gives: the set of events is then a
// rule the compiler holds instead of a sentence someone has to remember, and adding one is a type
// error at every call site until somebody edits this file.
//
// NO PII EVER, and the property types are what enforce it rather than this comment. `billing` is a
// word the pricing page already shows and `from`/`cta` name a place in the UI. No name, no email
// address, no contact number, no shop slug, no order.
//
// The client arrives through setAnalyticsClient rather than being created here. That keeps this
// module pure enough to test in the `node` environment the rest of the suite runs in, and it is
// what makes "Praxor is not configured" the ordinary state rather than a special case.

import type { PraxorClient } from 'praxor'

/** The two billing cycles. One plan remains, so there is no `plan` property anywhere here. */
export type Billing = 'monthly' | 'yearly'

export type AnalyticsEvent =
  | 'merchant_signup'
  | 'trial_started'
  | 'merchant_login'
  | 'billing_checkout_started'
  | 'cta_click'

// `type`, NOT `interface`, and it matters: an interface has no implicit index signature, so it is
// not assignable to the SDK's EventProperties (Record<string, unknown>) and the track call below
// fails to compile.
type EventProps = {
  merchant_signup: { billing: Billing }
  /** The shop was created AND Stripe provisioned the cardless trial. */
  trial_started: undefined
  merchant_login: undefined
  billing_checkout_started: { billing: Billing; from: 'subscription' | 'suspended' }
  cta_click: { from: string; cta: string; billing?: Billing }
}

let client: PraxorClient | null = null

/** Called by useAnalytics once the client exists, and with null when it does not. */
export function setAnalyticsClient(next: PraxorClient | null): void {
  client = next
}

/**
 * Report one named event.
 *
 * The rest-tuple signature is what makes the properties REQUIRED for the events that have them and
 * absent for the two that do not, rather than optional everywhere.
 */
export function trackEvent<E extends AnalyticsEvent>(
  event: E,
  ...rest: EventProps[E] extends undefined ? [] : [properties: EventProps[E]]
): void {
  if (!client) return
  try {
    client.track(event, rest[0])
  } catch {
    // An ad blocker can leave a global that throws. A missing measurement is acceptable; a submit
    // handler or a checkout click that dies inside it is not.
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @bitetime/frontend test -- src/analytics/events.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify the types hold**

Run: `pnpm --filter @bitetime/frontend typecheck`
Expected: no errors. If `client.track(event, rest[0])` errors with "Index signature for type 'string' is missing", `EventProps` was declared as an `interface` — change it to a `type`.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/analytics/events.ts apps/frontend/src/analytics/events.test.ts
git commit -m "feat(analytics): name the five events this app reports"
```

---

### Task 4: The hook, and mounting it

**Files:**
- Create: `apps/frontend/src/analytics/useAnalytics.ts`
- Modify: `apps/frontend/src/AppRouter.tsx` (add a `PlatformAnalytics` component beside `PixelConsent`, around lines 139-152 and 179-201)

**Interfaces:**
- Consumes: `praxorSettings()` (Task 1), `isPlatformPath()` (Task 2), `setAnalyticsClient()` and `trackEvent()` (Task 3).
- Produces: `export function useAnalytics(): void` from `src/analytics/useAnalytics.ts`.

There is no unit test in this task. The hook is the one impure file in the module, the suite runs in the `node` environment with no DOM, and CLAUDE.md says the UI is proven by running the app. Task 7 is that run.

- [ ] **Step 1: Write the hook**

Create `apps/frontend/src/analytics/useAnalytics.ts`:

```ts
// The ONE file that knows this app is the thing being measured.
//
// Everything it calls takes its inputs as arguments and reads no route table of its own, the same
// split usePixels.ts uses.
//
// THE SDK'S AUTOMATIC CAPTURE IS OFF, and it is not a preference. `praxor` captures pageviews by
// patching window.history.pushState/replaceState and captures outbound clicks with a listener on
// document. Both are global to the page and neither can be told to ignore /s/:slug. This app is
// one SPA, so a visitor reaches a storefront from /pricing with no document load — and the SDK
// would report that navigation out of a merchant customer's browser. See scope.ts.

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { initPraxor } from 'praxor'
import type { PraxorClient } from 'praxor'
import { praxorSettings } from './config'
import { isPlatformPath } from './scope'
import { setAnalyticsClient, trackEvent } from './events'
import type { Billing } from './events'

// Read once at module scope: the settings are inlined at build time and cannot change while the
// app runs, so re-reading them per render would be re-deriving a constant.
const SETTINGS = praxorSettings()

/** The href every signup CTA points at, in all its shapes. */
const SIGNUP_PREFIX = '/merchant/signup'

/**
 * `/merchant/signup/yearly`, and also the older `/merchant/signup/pro/yearly` still sitting in
 * inboxes and in Stripe's cancel_url history — hence a scan of the segments rather than a fixed
 * position. See the route comment in AppRouter.tsx.
 */
function billingFromHref(href: string): Billing | undefined {
  const segments = href.split('?')[0].split('#')[0].split('/')
  if (segments.includes('yearly')) return 'yearly'
  if (segments.includes('monthly')) return 'monthly'
  return undefined
}

export function useAnalytics(): void {
  const { pathname } = useLocation()
  const clientRef = useRef<PraxorClient | null>(null)
  const inScope = isPlatformPath(pathname)

  // Created once, and NEVER destroyed. initPraxor is an application-wide singleton and StrictMode
  // mounts every effect twice in development; a cleanup that called destroy() would tear down the
  // client the second mount then reuses. There is nothing to clean up either — with automatic
  // capture and outbound links both off, this client installs no listener of its own.
  useEffect(() => {
    if (!SETTINGS) return
    const client = initPraxor({
      siteId: SETTINGS.siteId,
      ...(SETTINGS.apiUrl ? { apiUrl: SETTINGS.apiUrl } : {}),
      autoCapturePageviews: false,
      trackOutboundLinks: false,
    })
    clientRef.current = client
    setAnalyticsClient(client)
  }, [])

  // One pageview per platform route, the first one included. The path is passed EXPLICITLY rather
  // than left to the SDK: the SDK reads window.location.pathname when the request is built, and
  // this effect already knows which route it is reporting.
  useEffect(() => {
    if (!inScope) return
    void clientRef.current?.trackPageview(pathname)
  }, [inScope, pathname])

  // One delegated listener instead of a handler in each of the seven components that render a
  // signup CTA. `data-cta` refines the label where a page has more than one; without it the event
  // still arrives, named `link`.
  useEffect(() => {
    if (!SETTINGS || !inScope) return
    function onClick(event: MouseEvent): void {
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest('a[href]')
      if (!link) return
      const href = link.getAttribute('href') ?? ''
      if (href !== SIGNUP_PREFIX && !href.startsWith(`${SIGNUP_PREFIX}/`)) return
      const billing = billingFromHref(href)
      trackEvent('cta_click', {
        from: pathname,
        cta: link.getAttribute('data-cta') ?? 'link',
        ...(billing ? { billing } : {}),
      })
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [inScope, pathname])
}
```

- [ ] **Step 2: Mount it in `AppRouter.tsx`**

Add the import beside the existing `usePixels` import:

```tsx
import { useAnalytics } from './analytics/useAnalytics'
```

Add this component immediately after the `PixelConsent` function (after line 201):

```tsx
// First-party analytics. Mounted here for the same reason PixelConsent is: route-aware, app-wide,
// and outside AnimatedRoutes so a page transition does not remount it. It renders nothing — the
// hook is all of it.
function PlatformAnalytics() {
  useAnalytics()
  return null
}
```

Add the element inside `AppRouter`, after `<PixelConsent />`:

```tsx
      <RouteToaster />
      <PixelConsent />
      <PlatformAnalytics />
    </SessionProvider>
```

- [ ] **Step 3: Verify the app still compiles and every existing test passes**

Run: `pnpm --filter @bitetime/frontend typecheck && pnpm --filter @bitetime/frontend test && pnpm lint`
Expected: PASS, with no new failures.

- [ ] **Step 4: Verify the prerender is untouched**

Run: `pnpm --filter @bitetime/frontend build`
Expected: the build completes and prints one line per prerendered route. The prerender renders each route element directly and never mounts `AppRouter`, and `renderToStaticMarkup` fires no effect — so a build must reach no network. A build that hangs or logs a Praxor request means the client was created at module scope; move it back inside the effect.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/analytics/useAnalytics.ts apps/frontend/src/AppRouter.tsx
git commit -m "feat(analytics): report a pageview per platform route"
```

---

### Task 5: Report the four funnel events

**Files:**
- Modify: `apps/frontend/src/merchant/SignupScreen.tsx:90-96`
- Modify: `apps/frontend/src/merchant/LoginScreen.tsx:61`
- Modify: `apps/frontend/src/merchant/SubscriptionTab.tsx:86-97`
- Modify: `apps/frontend/src/merchant/SuspendedScreen.tsx:29-37`

**Interfaces:**
- Consumes: `trackEvent()` and `Billing` from `src/analytics/events.ts` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Report the signup and the trial**

In `apps/frontend/src/merchant/SignupScreen.tsx`, add the import:

```tsx
import { trackEvent } from '../analytics/events'
```

The existing block reads:

```tsx
      const created = await createMerchant({ name, billing, referredByCode: ref, businessNature, currency })
      if (!created.ok) { setMsg(created.error.message || t('Something went wrong.', '出错了。')); setBusy(false); return }
      pixelTrack(platformPixelIds(), 'CompleteRegistration')
      await refreshMerchant()
```

Insert the two calls immediately after the `pixelTrack` line, keeping that line where it is:

```tsx
      pixelTrack(platformPixelIds(), 'CompleteRegistration')
      // The shop exists at this line, which is why the report is here and not on the page the
      // merchant lands on.
      trackEvent('merchant_signup', { billing: billing === 'yearly' ? 'yearly' : 'monthly' })
      // `trial` is the backend's own answer: POST /api/merchants returns `{ …, trial: false }`
      // when Stripe refused and the shop stayed `pending`, and `{ …, status: 'active', trial }`
      // when it provisioned the cardless trial. A pending shop started no trial.
      if (created.data?.trial === true) trackEvent('trial_started')
      await refreshMerchant()
```

- [ ] **Step 2: Report the login**

In `apps/frontend/src/merchant/LoginScreen.tsx`, add the import:

```tsx
import { trackEvent } from '../analytics/events'
```

The existing line reads:

```tsx
    try { await signIn(email, password); await refreshMerchant(); navigate('/merchant', { replace: true }) }
```

Replace it with:

```tsx
    try {
      await signIn(email, password)
      trackEvent('merchant_login')
      await refreshMerchant()
      navigate('/merchant', { replace: true })
    }
```

- [ ] **Step 3: Report both checkout starts**

In `apps/frontend/src/merchant/SubscriptionTab.tsx`, add the import:

```tsx
import { trackEvent } from '../analytics/events'
```

In `CheckoutButton`, replace the body of `go()`:

```tsx
  async function go() {
    setBusy(true)
    // Reported before the redirect, because the redirect leaves this page and nothing after
    // window.location.assign runs.
    trackEvent('billing_checkout_started', {
      billing: cycle === 'yearly' ? 'yearly' : 'monthly',
      from: 'subscription',
    })
    const r = await startCheckout({ billing: cycle })
    if (r.ok) window.location.assign(r.data)
    else {
      toast.error(r.error.message || t('Could not start checkout', '无法开始结账'))
      setBusy(false)
    }
  }
```

In `apps/frontend/src/merchant/SuspendedScreen.tsx`, add the same import and replace the body of `reactivate()`:

```tsx
  async function reactivate() {
    setBusy(true); setErr('')
    trackEvent('billing_checkout_started', {
      billing: cycle === 'yearly' ? 'yearly' : 'monthly',
      from: 'suspended',
    })
    const r = await startCheckout({ billing: cycle })
    if (r.ok) window.location.assign(r.data)
    else {
      setErr(r.error.message || t('Could not start checkout', '无法开始结账'))
      setBusy(false)
    }
  }
```

- [ ] **Step 4: Verify nothing broke**

Run: `pnpm --filter @bitetime/frontend typecheck && pnpm --filter @bitetime/frontend test && pnpm lint`
Expected: PASS. `store.ts` must appear in no diff in this task — the data layer stays free of analytics.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/merchant/SignupScreen.tsx apps/frontend/src/merchant/LoginScreen.tsx \
        apps/frontend/src/merchant/SubscriptionTab.tsx apps/frontend/src/merchant/SuspendedScreen.tsx
git commit -m "feat(analytics): report signup, trial, login and checkout start"
```

---

### Task 6: Remove `@vercel/analytics` and correct the privacy notice

**Files:**
- Modify: `apps/frontend/src/main.tsx:4,13`
- Modify: `apps/frontend/package.json` (dependencies)
- Modify: `apps/frontend/src/legal/documents.ts:251`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

**Note the accepted risk:** between this deploy and the first confirmed Praxor data, the app has no pageview measurement at all. The user chose this over running both for one release.

- [ ] **Step 1: Take it out of `main.tsx`**

Delete the import on line 4:

```tsx
import { Analytics } from '@vercel/analytics/react'
```

and the element:

```tsx
      <Analytics />
```

`main.tsx` then renders `ErrorBoundary` → `BrowserRouter` → `AppRouter` and nothing else.

- [ ] **Step 2: Remove the dependency**

Run from the repo root:

```bash
pnpm --filter @bitetime/frontend remove @vercel/analytics
```

- [ ] **Step 3: Correct the privacy notice**

In `apps/frontend/src/legal/documents.ts`, line 251 currently reads:

```ts
        'We also measure how our pages are used. That measurement is done by our own systems and by our hosting provider, does not identify you, and does not follow you to other websites.',
```

Replace it with:

```ts
        'We also measure how our pages are used. That measurement is done by our own systems, does not identify you, and does not follow you to other websites.',
```

The hosting provider no longer measures anything, and a privacy notice naming a recipient that receives nothing is a false statement in a legal document — the same rule `.env.example` states for TikTok.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @bitetime/frontend test && pnpm --filter @bitetime/frontend typecheck && pnpm lint`
Expected: PASS, `src/legal/legal.test.ts` included. If a legal test pins the old sentence, update the test to the new one — the notice is the source of truth.

- [ ] **Step 5: Confirm nothing still imports it**

Run: `grep -rn "@vercel/analytics" apps/frontend`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/main.tsx apps/frontend/package.json pnpm-lock.yaml \
        apps/frontend/src/legal/documents.ts
git commit -m "refactor(analytics): drop Vercel Analytics for first-party measurement"
```

---

### Task 7: Prove it against a running app

**Files:**
- Modify: none, unless a step fails.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

CLAUDE.md: the UI is verified by running the app, not by component tests. This task is that run. It needs a real site id, or a local Praxor with `VITE_PRAXOR_API_URL` pointed at it.

- [ ] **Step 1: Run the whole check suite**

Run from the repo root: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all four PASS.

- [ ] **Step 2: Start the app with analytics configured**

Set `VITE_PRAXOR_SITE_ID` in `apps/frontend/.env.local`, then run `pnpm dev` from the repo root. Open the browser's Network tab and filter on `analytics/track`.

- [ ] **Step 3: Check the marketing funnel**

Load `/`, navigate to `/pricing`, then click a signup CTA.
Expected: two `analytics/track` requests with no `name` (the pageviews), then one with `name: "cta_click"` carrying `from` and `cta`, then a third pageview for `/merchant/signup`.

- [ ] **Step 4: Check the storefront silence — the load-bearing one**

From `/pricing`, navigate to a storefront at `/s/:slug`, add an item, and open the checkout.
Expected: **zero** requests to `analytics/track`, on the initial navigation and on every move inside the storefront. A request here means the scope rule or the SDK's automatic capture is wrong; stop and fix it before anything else.

- [ ] **Step 5: Check the merchant funnel**

Complete a merchant signup with `stripe listen --forward-to http://localhost:8787/api/stripe/webhook` running.
Expected: `merchant_signup` with `{ billing }`, then `trial_started`, then a pageview for `/merchant`.

Then log out and log in at `/merchant/login`.
Expected: `merchant_login`, then a pageview for `/merchant`.

- [ ] **Step 6: Check that an unconfigured build is silent**

Remove `VITE_PRAXOR_SITE_ID` from `.env.local` and restart `pnpm dev`.
Expected: no request to any Praxor endpoint on any page, and no console error.

- [ ] **Step 7: Commit any fix, then hand over the environment variable**

Production needs `VITE_PRAXOR_SITE_ID` set in the Vercel project (Root Directory `apps/frontend`). That is a human's action in the Vercel dashboard; say so plainly and stop there. Until it is set, the deployed app measures nothing — which is the same silent state as a failed rollout, so check it on the first deploy.

---

## Self-review

**Spec coverage**

| Spec section | Task |
|---|---|
| Scope table | 2 |
| Automatic capture off | 4 |
| `config.ts` | 1 |
| `scope.ts` | 2 |
| `events.ts` and the event table | 3, 5 |
| `useAnalytics.ts`, pageviews, CTA listener | 4 |
| `@vercel/analytics` removal and the privacy edit | 6 |
| Tests: `scope.test.ts`, `config.test.ts`, `events.test.ts` | 1, 2, 3 |
| Verification steps 1-5 | 7 |
| No revenue attribution, no `sample_shop_opened`, no consent gate | not implemented, by design |

**Names** — `praxorSettings`/`PraxorSettings`, `isPlatformPath`, `setAnalyticsClient`, `trackEvent`, `AnalyticsEvent`, `Billing` are spelled the same in every task that uses them.
