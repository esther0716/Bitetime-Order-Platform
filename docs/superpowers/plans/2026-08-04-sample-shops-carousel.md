# Sample Shops Carousel (#107) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the removed hardcoded `bitetime-co` sample-shop link with a landing-page carousel of non-clickable preview cards, sourced from real merchants flagged `is_sample` in the database and toggled by a superadmin.

**Architecture:** A new `merchants.is_sample` column, flipped through a new superadmin-only backend endpoint and a matching `/admin/merchants` UI action. A second, unauthenticated backend endpoint returns the flagged shops with up to 3 active products each. The frontend fetches that once on the landing page and renders static (non-`Link`, no `href`) cards in a CSS scroll-snap row — there is no path from this UI into a live `/s/:slug` storefront.

**Tech Stack:** Hono (backend), React + Vite (frontend), Supabase Postgres, Tailwind v4 (built-in `snap-x`/`snap-mandatory`/`snap-start` utilities — no new dependency).

## Global Constraints

- No `/s/:slug` link or `<Link>`/`<a href>` anywhere in the new carousel UI — this is the fix for today's incident (`fcd0a57`), not just a feature add.
- `GET /api/merchants/samples` filters on `is_sample = true AND status = 'active'` — a suspended shop disappears from the carousel automatically.
- The samples endpoint's product shape does NOT reuse `productFromRow`/`PricedProduct` from `@bitetime/shared` (no promo/pricing-engine fields belong on a marketing card).
- Product image fields are storage **paths**, never URLs — resolved client-side via the existing `productImageUrl()` (`apps/frontend/src/store.ts:837`), matching the codebase-wide convention (see `payment_proof` design doc).
- No fallback/fake data: zero flagged shops or a failed fetch means the section renders nothing (`useSampleShops` starts `shops: []` and stays there on error — unlike `usePlatformPricing`, which has a real numeric fallback).
- UI is verified by running the app, not component tests (CLAUDE.md) — no `.test.tsx` files in this plan.
- Never run `supabase db push` or any `supabase` command that targets production. `db:migrate` only, from `apps/backend/`.

---

### Task 1: `merchants.is_sample` migration

**Files:**
- Create: `apps/backend/supabase/migrations/20260804170000_merchants_is_sample.sql`

**Interfaces:**
- Produces: `merchants.is_sample boolean not null default false` — every later task reads/writes this column.

- [ ] **Step 1: Write the migration**

```sql
-- Superadmin-set flag: shop appears in the landing page sample-shops carousel
-- (GET /api/merchants/samples) when true AND status = 'active'. Toggled from
-- /admin/merchants (POST /api/admin/set-merchant-sample), never by the merchant
-- themselves. See docs/superpowers/specs/2026-08-04-sample-shops-carousel-design.md.
alter table public.merchants
  add column if not exists is_sample boolean not null default false;
```

- [ ] **Step 2: Apply it to the local stack**

Run (from `apps/backend/`): `pnpm db:migrate`
Expected: migration `20260804170000_merchants_is_sample` listed as applied, no errors.

- [ ] **Step 3: Verify the column exists**

Run: `cd apps/backend && supabase status -o env | grep DB_URL` to get the local `DB_URL`, then:
```bash
psql "<DB_URL>" -c "select column_name, data_type, column_default from information_schema.columns where table_name='merchants' and column_name='is_sample';"
```
Expected: one row — `is_sample | boolean | false`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/supabase/migrations/20260804170000_merchants_is_sample.sql
git commit -m "feat(db): add merchants.is_sample for the sample-shops carousel (#107)"
```

---

### Task 2: Backend — superadmin toggle endpoint

**Files:**
- Modify: `apps/backend/src/app.ts` (add route near `set-merchant-status`, ~line 922)
- Test: `apps/backend/tests/api/admin-sample.test.ts` (create)

**Interfaces:**
- Consumes: `merchants.is_sample` (Task 1), `requireSuperadmin` middleware (`apps/backend/src/mw.ts`, already imported in `app.ts`), `admin` Supabase client (already imported).
- Produces: `POST /api/admin/set-merchant-sample` — body `{ merchantId: string, isSample: boolean }` → `200 { ok: true, isSample: boolean }` on success, `400` on a missing/malformed body, `404` on an unknown merchant, `401`/`403` via `requireSuperadmin`. Later tasks (frontend `store.ts`) call this route by exact path and body shape.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/api/admin-sample.test.ts`:

```ts
// tests/api/admin-sample.test.ts
// POST /api/admin/set-merchant-sample — superadmin toggle for the landing-page sample-shops
// carousel (#107). Persists merchants.is_sample; no other side effects.
import { describe, it, expect, beforeAll } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, serviceClient } from '../rls/helpers.js'

function post(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return data.session!.access_token
}

async function isSampleOf(merchantId: string) {
  const { data } = await serviceClient()
    .from('merchants').select('is_sample').eq('id', merchantId).maybeSingle()
  return data?.is_sample
}

describe('POST /api/admin/set-merchant-sample', () => {
  let superToken: string
  let plainToken: string
  let merchantId: string

  beforeAll(async () => {
    const superClient = await makeUser('super-sample@example.com', 'password123')
    const { data: sess } = await superClient.auth.getSession()
    const svc = serviceClient()
    await svc.from('profiles').delete().eq('user_id', sess.session!.user.id)
    await svc.from('profiles').insert({ user_id: sess.session!.user.id, name: 'Super', app_role: 'superadmin' })
    superToken = await tokenOf(superClient)

    const owner = await makeUser('owner-sample@example.com', 'password123')
    const { data: osess } = await owner.auth.getSession()
    merchantId = await seedMerchant({ slug: 'sample-toggle-shop', owner_id: osess.session!.user.id })
    plainToken = await tokenOf(owner)
  })

  it('refuses an unauthenticated caller', async () => {
    expect((await post('/api/admin/set-merchant-sample', { merchantId, isSample: true })).status).toBe(401)
  })

  it('refuses a non-superadmin', async () => {
    expect((await post('/api/admin/set-merchant-sample', { merchantId, isSample: true }, plainToken)).status).toBe(403)
  })

  it('400s on a missing merchantId', async () => {
    expect((await post('/api/admin/set-merchant-sample', { isSample: true }, superToken)).status).toBe(400)
  })

  it('400s on a non-boolean isSample', async () => {
    expect((await post('/api/admin/set-merchant-sample', { merchantId, isSample: 'yes' }, superToken)).status).toBe(400)
  })

  it('404s on an unknown merchant', async () => {
    const res = await post(
      '/api/admin/set-merchant-sample',
      { merchantId: '00000000-0000-0000-0000-000000000000', isSample: true },
      superToken,
    )
    expect(res.status).toBe(404)
  })

  it('flags and unflags a merchant as a sample shop', async () => {
    expect(await isSampleOf(merchantId)).toBe(false)

    const on = await post('/api/admin/set-merchant-sample', { merchantId, isSample: true }, superToken)
    expect(on.status).toBe(200)
    expect(await isSampleOf(merchantId)).toBe(true)

    const off = await post('/api/admin/set-merchant-sample', { merchantId, isSample: false }, superToken)
    expect(off.status).toBe(200)
    expect(await isSampleOf(merchantId)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bitetime/backend test:db -- admin-sample`
Expected: every case FAILs (route does not exist yet — 404s across the board, not the asserted statuses).

- [ ] **Step 3: Implement the route**

In `apps/backend/src/app.ts`, immediately after the `app.post('/api/admin/set-merchant-status', ...)` handler (ends ~line 940), add:

