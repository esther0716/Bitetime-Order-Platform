# Marketing Pixels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a Meta Pixel (and a TikTok Pixel that stays inert until an account exists) on TinyOrder's own marketing pages, behind an explicit consent banner, reporting a pageview and a completed shop signup.

**Architecture:** A new `src/pixels/` folder. Four pure modules answer four questions — which ids exist (`ids.ts`), is this a marketing route (`marketingPaths.ts`), what did the visitor choose (`consent.ts`), what do we tell the vendors (`track.ts`) — plus a `load.ts` that injects the vendor snippets. `usePixels.ts` is the only file that combines them and the only one that knows this is the platform rather than a merchant; it is mounted in `AppRouter` beside the existing `RouteToaster`, which it copies in shape.

**Tech Stack:** TypeScript, React 19, `react-router-dom` v7, Vitest (`environment: 'node'` — see constraints), Tailwind + the repo's `Button` primitive.

Spec: `docs/superpowers/specs/2026-08-11-marketing-pixels-design.md`. Issue: [#217](https://github.com/leongcheefai/Bitetime-Order-Platform/issues/217).

## Global Constraints

- **Never on storefronts.** No pixel code may run on `/s/:slug`, `/merchant`, `/admin`, `/reset-password` or `/releases/:tag`.
- **Nothing loads before Accept.** No third-party script tag may be created for a visitor who has not accepted, including one who has not answered yet.
- **No PII to either vendor.** No email, phone, name, shop name or slug is ever passed to `fbq` or `ttq`. Behavioural data only.
- **Absent env var = fully off.** With no `VITE_META_PIXEL_ID` and no `VITE_TIKTOK_PIXEL_ID`, nothing loads and the banner never renders. This is the state in dev, CI, Vitest and Playwright, and no test may stub around it.
- **The privacy notice names Meta only.** TikTok receives nothing today. Setting `VITE_TIKTOK_PIXEL_ID` requires naming TikTok in `src/legal/documents.ts` first.
- **Vitest runs in `environment: 'node'`** (`apps/frontend/vitest.config.ts`). There is no `localStorage`, `document` or `window`. Fake them on `globalThis` in `beforeEach` and delete them in `afterEach`, exactly as `src/checkoutGate.test.ts:44-58` does. Do not switch the config to jsdom.
- **All commands run from the repo root**, not from `apps/frontend`. Tests: `pnpm --filter @bitetime/frontend test`.
- **Bilingual UI.** Every user-visible string goes through `t(english, chinese)` from `useSession()`. The legal documents are the deliberate exception and stay English-only.
- **Commit after every task.** Conventional Commits, `Refs #217` in the body.

---

### Task 1: Pixel ids and the marketing-path predicate

The two questions that decide whether a visitor is in scope at all. Both pure, both trivially testable, and neither touches the DOM.

**Files:**
- Create: `apps/frontend/src/pixels/ids.ts`
- Create: `apps/frontend/src/pixels/ids.test.ts`
- Create: `apps/frontend/src/pixels/marketingPaths.ts`
- Create: `apps/frontend/src/pixels/marketingPaths.test.ts`
- Modify: `apps/frontend/.env.example`

**Interfaces:**
- Consumes: `ROUTE_META` from `apps/frontend/src/routeMeta.ts`; `canonicalPath(pathname: string): string` from `apps/frontend/src/canonical.ts`.
- Produces:
  - `interface PixelIds { meta?: string; tiktok?: string }`
  - `platformPixelIds(): PixelIds`
  - `hasAnyPixel(ids: PixelIds): boolean`
  - `isMarketingPath(pathname: string): boolean`

- [ ] **Step 1: Write the failing test for ids**

Create `apps/frontend/src/pixels/ids.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { platformPixelIds, hasAnyPixel } from './ids'

afterEach(() => { vi.unstubAllEnvs() })

describe('platformPixelIds', () => {
  it('reads nothing when neither variable is set', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '')
    vi.stubEnv('VITE_TIKTOK_PIXEL_ID', '')
    expect(platformPixelIds()).toEqual({ meta: undefined, tiktok: undefined })
  })

  it('reads each variable independently — one set, one pixel', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '123456789')
    vi.stubEnv('VITE_TIKTOK_PIXEL_ID', '')
    expect(platformPixelIds()).toEqual({ meta: '123456789', tiktok: undefined })
  })

  it('reads both when both are set', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '123456789')
    vi.stubEnv('VITE_TIKTOK_PIXEL_ID', 'CABCDEF')
    expect(platformPixelIds()).toEqual({ meta: '123456789', tiktok: 'CABCDEF' })
  })

  it('treats a whitespace-only value as unset, so a stray space cannot half-enable a pixel', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '   ')
    expect(platformPixelIds().meta).toBeUndefined()
  })

  it('trims a value that a dashboard copy-paste padded', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', ' 123456789 ')
    expect(platformPixelIds().meta).toBe('123456789')
  })
})

describe('hasAnyPixel', () => {
  it('is false when nothing is configured — the whole feature is then off', () => {
    expect(hasAnyPixel({})).toBe(false)
    expect(hasAnyPixel({ meta: undefined, tiktok: undefined })).toBe(false)
  })

  it('is true for either vendor alone', () => {
    expect(hasAnyPixel({ meta: '1' })).toBe(true)
    expect(hasAnyPixel({ tiktok: 'C1' })).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @bitetime/frontend test -- src/pixels/ids.test.ts`
Expected: FAIL — cannot resolve `./ids`.

- [ ] **Step 3: Write `ids.ts`**

Create `apps/frontend/src/pixels/ids.ts`:

```ts
// WHICH advertising pixels exist, as data rather than as an `if` buried in a hook.
//
// Deliberately a plain value object with two optional fields, not two booleans and two constants:
// this is the type the merchant-pixel feature (#220) hands over per shop, read off the merchant
// row instead of the environment. Everything downstream of here takes a PixelIds and asks no
// question about where it came from — that seam is the reason this ships first.
//
// An id is public: it ships in the page, and Meta and TikTok both treat it as such. The env var
// is not a secret, it is a switch.

export interface PixelIds {
  /** Meta (Facebook) pixel id. */
  meta?: string
  /** TikTok pixel id. */
  tiktok?: string
}

/**
 * Empty, whitespace and unset all mean the same thing: no pixel.
 *
 * A Vercel variable set to a blank string is the shape of a half-finished configuration, and
 * `''` is truthy to nobody but is a perfectly good value to inject into a vendor snippet — which
 * would then initialise a pixel with no id and report to nowhere, silently.
 */
function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** The platform's own ids, from the build environment. */
export function platformPixelIds(): PixelIds {
  return {
    meta: configured(import.meta.env.VITE_META_PIXEL_ID),
    tiktok: configured(import.meta.env.VITE_TIKTOK_PIXEL_ID),
  }
}

/**
 * Is anything configured at all?
 *
 * The gate on the whole feature, banner included. With neither id set nothing loads and nothing
 * renders, which is what keeps dev, CI, Vitest and Playwright free of third-party scripts with
 * no stubbing anywhere.
 */
export function hasAnyPixel(ids: PixelIds): boolean {
  return Boolean(ids.meta || ids.tiktok)
}
```

- [ ] **Step 4: Run the ids test and confirm it passes**

Run: `pnpm --filter @bitetime/frontend test -- src/pixels/ids.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing test for the marketing-path predicate**

Create `apps/frontend/src/pixels/marketingPaths.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isMarketingPath } from './marketingPaths'
import { ROUTE_META } from '../routeMeta'

