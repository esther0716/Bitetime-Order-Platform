# Sample Shop Storefront Screenshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a real screenshot of each sample shop's live storefront on its `/sample-shops` card, captured weekly by a GitHub Actions cron job — never a live link, never client-triggered.

**Architecture:** A GitHub Actions workflow runs a Playwright script (in `apps/backend/scripts/`, CI-only) that navigates each `is_sample` shop's public `/s/:slug` page, screenshots it, and POSTs the PNG to a new secret-gated backend endpoint. That endpoint writes the image to a new public Storage bucket via the service-role client and records the path on `merchants.sample_screenshot_path`. `GET /api/merchants/samples` (#107) starts returning that path; the frontend card renders the screenshot when present, falling back to today's avatar+product-list layout when absent.

**Tech Stack:** Playwright (new backend devDependency, library only — not `@playwright/test`), Hono, Supabase Storage, GitHub Actions cron.

## Global Constraints

- The capture script makes exactly two Playwright calls per shop: `page.goto()` and `page.screenshot()`. No `click()`, no form interaction, anywhere in the script.
- Capture runs only in GitHub Actions — Playwright/Chromium must never become a runtime dependency of the deployed backend (`apps/backend/src/app.ts` imports nothing from `playwright`; the esbuild bundle's `--external:` list is untouched).
- Cron only, weekly — no on-demand trigger from the admin toggle.
- The new bucket (`sample-shop-screenshots`) is public for reads; no `storage.objects` policy is added for it — every write goes through `admin.storage` (service role) in the one upload endpoint, and RLS is the backstop proving anon/authenticated get neither read-via-policy-bypass nor write.
- A card with no `screenshotPath` renders exactly like it does today (avatar + product list) — never a broken image, never an empty gap.
- `apps/backend/supabase/migrations/` changes are applied locally with `pnpm db:migrate` from `apps/backend/`, never `db:push`.

---

### Task 1: Migration — `sample_screenshot_path` column + Storage bucket

**Files:**
- Create: `apps/backend/supabase/migrations/20260804180000_merchants_sample_screenshot.sql`

**Interfaces:**
- Produces: `merchants.sample_screenshot_path text` (nullable); Storage bucket `sample-shop-screenshots` (public, 3 MiB limit, `image/png` only). Every later backend task reads/writes this column and bucket by these exact names.

- [ ] **Step 1: Write the migration**

```sql
-- Screenshot of a sample shop's live storefront, captured weekly by a GitHub Actions cron
-- (.github/workflows/sample-shop-screenshot-sweep.yml) via Playwright, uploaded through
-- POST /api/internal/sample-shop-screenshot/:merchantId. Null until the first successful capture.
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

- [ ] **Step 2: Apply it to the local stack**

Run (from `apps/backend/`): `pnpm db:migrate`
Expected: migration `20260804180000_merchants_sample_screenshot` listed as applied, no errors.

- [ ] **Step 3: Verify**

Run: `cd apps/backend && supabase status -o env | grep DB_URL` to get the local `DB_URL`, then:
```bash
psql "<DB_URL>" -c "select column_name from information_schema.columns where table_name='merchants' and column_name='sample_screenshot_path';"
psql "<DB_URL>" -c "select id, public, file_size_limit, allowed_mime_types from storage.buckets where id='sample-shop-screenshots';"
```
Expected: the column exists; the bucket row shows `public=true`, `file_size_limit=3145728`, `allowed_mime_types={image/png}`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/supabase/migrations/20260804180000_merchants_sample_screenshot.sql
git commit -m "feat(db): add merchants.sample_screenshot_path + sample-shop-screenshots bucket"
```

---

### Task 2: Backend — screenshot upload endpoint

**Files:**
- Modify: `apps/backend/src/env.ts` (add `sampleShopScreenshotSweepSecret`)
- Modify: `apps/backend/vitest.db.config.ts` (stub the secret for tests, same as `TRIAL_FEEDBACK_SWEEP_SECRET`)
- Modify: `apps/backend/src/app.ts` (add route right after `POST /api/internal/trial-feedback-sweep`, which ends at the `})` before `app.post('/api/customer/signup', ...)`)
- Test: `apps/backend/tests/api/sample-shot-upload.test.ts` (create)

**Interfaces:**
- Consumes: `merchants.sample_screenshot_path`, bucket `sample-shop-screenshots` (Task 1); `safeEqualSecret` (already defined in `app.ts`, just above the trial-feedback-sweep route).
- Produces: `POST /api/internal/sample-shop-screenshot/:merchantId` — header `x-sweep-secret`, body raw PNG bytes, `Content-Type: image/png` → `200 { ok: true }` on success, `503` if the secret env var is unset, `403` on a wrong/missing secret, `400` on wrong content-type / empty / oversized body, `404` on an unknown merchant, `500` on a storage failure. Later tasks (the capture script, Task 5) call this route by exact path/header/body shape.

- [ ] **Step 1: Add the env var**

In `apps/backend/src/env.ts`, immediately after the `trialFeedbackSweepSecret` block, add:

```ts
  // Shared secret for the sample-shop screenshot cron sweep
  // (POST /api/internal/sample-shop-screenshot/:merchantId, called by a GitHub Actions
  // schedule — see .github/workflows/sample-shop-screenshot-sweep.yml). Same posture as
  // trialFeedbackSweepSecret: unset means the endpoint always refuses (503).
  sampleShopScreenshotSweepSecret: process.env.SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET || '',
```

- [ ] **Step 2: Stub the secret for `test:db` runs**

In `apps/backend/vitest.db.config.ts`, immediately after the line `if (!process.env.TRIAL_FEEDBACK_SWEEP_SECRET) process.env.TRIAL_FEEDBACK_SWEEP_SECRET = 'test-sweep-secret-stub'`, add:

```ts
  // Same reasoning as the TRIAL_FEEDBACK_SWEEP_SECRET stub just above: it only gates an
  // internal endpoint, no live-network risk, so a plain default is enough.
  if (!process.env.SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET) {
    process.env.SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET = 'test-screenshot-sweep-secret-stub'
  }
```

- [ ] **Step 3: Write the failing test**

Create `apps/backend/tests/api/sample-shot-upload.test.ts`:

```ts
// tests/api/sample-shot-upload.test.ts
// POST /api/internal/sample-shop-screenshot/:merchantId — the sample-shop screenshot cron's
// upload endpoint. Unauthenticated (no user token), gated by a shared secret header instead,
// exactly like /api/internal/trial-feedback-sweep. Driven in-process against real Postgres +
// real Storage: admin.storage is not mockable here without also faking the property (a real
// upload landing in the bucket) this suite exists to prove.
import { describe, it, expect, beforeAll } from 'vitest'
import { app } from '../../src/app.js'
import { env } from '../../src/env.js'
import { serviceClient, resetMerchant, seedMerchant, makeUser } from '../rls/helpers.js'

const BUCKET = 'sample-shop-screenshots'

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

function post(merchantId: string, body: Uint8Array | string, opts: { contentType?: string; secret?: string } = {}) {
  const headers: Record<string, string> = {}
  if (opts.contentType !== undefined) headers['Content-Type'] = opts.contentType
  if (opts.secret !== undefined) headers['x-sweep-secret'] = opts.secret
  return app.request(`/api/internal/sample-shop-screenshot/${merchantId}`, { method: 'POST', headers, body })
}

describe('POST /api/internal/sample-shop-screenshot/:merchantId', () => {
  let merchantId: string

  beforeAll(async () => {
    await resetMerchant('sample-shot-shop')
    const owner = await makeUser('sample-shot-owner@example.com', 'password123')
    const { data: session } = await owner.auth.getSession()
    merchantId = await seedMerchant({ slug: 'sample-shot-shop', owner_id: session.session!.user.id })
  })

  it('503s when the sweep secret env var is unset', async () => {
    const saved = env.sampleShopScreenshotSweepSecret
    env.sampleShopScreenshotSweepSecret = ''
    try {
      const res = await post(merchantId, PNG_1X1, { contentType: 'image/png', secret: 'anything' })
      expect(res.status).toBe(503)
    } finally {
      env.sampleShopScreenshotSweepSecret = saved
    }
  })

  it('refuses a missing secret', async () => {
    const res = await post(merchantId, PNG_1X1, { contentType: 'image/png' })
    expect(res.status).toBe(403)
  })

  it('refuses a wrong secret', async () => {
    const res = await post(merchantId, PNG_1X1, { contentType: 'image/png', secret: 'wrong-secret' })
    expect(res.status).toBe(403)
  })

  it('refuses a non-image/png content-type', async () => {
    const res = await post(merchantId, PNG_1X1, { contentType: 'image/jpeg', secret: env.sampleShopScreenshotSweepSecret })
    expect(res.status).toBe(400)
  })

  it('refuses an empty body', async () => {
    const res = await post(merchantId, new Uint8Array(0), { contentType: 'image/png', secret: env.sampleShopScreenshotSweepSecret })
    expect(res.status).toBe(400)
  })

  it('refuses an oversized body', async () => {
    const big = new Uint8Array(3 * 1024 * 1024 + 1)
    const res = await post(merchantId, big, { contentType: 'image/png', secret: env.sampleShopScreenshotSweepSecret })
    expect(res.status).toBe(400)
  })

  it('404s on an unknown merchant', async () => {
    const res = await post(
      '00000000-0000-0000-0000-000000000000',
      PNG_1X1,
      { contentType: 'image/png', secret: env.sampleShopScreenshotSweepSecret },
    )
    expect(res.status).toBe(404)
  })

  it('uploads the image and persists the path', async () => {
    const res = await post(merchantId, PNG_1X1, { contentType: 'image/png', secret: env.sampleShopScreenshotSweepSecret })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const { data: row } = await serviceClient()
      .from('merchants').select('sample_screenshot_path').eq('id', merchantId).maybeSingle()
    expect(row?.sample_screenshot_path).toBe(`${merchantId}.png`)

    const { data: file, error } = await serviceClient().storage.from(BUCKET).download(`${merchantId}.png`)
    expect(error).toBeNull()
    expect(file).not.toBeNull()
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @bitetime/backend test:db -- sample-shot-upload`
Expected: every case except the first two (503-when-unset, refuses-missing-secret) FAILs with a 404 (route does not exist yet) instead of the asserted status.

- [ ] **Step 5: Implement the route**

In `apps/backend/src/app.ts`, immediately after the `app.post('/api/internal/trial-feedback-sweep', ...)` handler's closing `})` (right before `app.post('/api/customer/signup', ...)`), add:

```ts
const SAMPLE_SCREENSHOT_BUCKET = 'sample-shop-screenshots'
const MAX_SAMPLE_SCREENSHOT_BYTES = 3 * 1024 * 1024 // 3 MiB — same ceiling as the migration's file_size_limit

// Not user-authenticated — called by a GitHub Actions schedule (see
// .github/workflows/sample-shop-screenshot-sweep.yml), gated by a shared secret header instead.
// Fails CLOSED (503) when the secret is unset, matching trial-feedback-sweep's house rule.
app.post('/api/internal/sample-shop-screenshot/:merchantId', async (c) => {
  if (!env.sampleShopScreenshotSweepSecret) return c.json({ error: 'Sweep disabled' }, 503)
  const provided = c.req.header('x-sweep-secret') || ''
  if (!safeEqualSecret(provided, env.sampleShopScreenshotSweepSecret)) return c.json({ error: 'Forbidden' }, 403)

  const merchantId = c.req.param('merchantId')
  if (c.req.header('Content-Type') !== 'image/png') return c.json({ error: 'unsupported_type' }, 400)

  const buffer = await c.req.arrayBuffer()
  if (buffer.byteLength === 0) return c.json({ error: 'invalid_body' }, 400)
  if (buffer.byteLength > MAX_SAMPLE_SCREENSHOT_BYTES) return c.json({ error: 'too_large' }, 400)

  const { data: merchant } = await admin.from('merchants').select('id').eq('id', merchantId).maybeSingle()
  if (!merchant) return c.json({ error: 'Merchant not found' }, 404)

  const path = `${merchantId}.png`
  const { error } = await admin.storage
    .from(SAMPLE_SCREENSHOT_BUCKET)
    .upload(path, buffer, { contentType: 'image/png', upsert: true })
  if (error) {
    console.error('Sample shot upload failed:', error.message)
    return c.json({ error: 'upload_failed' }, 500)
  }

  await admin.from('merchants').update({ sample_screenshot_path: path }).eq('id', merchantId)
  return c.json({ ok: true })
})
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @bitetime/backend test:db -- sample-shot-upload`
Expected: all 8 cases PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/env.ts apps/backend/vitest.db.config.ts apps/backend/src/app.ts apps/backend/tests/api/sample-shot-upload.test.ts
git commit -m "feat(backend): add POST /api/internal/sample-shop-screenshot/:merchantId"
```

---

### Task 3: RLS — prove the browser gets no direct access to the bucket

**Files:**
- Test: `apps/backend/tests/rls/sample-shot-storage.test.ts` (create)

**Interfaces:**
- Consumes: bucket `sample-shop-screenshots` (Task 1); `anonClient`, `serviceClient`, `makeUser`, `seedMerchant` from `tests/rls/helpers.ts`.

- [ ] **Step 1: Write the test**

```ts
// tests/rls/sample-shot-storage.test.ts
// The `sample-shop-screenshots` bucket is PUBLIC for reads (the migration's `public: true`) but
// has no storage.objects policy at all — every write goes through the backend's service-role
// client in POST /api/internal/sample-shop-screenshot/:merchantId. This is the proof that no
// browser role (anon or an authenticated shop owner) can write here directly, and that the public
// read flag actually works — unlike payment-proof-storage.test.ts's bucket (private, no read
// either), a sample shot is meant to be viewable without auth once the sweep has written it.
import { describe, it, expect } from 'vitest'
import { anonClient, makeUser, seedMerchant, serviceClient } from './helpers.js'

const BUCKET = 'sample-shop-screenshots'

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)
function png() {
  return new Blob([PNG_1X1], { type: 'image/png' })
}