```ts
// ── Superadmin: flag/unflag a merchant for the landing-page sample-shops carousel (#107) ──────
// Pure flag flip — no billing/status side effects, unlike comp/uncomp. GET /api/merchants/samples
// is what actually reads it.
app.post('/api/admin/set-merchant-sample', requireSuperadmin, async (c) => {
  const { merchantId, isSample } = await c.req.json().catch(() => ({}))
  if (!merchantId || typeof isSample !== 'boolean') {
    return c.json({ error: 'Missing merchantId or isSample' }, 400)
  }

  const { data: merchant } = await admin
    .from('merchants').select('id').eq('id', merchantId).maybeSingle()
  if (!merchant) return c.json({ error: 'Merchant not found' }, 404)

  const { error } = await admin.from('merchants').update({ is_sample: isSample }).eq('id', merchantId)
  if (error) {
    console.error('set-merchant-sample failed:', error.message)
    return c.json({ error: 'Update failed' }, 500)
  }
  return c.json({ ok: true, isSample })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bitetime/backend test:db -- admin-sample`
Expected: all 6 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app.ts apps/backend/tests/api/admin-sample.test.ts
git commit -m "feat(backend): add POST /api/admin/set-merchant-sample (#107)"
```

---

### Task 3: Backend — public samples endpoint

**Files:**
- Modify: `apps/backend/src/app.ts` (add route directly before `app.get('/api/merchants/:slug', ...)`, ~line 624 — it must come first so a literal `/api/merchants/samples` request is never captured by the `:slug` param route)
- Modify: `apps/backend/tests/rls/helpers.ts` (extend `seedMerchant` with optional `is_sample`, `seedProduct` with optional `sort`)
- Test: `apps/backend/tests/api/reads-public.test.ts` (append)

**Interfaces:**
- Consumes: `merchants.is_sample` (Task 1).
- Produces: `GET /api/merchants/samples` → `200` array of
  ```ts
  {
    id: string
    slug: string
    name: string
    currency: string
    products: Array<{ id: string; name: string; nameZh: string | null; price: number; imagePath: string | null }>
  }
  ```
  (products capped at 3/shop, active only, ordered by `sort` then `created_at`). Later tasks (`store.ts`'s `SampleShop`/`SampleShopProduct` types, `SampleShopsCarousel`) consume this exact shape.

- [ ] **Step 1: Extend the test helpers**

In `apps/backend/tests/rls/helpers.ts`, add `is_sample?: boolean` to `seedMerchant`'s `fields` param (after `origin_place_id?: string`) and thread it through the insert the same way every other optional column is:

```ts
  origin_place_id?: string
  /** Landing-page sample-shops carousel flag (#107). Omitted leaves the column default (false). */
  is_sample?: boolean
}) {
```
and in the `.insert({...})` call, after the `origin_place_id` line:
```ts
      ...(fields.origin_place_id !== undefined ? { origin_place_id: fields.origin_place_id } : {}),
      ...(fields.is_sample !== undefined ? { is_sample: fields.is_sample } : {}),
```

Add `sort?: number` to `seedProduct`'s `fields` param (after `option_groups?: unknown`) and thread it through the same way:
```ts
  option_groups?: unknown
  /** Display order within a shop (products.sort). Omitted leaves the column default (0). */
  sort?: number
}) {
```
and in its `.insert({...})` call, after the `option_groups` line:
```ts
      ...(fields.option_groups !== undefined ? { option_groups: fields.option_groups } : {}),
      ...(fields.sort !== undefined ? { sort: fields.sort } : {}),
```

- [ ] **Step 2: Write the failing test**

Append to the end of `apps/backend/tests/api/reads-public.test.ts` (inside the existing `import`s, no new imports needed):

```ts

describe('GET /api/merchants/samples', () => {
  let sampleShopId: string
  let suspendedSampleId: string
  let nonSampleId: string

  beforeAll(async () => {
    const owner = await makeUser('samples-owner@example.com', 'password123')
    const { data: os } = await owner.auth.getSession()
    const ownerId = os.session!.user.id

    sampleShopId = await seedMerchant({ slug: 'sample-active-shop', owner_id: ownerId, is_sample: true })
    await seedProduct({ merchant_id: sampleShopId, name: 'Kaya Toast', price: 6, sort: 2 })
    await seedProduct({ merchant_id: sampleShopId, name: 'Milo Dinosaur', price: 8, sort: 1 })
    await seedProduct({ merchant_id: sampleShopId, name: 'Nasi Lemak', price: 10, sort: 3 })
    await seedProduct({ merchant_id: sampleShopId, name: 'Roti Canai', price: 4, sort: 4 })
    await seedProduct({ merchant_id: sampleShopId, name: 'Inactive Item', price: 99, sort: 0, active: false })

    suspendedSampleId = await seedMerchant({
      slug: 'sample-suspended-shop', owner_id: ownerId, is_sample: true, status: 'suspended',
    })
    await seedProduct({ merchant_id: suspendedSampleId, name: 'Should Not Appear', price: 1 })

    nonSampleId = await seedMerchant({ slug: 'not-a-sample-shop', owner_id: ownerId, is_sample: false })
    await seedProduct({ merchant_id: nonSampleId, name: 'Also Should Not Appear', price: 1 })
  })

  it('returns only active, is_sample=true shops', async () => {
    const res = await get('/api/merchants/samples')
    expect(res.status).toBe(200)
    const rows = (await res.json()) as Array<{ id: string; slug: string }>
    const ids = rows.map(r => r.id)
    expect(ids).toContain(sampleShopId)
    expect(ids).not.toContain(suspendedSampleId)
    expect(ids).not.toContain(nonSampleId)
  })

  it('caps products at 3, ordered by sort, and excludes inactive products', async () => {
    const res = await get('/api/merchants/samples')
    const rows = (await res.json()) as Array<{ id: string; products: Array<{ name: string; nameZh: string | null; price: number; imagePath: string | null }> }>
    const shop = rows.find(r => r.id === sampleShopId)!
    expect(shop.products).toHaveLength(3)
    expect(shop.products.map(p => p.name)).toEqual(['Milo Dinosaur', 'Kaya Toast', 'Nasi Lemak'])
    expect(shop.products.every(p => p.name !== 'Inactive Item')).toBe(true)
    expect(shop.products[0]).toHaveProperty('nameZh')
    expect(shop.products[0]).toHaveProperty('imagePath')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @bitetime/backend test:db -- reads-public`
Expected: the two new cases FAIL (`GET /api/merchants/samples` 404s — route not implemented — or TypeScript fails to compile because `seedMerchant`/`seedProduct` don't yet accept `is_sample`/`sort`. If it's a compile failure, that confirms Step 1 was applied; the route itself is still missing).

- [ ] **Step 4: Implement the route**

In `apps/backend/src/app.ts`, immediately before `app.get('/api/merchants/:slug', ...)` (~line 624), add:

```ts
// ── Public: landing-page sample-shops carousel (#107) ──────────────────────────────────────────
// Registered BEFORE /api/merchants/:slug so the literal path "samples" is never captured as a
// slug. Unauthenticated, like /api/merchants/:slug and /api/merchants/:id/products below — same
// trust level, no tenant scoping needed. Deliberately does NOT reuse productFromRow/PricedProduct
// from @bitetime/shared: this response has no promo/pricing-engine fields, because it prices
// nothing — see docs/superpowers/specs/2026-08-04-sample-shops-carousel-design.md.
app.get('/api/merchants/samples', async (c) => {
  const { data: merchants, error } = await admin
    .from('merchants')
    .select('id, slug, name, currency')
    .eq('is_sample', true)
    .eq('status', 'active')
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  if (!merchants?.length) return c.json([])

  const { data: products, error: pErr } = await admin
    .from('products')
    .select('id, merchant_id, name, name_zh, price, image_urls')
    .in('merchant_id', merchants.map((m) => m.id))
    .eq('active', true)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true })
  if (pErr) return c.json({ error: 'Lookup failed' }, 500)

  const byMerchant = new Map<string, typeof products>()
  for (const p of products ?? []) {
    const list = byMerchant.get(p.merchant_id) ?? []
    if (list.length < 3) list.push(p)
    byMerchant.set(p.merchant_id, list)
  }

  return c.json(merchants.map((m) => ({
    id: m.id,
    slug: m.slug,
    name: m.name,
    currency: m.currency,
    products: (byMerchant.get(m.id) ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      nameZh: p.name_zh,
      price: p.price,
      imagePath: p.image_urls?.[0] ?? null,
    })),
  })))
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @bitetime/backend test:db -- reads-public`
Expected: all cases in the file PASS, including the two new ones.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/app.ts apps/backend/tests/rls/helpers.ts apps/backend/tests/api/reads-public.test.ts
git commit -m "feat(backend): add GET /api/merchants/samples for the landing-page carousel (#107)"
```

---

### Task 4: Frontend — types + store.ts API calls

**Files:**
- Modify: `apps/frontend/src/types.ts` (add `is_sample?: boolean` to `Merchant`)
- Modify: `apps/frontend/src/store.ts` (add `SampleShop`/`SampleShopProduct` types, `fetchSampleShops`, `setMerchantSample`)

**Interfaces:**
- Consumes: `POST /api/admin/set-merchant-sample`, `GET /api/merchants/samples` (Tasks 2–3).
- Produces: `SampleShop`, `SampleShopProduct` types; `fetchSampleShops(): Promise<Result<SampleShop[]>>`; `setMerchantSample(id: string, isSample: boolean): Promise<Result<any>>`. Later tasks (`useSampleShops`, `AdminMerchants.tsx`, `SampleShopsCarousel`) import these by exact name.

- [ ] **Step 1: Add the `Merchant` field**

In `apps/frontend/src/types.ts`, inside `interface Merchant` (starts line 19), add after `created_at?: string`:

```ts
  /** Landing-page sample-shops carousel flag (#107). Toggled only from /admin/merchants. */
  is_sample?: boolean
```

- [ ] **Step 2: Add the store.ts types and functions**

In `apps/frontend/src/store.ts`, immediately after `export async function uncompMerchant(...)` (ends ~line 146), add:

```ts
// Superadmin: flag/unflag a merchant for the landing-page sample-shops carousel (#107).
// Pure flag flip, no billing/status side effect — see set-merchant-sample in app.ts.
export async function setMerchantSample(id: string, isSample: boolean): Promise<Result<any>> {
  return apiSend<any>('/api/admin/set-merchant-sample', 'POST', { merchantId: id, isSample }, { auth: 'required' })
}
```

Then, immediately after `export interface PlatformPricing { ... }` and its blank line (ends ~line 199, right before `export async function fetchPlatformPricing`), add:

```ts
// A shop shown in the landing-page sample-shops carousel (#107). `imagePath` is a Storage PATH
// in the public `product-images` bucket, never a URL — resolve with productImageUrl() below.
export interface SampleShopProduct {
  id: string
  name: string
  nameZh: string | null
  price: number
  imagePath: string | null
}

export interface SampleShop {
  id: string
  slug: string
  name: string
  currency: string
  products: SampleShopProduct[]
}

export async function fetchSampleShops(): Promise<Result<SampleShop[]>> {
  return apiGet<SampleShop[]>('/api/merchants/samples')
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bitetime/frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/types.ts apps/frontend/src/store.ts
git commit -m "feat(frontend): add sample-shops types and API calls to store.ts (#107)"
```

---

### Task 5: Frontend — `useSampleShops` hook

**Files:**
- Create: `apps/frontend/src/useSampleShops.ts`

**Interfaces:**
- Consumes: `fetchSampleShops`, `SampleShop` (Task 4).
- Produces: `useSampleShops(): { shops: SampleShop[]; loading: boolean }`. Consumed by `SampleShopsCarousel` (Task 8).

- [ ] **Step 1: Write the hook**

```ts
import { useState, useEffect } from 'react'
import { fetchSampleShops, type SampleShop } from './store'

/**
 * Fetch the landing-page sample-shops carousel data once. No fallback content on error or an
 * empty result — `shops` just stays `[]`, and the caller (SampleShopsCarousel) renders nothing
 * in that case. Unlike usePlatformPricing, there is no sensible fake shop to fall back to.
 */
export function useSampleShops() {
  const [shops, setShops] = useState<SampleShop[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetchSampleShops()
      .then((r) => { if (active && r.ok) setShops(r.data) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return { shops, loading }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @bitetime/frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/useSampleShops.ts
git commit -m "feat(frontend): add useSampleShops hook (#107)"
```

---

### Task 6: Frontend — admin toggle UI in `/admin/merchants`

**Files:**
- Modify: `apps/frontend/src/admin/AdminMerchants.tsx`

**Interfaces:**
- Consumes: `setMerchantSample` (Task 4), `Merchant.is_sample` (Task 4).

- [ ] **Step 1: Import `setMerchantSample`**

In `apps/frontend/src/admin/AdminMerchants.tsx`, change the existing import line:
```ts
import { fetchAllMerchants, setMerchantStatus, approveMerchant, compMerchant, uncompMerchant, fetchAllBilling, type MerchantBilling } from '../store'
```
to:
```ts
import { fetchAllMerchants, setMerchantStatus, approveMerchant, compMerchant, uncompMerchant, setMerchantSample, fetchAllBilling, type MerchantBilling } from '../store'
```

- [ ] **Step 2: Add the handler to `AdminTableMeta`**

In the `interface AdminTableMeta` block, after `onUncomp: (id: string) => void`, add:
```ts
  onToggleSample: (id: string, isSample: boolean) => void
```

- [ ] **Step 3: Add the dropdown action**

In the `actions` column's `cell`, inside `<DropdownMenuContent>`, immediately after the comp/uncomp `DropdownMenuItem` block (ends with the closing `)}` for `onComp`), add:

```tsx
              {m.is_sample ? (
                <DropdownMenuItem className="cursor-pointer" onClick={() => meta.onToggleSample(m.id, false)}>
                  {t('Remove from samples', '取消示例店铺')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem className="cursor-pointer" onClick={() => meta.onToggleSample(m.id, true)}>
                  {t('Mark as sample shop', '设为示例店铺')}
                </DropdownMenuItem>
              )}
```

- [ ] **Step 4: Add the handler function and wire it into `meta`**

In the `AdminMerchants` component, immediately after the `uncomp` function (ends `setBusy(null); }`), add:

```ts
  async function toggleSample(id: string, isSample: boolean) {
    setBusy(id)
    const r = await setMerchantSample(id, isSample)
    if (r.ok) {
      toast.success(isSample ? t('Marked as sample shop', '已设为示例店铺') : t('Removed from samples', '已取消示例店铺'))
      await load()
    } else {
      toast.error(r.error.message || t('Could not update', '无法更新'))
    }
    setBusy(null)
  }
```

In the `meta` object literal, after `onUncomp: uncomp,`, add:
```ts
    onToggleSample: toggleSample,
```

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @bitetime/frontend exec tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/admin/AdminMerchants.tsx
git commit -m "feat(frontend): add sample-shop toggle to /admin/merchants (#107)"
```

---

### Task 7: Frontend — `SampleShopsCarousel` component

**Files:**
- Create: `apps/frontend/src/marketing/SampleShopsCarousel.tsx`

**Interfaces:**
- Consumes: `useSampleShops` (Task 5), `productImageUrl` (`apps/frontend/src/store.ts:837`), `formatMoney` (`apps/frontend/src/currency.ts`), `useSession` (`../SessionContext`), `Reveal` + section styling from `./LandingMotion` / `./ctaStyles`.
- Produces: default export `SampleShopsCarousel` — a self-contained `<section>` (or `null`), no props. Consumed by `Landing.tsx` (Task 8).

- [ ] **Step 1: Write the component**

```tsx
import { useSession } from '../SessionContext'
import { formatMoney } from '../currency'
import { productImageUrl } from '../store'
import { useSampleShops } from '../useSampleShops'
import { Reveal } from './LandingMotion'
import { sectionTitle } from './ctaStyles'

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}

// Real shops (merchants.is_sample), NON-clickable preview cards — no <Link>/<a href> anywhere in
// this file. That is deliberate: the landing page used to link straight into a live storefront
// (`/s/bitetime-co`) and customers placed real orders on it (fcd0a57). This carousel replaces
// that link entirely rather than reintroducing it across more shops. See
// docs/superpowers/specs/2026-08-04-sample-shops-carousel-design.md.
export default function SampleShopsCarousel() {
  const { t, lang } = useSession()
  const { shops } = useSampleShops()

  if (shops.length === 0) return null

  return (
    <section className="border-t border-clay-border px-8 py-16 max-[600px]:px-5 max-[600px]:py-10">
      <Reveal>
        <h2 className={sectionTitle}>
          {t('Real shops on TinyOrder', 'TinyOrder 上的真实店铺')}
        </h2>
        <div
          className="flex overflow-x-auto snap-x snap-mandatory gap-5 pb-2 max-w-[900px] mx-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {shops.map((shop) => (
            <div
              key={shop.id}
              className="shrink-0 snap-start w-[260px] rounded-2xl border-[1.5px] border-clay-border bg-surface-raised p-5 text-left shadow-[0_16px_40px_-18px_rgba(43,10,16,0.22)]"
            >
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
          ))}
        </div>
      </Reveal>
    </section>
  )
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm --filter @bitetime/frontend exec tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/marketing/SampleShopsCarousel.tsx
git commit -m "feat(frontend): add SampleShopsCarousel component (#107)"
```

---

### Task 8: Frontend — wire the carousel into the landing page

**Files:**
- Modify: `apps/frontend/src/marketing/Landing.tsx`

**Interfaces:**
- Consumes: `SampleShopsCarousel` (Task 7).

- [ ] **Step 1: Import it**

In `apps/frontend/src/marketing/Landing.tsx`, after the existing `import { MarketingNav, MarketingFooter } from './MarketingChrome'` line, add:
```ts
import SampleShopsCarousel from './SampleShopsCarousel'
```

- [ ] **Step 2: Render it between the Hero and "How it works"**

Immediately after the Hero `</section>` closing tag (line 105) and before the `{/* ── How it works ── */}` comment (line 107), add:

```tsx
      <SampleShopsCarousel />