describe('isMarketingPath', () => {
  it('is true for every page that has its own title — that IS the marketing set', () => {
    for (const path of Object.keys(ROUTE_META)) {
      expect(isMarketingPath(path), path).toBe(true)
    }
  })

  it('is true for the pages by name, so a deletion from ROUTE_META cannot pass silently', () => {
    for (const path of ['/', '/pricing', '/features', '/faq', '/sample-shops',
                        '/terms', '/privacy', '/merchant/signup', '/merchant/login',
                        '/for/home-bakers']) {
      expect(isMarketingPath(path), path).toBe(true)
    }
  })

  it('is false on a storefront — a shop’s customers are never TinyOrder’s ad audience', () => {
    expect(isMarketingPath('/s/kopi-corner')).toBe(false)
    expect(isMarketingPath('/s/kopi-corner/orders')).toBe(false)
  })

  it('is false on the signed-in surfaces', () => {
    expect(isMarketingPath('/merchant')).toBe(false)
    expect(isMarketingPath('/merchant/kopi-corner')).toBe(false)
    expect(isMarketingPath('/admin')).toBe(false)
    expect(isMarketingPath('/admin/merchants')).toBe(false)
  })

  it('is false on the routes with no title of their own', () => {
    expect(isMarketingPath('/reset-password')).toBe(false)
    expect(isMarketingPath('/releases/v1.2.0')).toBe(false)
  })

  it('follows a signup preselection back to the one page it preselects', () => {
    expect(isMarketingPath('/merchant/signup/pro/yearly')).toBe(true)
    expect(isMarketingPath('/merchant/signup/basic')).toBe(true)
  })

  it('ignores a trailing slash, which is the same page', () => {
    expect(isMarketingPath('/pricing/')).toBe(true)
    expect(isMarketingPath('/')).toBe(true)
  })

  it('treats an empty pathname as the homepage rather than as nothing', () => {
    expect(isMarketingPath('')).toBe(true)
  })
})
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `pnpm --filter @bitetime/frontend test -- src/pixels/marketingPaths.test.ts`
Expected: FAIL — cannot resolve `./marketingPaths`.

- [ ] **Step 7: Write `marketingPaths.ts`**

Create `apps/frontend/src/pixels/marketingPaths.ts`:

```ts
// WHERE the platform's own pixels are allowed to fire.
//
// DERIVED, never hand-maintained. ROUTE_META's keys already are the set of public pages that have
// a title and a description of their own — the marketing pages plus the two app pages sitemap.xml
// lists plus the two legal documents. A second list spelling the same set out again is a list that
// drifts, and the drift here is not cosmetic: a new marketing page would silently lose its
// tracking, and, far worse, a new route shape under /s/ would silently gain it.
//
// Everything absent from that table is excluded for free and for the right reason: a storefront,
// a dashboard and an admin screen have no build-time title precisely because they are not pages
// we publish. /reset-password and /releases/:tag fall out for the same reason.
//
// Note what is deliberately IN: /merchant/signup. It is the page an ad lands on and the page the
// conversion happens on.

import { ROUTE_META } from '../routeMeta'
import { canonicalPath } from '../canonical'

/**
 * Is this path one of TinyOrder's own published pages?
 *
 * Normalised the same two ways the canonical URL is, so that one route cannot answer differently
 * depending on how the visitor typed it: a trailing slash is dropped (except at the root, where
 * the slash IS the path), and a signup preselection like `/merchant/signup/pro/yearly` collapses
 * to the single page it preselects.
 */
export function isMarketingPath(pathname: string): boolean {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return canonicalPath(trimmed || '/') in ROUTE_META
}
```

- [ ] **Step 8: Run the marketing-path test and confirm it passes**

Run: `pnpm --filter @bitetime/frontend test -- src/pixels/marketingPaths.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 9: Document the two variables**

Append to `apps/frontend/.env.example`:

```
# Advertising pixels on the MARKETING PAGES ONLY (never on a shop's storefront). Unset here on
# purpose: with neither set, no third-party script is ever requested and the consent banner never
# renders, which is the state dev, CI and the e2e run need. Set them in Vercel, not here.
#
# ⚠ Setting VITE_TIKTOK_PIXEL_ID requires naming TikTok in src/legal/documents.ts FIRST. The
# privacy notice names Meta only today, because TikTok currently receives nothing — and a notice
# that names a recipient of personal data which receives none is a false statement in a legal
# document. The env var is the switch; the notice is the precondition.
VITE_META_PIXEL_ID=
VITE_TIKTOK_PIXEL_ID=
```

- [ ] **Step 10: Run the whole frontend suite, then commit**

Run: `pnpm --filter @bitetime/frontend test`
Expected: PASS, no previously-passing test broken.

```bash
git add apps/frontend/src/pixels/ids.ts apps/frontend/src/pixels/ids.test.ts \
        apps/frontend/src/pixels/marketingPaths.ts apps/frontend/src/pixels/marketingPaths.test.ts \
        apps/frontend/.env.example
git commit -m "feat(pixels): decide which pixels exist and which pages may fire them

The marketing set is DERIVED from ROUTE_META rather than written out a
second time. A hand-kept list drifts, and the drift is not cosmetic: a new
route under /s/ would silently start tracking a shop's customers.

Neither env var is set anywhere in the repo, so nothing loads in dev, CI or
the e2e run and no test needs to stub around it.