describe('sample-shop-screenshots storage: public read, no browser write', () => {
  it('denies an anonymous upload', async () => {
    const { error } = await anonClient()
      .storage.from(BUCKET)
      .upload('anon/anon.png', png(), { contentType: 'image/png' })
    expect(error).not.toBeNull()
  })

  it('denies a merchant owner uploading, even into what would be their own file', async () => {
    const owner = await makeUser('sample-shot-storage-owner@example.com', 'password123')
    const { data: session } = await owner.auth.getSession()
    const merchantId = await seedMerchant({ slug: 'sample-shot-storage-shop', owner_id: session.session!.user.id })

    const { error } = await owner.storage
      .from(BUCKET)
      .upload(`${merchantId}.png`, png(), { contentType: 'image/png' })
    expect(error).not.toBeNull()
  })

  it('allows an anonymous read of a file the service role wrote', async () => {
    const path = 'seed/read-check.png'
    await serviceClient().storage.from(BUCKET).upload(path, png(), { contentType: 'image/png', upsert: true })

    const { data, error } = await anonClient().storage.from(BUCKET).download(path)
    expect(error).toBeNull()
    expect(data).not.toBeNull()

    await serviceClient().storage.from(BUCKET).remove([path])
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @bitetime/backend test:db -- sample-shot-storage`
Expected: all 3 cases PASS (Task 1's migration already created the bucket with the right shape, so this task is pure verification — no app code changes).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/tests/rls/sample-shot-storage.test.ts
git commit -m "test(backend): verify sample-shop-screenshots bucket has no browser write policy"
```

---

### Task 4: Backend — expose `screenshotPath` from the samples endpoint

**Files:**
- Modify: `apps/backend/src/app.ts:628-666` (`GET /api/merchants/samples`)
- Modify: `apps/backend/tests/api/reads-public.test.ts` (extend the existing `GET /api/merchants/samples` describe block)

**Interfaces:**
- Consumes: `merchants.sample_screenshot_path` (Task 1).
- Produces: `GET /api/merchants/samples` response items gain `screenshotPath: string | null`. Task 6 (frontend `SampleShop` type) consumes this exact field name.

- [ ] **Step 1: Write the failing test**

In `apps/backend/tests/api/reads-public.test.ts`, inside the existing `describe('GET /api/merchants/samples', ...)` block (added by #107), add a new `it` after `'caps products at 3, ordered by sort, and excludes inactive products'`:

```ts
  it('returns null screenshotPath for a shop with no capture yet', async () => {
    const res = await get('/api/merchants/samples')
    const rows = (await res.json()) as Array<{ id: string; screenshotPath: string | null }>
    const shop = rows.find(r => r.id === sampleShopId)!
    expect(shop.screenshotPath).toBeNull()
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bitetime/backend test:db -- reads-public`
Expected: FAIL — `shop.screenshotPath` is `undefined`, not `null` (the field doesn't exist on the response yet).

- [ ] **Step 3: Add the column to the query and response**

In `apps/backend/src/app.ts`, in the `GET /api/merchants/samples` handler:

Change:
```ts
    .select('id, slug, name, currency')
```
to:
```ts
    .select('id, slug, name, currency, sample_screenshot_path')
```

Change:
```ts
  return c.json(merchants.map((m) => ({
    id: m.id,
    slug: m.slug,
    name: m.name,
    currency: m.currency,
    products: (byMerchant.get(m.id) ?? []).map((p) => ({
```
to:
```ts
  return c.json(merchants.map((m) => ({
    id: m.id,
    slug: m.slug,
    name: m.name,
    currency: m.currency,
    screenshotPath: m.sample_screenshot_path,
    products: (byMerchant.get(m.id) ?? []).map((p) => ({
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bitetime/backend test:db -- reads-public`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app.ts apps/backend/tests/api/reads-public.test.ts
git commit -m "feat(backend): expose screenshotPath from GET /api/merchants/samples"
```

---

### Task 5: Capture script + backend package.json wiring

**Files:**
- Create: `apps/backend/scripts/captureSampleShopScreenshots.ts`
- Modify: `apps/backend/package.json` (add `playwright` devDependency + `screenshot:sweep` script)
- Modify: `apps/backend/tsconfig.json` (add `scripts` to `include` — it isn't there today, so this file would otherwise be silently skipped by `pnpm typecheck` rather than checked)

**Interfaces:**
- Consumes: `GET /api/merchants/samples` (returns `{ id, slug, ... }[]`, Task 4), `POST /api/internal/sample-shop-screenshot/:merchantId` (Task 2).
- Produces: `pnpm --filter @bitetime/backend screenshot:sweep` — a CLI entry point Task 6's GitHub Actions workflow calls by exact name.

- [ ] **Step 1: Add the devDependency and script**

In `apps/backend/package.json`, add to `"scripts"` (after `"db:seed:superadmin"`):

```json
    "screenshot:sweep": "node --import jiti/register scripts/captureSampleShopScreenshots.ts"
```

Add to `"devDependencies"` (alongside the existing `vitest` entry, same major version as the frontend's `@playwright/test`):

```json
    "playwright": "^1.62.0"
```

- [ ] **Step 2: Install it**

Run (from the repo root): `pnpm install`
Expected: `playwright` appears in `apps/backend/node_modules` and in `pnpm-lock.yaml`; no other package versions change.

- [ ] **Step 3: Write the script**

Create `apps/backend/scripts/captureSampleShopScreenshots.ts`:

```ts
// CI-only. Never imported by src/app.ts, never bundled by the esbuild build — playwright stays
// a devDependency, not a runtime one. Run via `pnpm --filter @bitetime/backend screenshot:sweep`,
// scheduled weekly by .github/workflows/sample-shop-screenshot-sweep.yml.
import { chromium } from 'playwright'

const FRONTEND_URL = process.env.FRONTEND_URL
const BACKEND_URL = process.env.BACKEND_URL
const SWEEP_SECRET = process.env.SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET
if (!FRONTEND_URL || !BACKEND_URL || !SWEEP_SECRET) {
  console.error('FRONTEND_URL, BACKEND_URL and SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET are all required')
  process.exit(1)
}

interface SampleShop {
  id: string
  slug: string
}

async function main() {
  const res = await fetch(`${BACKEND_URL}/api/merchants/samples`)
  if (!res.ok) throw new Error(`GET /api/merchants/samples: ${res.status}`)
  const shops = (await res.json()) as SampleShop[]

  const browser = await chromium.launch()
  // Mobile viewport — this storefront is mobile-first, and the card the screenshot lands in is
  // a narrow, portrait-shaped slot.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

  let okCount = 0
  for (const shop of shops) {
    try {
      // Exactly two Playwright calls: navigate, screenshot. No click(), no form interaction,
      // anywhere in this script — that is what makes this incapable of placing a real order.
      await page.goto(`${FRONTEND_URL}/s/${shop.slug}`, { waitUntil: 'networkidle' })
      const pngBuffer = await page.screenshot({ type: 'png' })

      const upload = await fetch(
        `${BACKEND_URL}/api/internal/sample-shop-screenshot/${shop.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'image/png', 'x-sweep-secret': SWEEP_SECRET },
          body: pngBuffer,
        },
      )
      if (!upload.ok) throw new Error(`upload: ${upload.status}`)
      okCount++
    } catch (err) {
      // One shop's capture failing (a redirect, a slow load, a temporary 5xx) must not stop the
      // rest — the card's fallback layout is exactly what makes a missed capture harmless.
      console.error(`capture failed for ${shop.slug}:`, err instanceof Error ? err.message : String(err))
    }
  }

  await browser.close()
  console.log(`captured ${okCount}/${shops.length}`)
}

main()
```

- [ ] **Step 4: Add `scripts` to the tsconfig include list**

`apps/backend/tsconfig.json`'s `include` is currently `["src", "tests", "vitest.config.ts", "eslint.config.ts"]` — no `scripts` entry, so the file just written would be silently skipped by `pnpm typecheck` rather than checked. Change:

```json
  "include": ["src", "tests", "vitest.config.ts", "eslint.config.ts"]
```

to:

```json
  "include": ["src", "tests", "scripts", "vitest.config.ts", "eslint.config.ts"]
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bitetime/backend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/package.json apps/backend/tsconfig.json apps/backend/scripts/captureSampleShopScreenshots.ts pnpm-lock.yaml
git commit -m "feat(backend): add sample-shop screenshot capture script"
```

---

### Task 6: GitHub Actions — weekly sweep

**Files:**
- Create: `.github/workflows/sample-shop-screenshot-sweep.yml`

**Interfaces:**
- Consumes: `pnpm --filter @bitetime/backend screenshot:sweep` (Task 5), repo secrets `FRONTEND_URL`, `BACKEND_URL`, `SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET` (none of which this task can set — that is a human, repo-owner action taken outside this plan).

- [ ] **Step 1: Write the workflow**

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

- [ ] **Step 2: Validate the YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/sample-shop-screenshot-sweep.yml'))" 2>&1 || cat .github/workflows/sample-shop-screenshot-sweep.yml`
Expected: no output from the `python3` command (valid YAML) — if `python3`/`yaml` isn't available, at minimum visually diff its structure against `.github/workflows/trial-feedback-sweep.yml`, which is known-good.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/sample-shop-screenshot-sweep.yml
git commit -m "ci: add weekly sample-shop screenshot sweep workflow"
```

---

### Task 7: Frontend — `SampleShop` type + screenshot URL helper

**Files:**
- Modify: `apps/frontend/src/store.ts:207-227`

**Interfaces:**
- Consumes: `GET /api/merchants/samples`'s `screenshotPath` field (Task 4).
- Produces: `SampleShop.screenshotPath: string | null`; `sampleShopScreenshotUrl(path: string): string`. Task 8 (`SampleShopsCarousel.tsx`) imports both by exact name.

- [ ] **Step 1: Add `screenshotPath` to the type**

In `apps/frontend/src/store.ts`, change:

```ts
export interface SampleShop {
  id: string
  slug: string
  name: string
  currency: string
  products: SampleShopProduct[]
}
```

to:

```ts
export interface SampleShop {
  id: string
  slug: string
  name: string
  currency: string
  /** Storage path in the public `sample-shop-screenshots` bucket, or null if not yet captured
   *  (or never will be — capture is a weekly cron, not guaranteed). Resolve with
   *  sampleShopScreenshotUrl() below. Never render this as a URL directly. */
  screenshotPath: string | null
  products: SampleShopProduct[]
}
```

- [ ] **Step 2: Add the URL helper**

Immediately after `export async function fetchSampleShops(): Promise<Result<SampleShop[]>> { ... }`, add:

```ts
export const SAMPLE_SCREENSHOT_BUCKET = 'sample-shop-screenshots'

export function sampleShopScreenshotUrl(path: string): string {
  return storage.from(SAMPLE_SCREENSHOT_BUCKET).getPublicUrl(path).data.publicUrl
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bitetime/frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/store.ts
git commit -m "feat(frontend): add SampleShop.screenshotPath and sampleShopScreenshotUrl"
```

---

### Task 8: Frontend — render the screenshot on the card

**Files:**
- Modify: `apps/frontend/src/marketing/SampleShopsCarousel.tsx`

**Interfaces:**
- Consumes: `SampleShop.screenshotPath`, `sampleShopScreenshotUrl` (Task 7).

- [ ] **Step 1: Import the helper**

Change:
```ts
import { productImageUrl, type SampleShop } from '../store'
```
to:
```ts
import { productImageUrl, sampleShopScreenshotUrl, type SampleShop } from '../store'
```

- [ ] **Step 2: Branch the card body on `screenshotPath`**

Replace the `CarouselItem` body:

```tsx
          <CarouselItem key={shop.id} className="basis-[260px] max-w-[260px]">
            <div className="h-full rounded-2xl border-[1.5px] border-clay-border bg-surface-raised p-5 text-left shadow-[0_16px_40px_-18px_rgba(43,10,16,0.22)]">
              <div className="flex items-center gap-3 pb-4 border-b border-divider">
                {shop.products[0]?.imagePath ? (
                  <img
                    src={productImageUrl(shop.products[0].imagePath)}
                    alt=""
                    className="h-10 w-10 rounded-round object-cover shrink-0"
                  />
                ) : (
                  <span className="grid h-10 w-10 place-items-center rounded-round bg-oxblood-tint font-heading text-[15px] font-medium text-oxblood shrink-0">
                    {initials(shop.name)}
                  </span>
                )}
                <p className="min-w-0 truncate font-heading text-[15px] font-medium text-ink leading-tight">
                  {shop.name}
                </p>
              </div>
              {shop.products.length > 0 && (
                <ul className="list-none m-0 p-0 flex flex-col divide-y divide-divider">
                  {shop.products.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                      <span className="text-[13.5px] text-ink truncate">
                        {lang === 'zh' && p.nameZh ? p.nameZh : p.name}
                      </span>
                      <span className="font-heading text-[13.5px] font-medium text-oxblood shrink-0">
                        {formatMoney(p.price, shop.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CarouselItem>
```

with:

```tsx
          <CarouselItem key={shop.id} className="basis-[260px] max-w-[260px]">
            {shop.screenshotPath ? (
              // Replaces the avatar+product-list block ENTIRELY — one card, one representation
              // of the shop, never both. A static <img>, same as every other card: no <a>/<Link>.
              <div className="h-full overflow-hidden rounded-2xl border-[1.5px] border-clay-border bg-surface-raised shadow-[0_16px_40px_-18px_rgba(43,10,16,0.22)]">
                <img
                  src={sampleShopScreenshotUrl(shop.screenshotPath)}
                  alt={shop.name}
                  className="block w-full h-full object-cover object-top"
                />
              </div>
            ) : (
              <div className="h-full rounded-2xl border-[1.5px] border-clay-border bg-surface-raised p-5 text-left shadow-[0_16px_40px_-18px_rgba(43,10,16,0.22)]">
                <div className="flex items-center gap-3 pb-4 border-b border-divider">
                  {shop.products[0]?.imagePath ? (
                    <img
                      src={productImageUrl(shop.products[0].imagePath)}
                      alt=""
                      className="h-10 w-10 rounded-round object-cover shrink-0"
                    />
                  ) : (
                    <span className="grid h-10 w-10 place-items-center rounded-round bg-oxblood-tint font-heading text-[15px] font-medium text-oxblood shrink-0">
                      {initials(shop.name)}
                    </span>
                  )}
                  <p className="min-w-0 truncate font-heading text-[15px] font-medium text-ink leading-tight">
                    {shop.name}
                  </p>
                </div>
                {shop.products.length > 0 && (
                  <ul className="list-none m-0 p-0 flex flex-col divide-y divide-divider">
                    {shop.products.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                        <span className="text-[13.5px] text-ink truncate">
                          {lang === 'zh' && p.nameZh ? p.nameZh : p.name}
                        </span>
                        <span className="font-heading text-[13.5px] font-medium text-oxblood shrink-0">
                          {formatMoney(p.price, shop.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CarouselItem>
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter @bitetime/frontend exec tsc --noEmit && pnpm lint`
Expected: no errors (pre-existing warnings elsewhere in the repo are unrelated and unchanged).

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/marketing/SampleShopsCarousel.tsx
git commit -m "feat(frontend): render sample shop screenshot when captured, else fall back"
```

---

### Task 9: Run-and-verify

**Files:** none (manual verification only, per CLAUDE.md — UI is verified by running the app).

- [ ] **Step 1: Install Playwright's browser locally**

Run: `pnpm --filter @bitetime/backend exec playwright install chromium`

- [ ] **Step 2: Start the stack**

From the repo root: `pnpm dev` (frontend `:5173`, backend `:8787`). Ensure local Supabase is running (`cd apps/backend && supabase status`; if not, `supabase start`).

- [ ] **Step 3: Flag a merchant as a sample with at least one product**

Via `/admin/merchants` (superadmin), or reuse an existing shop — mark it `is_sample` via the "Mark as sample shop" action (#107).

- [ ] **Step 4: Run the capture script against the local stack**

```bash
FRONTEND_URL=http://localhost:5173 BACKEND_URL=http://localhost:8787 SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET=<same value backend/.env has for SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET> \
  pnpm --filter @bitetime/backend screenshot:sweep
```

Expected: `captured 1/1` (or however many sample shops exist) printed at the end.

- [ ] **Step 5: Verify the card**

Open `/sample-shops`. Confirm the just-flagged shop's card now shows the storefront screenshot, not the avatar+product-list layout. Confirm a shop with no capture (if any) still shows the fallback layout unchanged. Confirm neither card is clickable.

- [ ] **Step 6: Full check**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @bitetime/backend test:db && pnpm build`
Expected: all pass.
