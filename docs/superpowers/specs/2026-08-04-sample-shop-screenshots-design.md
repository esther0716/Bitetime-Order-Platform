# Sample shop storefront screenshots

## What we are building

The `/sample-shops` carousel (#107) shows a shop's name and its first few product names/prices. That proves real shops exist on TinyOrder, but it doesn't show the thing a hesitant merchant actually needs to see before signing up: what a live storefront looks and feels like. A product list is not a demo of the product.

This adds a real screenshot of each sample shop's live storefront (`/s/:slug`) to its card, captured on a schedule and served from Storage — never a live link, never an iframe, never anything that lets a visitor reach the real storefront from this page. That constraint is the same one #107's non-clickable cards exist for (`fcd0a57`), and it must hold here too.

Decisions taken during brainstorming:

| Question | Decision |
|---|---|
| Where does capture run? | GitHub Actions, not the deployed backend. Playwright is already a frontend devDependency (e2e tests) but never a runtime dependency of the Railway-hosted backend — adding a full Chromium binary to that process would be new deploy weight and cold-start cost for a once-a-week job. |
| Cadence | Cron only (weekly), no on-demand trigger from the admin toggle. Matches `trial-feedback-sweep.yml` exactly. A shop just flagged as sample has no screenshot until the next run — the card falls back to today's avatar+product-list layout, never a broken image. **Superseded 2026-08-26 — see "Update" below.** |
| Safety constraint | The capture script does exactly two Playwright calls per shop: `page.goto()` and `page.screenshot()`. No `click()`, no form interaction, anywhere in the script — trivially auditable, and the reason this can't place a real order. |
| Bucket visibility | Public, like `product-images`. A screenshot of an already-public storefront page carries no more sensitivity than the page itself. |
| Who can write to it | Only the backend's service-role client, via one secret-gated endpoint. No browser role (anon or authenticated) gets a write policy — there is no legitimate merchant-initiated write here, unlike `product-images`. |
| Card layout when a screenshot exists | Replaces the avatar+product-list block entirely, not shown alongside it — one card, one representation of the shop, not two competing ones. |

## Data model

`apps/backend/supabase/migrations/<ts>_merchants_sample_screenshot.sql`:

```sql
-- Screenshot of a sample shop's live storefront, captured weekly by a GitHub Actions cron
-- (.github/workflows/sample-shop-screenshot-sweep.yml) via Playwright, uploaded through
-- POST /api/internal/sample-shop-screenshot. Null until the first successful capture.
alter table public.merchants
  add column if not exists sample_screenshot_path text;

comment on column public.merchants.sample_screenshot_path is
  'Storage path in the PUBLIC `sample-shop-screenshots` bucket ({merchant_id}.png). Never a URL —
   resolve with sampleShopScreenshotUrl() in store.ts. Set only by the internal sweep endpoint
   (service role); no merchant or superadmin ever writes this directly.';

insert into storage.buckets (id, name, public)
values ('sample-shop-screenshots', 'sample-shop-screenshots', true)
on conflict (id) do nothing;

update storage.buckets
set
  file_size_limit = 3145728, -- 3 MiB — MAX_SCREENSHOT_BYTES in app.ts, a single PNG viewport capture
  allowed_mime_types = array['image/png']
where id = 'sample-shop-screenshots';

-- No storage.objects policy for this bucket, deliberately — mirrors payment-proof's "no policy
-- means no access" (20260804160000). Read is public via the bucket flag above; write only ever
-- happens through admin.storage in the sweep endpoint, which is service_role and bypasses RLS
-- entirely. tests/rls/sample-shot-storage.test.ts is the proof anon/authenticated get neither.
```

## Backend

### Upload endpoint

`POST /api/internal/sample-shop-screenshot/:merchantId`, secret-gated exactly like `trial-feedback-sweep`, body-shaped exactly like the existing `POST /api/orders/:orderId/payment-proof` (raw binary body, `Content-Type` names the file):

```ts
const SCREENSHOT_BUCKET = 'sample-shop-screenshots'
const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024 // 3 MiB — same ceiling as the migration's file_size_limit

app.post('/api/internal/sample-shop-screenshot/:merchantId', async (c) => {
  if (!env.sampleShopScreenshotSweepSecret) return c.json({ error: 'Sweep disabled' }, 503)
  const provided = c.req.header('x-sweep-secret') || ''
  if (!safeEqualSecret(provided, env.sampleShopScreenshotSweepSecret)) return c.json({ error: 'Forbidden' }, 403)

  const merchantId = c.req.param('merchantId')
  if (c.req.header('Content-Type') !== 'image/png') return c.json({ error: 'unsupported_type' }, 400)

  const buffer = await c.req.arrayBuffer()
  if (buffer.byteLength === 0) return c.json({ error: 'invalid_body' }, 400)
  if (buffer.byteLength > MAX_SCREENSHOT_BYTES) return c.json({ error: 'too_large' }, 400)

  const { data: merchant } = await admin.from('merchants').select('id').eq('id', merchantId).maybeSingle()
  if (!merchant) return c.json({ error: 'Merchant not found' }, 404)

  const path = `${merchantId}.png`
  const { error } = await admin.storage
    .from(SCREENSHOT_BUCKET)
    .upload(path, buffer, { contentType: 'image/png', upsert: true })
  if (error) {
    console.error('Sample shot upload failed:', error.message)
    return c.json({ error: 'upload_failed' }, 500)
  }

  await admin.from('merchants').update({ sample_screenshot_path: path }).eq('id', merchantId)
  return c.json({ ok: true })
})
```

`env.ts` gains `sampleShopScreenshotSweepSecret: process.env.SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET || ''`, read the same fail-open-403 way `trialFeedbackSweepSecret` is (unset means the route always 503s, never silently accepts).

### Samples endpoint

`GET /api/merchants/samples` (existing, #107) adds `sample_screenshot_path` to its `merchants` select and maps it to `screenshotPath` on the response, alongside the existing `products` array — no other change to that handler.

## Capture script

`apps/backend/scripts/captureSampleShopScreenshots.ts`, run by CI only (never by `pnpm dev`/`build`):

```ts
import { chromium } from 'playwright'

const FRONTEND_URL = process.env.FRONTEND_URL
const BACKEND_URL = process.env.BACKEND_URL
const SWEEP_SECRET = process.env.SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET
if (!FRONTEND_URL || !BACKEND_URL || !SWEEP_SECRET) {
  console.error('FRONTEND_URL, BACKEND_URL and SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET are all required')
  process.exit(1)
}

interface SampleShop { id: string; slug: string }

async function main() {
  const res = await fetch(`${BACKEND_URL}/api/merchants/samples`)
  if (!res.ok) throw new Error(`GET /api/merchants/samples: ${res.status}`)
  const shops = (await res.json()) as SampleShop[]

  const browser = await chromium.launch()
  // Mobile viewport — this storefront is mobile-first (see CLAUDE.md), and the card the
  // screenshot lands in is a narrow, portrait-shaped slot.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

  let ok = 0
  for (const shop of shops) {
    try {
      // Exactly two Playwright calls: navigate, screenshot. No click(), no form interaction,
      // anywhere in this script — that is what makes this incapable of placing a real order.
      await page.goto(`${FRONTEND_URL}/s/${shop.slug}`, { waitUntil: 'networkidle' })
      const png = await page.screenshot({ type: 'png' })

      const upload = await fetch(
        `${BACKEND_URL}/api/internal/sample-shop-screenshot/${shop.id}`,
        { method: 'POST', headers: { 'Content-Type': 'image/png', 'x-sweep-secret': SWEEP_SECRET }, body: png },
      )
      if (!upload.ok) throw new Error(`upload: ${upload.status}`)
      ok++
    } catch (err) {
      // One shop's capture failing (a redirect, a slow load, a temporary 5xx) must not stop the
      // rest — the card's fallback layout is exactly what makes a missed capture harmless.
      console.error(`capture failed for ${shop.slug}:`, err instanceof Error ? err.message : String(err))
    }
  }

  await browser.close()
  console.log(`captured ${ok}/${shops.length}`)
}

main()
```

`apps/backend/package.json` gains a devDependency on `playwright` (the library — not `@playwright/test`, which stays frontend-only) and a script:

```json
"screenshot:sweep": "node --import jiti/register scripts/captureSampleShopScreenshots.ts"
```

This is a devDependency only, never imported by `src/app.ts` or anything the esbuild bundle touches, so it needs no `--external:` flag (CLAUDE.md's monorepo rule is about runtime dependencies the bundle would otherwise inline).

## GitHub Actions

`.github/workflows/sample-shop-screenshot-sweep.yml`, mirrors `trial-feedback-sweep.yml`'s shape and its secrets discipline:

```yaml
# Weekly capture of each sample shop's live storefront for the /sample-shops carousel (#107).
# THREE REPO SECRETS ARE REQUIRED and are NOT set by this file:
#   FRONTEND_URL                        — the deployed frontend's base URL (Vercel)
#   BACKEND_URL                         — the deployed backend's base URL (Railway)
#   SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET — must equal the backend's own env var of the same name
# Without all three the script exits 1 immediately — see captureSampleShopScreenshots.ts.
name: sample-shop-screenshot-sweep

on:
  schedule:
    - cron: '0 4 * * 1'
  workflow_dispatch: {}

jobs:
  sweep:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - run: pnpm --filter @bitetime/backend exec playwright install --with-deps chromium
      - run: pnpm --filter @bitetime/backend screenshot:sweep
        env:
          FRONTEND_URL: ${{ secrets.FRONTEND_URL }}
          BACKEND_URL: ${{ secrets.BACKEND_URL }}
          SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET: ${{ secrets.SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET }}
```

## Frontend

- `SampleShop` (`store.ts`, #107) gains `screenshotPath: string | null`.
- New `SCREENSHOT_BUCKET = 'sample-shop-screenshots'` + `sampleShopScreenshotUrl(path: string): string` in `store.ts`, mirroring `paymentQrUrl`/`productImageUrl` exactly (`storage.from(BUCKET).getPublicUrl(path).data.publicUrl`).
- `SampleShopsCarousel.tsx`: when `shop.screenshotPath` is set, the card renders `<img src={sampleShopScreenshotUrl(shop.screenshotPath)} />` filling the card, nothing else. When absent, today's avatar+product-list layout is unchanged. No card ever mixes both.

## Testing

- **Backend (`test:db`)**: `tests/api/sample-shot.test.ts` — the upload endpoint refuses a missing/wrong secret (403), a non-PNG content-type (400), an empty or oversized body (400), an unknown merchant (404), and on success both writes the storage object AND persists `sample_screenshot_path`, retrievable afterward from `GET /api/merchants/samples` as `screenshotPath`. `tests/rls/sample-shot-storage.test.ts` — mirrors `payment-proof-storage.test.ts`'s shape: anon and an authenticated shop owner both refused a write; unlike payment-proof, an anonymous **read** of an object written by the service role must succeed (public bucket).
- **Capture script**: not unit-tested — it is a thin CI-only orchestration script with no logic beyond "call these two APIs per shop," and the two things worth verifying (safety: no click/interaction calls; correctness: the upload endpoint's contract) are covered by reading the script itself and by the endpoint's own test suite, respectively.
- **Run-and-verify**: manually run `pnpm --filter @bitetime/backend screenshot:sweep` locally against a dev stack with one `is_sample` shop, confirm the card on `/sample-shops` switches from the fallback layout to the screenshot; confirm a shop with no captured screenshot still renders its fallback card unchanged.

## Out of scope

- On-demand / immediate capture when a shop is newly flagged sample (cron-only, per the decision above).
- Retry logic beyond "next week's run tries again" — a shop that fails one week just keeps its fallback card or last-known screenshot until the next successful run.
- Cropping, compressing, or otherwise post-processing the screenshot beyond what `page.screenshot()` produces at the fixed mobile viewport.
- Screenshotting anything other than the storefront's default landing state (no scrolled state, no cart open, no specific product highlighted).


## Update — 2026-08-26: capture on flag, one card kind

Visitors reported the `/sample-shops` row looking broken. It was: two of the three shops had a
screenshot and one did not, so the row held two storefront captures beside one
avatar-and-product-list card. Three shops rendered three different ways reads as a fault, not as a
gallery. Two decisions above caused it, and both are reversed here.

**The fallback layout is gone.** `SampleShopsCarousel` renders exactly one kind of card. A shop
with no screenshot is filtered out in `useSampleShops` (narrowed to `CapturedSampleShop`) and is
simply absent from the row. The card is a fixed `aspect-[3/4]` rather than `h-full`, so the crop
point no longer depends on which other shops happen to be flagged.

**Capture is asked for at flag time.** Dropping the fallback would otherwise leave a newly flagged
shop invisible for up to seven days, so `POST /api/admin/set-merchant-sample` now dispatches the
capture workflow for that one shop:

- `sample-shop-screenshot-sweep.yml` takes a `merchant_id` `workflow_dispatch` input; empty (the
  schedule, and the manual button) still sweeps every sample shop.
- `dispatchSampleScreenshot` in `github.ts` is an adapter like every other export there — token as
  a parameter, swallows its own errors, returns whether GitHub accepted. It posts to
  `/actions/workflows/sample-shop-screenshot-sweep.yml/dispatches` with `ref: 'main'`.
- The toggle reports `captureQueued` and never fails on a refused dispatch. The weekly cron stays
  the guarantee; this is only the thing that makes the shop appear in minutes rather than days.

Two operational requirements this adds, neither of which the issue-filing path needed:
`GITHUB_TOKEN` must carry **`actions: write`**, and the workflow file must exist on **`main`** —
GitHub resolves a dispatch against that ref and 404s otherwise.

**The sweep now fails loudly.** It used to log a per-shop failure and exit 0. With shot-less shops
filtered out of the carousel, a swallowed failure is a shop missing from the page, so the script
collects failures and exits non-zero. It also stopped waiting on `networkidle` — the storefront
keeps talking to the backend — and waits for `[data-sample-capture="menu"]` in
`store/Storefront.tsx` instead, retrying the navigation once for a cold start.

## Update — 2026-08-26 (second): a photograph goes stale when the storefront changes

The first update fixed a shop with no screenshot. This one fixes a shop whose screenshot is of
the wrong storefront. `Verify Shop` and `Demo Pro Bakery` were carrying captures from 2026-08-04 —
before the shared menu row (`a6f30e0`), the shop description (`a91ab28`) and the whole per-shop
brand colour series (`24dbd39`…`7d24e84`). The carousel was selling a three-week-old design.

The cause is that capture cadence was purely time-based. Nothing connected a screenshot to the
build it was a screenshot OF, so any storefront change shipped stale previews until the next
Monday. Three additions:

1. **Every production deploy re-shoots every sample shop.** The workflow gains a
   `deployment_status` trigger, gated on `state == 'success' && environment == 'Production'`.
   Vercel's GitHub integration writes that status after the build is live, so there is nothing to
   poll and no `sleep`. The gate is also what stops one Actions run per preview deploy, and what
   stops a failed deploy being photographed as an error page. The weekly cron stays as the
   backstop for menu edits, which ship no deploy.
2. **`POST /api/admin/recapture-samples`** (superadmin) dispatches the same sweep with no
   `merchant_id`, reached from a "Recapture sample screenshots" button on `/admin/merchants`. The
   manual path, for a shot that came out wrong. It reports `captureQueued` and never errors on a
   refused dispatch, exactly like the flag toggle. `dispatchSampleScreenshot`'s `merchantId` is
   therefore optional, and sends `merchant_id: ''` when absent — the input's own default, which
   the script reads as "sweep all".
3. **A documented local sweep** in CLAUDE.md's command list. Nothing captures against a developer's
   own stack, so a local screenshot keeps whatever design it had on the day it was taken — which
   is how this was found.

## Update — 2026-08-26 (third): `?preview=1` — the shop, without the order form

A 390x844 capture of a real storefront is mostly things a visitor is not being sold: sign-in and
invoice links, a language picker, the fulfilment buttons and an empty August calendar. The menu —
the thing a hesitant merchant wants to see — was a strip in the middle.

`/s/:slug?preview=1` renders the shop without the order form, and the sweep captures that URL.

**Presentation only, and it must stay that way.** No logic in `Storefront.tsx` branches on the
parameter: the cart still works, the totals still price, the submit still submits. It sets
`data-preview="1"` on the form wrapper and hides through one rule in `index.css`:

```css
[data-preview] [data-sample-capture="menu"] ~ *,
[data-preview] [data-preview-hide] { display: none; }
```

The sibling selector is why the storefront needed no restructuring — every field the customer
fills in is a flat sequence of siblings after the product list, so `~ *` from the menu marker
takes all of it at once. `data-preview-hide` marks the two things ABOVE the menu that had to go:
the sign-in / invoice row and the language picker. A customer who arrives with the parameter is
looking at a shop, not at a different application, which is the property that keeps a marketing
screenshot from ever being able to break a real checkout.

The capture viewport drops to **390x520** — 390 at the card's own 3:4, so the image is what the
card shows rather than a full phone page cropped to a third of itself. Verified against a local
stack: `Demo Pro Bakery` now captures as shop name, platform credit, MENU, its two categories and
four products, ending on a real Add button.

## Update — 2026-08-26 (fourth): the URL has to change when the picture does

Re-shooting on every deploy achieved nothing on its own. The storage path was a fixed
`{merchant_id}.png` that each capture overwrote in place, and the public bucket serves objects
with a `max-age`, so a browser holding the previous screenshot went on showing it — a storefront
design replaced weeks earlier, still on the marketing page, with fresh bytes sitting in Storage
that nobody would fetch. It was confirmed with a fresh page load: the new card layout rendered
and the picture inside it was three weeks old.

The upload endpoint now writes `{merchant_id}/{ms}.png` — a new name per capture, so a recapture
is a new URL, which is the only thing a cache respects. No migration: the column already stored a
filename. Three consequences worth stating:

- The bytes are uploaded `cacheControl: '31536000'` rather than the hourly default. A URL that
  never repeats can be cached as hard as the assets under `/assets` are.
- The previous object is deleted, but only **after** the merchants row points at the new one — a
  delete that ran first would leave the carousel with a dead URL if the update failed. Weekly
  captures would otherwise accumulate one PNG per shop per week for ever. Best-effort: an orphan
  costs storage, never correctness.
- `sample_screenshot_path` is still a path, never a URL, and is still resolved through
  `sampleShopScreenshotUrl()`. Nothing on the frontend changed.