Refs #217"
```

---

### Task 2: The consent store

**Files:**
- Create: `apps/frontend/src/pixels/consent.ts`
- Create: `apps/frontend/src/pixels/consent.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type ConsentChoice = 'accepted' | 'rejected'`
  - `const PLATFORM_CONSENT_SCOPE = 'platform'`
  - `readConsent(scope: string): ConsentChoice | null`
  - `writeConsent(scope: string, choice: ConsentChoice): void`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/pixels/consent.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readConsent, writeConsent, PLATFORM_CONSENT_SCOPE } from './consent'

const store = new Map<string, string>()
const fake = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}

beforeEach(() => {
  store.clear()
  ;(globalThis as any).localStorage = fake
})
afterEach(() => {
  delete (globalThis as any).localStorage
})

describe('consent', () => {
  it('has made no choice until one is made', () => {
    expect(readConsent(PLATFORM_CONSENT_SCOPE)).toBeNull()
  })

  it('round-trips an acceptance', () => {
    writeConsent(PLATFORM_CONSENT_SCOPE, 'accepted')
    expect(readConsent(PLATFORM_CONSENT_SCOPE)).toBe('accepted')
  })

  it('round-trips a rejection, which is a real answer and not an absent one', () => {
    writeConsent(PLATFORM_CONSENT_SCOPE, 'rejected')
    expect(readConsent(PLATFORM_CONSENT_SCOPE)).toBe('rejected')
  })

  it('keeps scopes apart, so a shop’s banner is not answered by the platform’s', () => {
    writeConsent(PLATFORM_CONSENT_SCOPE, 'accepted')
    expect(readConsent('shop:kopi-corner')).toBeNull()
  })

  it('records when the choice was made, so a future version can expire it', () => {
    writeConsent(PLATFORM_CONSENT_SCOPE, 'accepted')
    const raw = JSON.parse(store.get('to_consent_v1.platform')!)
    expect(raw).toMatchObject({ scope: 'platform', choice: 'accepted' })
    expect(typeof raw.ts).toBe('number')
  })

  it('reads corrupt storage as no choice, never as consent', () => {
    store.set('to_consent_v1.platform', 'not json')
    expect(readConsent(PLATFORM_CONSENT_SCOPE)).toBeNull()
  })

  it('reads an unrecognised choice as no choice, never as consent', () => {
    store.set('to_consent_v1.platform', JSON.stringify({ scope: 'platform', choice: 'maybe', ts: 1 }))
    expect(readConsent(PLATFORM_CONSENT_SCOPE)).toBeNull()
  })

  it('fails closed when storage is unavailable, and never throws', () => {
    // Private-mode Safari throws on write; node/SSR has no localStorage at all. Either way the
    // honest answer is "no choice made" — the banner asks again and the pixels stay unloaded.
    delete (globalThis as any).localStorage
    expect(readConsent(PLATFORM_CONSENT_SCOPE)).toBeNull()
    expect(() => writeConsent(PLATFORM_CONSENT_SCOPE, 'accepted')).not.toThrow()

    ;(globalThis as any).localStorage = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    expect(readConsent(PLATFORM_CONSENT_SCOPE)).toBeNull()
    expect(() => writeConsent(PLATFORM_CONSENT_SCOPE, 'accepted')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @bitetime/frontend test -- src/pixels/consent.test.ts`
Expected: FAIL — cannot resolve `./consent`.

- [ ] **Step 3: Write `consent.ts`**

Create `apps/frontend/src/pixels/consent.ts`:

```ts
// What the visitor answered when asked about advertising cookies.
//
// FAILS CLOSED, everywhere and on purpose. Storage missing, storage throwing, stored JSON
// corrupt, stored choice unrecognised — every one of them reads as "no choice made", which shows
// the banner again and leaves the pixels unloaded. The failure mode of the opposite default is a
// third-party script running for someone who never agreed to it, which is the whole thing this
// module exists to prevent.
//
// SCOPED, because the merchant-pixel feature (#220) puts a second, unrelated question in front of
// a different audience: a customer's answer at `shop:kopi-corner` must not be read as an answer to
// TinyOrder's own banner, and vice versa.

export type ConsentChoice = 'accepted' | 'rejected'

/** The scope of TinyOrder's own banner, on its own marketing pages. */
export const PLATFORM_CONSENT_SCOPE = 'platform'

// VERSIONED so that adding a vendor can invalidate stored consent by bumping to v2, rather than
// treating an answer given about Meta as an answer about someone else. Silently reusing it would
// claim the visitor agreed to something they were never shown.
const KEY_PREFIX = 'to_consent_v1'

interface StoredConsent {
  scope: string
  choice: ConsentChoice
  /** Epoch ms. Unused today; here so a future expiry does not need a v2 to become possible. */
  ts: number
}

function keyFor(scope: string): string {
  return `${KEY_PREFIX}.${scope}`
}

export function readConsent(scope: string): ConsentChoice | null {
  try {
    const raw = localStorage.getItem(keyFor(scope))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredConsent
    return parsed.choice === 'accepted' || parsed.choice === 'rejected' ? parsed.choice : null
  } catch {
    return null
  }
}

export function writeConsent(scope: string, choice: ConsentChoice): void {
  try {
    const stored: StoredConsent = { scope, choice, ts: Date.now() }
    localStorage.setItem(keyFor(scope), JSON.stringify(stored))
  } catch {
    // Storage unavailable. The choice still holds for this page's lifetime, because the caller
    // keeps it in React state; it is simply not remembered for the next visit.
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @bitetime/frontend test -- src/pixels/consent.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/pixels/consent.ts apps/frontend/src/pixels/consent.test.ts
git commit -m "feat(pixels): remember the advertising-cookie choice, and fail closed

Missing storage, throwing storage, corrupt JSON and an unrecognised value
all read as no choice made. The banner then asks again and nothing loads.
The opposite default runs a third-party script for someone who never agreed.

The key carries a scope, so the merchant-pixel banner (#220) asks its own
question of a different audience without reading this answer.

Refs #217"
```

---

### Task 3: Injecting the vendor snippets

**Files:**
- Create: `apps/frontend/src/pixels/load.ts`
- Create: `apps/frontend/src/pixels/load.test.ts`

**Interfaces:**
- Consumes: `PixelIds` from `./ids`.
- Produces: `loadPixels(ids: PixelIds): void`

**Note on the snippets:** both are the vendors' own base code, pasted verbatim with the id interpolated, and **with the vendors' trailing `fbq('track','PageView')` / `ttq.page()` removed**. Do not rewrite them by hand in TypeScript: `ttq`'s shim sets up internals (`_i`, `_t`, `_o`, `instance`) that the real `events.js` reads back, and a hand-made copy that drifts from the vendor's fails invisibly. There is no CSP on this project (`apps/frontend/vercel.json` sets only cache headers), so an inline `<script>` runs.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/pixels/load.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

interface FakeScript { textContent: string; dataset: Record<string, string> }

const head: FakeScript[] = []

function installFakeDocument() {
  head.length = 0
  ;(globalThis as any).document = {
    createElement: (): FakeScript => ({ textContent: '', dataset: {} }),
    head: { appendChild: (el: FakeScript) => { head.push(el) } },
  }
}

beforeEach(() => {
  vi.resetModules() // load.ts remembers what it injected; each test needs a fresh module
  installFakeDocument()
})
afterEach(() => {
  delete (globalThis as any).document
})

async function loader() {
  return (await import('./load')).loadPixels
}