```

- [ ] **Step 3: Typecheck, lint, build**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @bitetime/frontend build`
Expected: all pass; build succeeds (this also re-runs the prerender step, which does not execute effects, so `SampleShopsCarousel`'s fetch never fires at build time — it renders `null` in the prerendered HTML, which is correct: the carousel is real-time data, not marketing copy).

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/marketing/Landing.tsx
git commit -m "feat(frontend): render SampleShopsCarousel on the landing page (#107)"
```

---

### Task 9: Run-and-verify

**Files:** none (manual verification only, per CLAUDE.md — UI is verified by running the app).

- [ ] **Step 1: Start the stack**

From the repo root: `pnpm dev` (frontend `:5173`, backend `:8787`). Ensure local Supabase is running (`cd apps/backend && supabase status`; if not, `supabase start`).

- [ ] **Step 2: Flag a merchant as a sample**

Sign in as superadmin, go to `/admin/merchants`, pick any active merchant with at least one active product, open its row's `⋯` menu, click "Mark as sample shop". Confirm the success toast.

- [ ] **Step 3: Verify the landing page**

Open `/` signed out. Confirm:
- A "Real shops on TinyOrder" section appears between the hero and "How it works".
- It shows the flagged shop's real name and product(s)/price(s).
- No element in that section is a link — hovering shows no pointer/href, and `⌘`-clicking does nothing.
- The existing hero `StorefrontPreview` mock (with its order-ping animation) is unchanged.

- [ ] **Step 4: Verify the empty state**

Back in `/admin/merchants`, click "Remove from samples" on that shop. Reload `/`. Confirm the "Real shops on TinyOrder" section is gone entirely (not an empty/loading placeholder).

- [ ] **Step 5: Verify suspension hides a sample shop**

Re-flag the same shop as a sample. In `/admin/merchants`, suspend it. Reload `/`. Confirm the section is gone (or excludes that shop if other samples exist) — proves the `status = 'active'` filter in `GET /api/merchants/samples`. Reactivate the shop afterward to leave the environment as found.

- [ ] **Step 6: Full check**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @bitetime/backend test:db && pnpm build`
Expected: all pass.
