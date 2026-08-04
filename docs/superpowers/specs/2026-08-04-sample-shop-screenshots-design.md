# Sample shop storefront screenshots

## What we are building

The `/sample-shops` carousel (#107) shows a shop's name and its first few product names/prices. That proves real shops exist on TinyOrder, but it doesn't show the thing a hesitant merchant actually needs to see before signing up: what a live storefront looks and feels like. A product list is not a demo of the product.

This adds a real screenshot of each sample shop's live storefront (`/s/:slug`) to its card, captured on a schedule and served from Storage — never a live link, never an iframe, never anything that lets a visitor reach the real storefront from this page. That constraint is the same one #107's non-clickable cards exist for (`fcd0a57`), and it must hold here too.

Decisions taken during brainstorming:

| Question | Decision |
|---|---|
| Where does capture run? | GitHub Actions, not the deployed backend. Playwright is already a frontend devDependency (e2e tests) but never a runtime dependency of the Railway-hosted backend — adding a full Chromium binary to that process would be new deploy weight and cold-start cost for a once-a-week job. |
| Cadence | Cron only (weekly), no on-demand trigger from the admin toggle. Matches `trial-feedback-sweep.yml` exactly. A shop just flagged as sample has no screenshot until the next run — the card falls back to today's avatar+product-list layout, never a broken image. |
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