describe('loadPixels', () => {
  it('injects nothing when no id is configured', async () => {
    const loadPixels = await loader()
    loadPixels({})
    expect(head).toHaveLength(0)
  })

  it('injects only the vendor whose id is set', async () => {
    const loadPixels = await loader()
    loadPixels({ meta: '123456789' })
    expect(head).toHaveLength(1)
    expect(head[0].dataset.pixel).toBe('meta')
    expect(head[0].textContent).toContain('123456789')
    expect(head[0].textContent).toContain('connect.facebook.net')
  })

  it('injects both when both ids are set', async () => {
    const loadPixels = await loader()
    loadPixels({ meta: '123456789', tiktok: 'CABCDEF' })
    expect(head.map(s => s.dataset.pixel)).toEqual(['meta', 'tiktok'])
    expect(head[1].textContent).toContain('CABCDEF')
    expect(head[1].textContent).toContain('analytics.tiktok.com')
  })

  it('fires no pageview of its own — one code path owns pageviews', async () => {
    const loadPixels = await loader()
    loadPixels({ meta: '123456789', tiktok: 'CABCDEF' })
    expect(head[0].textContent).not.toContain('PageView')
    expect(head[1].textContent).not.toContain('ttq.page()')
  })

  it('injects once however many times it is called', async () => {
    const loadPixels = await loader()
    loadPixels({ meta: '123456789' })
    loadPixels({ meta: '123456789' })
    loadPixels({ meta: '123456789' })
    expect(head).toHaveLength(1)
  })

  it('does not throw where there is no document', async () => {
    const loadPixels = await loader()
    delete (globalThis as any).document
    expect(() => loadPixels({ meta: '123456789' })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @bitetime/frontend test -- src/pixels/load.test.ts`
Expected: FAIL — cannot resolve `./load`.

- [ ] **Step 3: Write `load.ts`**

Create `apps/frontend/src/pixels/load.ts`:

```ts
// The only file in this folder that touches a third party.
//
// It is called from exactly one place — usePixels, after the visitor accepts — and every rule
// about who gets tracked is decided BEFORE control reaches here. That is deliberate: a module
// that both decides and injects is one where a refactor can quietly reorder the two.
//
// The snippets below are the vendors' own base code, verbatim, with the id interpolated and with
// their trailing pageview call REMOVED. Do not rewrite them by hand: ttq's shim builds internals
// (_i, _t, _o, instance) that the real events.js reads back, and a hand-made copy that drifts from
// the vendor's own fails silently. Refresh them by re-copying from the vendors, keeping the two
// edits noted here.
//
// Both snippets create their own async <script>, and this runs only after Accept — so neither
// vendor is ever on the critical path or visible to the preload scanner. That matters here more
// than most places: index.css and index.html exist in their current shape because two cold
// third-party origins in series cost 793ms of a 2.75s mobile FCP once already.

import type { PixelIds } from './ids'

// Keyed by vendor AND id rather than a single boolean, so that a second pixel id in one session
// still loads. Not reachable today (the platform's ids are fixed at build time) and squarely a
// #220 concern, where a customer may see two shops in one SPA session.
const injected = new Set<string>()

// The vendor's snippet minus its trailing `fbq('track','PageView')`. Its own `if(f.fbq)return`
// guard skips only the shim setup, so a later `fbq('init', <other id>)` still runs.
function metaSnippet(id: string): string {
  return `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?` +
    `n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;` +
    `n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;` +
    `t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,` +
    `document,'script','https://connect.facebook.net/en_US/fbevents.js');` +
    `fbq('init','${id}');`
}

// The vendor's snippet minus its trailing `ttq.page()`.
function tiktokSnippet(id: string): string {
  return `!function (w, d, t) {w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];` +
    `ttq.methods=["page","track","identify","instances","debug","on","off","once","ready",` +
    `"alias","group","enableCookie","disableCookie","holdConsent","revokeConsent",` +
    `"grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){` +
    `t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};` +
    `for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);` +
    `ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)` +
    `ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){` +
    `var r="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},` +
    `ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},` +
    `ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",` +
    `n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];` +
    `e.parentNode.insertBefore(n,e)};ttq.load('${id}');}(window, document, 'ttq');`
}

function inject(vendor: 'meta' | 'tiktok', id: string, code: string): void {
  const key = `${vendor}:${id}`
  if (injected.has(key)) return
  injected.add(key)
  const el = document.createElement('script')
  el.dataset.pixel = vendor
  el.textContent = code
  document.head.appendChild(el)
}

/**
 * Load whichever pixels the given ids name. Idempotent per vendor and id.
 *
 * Callers must already have established that the visitor accepted. This function asks no such
 * question, and must not be given the chance to answer one wrongly.
 */
export function loadPixels(ids: PixelIds): void {
  if (typeof document === 'undefined') return
  if (ids.meta) inject('meta', ids.meta, metaSnippet(ids.meta))
  if (ids.tiktok) inject('tiktok', ids.tiktok, tiktokSnippet(ids.tiktok))
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @bitetime/frontend test -- src/pixels/load.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/pixels/load.ts apps/frontend/src/pixels/load.test.ts
git commit -m "feat(pixels): inject the Meta and TikTok base snippets on demand

The vendors' own snippets, verbatim, minus their trailing pageview call —
one code path owns pageviews instead of two. Rewriting ttq's shim by hand
would drift from the internals its own events.js reads back.

This file decides nothing. Whether the visitor may be tracked is settled
before control reaches it, so a refactor cannot reorder the two.

Refs #217"
```

---

### Task 4: Reporting events

**Files:**
- Create: `apps/frontend/src/pixels/track.ts`
- Create: `apps/frontend/src/pixels/track.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — it reads `globalThis.fbq` / `globalThis.ttq` at call time.
- Produces:
  - `pixelPageView(): void`
  - `pixelTrack(event: string, params?: Record<string, unknown>): void`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/pixels/track.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pixelPageView, pixelTrack } from './track'

let fbqCalls: unknown[][]
let ttqPageCalls: number
let ttqTrackCalls: unknown[][]

beforeEach(() => {
  fbqCalls = []
  ttqPageCalls = 0
  ttqTrackCalls = []
  ;(globalThis as any).fbq = (...args: unknown[]) => { fbqCalls.push(args) }
  ;(globalThis as any).ttq = {
    page: () => { ttqPageCalls += 1 },
    track: (...args: unknown[]) => { ttqTrackCalls.push(args) },
  }
})
afterEach(() => {
  delete (globalThis as any).fbq
  delete (globalThis as any).ttq
})

describe('pixelPageView', () => {
  it('tells both vendors a page was viewed', () => {
    pixelPageView()
    expect(fbqCalls).toEqual([['track', 'PageView']])
    expect(ttqPageCalls).toBe(1)
  })
})

describe('pixelTrack', () => {
  it('reports a named event to both vendors', () => {
    pixelTrack('CompleteRegistration')
    expect(fbqCalls).toEqual([['track', 'CompleteRegistration']])
    expect(ttqTrackCalls).toEqual([['CompleteRegistration']])
  })

  it('passes parameters through when there are any', () => {
    pixelTrack('CompleteRegistration', { plan: 'basic' })
    expect(fbqCalls).toEqual([['track', 'CompleteRegistration', { plan: 'basic' }]])
    expect(ttqTrackCalls).toEqual([['CompleteRegistration', { plan: 'basic' }]])
  })
})

describe('when the vendors are not there', () => {
  it('does nothing before the snippets have loaded', () => {
    delete (globalThis as any).fbq
    delete (globalThis as any).ttq
    expect(() => pixelPageView()).not.toThrow()
    expect(() => pixelTrack('CompleteRegistration')).not.toThrow()
  })

  it('survives a vendor that throws, which an ad blocker can produce', () => {
    ;(globalThis as any).fbq = () => { throw new Error('blocked') }
    ;(globalThis as any).ttq = {
      page: () => { throw new Error('blocked') },
      track: () => { throw new Error('blocked') },
    }
    expect(() => pixelPageView()).not.toThrow()
    expect(() => pixelTrack('CompleteRegistration')).not.toThrow()
  })

  it('ignores a global that is not the shape it expects', () => {
    ;(globalThis as any).fbq = 'not a function'
    ;(globalThis as any).ttq = { page: 'not a function' }
    expect(() => pixelPageView()).not.toThrow()
  })

  it('still reaches the vendor that IS there when the other is missing', () => {
    delete (globalThis as any).ttq
    pixelPageView()
    expect(fbqCalls).toEqual([['track', 'PageView']])
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @bitetime/frontend test -- src/pixels/track.test.ts`
Expected: FAIL — cannot resolve `./track`.

- [ ] **Step 3: Write `track.ts`**

Create `apps/frontend/src/pixels/track.ts`:

```ts
// What we tell the vendors. Two verbs, and nothing else may be added without re-reading the
// privacy notice, which describes exactly this and nothing more.
//
// NO PII EVER. No email, phone, name, shop name or slug is passed to either vendor. That is not a
// style preference: src/legal/documents.ts states that these pixels receive the pages you viewed
// and whether you created a shop, and a parameter added here without changing that sentence makes
// a legal document false.
//
// Every call is guarded twice — for a global that is absent (the snippets have not loaded, or an
// ad blocker removed them) and for one that throws. These fire from route effects, and a throw in
// a route effect takes down the navigation, which would trade a missing analytics event for a
// broken page.

type FbqFn = (...args: unknown[]) => void
interface TtqObject {
  page: () => void
  track: (event: string, params?: Record<string, unknown>) => void
}

function fbq(): FbqFn | null {
  const fn = (globalThis as { fbq?: unknown }).fbq
  return typeof fn === 'function' ? (fn as FbqFn) : null
}

function ttq(): TtqObject | null {
  const obj = (globalThis as { ttq?: unknown }).ttq as TtqObject | undefined
  return obj && typeof obj.page === 'function' && typeof obj.track === 'function' ? obj : null
}

function quietly(run: () => void): void {
  try {
    run()
  } catch {
    // An ad blocker can leave a global that throws. A missing report is acceptable; a route
    // transition that dies inside an effect is not.
  }
}

/** One pageview, to whichever vendors are loaded. Called per marketing route, including the first. */
export function pixelPageView(): void {
  quietly(() => fbq()?.('track', 'PageView'))
  quietly(() => ttq()?.page())
}

/** One named conversion. `CompleteRegistration` is the only caller today. */
export function pixelTrack(event: string, params?: Record<string, unknown>): void {
  quietly(() => {
    const fn = fbq()
    if (!fn) return
    if (params) fn('track', event, params)
    else fn('track', event)
  })
  quietly(() => {
    const obj = ttq()
    if (!obj) return
    if (params) obj.track(event, params)
    else obj.track(event)
  })
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @bitetime/frontend test -- src/pixels/track.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/pixels/track.ts apps/frontend/src/pixels/track.test.ts
git commit -m "feat(pixels): report a pageview and a named conversion

Two verbs and no personal data. The privacy notice states that these pixels
receive the pages you viewed and whether you created a shop, so a parameter
added here without changing that sentence makes a legal document false.

Guarded for a global that is absent and for one that throws: these fire from
route effects, and an ad blocker must not be able to break a navigation.

Refs #217"
```

---

### Task 5: The banner and the wiring

The first task that renders anything. Verified by running the app, per CLAUDE.md — there are no component tests in this repo.

**Files:**
- Create: `apps/frontend/src/pixels/ConsentBanner.tsx`
- Create: `apps/frontend/src/pixels/usePixels.ts`
- Modify: `apps/frontend/src/AppRouter.tsx` (add a lazy import beside the others at lines 38-49; add a `PixelConsent` component and mount it beside `<RouteToaster />` at line 136)

**Interfaces:**
- Consumes: `platformPixelIds`, `hasAnyPixel`, `PixelIds` from `./ids`; `isMarketingPath` from `./marketingPaths`; `readConsent`, `writeConsent`, `PLATFORM_CONSENT_SCOPE`, `ConsentChoice` from `./consent`; `loadPixels` from `./load`; `pixelPageView` from `./track`; `useSession` from `../SessionContext`; `Button` from `../components/ui/button`.
- Produces: `usePixels(): { showBanner: boolean; accept: () => void; reject: () => void }`; a default-exported `ConsentBanner` taking `{ onAccept: () => void; onReject: () => void }`.

- [ ] **Step 1: Write `usePixels.ts`**

Create `apps/frontend/src/pixels/usePixels.ts`:

```ts
// The ONE file that knows this is the platform's own tracking.
//
// Everything it calls takes its inputs as arguments and reads no environment and no route table.
// That is what lets the merchant-pixel feature (#220) add a sibling hook — ids off MerchantContext,
// scope `shop:<slug>` — and reuse load, track, consent and the banner untouched.

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { platformPixelIds, hasAnyPixel } from './ids'
import { isMarketingPath } from './marketingPaths'
import { readConsent, writeConsent, PLATFORM_CONSENT_SCOPE } from './consent'
import type { ConsentChoice } from './consent'
import { loadPixels } from './load'
import { pixelPageView } from './track'

// Read once at module scope: the ids are inlined at build time and cannot change while the app
// runs, and re-reading them per render would be re-deriving a constant.
const IDS = platformPixelIds()
const CONFIGURED = hasAnyPixel(IDS)

export interface PixelsState {
  /** Ask the visitor. False once they have answered, and false wherever we would not track them. */
  showBanner: boolean
  accept: () => void
  reject: () => void
}

export function usePixels(): PixelsState {
  const { pathname } = useLocation()
  const onMarketingPath = isMarketingPath(pathname)

  // Read during the FIRST render, not in an effect. An effect would render `null` first and then
  // flash the banner at someone who accepted months ago. Safe to do here because this component
  // never renders during the prerender: scripts/prerender.tsx renders each route element directly
  // rather than mounting AppRouter, and readConsent answers null without storage anyway.
  const [choice, setChoice] = useState<ConsentChoice | null>(
    () => readConsent(PLATFORM_CONSENT_SCOPE),
  )

  // The single point at which a third-party script may exist. Nothing else calls loadPixels.
  useEffect(() => {
    if (!CONFIGURED || choice !== 'accepted') return
    loadPixels(IDS)
  }, [choice])

  // One pageview per marketing route, the first one included. A non-marketing route reports
  // nothing: the script stays in the document because an SPA cannot unload it, but it is never
  // told anything — which is how a storefront visit reaches no ad account.
  useEffect(() => {
    if (!CONFIGURED || choice !== 'accepted' || !onMarketingPath) return
    pixelPageView()
  }, [choice, onMarketingPath, pathname])

  return {
    showBanner: CONFIGURED && onMarketingPath && choice === null,
    accept: () => {
      writeConsent(PLATFORM_CONSENT_SCOPE, 'accepted')
      setChoice('accepted')
    },
    reject: () => {
      writeConsent(PLATFORM_CONSENT_SCOPE, 'rejected')
      setChoice('rejected')
    },
  }
}
```

- [ ] **Step 2: Write `ConsentBanner.tsx`**

Create `apps/frontend/src/pixels/ConsentBanner.tsx`:

```tsx
// The question itself. Knows nothing about ids, routes or storage — it takes two callbacks.
//
// ACCEPT AND REJECT ARE THE SAME CONTROL AT THE SAME SIZE. A greyed-out, hidden or link-styled
// Reject beside a filled Accept is the specific pattern regulators cite as invalid consent, and
// it is also the one a reviewer is most likely to "tidy" without knowing why it is deliberate.

import { Link } from 'react-router-dom'
import { useSession } from '../SessionContext'
import { Button } from '../components/ui/button'

export default function ConsentBanner({
  onAccept,
  onReject,
}: {
  onAccept: () => void
  onReject: () => void
}) {
  const { t } = useSession()
  return (
    <div
      role="region"
      aria-label={t('Advertising cookies', '广告 Cookie')}
      className="fixed inset-x-0 bottom-0 z-50 border-t-[0.5px] border-border bg-card px-4 py-3 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]"
    >
      <div className="mx-auto flex max-w-[720px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-[1.6] text-muted-foreground">
          {t(
            'We use advertising cookies on our own pages to measure our advertising. They load only if you accept, and never on a shop’s page.',
            '我们在自己的页面上使用广告 Cookie 来衡量广告效果。只有你接受后才会加载，店铺页面上永远不会使用。',
          )}{' '}
          <Link to="/privacy" className="text-primary underline underline-offset-2">
            {t('Privacy Policy', '隐私政策')}
          </Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={onReject}>
            {t('Reject', '拒绝')}
          </Button>
          <Button size="sm" onClick={onAccept}>
            {t('Accept', '接受')}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Mount it in `AppRouter.tsx`**

Add beside the other lazy imports (after line 49, `const Toaster = lazy(...)`):

```tsx
// Lazy for the same reason the toaster is: the marketing entry chunk must not carry a component
// that most visits never render. It is only ever asked for after a visitor with a pixel
// configured reaches a marketing route without having answered.
const ConsentBanner = lazy(() => import('./pixels/ConsentBanner'))
```

Add the import beside the other hook imports (after line 10, `import { useDocumentMeta } from './documentMeta'`):

```tsx
import { usePixels } from './pixels/usePixels'
```

Add this component immediately after `RouteToaster` (i.e. after the closing brace of the function beginning at line 156):

```tsx
// The advertising pixels and the question that gates them. Mounted here, beside RouteToaster and
// for the same reason: it is route-aware and app-wide, and it belongs outside AnimatedRoutes so a
// page transition does not animate it.
//
// The hook is called unconditionally — the pageview effects live inside it and must run whether or
// not the banner is on screen. Only the banner itself is conditional.
function PixelConsent() {
  const { showBanner, accept, reject } = usePixels()
  if (!showBanner) return null
  return (
    <Suspense fallback={null}>
      <ConsentBanner onAccept={accept} onReject={reject} />
    </Suspense>
  )
}
```

Mount it in `AppRouter` (line 136), after `<RouteToaster />`:

```tsx
      <RouteToaster />
      <PixelConsent />
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both PASS.

- [ ] **Step 5: Confirm the feature is inert with no env vars**

Run: `pnpm --filter @bitetime/frontend dev`

In the browser at `http://localhost:5173/`:
- No consent banner appears.
- DevTools → Network shows no request to `connect.facebook.net` or `analytics.tiktok.com`.
- DevTools → Console: `typeof fbq` is `"undefined"`.

This is the state CI and the e2e run are in. Leave the dev server running for the next step.

- [ ] **Step 6: Confirm the feature works with an env var set**

Stop the dev server. Create `apps/frontend/.env.local` (git-ignored) with a real-shaped test id and restart:

```bash
echo 'VITE_META_PIXEL_ID=000000000000000' >> apps/frontend/.env.local
pnpm --filter @bitetime/frontend dev
```

Verify each of these in the browser, clearing `localStorage` between runs
(`localStorage.removeItem('to_consent_v1.platform')`):

| Where | Expected |
|---|---|
| `/` | Banner appears. No request to `connect.facebook.net`. |
| `/` → click **Reject** | Banner disappears. Still no request. Reload: banner does not return, still no request. |
| `/` → click **Accept** | Banner disappears. `connect.facebook.net/en_US/fbevents.js` is requested once. Console `typeof fbq` is `"function"`. |
| After Accept, click to `/pricing`, `/features` | No second `fbevents.js` request; one `/tr?...&ev=PageView` beacon per route. |
| After Accept, visit `/s/<any active shop>` | **No `ev=PageView` beacon.** This is the constraint that matters most — check it explicitly. |
| `/s/<slug>` with `localStorage` cleared | **No banner.** |
| `/merchant` with `localStorage` cleared | **No banner.** |
| Switch the language to 中文 | Banner text and both buttons are Chinese. |
| 375px-wide viewport | Banner stacks, both buttons reachable, nothing overflows. |

- [ ] **Step 7: Remove the local test id**

Delete the `VITE_META_PIXEL_ID` line from `apps/frontend/.env.local`. Confirm `git status` shows no change to any env file — `.env.local` is git-ignored and must stay untracked.

- [ ] **Step 8: Run the full suite and commit**

Run: `pnpm --filter @bitetime/frontend test`
Expected: PASS.

```bash
git add apps/frontend/src/pixels/usePixels.ts apps/frontend/src/pixels/ConsentBanner.tsx \
        apps/frontend/src/AppRouter.tsx
git commit -m "feat(pixels): ask before loading, then report marketing pageviews

usePixels is the only file that knows this is the platform's own tracking.
Everything below it takes its inputs as arguments, so the merchant pixels
(#220) add a sibling hook rather than a second copy.

Accept and Reject are the same control at the same size. A greyed-out
Reject beside a filled Accept is invalid consent, not a tidier layout.

The consent choice is read during the first render rather than in an effect,
so a returning visitor who accepted does not see the banner flash.

Refs #217"
```

---

### Task 6: Report the one conversion

**Files:**
- Modify: `apps/frontend/src/merchant/SignupScreen.tsx:3` (imports) and `:87-88` (after the `created.ok` check)

**Interfaces:**
- Consumes: `pixelTrack` from `../pixels/track`.
- Produces: nothing.

- [ ] **Step 1: Add the import**

In `apps/frontend/src/merchant/SignupScreen.tsx`, beside the existing store import on line 3:

```ts
import { pixelTrack } from '../pixels/track'
```

- [ ] **Step 2: Fire the event**

The current code at lines 86-89 reads:

```ts
      const created = await createMerchant({ name, plan, billing, referredByCode: ref, businessNature, currency })
      if (!created.ok) { setMsg(created.error.message || t('Something went wrong.', '出错了。')); setBusy(false); return }
      await refreshMerchant()
      if (plan === 'basic') {
```

Insert the call between the `created.ok` guard and `refreshMerchant()`:

```ts
      const created = await createMerchant({ name, plan, billing, referredByCode: ref, businessNature, currency })
      if (!created.ok) { setMsg(created.error.message || t('Something went wrong.', '出错了。')); setBusy(false); return }
      // The one conversion the marketing pixels report, and it has to be here rather than on the
      // page the merchant lands on: /merchant is outside the marketing scope, and a Pro signup
      // leaves for Stripe Checkout without ever reaching it. The shop exists at this line in both
      // branches. A no-op unless the visitor accepted — see track.ts.
      pixelTrack('CompleteRegistration')
      await refreshMerchant()
      if (plan === 'basic') {
```

- [ ] **Step 3: Typecheck, lint and test**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @bitetime/frontend test`
Expected: all PASS.

- [ ] **Step 4: Verify in the browser**

With `VITE_META_PIXEL_ID=000000000000000` in `apps/frontend/.env.local` and local Supabase running (`supabase start` from `apps/backend`), run `pnpm dev`, accept the banner on `/`, then complete a **Basic** signup at `/merchant/signup`.

Expected in DevTools → Network: a `connect.facebook.net/tr?...&ev=CompleteRegistration` beacon fires before the redirect to `/merchant`.

Then clear `localStorage`, **Reject** the banner, and complete another Basic signup with a different email. Expected: **no beacon at all**, and no error in the console.

Remove the `VITE_META_PIXEL_ID` line from `.env.local` afterwards.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/merchant/SignupScreen.tsx
git commit -m "feat(pixels): report a completed shop signup

Fires where the shop is created, not on the page the merchant lands on:
/merchant is outside the marketing scope, and a Pro signup leaves for Stripe
Checkout without reaching it. Both branches pass this line.

A no-op for a visitor who declined, because track.ts finds no global.

Refs #217"
```

---

### Task 7: Make the privacy notice true

The notice currently states that we do not use personal data for advertising. That sentence is false the moment a pixel loads, so this task is not optional and must not be deferred behind the code.

**Files:**
- Modify: `apps/frontend/src/legal/entity.ts:41` (`LEGAL_LAST_UPDATED`)
- Modify: `apps/frontend/src/legal/documents.ts` (the `PRIVACY` document, from line 187)
- Modify: `apps/frontend/src/legal/legal.test.ts`

**Interfaces:**
- Consumes: `PRIVACY` from `./documents`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `apps/frontend/src/legal/legal.test.ts`:

```ts
describe('advertising pixels', () => {
  const paragraphs = PRIVACY.sections.flatMap(s => s.body)
  const text = paragraphs.join(' ')

  it('no longer claims we never use data for advertising, because we now do', () => {
    // The sentence this replaces was true until the marketing pages carried a pixel (#217). A
    // legal document that contradicts the code is the one failure this whole file exists to catch.
    expect(text).not.toContain('we do not use it for advertising')
  })

  it('still promises we do not sell personal data', () => {
    expect(text.toLowerCase()).toContain('we do not sell personal data')
  })

  it('names Meta as a recipient', () => {
    expect(text).toContain('Meta')
  })

  it('does NOT name TikTok, which receives nothing', () => {
    // Setting VITE_TIKTOK_PIXEL_ID means naming TikTok here FIRST. Naming a recipient of personal
    // data that receives none is as false as omitting one that does.
    expect(text).not.toContain('TikTok')
  })

  it('says the pixels are on our pages and not on a shop’s storefront', () => {
    expect(text.toLowerCase()).toContain('storefront')
  })

  it('has a section about cookies that a banner can link a reader to', () => {
    const cookies = PRIVACY.sections.find(s => s.id === 'cookies')
    expect(cookies).toBeDefined()
    expect(cookies!.body.length).toBeGreaterThan(0)
  })

  it('numbers the privacy sections 1..n with no gap and no repeat', () => {
    const numbers = PRIVACY.sections.map(s => Number(s.heading.split('.')[0]))
    expect(numbers).toEqual(Array.from({ length: PRIVACY.sections.length }, (_, i) => i + 1))
  })
})
```

Confirm `PRIVACY` is imported at the top of that file; add it to the existing import from `./documents` if it is not.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @bitetime/frontend test -- src/legal/legal.test.ts`
Expected: FAIL — the "no longer claims" test, the "names Meta" test and the "cookies section" test all fail.

- [ ] **Step 3: Rewrite the advertising sentence**

In `apps/frontend/src/legal/documents.ts`, in the `why-we-collect` section (line 218), replace:

```ts
        'We do not sell personal data, and we do not use it for advertising.',
```

with:

```ts
        'We do not sell personal data. We do not use what a shop tells us, or what its customers order, for advertising.',
        'On our own marketing pages we use a Meta advertising pixel to measure our own advertising, and it runs only if you accept it. It is never present on a shop\'s storefront.',
```

- [ ] **Step 4: Name Meta in the disclosure section**

In the `disclosure` section, after the paragraph beginning `'To the service providers we run on.'`, insert:

```ts
        'To Meta, if you accept advertising cookies on our own marketing pages. Meta receives which of our pages you viewed and whether you created a shop. It does not receive your name, your email address, your contact number or any order. It receives nothing at all from a shop\'s storefront, and nothing at all if you decline.',
```

- [ ] **Step 5: Add the cookies section and renumber**

Insert a new section immediately after the `disclosure` section and before the `retention` section:

```ts
    {
      id: 'cookies',
      heading: '5. Cookies and similar technologies',
      body: [
        'We use a small amount of storage in your browser to keep the service working — to keep you signed in, to remember the language you chose, and to remember a choice you made at a shop\'s checkout. These are necessary for the service to work and are not used for advertising.',
        'We also measure how our pages are used. That measurement is done by our own systems and by our hosting provider, does not identify you, and does not follow you to other websites.',
        'Advertising cookies are separate and are only ever set on our own marketing pages, never on a shop\'s storefront. We ask you before any of them are set, and we set none of them if you decline or if you do not answer. Your answer is remembered in your own browser, so a different browser or device asks you again.',
      ],
    },
```

Then renumber the headings that follow it. The `id` of each section is unchanged, so no existing anchor link breaks — only the number at the start of the heading changes:

| Section `id` | Old heading | New heading |
|---|---|---|
| `retention` | `'5. How long we keep it'` | `'6. How long we keep it'` |
| `guest-orders` | `'6. Ordering as a guest'` | `'7. Ordering as a guest'` |
| (email addresses) | `'7. A note about email addresses'` | `'8. A note about email addresses'` |
| (rights) | `'8. Your rights'` | `'9. Your rights'` |
| (security) | `'9. Security'` | `'10. Security'` |
| (changes) | `'10. Changes to this notice'` | `'11. Changes to this notice'` |
| (contact) | `'11. Contact'` | `'12. Contact'` |

- [ ] **Step 6: Bump the last-updated date**

In `apps/frontend/src/legal/entity.ts`, change:

```ts
export const LEGAL_LAST_UPDATED = '27 July 2026'
```

to:

```ts
export const LEGAL_LAST_UPDATED = '11 August 2026'
```

- [ ] **Step 7: Run the legal tests and confirm they pass**

Run: `pnpm --filter @bitetime/frontend test -- src/legal/legal.test.ts`
Expected: PASS, including the pre-existing tests for unique section ids and for the authoritative-language sentence.

- [ ] **Step 8: Read the rendered page**

Run `pnpm --filter @bitetime/frontend dev` and open `http://localhost:5173/privacy`. Read sections 3, 4 and 5 end to end and confirm each sentence is true of the code as built. Confirm the numbering runs 1 to 12 with no gap.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/legal/documents.ts apps/frontend/src/legal/entity.ts \
        apps/frontend/src/legal/legal.test.ts
git commit -m "docs(legal): disclose the Meta advertising pixel in the privacy notice

The notice said we do not use personal data for advertising. That is false
the moment a pixel loads, so it changes with the code and not after it.

Meta is named. TikTok is NOT, because it receives nothing today, and naming
a recipient of personal data that receives none is as false as omitting one
that does. A test now holds that line, so switching TikTok on requires
changing this file first.

A new cookies section gives the consent banner something to link to.
Section ids are unchanged, so no existing anchor breaks.

Refs #217"
```

---

### Task 8: Whole-repo verification

**Files:** none created or modified.

- [ ] **Step 1: Run everything CI runs**

Run, from the repo root:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all four PASS. `pnpm build` includes `scripts/prerender.tsx`, so a failure there means the prerender tripped over the new code — which it must not, because `PixelConsent` is mounted in `AppRouter` and the prerender renders route elements directly.

- [ ] **Step 2: Prove the banner is not in the prerendered HTML**

Run:

```bash
grep -ril "Advertising cookies" apps/frontend/dist/*.html apps/frontend/dist/for/*.html
```

Expected: **no matches**. A cookie banner baked into `dist/*.html` is page content to a crawler that runs no JavaScript.

- [ ] **Step 3: Prove no vendor host is in the built bundle by default**

Run:

```bash
grep -rl "connect.facebook.net" apps/frontend/dist/assets/ | head
```

The host string is expected in the JS bundle (it is inside `load.ts`'s snippet template, which ships whether or not it runs). Confirm instead that **no pixel id was inlined**:

```bash
grep -c "fbq('init'," apps/frontend/dist/assets/*.js | grep -v ':0' | head
```

Then confirm the built app does not run it: serve the build and load the homepage.

```bash
pnpm --filter @bitetime/frontend preview
```

Expected at `http://localhost:4173/`: no banner, no request to `connect.facebook.net`, `typeof fbq === 'undefined'`.

- [ ] **Step 4: Push and open the pull request**

```bash
git push -u origin HEAD
gh pr create --base dev --title "feat: Meta and TikTok pixels on the marketing pages" --body "$(cat <<'EOF'
Adds the Meta Pixel and a TikTok Pixel to TinyOrder's own marketing pages, behind a consent banner.

Design: `docs/superpowers/specs/2026-08-11-marketing-pixels-design.md`

**The pixels never fire on a shop's storefront.** `/s/:slug`, `/merchant`, `/admin`, `/reset-password` and `/releases/:tag` are all outside the scope, which is derived from `ROUTE_META` rather than kept as a second list.

**Nothing loads before Accept.** A visitor who declines, or who does not answer, causes no third-party request at all.

**Nothing loads without an env var.** `VITE_META_PIXEL_ID` and `VITE_TIKTOK_PIXEL_ID` are unset in the repo, so dev, CI and the e2e run stay clean and no test stubs around them. Set the Meta id in Vercel to switch it on.

**TikTok ships inert.** There is no TikTok ad account. The privacy notice therefore names Meta only, and a test fails if TikTok appears in it — setting `VITE_TIKTOK_PIXEL_ID` means updating the notice first.

The privacy notice changes with this PR, because it currently states that we do not use personal data for advertising.

Follow-up: merchant-owned pixels on storefronts, #220.

Refs #217
EOF
)"
```

Note: `Refs`, not `Closes`. Per the repo's convention, an issue tracks production, and this PR targets `dev`.

---

## Self-Review

**Spec coverage.** Module shape → Tasks 1-5. Derived allowlist → Task 1. Consent storage, `v1` key, fail-closed → Task 2. Banner (equal weight, bilingual, `/privacy` link, absent from prerender) → Tasks 5 and 8. Snippets without the vendors' pageview call, idempotent, after-consent only → Task 3. Pageview per marketing route, `CompleteRegistration` in `SignupScreen`, no PII, guarded calls → Tasks 4 and 6. Legal §3, §4, cookies section → Task 7. Every listed test exists in a task. The Meta-only decision is enforced by a test in Task 7 and documented in `.env.example` in Task 1.

**Placeholders.** None: every code step carries the code, every verification step carries the command and the expected result.

**Type consistency.** `PixelIds` is defined in Task 1 and consumed by name in Tasks 3 and 5. `ConsentChoice`, `readConsent`, `writeConsent`, `PLATFORM_CONSENT_SCOPE` are defined in Task 2 and used with the same signatures in Task 5. `loadPixels(ids)` (Task 3), `pixelPageView()` and `pixelTrack(event, params?)` (Task 4) are called in Tasks 5 and 6 exactly as declared. `usePixels()` returns `{ showBanner, accept, reject }` and `PixelConsent` destructures those three names.
