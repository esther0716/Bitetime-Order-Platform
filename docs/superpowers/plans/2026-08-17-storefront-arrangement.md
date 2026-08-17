# Storefront Arrangement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merchant drags their own menu into order on a new dashboard section, and the storefront renders that order.

**Architecture:** `products.sort` already exists and is already read; one new endpoint writes it, plus `category_id`, in a single tenant-scoped SQL statement. The dashboard gains a `storefront` section whose drag surface renders the storefront's own rows at phone width, so the surface is also the preview. All arrangement rules live in one pure frontend module; the component holds only state and dnd-kit wiring.

**Tech Stack:** Hono + `postgres.js` (`db.ts`) on the backend. React 19, TanStack-free plain components, `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` on the frontend. Vitest everywhere.

**Spec:** `docs/superpowers/specs/2026-08-17-storefront-arrangement-design.md`

## Global Constraints

- `sort` MUST stay out of `PRODUCT_FIELDS` in `apps/backend/src/writes.ts`. The new endpoint is the only writer.
- `category_id` MUST NOT be validated against the shop's category list. A dangling id is the "uncategorized" state, per ADR 0013.
- `p.merchant_id = ${merchantId}` in the update statement is the ONLY tenancy guard on that path. `db.ts` is RLS-exempt.
- At most 500 items per request (`MAX_PRODUCT_ORDER_ITEMS`).
- Every `id` must match a uuid before it reaches Postgres. An unchecked id becomes a failing `::uuid` cast, which is a 500 for what is a 400.
- The whole product list is sent on every save, never a diff. Last-writer-wins.
- No new backend runtime dependency, so no new `--external:` flag in the esbuild command.
- dnd-kit is imported only from `apps/frontend/src/merchant/**`. It must never reach a storefront or marketing module.
- No component tests. Pure logic is unit-tested; UI is verified by running the app (CLAUDE.md).
- Every user-visible string is `t(english, chinese)`.
- Frontend tests: `pnpm --filter @bitetime/frontend test`. Backend unit: `pnpm --filter @bitetime/backend test`. Backend DB-backed: `pnpm --filter @bitetime/backend test:db` (needs `supabase start` from `apps/backend`).

## File Structure

| File | Responsibility |
|---|---|
| `apps/backend/src/productOrder.ts` | **Create.** Pure: parse and validate a product-order body. No database. |
| `apps/backend/src/productOrderDb.ts` | **Create.** The one statement that writes `sort` and `category_id`. |
| `apps/backend/src/app.ts` | **Modify.** One new route, `PUT /api/merchants/:id/product-order`. |
| `apps/backend/tests/unit/productOrder.test.ts` | **Create.** The validator's rules. |
| `apps/backend/tests/unit/writes.test.ts` | **Modify.** `pickProductFields` still drops `sort`. |
| `apps/backend/tests/api/product-order.test.ts` | **Create.** The route against real Postgres, tenancy included. |
| `apps/backend/tests/rls/helpers.ts` | **Modify.** `seedProduct` gains `category_id`. |
| `apps/frontend/src/store.ts` | **Modify.** `saveProductOrder`. |
| `apps/frontend/src/merchant/menuArrangement.ts` | **Create.** Every arrangement rule, pure. |
| `apps/frontend/src/merchant/menuArrangement.test.ts` | **Create.** Its tests. |
| `apps/frontend/src/components/MenuRow.tsx` | **Create.** The row shell both the storefront and the arranger draw. |
| `apps/frontend/src/store/Storefront.tsx` | **Modify.** Its product card becomes `MenuRow` plus slots. |
| `apps/frontend/src/merchant/StorefrontArranger.tsx` | **Create.** The screen: state, dnd-kit wiring, save. |
| `apps/frontend/src/merchant/Dashboard.tsx` | **Modify.** One new section. |
| `apps/frontend/src/merchant/MenuCategoriesDialog.tsx` | **Modify.** Loses Up and Down. |
| `CLAUDE.md`, `CONTEXT.md` | **Modify.** Record the section and the endpoint. |

---

### Task 1: The product-order validator (pure)

**Files:**
- Create: `apps/backend/src/productOrder.ts`
- Test: `apps/backend/tests/unit/productOrder.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface ProductOrderItem { id: string; sort: number; category_id: string | null }`, `type ProductOrderError = 'malformed_body' | 'too_many_items' | 'malformed_item' | 'duplicate_item'`, `const MAX_PRODUCT_ORDER_ITEMS = 500`, `parseProductOrder(body: unknown): { ok: true; items: ProductOrderItem[] } | { ok: false; error: ProductOrderError }`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/unit/productOrder.test.ts`:

```ts
// tests/unit/productOrder.test.ts
// The rules PUT /api/merchants/:id/product-order enforces before it touches Postgres. Pure, so
// this runs in `pnpm --filter @bitetime/backend test` with no Supabase and no env.
import { describe, it, expect } from 'vitest'
import { parseProductOrder, MAX_PRODUCT_ORDER_ITEMS } from '../../src/productOrder.js'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('parseProductOrder', () => {
  it('accepts a well-formed list', () => {
    const r = parseProductOrder({
      items: [
        { id: uuid(1), sort: 0, category_id: 'c1' },
        { id: uuid(2), sort: 1, category_id: null },
      ],
    })
    expect(r).toEqual({
      ok: true,
      items: [
        { id: uuid(1), sort: 0, category_id: 'c1' },
        { id: uuid(2), sort: 1, category_id: null },
      ],
    })
  })

  it('accepts an empty list', () => {
    expect(parseProductOrder({ items: [] })).toEqual({ ok: true, items: [] })
  })

  // A dangling id IS the uncategorized state (ADR 0013), so the shop's own list is never consulted.
  it('accepts a category id that names nothing', () => {
    const r = parseProductOrder({ items: [{ id: uuid(1), sort: 0, category_id: 'long-deleted' }] })
    expect(r.ok).toBe(true)
  })

  // The form's "no category" is an empty string; the column has no such state.
  it('reads an empty category id as null', () => {
    const r = parseProductOrder({ items: [{ id: uuid(1), sort: 0, category_id: '' }] })
    expect(r).toEqual({ ok: true, items: [{ id: uuid(1), sort: 0, category_id: null }] })
  })

  it('refuses a body that is not an object with an items array', () => {
    expect(parseProductOrder(null)).toEqual({ ok: false, error: 'malformed_body' })
    expect(parseProductOrder({})).toEqual({ ok: false, error: 'malformed_body' })
    expect(parseProductOrder({ items: 'nope' })).toEqual({ ok: false, error: 'malformed_body' })
  })

  it('refuses more items than the cap', () => {
    const items = Array.from({ length: MAX_PRODUCT_ORDER_ITEMS + 1 }, (_, i) => ({
      id: uuid(i), sort: i, category_id: null,
    }))
    expect(parseProductOrder({ items })).toEqual({ ok: false, error: 'too_many_items' })
  })

  // Load-bearing: an id that is not a uuid reaches Postgres as a failing ::uuid cast, which turns
  // a bad request into a 500.
  it('refuses an id that is not a uuid', () => {
    expect(parseProductOrder({ items: [{ id: 'not-a-uuid', sort: 0, category_id: null }] }))
      .toEqual({ ok: false, error: 'malformed_item' })
  })

  it('refuses a sort that is not a non-negative integer', () => {
    for (const sort of [-1, 1.5, '0', null, undefined]) {
      expect(parseProductOrder({ items: [{ id: uuid(1), sort, category_id: null }] }))
        .toEqual({ ok: false, error: 'malformed_item' })
    }
  })

  it('refuses a category id that is neither a string nor null', () => {
    expect(parseProductOrder({ items: [{ id: uuid(1), sort: 0, category_id: 7 }] }))
      .toEqual({ ok: false, error: 'malformed_item' })
  })

  it('refuses an item that is not an object', () => {
    expect(parseProductOrder({ items: ['x'] })).toEqual({ ok: false, error: 'malformed_item' })
  })

  // Two rows naming one product would make the update's result depend on scan order.
  it('refuses the same product twice', () => {
    expect(parseProductOrder({
      items: [{ id: uuid(1), sort: 0, category_id: null }, { id: uuid(1), sort: 1, category_id: null }],
    })).toEqual({ ok: false, error: 'duplicate_item' })
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm --filter @bitetime/backend test tests/unit/productOrder.test.ts
```

Expected: FAIL — `Failed to load ../../src/productOrder.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/productOrder.ts`:

```ts
// What a product-order request must satisfy, and nothing that touches a database.
//
// The pure half of a pair, like aiUsage.ts / aiUsageDb.ts: `pnpm --filter @bitetime/backend test`
// reaches this with no Supabase, no env and no connection, so the rules that decide whether a
// merchant's arrangement is legal are checked by the cheap suite.
//
// See docs/superpowers/specs/2026-08-17-storefront-arrangement-design.md.

/** One product's new place: where it sits, and which section it sits in. */
export interface ProductOrderItem {
  id: string
  sort: number
  category_id: string | null
}

/** Why an arrangement is not a legal arrangement. */
export type ProductOrderError =
  | 'malformed_body' | 'too_many_items' | 'malformed_item' | 'duplicate_item'

/**
 * The most products one request may arrange.
 *
 * A shop with more products than this has a different problem, and the alternative is a statement
 * whose parameter arrays are as long as the body says.
 */
export const MAX_PRODUCT_ORDER_ITEMS = 500

// Postgres casts the id array to uuid[]. A value that is not a uuid raises there — a 500 for what
// is a bad request — so it is refused here instead, where the answer can say why.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Read a request body into the items the write needs, or say why it cannot.
 *
 * SHAPE FIRST and unconditionally: this is handed whatever the request contained, so every read
 * below is on a value nothing has checked. `validateOptionGroups` records the same lesson.
 *
 * `category_id` is deliberately NOT checked against the shop's own list. An id the list no longer
 * holds reads as uncategorized (ADR 0013), so checking it here would turn a stale dashboard into
 * a refused save.
 */
export function parseProductOrder(body: unknown):
  | { ok: true; items: ProductOrderItem[] }
  | { ok: false; error: ProductOrderError } {
  if (!isObject(body) || !Array.isArray(body.items)) return { ok: false, error: 'malformed_body' }
  if (body.items.length > MAX_PRODUCT_ORDER_ITEMS) return { ok: false, error: 'too_many_items' }

  const seen = new Set<string>()
  const items: ProductOrderItem[] = []

  for (const raw of body.items as unknown[]) {
    if (!isObject(raw)) return { ok: false, error: 'malformed_item' }
    if (typeof raw.id !== 'string' || !UUID.test(raw.id)) return { ok: false, error: 'malformed_item' }
    if (typeof raw.sort !== 'number' || !Number.isInteger(raw.sort) || raw.sort < 0) {
      return { ok: false, error: 'malformed_item' }
    }
    if (raw.category_id !== null && typeof raw.category_id !== 'string') {
      return { ok: false, error: 'malformed_item' }
    }
    // Two rows naming one product would leave the outcome to the scan order of the update.
    if (seen.has(raw.id)) return { ok: false, error: 'duplicate_item' }
    seen.add(raw.id)

    // The product form's "no category" is an empty string; the column has only NULL. One state
    // in, one state out — the two must not diverge into "unfiled" and "filed under nothing".
    items.push({ id: raw.id, sort: raw.sort, category_id: raw.category_id === '' ? null : raw.category_id })
  }

  return { ok: true, items }
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
pnpm --filter @bitetime/backend test tests/unit/productOrder.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/productOrder.ts apps/backend/tests/unit/productOrder.test.ts
git commit -m "feat(backend): validate a product-order request"
```

---

### Task 2: The write, the route, and the tenancy proof

**Files:**
- Create: `apps/backend/src/productOrderDb.ts`
- Modify: `apps/backend/src/app.ts` (import block near the other `*Db` imports; new route after the product DELETE route, around line 867)
- Modify: `apps/backend/tests/rls/helpers.ts` (`seedProduct`, around line 149)
- Modify: `apps/backend/tests/unit/writes.test.ts`
- Create: `apps/backend/tests/api/product-order.test.ts`

**Interfaces:**
- Consumes: `parseProductOrder`, `ProductOrderItem`, `MAX_PRODUCT_ORDER_ITEMS` from Task 1.
- Produces: `writeProductOrder(merchantId: string, items: ProductOrderItem[]): Promise<number>` (the number of rows updated), and the route `PUT /api/merchants/:id/product-order` answering `{ ok: true, updated: number }` or `{ error: ProductOrderError | 'Update failed' }`.

- [ ] **Step 1: Write the failing unit test for the allowlist**

In `apps/backend/tests/unit/writes.test.ts`, inside the existing `describe('pickProductFields', …)` block, add:

```ts
  // `sort` is written by PUT /api/merchants/:id/product-order and by nothing else. ProductsManager
  // spreads a whole row on edit, so accepting it here would let a stale dashboard drag a product
  // back to where it used to be, behind an ordinary rename.
  it('drops sort, so a product upsert can never move a product', () => {
    expect(pickProductFields({ name: 'Cookie', price: 5, sort: 99 })).toEqual({ name: 'Cookie', price: 5 })
  })
```

- [ ] **Step 2: Run it**

```bash
pnpm --filter @bitetime/backend test tests/unit/writes.test.ts
```

Expected: PASS immediately — `sort` is already excluded. This test is a pin, not a change. If it FAILS, `PRODUCT_FIELDS` has drifted; remove `'sort'` from it before continuing.

- [ ] **Step 3: Teach `seedProduct` about categories**

In `apps/backend/tests/rls/helpers.ts`, add to the `seedProduct` field list (beside the existing `sort?: number`):

```ts
  /** Which section the product sits in (products.category_id). Omitted leaves it NULL. */
  category_id?: string
```

and pass it through in the same conditional style the other optional fields use:

```ts
      ...(fields.category_id !== undefined ? { category_id: fields.category_id } : {}),
```

- [ ] **Step 4: Write the failing API test**

Create `apps/backend/tests/api/product-order.test.ts`:

```ts
// tests/api/product-order.test.ts
// PUT /api/merchants/:id/product-order — the merchant's own arrangement of their own menu.
//
// The load-bearing assertion is tenancy. This route writes through `db.ts`, which is RLS-EXEMPT:
// no policy runs on that connection, so the `p.merchant_id = :id` predicate inside the statement
// is the whole guard. A body naming a stranger's product must change nothing, anywhere.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, seedProduct, serviceClient, resetMerchant } from '../rls/helpers.js'

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function put(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('PUT /api/merchants/:id/product-order', () => {
  let shop: { id: string; token: string }

  beforeAll(async () => {
    await resetMerchant('arrange-shop')
    const owner = await makeUser('arrange-owner@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    shop = { id: await seedMerchant({ slug: 'arrange-shop', owner_id: userId }), token }
  })

  afterAll(async () => {
    await resetMerchant('arrange-shop')
  })

  it('writes sort and category_id, and the public read returns the new order', async () => {
    const first = await seedProduct({ merchant_id: shop.id, name: 'Tea', price: 5 })
    const second = await seedProduct({ merchant_id: shop.id, name: 'Cake', price: 9 })

    const res = await put(`/api/merchants/${shop.id}/product-order`, {
      items: [
        { id: second, sort: 0, category_id: 'c1' },
        { id: first, sort: 1, category_id: null },
      ],
    }, shop.token)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, updated: 2 })

    const list = await app.request(`/api/merchants/${shop.id}/products`)
    const rows = (await list.json()) as { id: string; sort: number; category_id: string | null }[]
    expect(rows.map(r => r.id)).toEqual([second, first])
    expect(rows[0]!.category_id).toBe('c1')
    expect(rows[1]!.category_id).toBeNull()

    await serviceClient().from('products').delete().in('id', [first, second])
  })

  // The merchant deleted the section but not the products in it. The arrangement drops them into
  // the trailing block, and the save is what finally clears the dangling id.
  it('clears a dangling category id when the product moves to the trailing block', async () => {
    const id = await seedProduct({ merchant_id: shop.id, name: 'Orphan', price: 3, category_id: 'long-deleted' })

    const res = await put(`/api/merchants/${shop.id}/product-order`, {
      items: [{ id, sort: 0, category_id: null }],
    }, shop.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient().from('products').select('category_id').eq('id', id).single()
    expect(data!.category_id).toBeNull()

    await serviceClient().from('products').delete().eq('id', id)
  })

  // ADR 0013: the shop's own list is never consulted, so filing into a just-deleted section from a
  // stale dashboard saves rather than 400s.
  it('accepts a category id the shop does not hold', async () => {
    const id = await seedProduct({ merchant_id: shop.id, name: 'Ghost', price: 3 })

    const res = await put(`/api/merchants/${shop.id}/product-order`, {
      items: [{ id, sort: 0, category_id: 'never-existed' }],
    }, shop.token)

    expect(res.status).toBe(200)
    const { data } = await serviceClient().from('products').select('category_id').eq('id', id).single()
    expect(data!.category_id).toBe('never-existed')

    await serviceClient().from('products').delete().eq('id', id)
  })

  // THE tenancy test. `db.ts` runs as the database owner and no policy stops this write; only the
  // predicate inside the statement does. Product ids are enumerable from the public product read.
  it('changes nothing when the body names another shop’s product', async () => {
    await resetMerchant('arrange-tenant-b')
    const ownerB = await makeUser('arrange-tenant-b@example.com', 'password123')
    const { userId: ownerBId } = await tokenOf(ownerB)
    const shopB = await seedMerchant({ slug: 'arrange-tenant-b', owner_id: ownerBId })
    const productB = await seedProduct({ merchant_id: shopB, name: 'Shop B Cake', price: 7, sort: 4 })

    const res = await put(`/api/merchants/${shop.id}/product-order`, {
      items: [{ id: productB, sort: 0, category_id: 'hijacked' }],
    }, shop.token)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, updated: 0 })

    const { data } = await serviceClient()
      .from('products').select('merchant_id, sort, category_id').eq('id', productB).single()
    expect(data!.merchant_id).toBe(shopB)
    expect(data!.sort).toBe(4)
    expect(data!.category_id).toBeNull()

    await serviceClient().from('products').delete().eq('id', productB)
    await resetMerchant('arrange-tenant-b')
  })

  it('400s a malformed body without touching a row', async () => {
    const id = await seedProduct({ merchant_id: shop.id, name: 'Safe', price: 3, sort: 2 })

    const res = await put(`/api/merchants/${shop.id}/product-order`, {
      items: [{ id: 'not-a-uuid', sort: 0, category_id: null }],
    }, shop.token)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'malformed_item' })

    const { data } = await serviceClient().from('products').select('sort').eq('id', id).single()
    expect(data!.sort).toBe(2)

    await serviceClient().from('products').delete().eq('id', id)
  })

  it('400s more than 500 items', async () => {
    const items = Array.from({ length: 501 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, sort: i, category_id: null,
    }))
    const res = await put(`/api/merchants/${shop.id}/product-order`, { items }, shop.token)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'too_many_items' })
  })

  it('403 for a non-owner', async () => {
    const other = await makeUser('arrange-other@example.com', 'password123')
    const { token } = await tokenOf(other)
    const res = await put(`/api/merchants/${shop.id}/product-order`, { items: [] }, token)
    expect(res.status).toBe(403)
  })

  it('401 without a token', async () => {
    const res = await put(`/api/merchants/${shop.id}/product-order`, { items: [] })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 5: Run it and watch it fail**

```bash
# from apps/backend, with the local stack up (`supabase start`)
pnpm --filter @bitetime/backend test:db tests/api/product-order.test.ts
```

Expected: FAIL — every case 404s, because the route does not exist.

- [ ] **Step 6: Write the database module**

Create `apps/backend/src/productOrderDb.ts`:

```ts
// The one statement that writes a shop's arrangement: where each product sits, and which section
// it sits in. The rules live next door in `productOrder.ts`, which is pure — see the note at the
// top of that file for why the split.
//
// Goes through `db.ts`, which is RLS-EXEMPT. The `p.merchant_id` predicate below is the WHOLE
// tenancy guard on this path; `requireMerchantOwns` on the route is what makes it true. A body
// naming a stranger's product updates zero rows, which is the correct answer and needs no
// separate lookup.

import { sql } from './db.js'
import type { ProductOrderItem } from './productOrder.js'

/**
 * Apply an arrangement. Returns how many rows it moved.
 *
 * ONE statement, so it is atomic on its own and needs no `withTransaction()`. A merchant never
 * sees half an arrangement.
 *
 * Three parallel arrays through `unnest`, rather than a `values` list built from the body: the
 * statement is then a fixed string with three parameters whatever the shop's size, and no SQL is
 * assembled from anything a request contained.
 */
export async function writeProductOrder(
  merchantId: string,
  items: ProductOrderItem[],
): Promise<number> {
  // `unnest` of three empty arrays is legal but pointless, and postgres.js has to guess the type
  // of an empty array. Nothing to do is nothing to ask.
  if (items.length === 0) return 0

  const ids = items.map(i => i.id)
  const sorts = items.map(i => i.sort)
  const categoryIds = items.map(i => i.category_id)

  const rows = await sql<{ id: string }[]>`
    update products p
       set sort = v.sort, category_id = v.category_id
      from unnest(${ids}::uuid[], ${sorts}::int[], ${categoryIds}::text[])
           as v(id, sort, category_id)
     where p.id = v.id
       and p.merchant_id = ${merchantId}
    returning p.id
  `
  return rows.length
}
```

If postgres.js refuses a bare JS array as a parameter here, wrap each with `sql.array(...)` — the
casts stay as they are.

- [ ] **Step 7: Add the route**

In `apps/backend/src/app.ts`, add to the imports beside the other domain modules:

```ts
import { parseProductOrder } from './productOrder.js'
import { writeProductOrder } from './productOrderDb.js'
```

and add this route immediately after the product DELETE handler (`app.delete('/api/merchants/:id/products/:productId', …)`):

```ts
/**
 * The merchant's arrangement of their own menu: which section each product sits in, and in what
 * order (docs/superpowers/specs/2026-08-17-storefront-arrangement-design.md).
 *
 * A separate endpoint rather than a field on the product upsert, because a rearrangement is one
 * decision about the whole menu — N upserts would leave a shop half-arranged when the fourth one
 * failed, and would need `sort` in `PRODUCT_FIELDS`, where a stale dashboard could drag a product
 * back to where it used to be behind an ordinary rename.
 *
 * `requireMerchantOwns` proves the caller owns :id. It says nothing about the product ids in the
 * body — the statement's own `merchant_id` predicate is what handles those, by matching none of
 * them. Hence `updated`, which a caller can compare against what it sent.
 */
app.put('/api/merchants/:id/product-order', requireMerchantOwns, async (c) => {
  const id = c.req.param('id')
  const parsed = parseProductOrder(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  try {
    const updated = await writeProductOrder(id, parsed.items)
    return c.json({ ok: true, updated })
  } catch {
    return c.json({ error: 'Update failed' }, 500)
  }
})
```

- [ ] **Step 8: Run the API test and watch it pass**

```bash
pnpm --filter @bitetime/backend test:db tests/api/product-order.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 9: Run the rest of the backend**

```bash
pnpm --filter @bitetime/backend test
pnpm --filter @bitetime/backend typecheck
pnpm --filter @bitetime/backend lint
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/productOrderDb.ts apps/backend/src/app.ts \
        apps/backend/tests/api/product-order.test.ts apps/backend/tests/unit/writes.test.ts \
        apps/backend/tests/rls/helpers.ts
git commit -m "feat(backend): one endpoint writes a shop's menu arrangement"
```

---

### Task 3: The arrangement rules (pure, frontend)

**Files:**
- Create: `apps/frontend/src/merchant/menuArrangement.ts`
- Test: `apps/frontend/src/merchant/menuArrangement.test.ts`

**Interfaces:**
- Consumes: `MenuCategory` from `@bitetime/shared`.
- Produces:
  - `interface ArrangedBlock<T> { category: MenuCategory | null; products: T[] }`
  - `interface Slot { block: number; index: number }`
  - `arrangeMenu<T>(products: T[], categories: MenuCategory[]): ArrangedBlock<T>[]`
  - `reseedCategories<T>(blocks: ArrangedBlock<T>[], categories: MenuCategory[]): ArrangedBlock<T>[]`
  - `moveProduct<T>(blocks: ArrangedBlock<T>[], from: Slot, to: Slot): ArrangedBlock<T>[]`
  - `moveCategory<T>(blocks: ArrangedBlock<T>[], from: number, to: number): ArrangedBlock<T>[]`
  - `findProduct<T>(blocks: ArrangedBlock<T>[], productId: string): Slot | null`
  - `resolveDropTarget<T>(blocks: ArrangedBlock<T>[], overId: string): Slot | null`
  - `categoriesOf<T>(blocks: ArrangedBlock<T>[]): MenuCategory[]`
  - `productOrderPatch<T>(blocks: ArrangedBlock<T>[]): { id: string; sort: number; category_id: string | null }[]`
  - `arrangementKeys<T>(blocks: ArrangedBlock<T>[]): { categories: string; products: string }`
  - `categoryDragId(categoryId: string): string`, `blockDropId(index: number): string`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/merchant/menuArrangement.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  arrangeMenu, reseedCategories, moveProduct, moveCategory, findProduct, resolveDropTarget,
  categoriesOf, productOrderPatch, arrangementKeys, categoryDragId, blockDropId,
} from './menuArrangement'
import type { MenuCategory } from '@bitetime/shared'

const cat = (id: string, over: Partial<MenuCategory> = {}): MenuCategory =>
  ({ id, name: id, active: true, ...over })

const prod = (id: string, category_id: string | null = null) => ({ id, category_id })

const CAKES = cat('cakes')
const TEA = cat('tea')
const HIDDEN = cat('hidden', { active: false })

describe('arrangeMenu', () => {
  it('puts each product in its own section, in the order given', () => {
    const blocks = arrangeMenu(
      [prod('p1', 'cakes'), prod('p2', 'tea'), prod('p3', 'cakes')],
      [CAKES, TEA],
    )
    expect(blocks.map(b => b.category?.id ?? null)).toEqual(['cakes', 'tea', null])
    expect(blocks[0]!.products.map(p => p.id)).toEqual(['p1', 'p3'])
    expect(blocks[1]!.products.map(p => p.id)).toEqual(['p2'])
    expect(blocks[2]!.products).toEqual([])
  })

  // The merchant's question is "where is everything filed", not "what does a customer see", so a
  // hidden section is a section here — a merchant must be able to file into one.
  it('keeps hidden categories, unlike menuSections', () => {
    const blocks = arrangeMenu([prod('p1', 'hidden')], [HIDDEN])
    expect(blocks[0]!.category!.id).toBe('hidden')
    expect(blocks[0]!.products.map(p => p.id)).toEqual(['p1'])
  })

  it('keeps an empty category, so there is somewhere to drop', () => {
    const blocks = arrangeMenu([], [CAKES])
    expect(blocks.map(b => b.category?.id ?? null)).toEqual(['cakes', null])
  })

  it('drops a product with a dangling category id into the trailing block', () => {
    const blocks = arrangeMenu([prod('p1', 'deleted')], [CAKES])
    expect(blocks[1]!.products.map(p => p.id)).toEqual(['p1'])
  })

  it('always ends with the trailing block, even for a shop with no categories', () => {
    const blocks = arrangeMenu([prod('p1')], [])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.category).toBeNull()
  })
})

describe('moveProduct', () => {
  const blocks = arrangeMenu([prod('p1', 'cakes'), prod('p2', 'cakes'), prod('p3')], [CAKES])

  it('moves an item inside its own section', () => {
    const next = moveProduct(blocks, { block: 0, index: 0 }, { block: 0, index: 1 })
    expect(next[0]!.products.map(p => p.id)).toEqual(['p2', 'p1'])
  })

  it('moves an item into another section', () => {
    const next = moveProduct(blocks, { block: 1, index: 0 }, { block: 0, index: 0 })
    expect(next[0]!.products.map(p => p.id)).toEqual(['p3', 'p1', 'p2'])
    expect(next[1]!.products).toEqual([])
  })

  it('clamps an index past the end of the target', () => {
    const next = moveProduct(blocks, { block: 0, index: 0 }, { block: 1, index: 99 })
    expect(next[1]!.products.map(p => p.id)).toEqual(['p3', 'p1'])
  })

  it('returns the same list for a slot that names nothing', () => {
    expect(moveProduct(blocks, { block: 9, index: 0 }, { block: 0, index: 0 })).toBe(blocks)
    expect(moveProduct(blocks, { block: 0, index: 9 }, { block: 0, index: 0 })).toBe(blocks)
  })

  it('does not mutate the list it was given', () => {
    moveProduct(blocks, { block: 0, index: 0 }, { block: 1, index: 0 })
    expect(blocks[0]!.products.map(p => p.id)).toEqual(['p1', 'p2'])
  })
})

describe('moveCategory', () => {
  const blocks = arrangeMenu([prod('p1', 'cakes'), prod('p2', 'tea')], [CAKES, TEA])

  it('moves a section, carrying its products', () => {
    const next = moveCategory(blocks, 0, 1)
    expect(next.map(b => b.category?.id ?? null)).toEqual(['tea', 'cakes', null])
    expect(next[1]!.products.map(p => p.id)).toEqual(['p1'])
  })

  // The storefront draws the un-headed block last, so it is not a section that can be moved above
  // one.
  it('leaves the trailing block last', () => {
    expect(moveCategory(blocks, 1, 0)[2]!.category).toBeNull()
  })

  it('returns the same list for an index that names nothing', () => {
    expect(moveCategory(blocks, 0, 5)).toBe(blocks)
    expect(moveCategory(blocks, -1, 0)).toBe(blocks)
  })
})

describe('reseedCategories', () => {
  const blocks = arrangeMenu([prod('p1', 'cakes'), prod('p2', 'tea'), prod('p3')], [CAKES, TEA])

  // The merchant renames a section in the dialog while holding unsaved drags. The drags survive.
  it('keeps every product where the draft put it', () => {
    const next = reseedCategories(blocks, [cat('cakes', { name: 'Bakes' }), TEA])
    expect(next[0]!.category!.name).toBe('Bakes')
    expect(next[0]!.products.map(p => p.id)).toEqual(['p1'])
    expect(next[1]!.products.map(p => p.id)).toEqual(['p2'])
  })

  it('sends a deleted section’s products to the trailing block', () => {
    const next = reseedCategories(blocks, [TEA])
    expect(next.map(b => b.category?.id ?? null)).toEqual(['tea', null])
    expect(next[1]!.products.map(p => p.id)).toEqual(['p3', 'p1'])
  })

  it('adds a new section as an empty block, in its list position', () => {
    const next = reseedCategories(blocks, [cat('new'), CAKES, TEA])
    expect(next.map(b => b.category?.id ?? null)).toEqual(['new', 'cakes', 'tea', null])
    expect(next[0]!.products).toEqual([])
  })

  it('takes the category order from the list it is given', () => {
    expect(reseedCategories(blocks, [TEA, CAKES]).map(b => b.category?.id ?? null))
      .toEqual(['tea', 'cakes', null])
  })
})

describe('findProduct and resolveDropTarget', () => {
  const blocks = arrangeMenu([prod('p1', 'cakes'), prod('p2')], [CAKES, TEA])

  it('finds a product’s slot', () => {
    expect(findProduct(blocks, 'p1')).toEqual({ block: 0, index: 0 })
    expect(findProduct(blocks, 'p2')).toEqual({ block: 2, index: 0 })
    expect(findProduct(blocks, 'nope')).toBeNull()
  })

  it('reads a product id as that product’s slot', () => {
    expect(resolveDropTarget(blocks, 'p1')).toEqual({ block: 0, index: 0 })
  })

  it('reads a block’s droppable id as the end of that block', () => {
    expect(resolveDropTarget(blocks, blockDropId(1))).toEqual({ block: 1, index: 0 })
  })

  it('reads a category’s drag id as the end of that category’s block', () => {
    expect(resolveDropTarget(blocks, categoryDragId('cakes'))).toEqual({ block: 0, index: 1 })
  })

  it('reads an id that names nothing as no target', () => {
    expect(resolveDropTarget(blocks, blockDropId(9))).toBeNull()
    expect(resolveDropTarget(blocks, categoryDragId('gone'))).toBeNull()
    expect(resolveDropTarget(blocks, 'unknown')).toBeNull()
  })
})

describe('productOrderPatch', () => {
  it('numbers every product from zero, across every section in order', () => {
    const blocks = arrangeMenu([prod('p1', 'cakes'), prod('p2', 'tea'), prod('p3')], [CAKES, TEA])
    expect(productOrderPatch(blocks)).toEqual([
      { id: 'p1', sort: 0, category_id: 'cakes' },
      { id: 'p2', sort: 1, category_id: 'tea' },
      { id: 'p3', sort: 2, category_id: null },
    ])
  })

  // The whole list, never a diff: two browsers arranging one shop must be last-writer-wins rather
  // than two interleaved partial numberings.
  it('returns every product, including ones that did not move', () => {
    const blocks = arrangeMenu([prod('p1'), prod('p2')], [])
    const moved = moveProduct(blocks, { block: 0, index: 0 }, { block: 0, index: 1 })
    expect(productOrderPatch(moved).map(p => p.id)).toEqual(['p2', 'p1'])
  })

  it('is empty for an empty shop', () => {
    expect(productOrderPatch(arrangeMenu([], []))).toEqual([])
  })

  it('files a product into the section whose block it sits in, not its stored id', () => {
    const blocks = arrangeMenu([prod('p1', 'deleted')], [CAKES])
    expect(productOrderPatch(blocks)).toEqual([{ id: 'p1', sort: 0, category_id: null }])
  })
})

describe('categoriesOf and arrangementKeys', () => {
  const blocks = arrangeMenu([prod('p1', 'cakes')], [CAKES, TEA])

  it('lists the categories in draft order, without the trailing block', () => {
    expect(categoriesOf(blocks)).toEqual([CAKES, TEA])
  })

  it('gives two keys, so a section edit and an item drag are told apart', () => {
    const keys = arrangementKeys(blocks)
    expect(arrangementKeys(blocks)).toEqual(keys)
    expect(arrangementKeys(moveCategory(blocks, 0, 1)).categories).not.toBe(keys.categories)
    expect(arrangementKeys(reseedCategories(blocks, [cat('cakes', { name: 'Bakes' }), TEA])).products)
      .toBe(keys.products)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @bitetime/frontend test src/merchant/menuArrangement.test.ts
```

Expected: FAIL — `Failed to resolve import "./menuArrangement"`.

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/merchant/menuArrangement.ts`:

```ts
// The merchant arranging their own menu — every rule the Storefront tab obeys, with no React in
// it (docs/superpowers/specs/2026-08-17-storefront-arrangement-design.md).
//
// NOT in `@bitetime/shared`, for `menuGroups.ts`'s reason: order is presentation, it runs in the
// browser only, and the backend has no opinion about the order of headings on a page. What is
// shared is the category type and its validator, because both sides read that column.
//
// A DELIBERATE SIBLING of `menuGroups.ts`, not a replacement for it. That module answers the
// STOREFRONT's question — what does a customer see — so it drops hidden categories, drops empty
// sections, and reads a dangling id as uncategorized. This one answers the MERCHANT's question —
// where is everything filed — so it keeps all three, or the merchant cannot drop anything into
// them. Two questions, two functions; folding them together is how one of the two answers ends up
// wrong.

import type { MenuCategory } from '@bitetime/shared'

/** One block of the draft: a section and its products, or the trailing un-headed block. */
export interface ArrangedBlock<T> {
  category: MenuCategory | null
  products: T[]
}

/** A position in the draft: which block, and which index inside it. */
export interface Slot {
  block: number
  index: number
}

/** The two fields this module reads off a product. The screen hands it whole rows. */
interface Categorized {
  id: string
  category_id?: string | null
}

// The ids dnd-kit drags. A product's own uuid is its drag id, so anything else has to be prefixed
// or a category called `p1` would collide with a product called `p1`.
const CATEGORY_PREFIX = 'cat:'
const BLOCK_PREFIX = 'drop:'

/** The drag id of a section's heading. */
export const categoryDragId = (categoryId: string): string => `${CATEGORY_PREFIX}${categoryId}`

/** The droppable id of a block's list, which is what an EMPTY block offers as a target. */
export const blockDropId = (index: number): string => `${BLOCK_PREFIX}${index}`

/**
 * Build the draft from the two stored things.
 *
 * The trailing block is ALWAYS present, even when empty: it is where a merchant drops a product to
 * take it out of every section, so it cannot appear only once something is already in it.
 */
export function arrangeMenu<T extends Categorized>(
  products: T[],
  categories: MenuCategory[],
): ArrangedBlock<T>[] {
  const ids = new Set(categories.map(c => c.id))
  const byCategory = new Map<string, T[]>(categories.map(c => [c.id, []]))
  const trailing: T[] = []

  for (const p of products) {
    const id = p.category_id
    if (id && ids.has(id)) byCategory.get(id)!.push(p)
    else trailing.push(p)
  }

  return [
    ...categories.map(c => ({ category: c, products: byCategory.get(c.id)! })),
    { category: null, products: trailing },
  ]
}

/**
 * Apply an edited category list to a draft, keeping every product where the draft put it.
 *
 * Called after the categories dialog saves. Rebuilding with `arrangeMenu` instead would read the
 * products' STORED `category_id` and their stored order — that is, it would throw away every drag
 * the merchant has not saved yet, behind a success toast.
 */
export function reseedCategories<T extends Categorized>(
  blocks: ArrangedBlock<T>[],
  categories: MenuCategory[],
): ArrangedBlock<T>[] {
  const held = new Map<string, T[]>()
  for (const b of blocks) if (b.category) held.set(b.category.id, b.products)

  const kept = new Set(categories.map(c => c.id))
  // A deleted section's products APPEND to the trailing block, after whatever was already there:
  // they are the newly unfiled ones, and the merchant's own trailing order is not disturbed.
  const trailing = [...(blocks.find(b => b.category === null)?.products ?? [])]
  for (const b of blocks) {
    if (b.category && !kept.has(b.category.id)) trailing.push(...b.products)
  }

  return [
    ...categories.map(c => ({ category: c, products: held.get(c.id) ?? [] })),
    { category: null, products: trailing },
  ]
}

/** Move one product from one slot to another. Returns the SAME array when the move is impossible. */
export function moveProduct<T>(
  blocks: ArrangedBlock<T>[],
  from: Slot,
  to: Slot,
): ArrangedBlock<T>[] {
  const source = blocks[from.block]
  const target = blocks[to.block]
  if (!source || !target) return blocks
  const item = source.products[from.index]
  if (item === undefined) return blocks

  const next = blocks.map(b => ({ ...b, products: [...b.products] }))
  next[from.block]!.products.splice(from.index, 1)
  const list = next[to.block]!.products
  // Clamped: dnd-kit reports an index against the list BEFORE the removal, so a move to the end of
  // the same block arrives one past it.
  list.splice(Math.max(0, Math.min(to.index, list.length)), 0, item)
  return next
}

/**
 * Move one section, carrying its products.
 *
 * Indices count SECTIONS, not blocks, and the trailing block is put back last however the sections
 * move: the storefront draws it last, so there is no arrangement in which it sits above a heading.
 */
export function moveCategory<T>(
  blocks: ArrangedBlock<T>[],
  from: number,
  to: number,
): ArrangedBlock<T>[] {
  const named = blocks.filter(b => b.category !== null)
  const trailing = blocks.filter(b => b.category === null)
  if (from < 0 || from >= named.length || to < 0 || to >= named.length) return blocks

  const next = [...named]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return [...next, ...trailing]
}

/** Where a product currently sits, or null. */
export function findProduct<T extends Categorized>(
  blocks: ArrangedBlock<T>[],
  productId: string,
): Slot | null {
  for (let block = 0; block < blocks.length; block++) {
    const index = blocks[block]!.products.findIndex(p => p.id === productId)
    if (index !== -1) return { block, index }
  }
  return null
}

/**
 * The slot a dnd-kit `over.id` names.
 *
 * Three kinds of target, because a merchant drops onto three kinds of thing: another product, an
 * empty block's list, or a section's heading. The last two both mean "the end of that block".
 */
export function resolveDropTarget<T extends Categorized>(
  blocks: ArrangedBlock<T>[],
  overId: string,
): Slot | null {
  if (overId.startsWith(BLOCK_PREFIX)) {
    const block = Number(overId.slice(BLOCK_PREFIX.length))
    return blocks[block] ? { block, index: blocks[block]!.products.length } : null
  }
  if (overId.startsWith(CATEGORY_PREFIX)) {
    const id = overId.slice(CATEGORY_PREFIX.length)
    const block = blocks.findIndex(b => b.category?.id === id)
    return block === -1 ? null : { block, index: blocks[block]!.products.length }
  }
  return findProduct(blocks, overId)
}

/** The category list in draft order, which is what the merchant row is patched with. */
export function categoriesOf<T>(blocks: ArrangedBlock<T>[]): MenuCategory[] {
  return blocks.map(b => b.category).filter((c): c is MenuCategory => c !== null)
}

/**
 * The request body: every product, its global position, and the section it now sits in.
 *
 * The section comes from the BLOCK, never from the product's stored `category_id` — that is what
 * makes dragging a product out of a deleted section finally clear the dangling id.
 *
 * Every product, never a diff. A diff is smaller and is wrong the moment two browsers arrange one
 * shop: the second save would carry only its own changes and interleave them with the first's.
 */
export function productOrderPatch<T extends Categorized>(
  blocks: ArrangedBlock<T>[],
): { id: string; sort: number; category_id: string | null }[] {
  const out: { id: string; sort: number; category_id: string | null }[] = []
  let sort = 0
  for (const b of blocks) {
    for (const p of b.products) out.push({ id: p.id, sort: sort++, category_id: b.category?.id ?? null })
  }
  return out
}

/**
 * What the screen compares against what it last saved.
 *
 * TWO keys, not one. The categories dialog saves on its own, so after a rename the stored category
 * list has moved on while the product order has not. One key would leave the screen dirty for ever
 * after any rename.
 */
export function arrangementKeys<T extends Categorized>(blocks: ArrangedBlock<T>[]): {
  categories: string
  products: string
} {
  return {
    categories: JSON.stringify(categoriesOf(blocks)),
    products: JSON.stringify(productOrderPatch(blocks)),
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
pnpm --filter @bitetime/frontend test src/merchant/menuArrangement.test.ts
```

Expected: PASS, 28 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/merchant/menuArrangement.ts apps/frontend/src/merchant/menuArrangement.test.ts
git commit -m "feat(frontend): the rules for arranging a shop's menu"
```

---

### Task 4: `MenuRow`, shared by the storefront and the arranger

**Files:**
- Create: `apps/frontend/src/components/MenuRow.tsx`
- Modify: `apps/frontend/src/store/Storefront.tsx` (the product card, around lines 1061–1185)

**Interfaces:**
- Consumes: `productImageUrl` from `../store`, `cn` from `@/lib/utils`.
- Produces: default export `MenuRow(props: { imagePaths?: string[]; onImageClick?: () => void; imageLabel?: string; title: ReactNode; subtitle?: ReactNode; meta?: ReactNode; trailing?: ReactNode; className?: string })`.

There is no test in this task. The repo verifies UI by running the app, and a component test here
would assert the markup this task exists to move.

- [ ] **Step 1: Write `MenuRow`**

Create `apps/frontend/src/components/MenuRow.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Images, Expand } from 'lucide-react'
import { productImageUrl } from '../store'
import { cn } from '@/lib/utils'

/**
 * One product, drawn the way a customer sees it.
 *
 * Extracted from `Storefront.tsx` so the merchant's Storefront tab can draw the same row while
 * dragging it (docs/superpowers/specs/2026-08-17-storefront-arrangement-design.md). The merchant is
 * judging ORDER and LAYOUT, so the layout has to be the real one — a second, similar-looking row
 * would drift from this one and quietly stop being a preview.
 *
 * Only the SHELL is shared. Everything that reads a cart lives in `meta` and `trailing`: the
 * storefront passes its promo price line and its quantity control, the arranger passes a plain
 * price and a drag handle. That is what keeps a 60-line promo computation out of a screen that
 * prices nothing.
 */
export default function MenuRow({
  imagePaths = [], onImageClick, imageLabel, title, subtitle, meta, trailing, className,
}: {
  imagePaths?: string[]
  /** Given, the thumbnail becomes a button. Omitted, it is a plain image. */
  onImageClick?: () => void
  imageLabel?: string
  title: ReactNode
  subtitle?: ReactNode
  meta?: ReactNode
  trailing?: ReactNode
  className?: string
}) {
  const first = imagePaths[0]

  return (
    <div
      className={cn(
        'flex items-center gap-[14px] px-4 py-[14px] bg-card border-[0.5px] border-border rounded-xl transition-colors',
        className,
      )}
    >
      {first ? (
        onImageClick ? (
          <button
            type="button"
            onClick={onImageClick}
            aria-label={imageLabel}
            className="group size-14 shrink-0 rounded-lg overflow-hidden border-[0.5px] border-border cursor-pointer relative transition-transform active:scale-[0.97]"
          >
            <img
              src={productImageUrl(first)}
              alt=""
              className="size-full object-cover transition-transform duration-200 group-hover:scale-110"
            />
            {/* Desktop cue: a veil + expand glyph on hover says "this opens". */}
            <span className="absolute inset-0 flex items-center justify-center bg-primary/0 transition-colors group-hover:bg-primary/30">
              <Expand className="size-4 text-white opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} />
            </span>
            {/* Touch cue (no hover on a phone): a persistent photo pill, with a count when there's
                more than one. The bare number badge read as decoration — nothing said "tap me". */}
            <span className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded-pill bg-primary/90 px-1.5 py-[3px] text-white text-[10px] font-medium leading-none">
              <Images className="size-[11px]" strokeWidth={2} />
              {imagePaths.length > 1 && imagePaths.length}
            </span>
          </button>
        ) : (
          <img
            src={productImageUrl(first)}
            alt=""
            className="size-14 shrink-0 rounded-lg object-cover border-[0.5px] border-border"
          />
        )
      ) : null}

      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-foreground">{title}</div>
        {subtitle ? (
          <div className="text-[12px] text-muted-foreground mt-0.5 leading-[1.4]">{subtitle}</div>
        ) : null}
        {meta}
      </div>

      {trailing}
    </div>
  )
}
```

- [ ] **Step 2: Use it in the storefront**

In `apps/frontend/src/store/Storefront.tsx`, add the import beside the other component imports:

```tsx
import MenuRow from '../components/MenuRow'
```

Replace the whole product card — from `<div key={p.id} className={cn("flex items-center gap-[14px] …` down to its closing `</div>` before `))}` — with:

```tsx
                  <MenuRow
                    key={p.id}
                    imagePaths={p.image_urls ?? []}
                    onImageClick={() => setGallery(p)}
                    imageLabel={t('View photos', '查看图片')}
                    className={cn(cart.some(l => l.productId === p.id) && "border-primary bg-brand-100")}
                    title={productName(p)}
                    subtitle={productDescr(p) || undefined}
                    meta={(() => {
                      /* …the existing IIFE, unchanged, comments and all… */
                    })()}
                    trailing={
                      optionGroupsFromRow(p.option_groups).some(g => g.active) ? (
                        /* …the existing Add button, unchanged… */
                      ) : (
                        /* …the existing − / qty / + control, unchanged… */
                      )
                    }
                  />
```

Move the existing price IIFE and the existing trailing control across **verbatim**, comments
included. Nothing inside them changes — this task moves markup, it does not rewrite behaviour. The
old `<img>`/photo `<button>` block and the `<div className="flex-1 min-w-0">` wrapper are deleted,
because `MenuRow` now draws both.

- [ ] **Step 3: Typecheck and lint**

```bash
pnpm --filter @bitetime/frontend typecheck
pnpm --filter @bitetime/frontend lint
pnpm --filter @bitetime/frontend test
```

Expected: all PASS.

- [ ] **Step 4: Run the app and look at a storefront**

```bash
pnpm dev
```

Open `http://localhost:5173/s/<a seeded shop slug>` and confirm, against the same page before this
change: the thumbnail, its hover veil and its photo pill; the name and Chinese name; the
description; the price line, including a promo product's struck-through price, its badge and its
"N left at this price"; the − / quantity / + control; the Add button on a product with options; and
the highlighted border on a product already in the cart.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/MenuRow.tsx apps/frontend/src/store/Storefront.tsx
git commit -m "refactor(storefront): one shared row for the menu"
```

---

### Task 5: The Storefront tab

**Files:**
- Create: `apps/frontend/src/merchant/StorefrontArranger.tsx`
- Modify: `apps/frontend/src/store.ts` (beside `updateMerchantConfig`, around line 1059)
- Modify: `apps/frontend/src/merchant/Dashboard.tsx` (`SECTIONS`, around line 25; the render switch, around line 107)
- Modify: `apps/frontend/src/merchant/MenuCategoriesDialog.tsx` (remove Up/Down, rewrite the comment)
- Modify: `apps/frontend/package.json` (three dependencies)

**Interfaces:**
- Consumes: every export of `menuArrangement.ts` (Task 3), `MenuRow` (Task 4), `PUT /api/merchants/:id/product-order` (Task 2), and the existing `lookupProducts`, `updateMerchantConfig`, `useSession`, `useNavGuard`, `MenuCategoriesDialog`.
- Produces: `saveProductOrder(merchantId: string, items: { id: string; sort: number; category_id: string | null }[]): Promise<Result<void>>` in `store.ts`; default export `StorefrontArranger` .

- [ ] **Step 1: Add the dependencies**

```bash
pnpm --filter @bitetime/frontend add @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities@^3.2.2
```

- [ ] **Step 2: Add the client call**

In `apps/frontend/src/store.ts`, directly below `updateMerchantConfig`:

```ts
/**
 * Write a shop's whole arrangement: where every product sits, and in which section.
 *
 * The WHOLE list every time, never a diff — see `menuArrangement.ts`. The endpoint answers with
 * how many rows it moved; a caller that cares can compare that against what it sent, which is how
 * a body naming a stranger's product reports itself (it moves nothing).
 */
export async function saveProductOrder(
  merchantId: string,
  items: { id: string; sort: number; category_id: string | null }[],
): Promise<Result<void>> {
  return toVoid(await apiSend(`/api/merchants/${merchantId}/product-order`, 'PUT', { items }, { auth: true }))
}
```

- [ ] **Step 3: Write the screen**

Create `apps/frontend/src/merchant/StorefrontArranger.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, EyeOff, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from '../SessionContext'
import { lookupProducts, saveProductOrder, updateMerchantConfig } from '../store'
import { formatMoney } from '../currency'
import { formatUnit } from '../productUnit'
import { menuCategoriesFromRow } from '@bitetime/shared'
import type { MenuCategory } from '@bitetime/shared'
import { Button } from '../components/ui/button'
import { SkeletonText } from '../components/Loaders'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '../components/ui/empty'
import MenuRow from '../components/MenuRow'
import MenuCategoriesDialog from './MenuCategoriesDialog'
import { useNavGuard } from './NavGuard'
import {
  arrangeMenu, reseedCategories, moveProduct, moveCategory, findProduct, resolveDropTarget,
  categoriesOf, productOrderPatch, arrangementKeys, categoryDragId, blockDropId,
  type ArrangedBlock,
} from './menuArrangement'
import { cn } from '@/lib/utils'

/**
 * The merchant arranging their own storefront (spec 2026-08-17).
 *
 * The drag surface IS the preview: every row is the same `MenuRow` the storefront draws, at phone
 * width. A merchant judging order and layout is looking at the real thing rather than at a
 * representation of it that can drift.
 *
 * What it is deliberately NOT faithful about is VISIBILITY. Hidden products and hidden categories
 * are drawn, tagged. A merchant must be able to file an item into a section that is switched off —
 * that is what a seasonal section is for — and cannot if the section is not on screen. The tags are
 * what stop the screen reading as a promise about what a customer sees.
 *
 * Every rule lives in `menuArrangement.ts`. This file holds state, dnd-kit wiring and markup.
 */

/** The product shape this screen reads. The rows come from the API as `any`, like everywhere else. */
interface Row {
  id: string
  category_id?: string | null
  name: string
  name_zh?: string | null
  descr?: string | null
  price: number
  unit?: string | null
  unit_quantity?: number | null
  active: boolean
  image_urls?: string[] | null
}

export default function StorefrontArranger() {
  const { t, lang, merchant, refreshMerchant } = useSession()
  const { registerBlocker } = useNavGuard()

  const [blocks, setBlocks] = useState<ArrangedBlock<Row>[] | null>(null)
  const [saved, setSaved] = useState({ categories: '', products: '' })
  const [saving, setSaving] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [categoriesSaving, setCategoriesSaving] = useState(false)

  const merchantId = merchant!.id
  const currency = merchant?.currency

  // Seeded ONCE, from the products read plus the row the session already holds. Re-seeding whenever
  // the merchant row changes would throw away unsaved drags every time `refreshMerchant` ran.
  useEffect(() => {
    let live = true
    lookupProducts(merchantId).then(r => {
      if (!live) return
      const rows = (r.ok ? r.data : []) as Row[]
      const next = arrangeMenu(rows, menuCategoriesFromRow(merchant?.product_categories))
      setBlocks(next)
      setSaved(arrangementKeys(next))
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeding is a one-shot, not a subscription
  }, [merchantId])

  const keys = blocks ? arrangementKeys(blocks) : saved
  const dirty = keys.categories !== saved.categories || keys.products !== saved.products

  // The same guard ShopSettings registers, so the sidebar cannot silently discard a rearrangement.
  useEffect(() => {
    registerBlocker(() => dirty)
    return () => registerBlocker(null)
  }, [dirty, registerBlocker])

  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const sensors = useSensors(
    // A small distance, so a tap on a row is still a tap and not the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragOver = useCallback((e: DragOverEvent) => {
    const { active, over } = e
    if (!over || active.data.current?.type !== 'product') return
    setBlocks(bs => {
      if (!bs) return bs
      const from = findProduct(bs, String(active.id))
      const to = resolveDropTarget(bs, String(over.id))
      // Only a CROSS-BLOCK move is applied here. Within one block dnd-kit's own sorting preview is
      // enough, and applying it on every over-event fights the animation.
      if (!from || !to || from.block === to.block) return bs
      return moveProduct(bs, from, to)
    })
  }, [])

  const onDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e
    if (!over) return
    setBlocks(bs => {
      if (!bs) return bs
      if (active.data.current?.type === 'category') {
        const named = categoriesOf(bs)
        const from = named.findIndex(c => categoryDragId(c.id) === active.id)
        const to = named.findIndex(c => categoryDragId(c.id) === over.id)
        return from === -1 || to === -1 ? bs : moveCategory(bs, from, to)
      }
      const from = findProduct(bs, String(active.id))
      const to = resolveDropTarget(bs, String(over.id))
      return from && to ? moveProduct(bs, from, to) : bs
    })
  }, [])

  /**
   * Save. Products first, then the categories.
   *
   * The two are not atomic together, and that order is the choice: a wrong item order under correct
   * headings is a smaller wrong than headings naming sections whose items never moved. Both writes
   * are idempotent, so a failure keeps the draft and keeps it dirty — Save retries the whole thing.
   */
  async function save() {
    if (!blocks) return
    setSaving(true)
    const items = productOrderPatch(blocks)
    const order = await saveProductOrder(merchantId, items)
    if (!order.ok) {
      setSaving(false)
      toast.error(order.error.message || t('Could not save the order', '无法保存顺序'))
      return
    }
    const cats = categoriesOf(blocks)
    const patched = await updateMerchantConfig(merchantId, { product_categories: cats })
    setSaving(false)
    if (!patched.ok) {
      toast.error(t('The item order is saved, but the sections are not. Press Save again.',
                    '产品顺序已保存，但分类未保存。请再次保存。'))
      return
    }
    await refreshMerchant()
    setSaved(arrangementKeys(blocks))
    toast.success(t('Storefront saved', '店面已保存'))
  }

  /**
   * The categories dialog writes on its own, immediately.
   *
   * It is seeded from the DRAFT, so a rename made after a drag saves the dragged order too. Then
   * the draft keeps every product where it is (`reseedCategories`), and only the category half of
   * the saved key moves — a dirty product order stays dirty.
   */
  async function saveCategories(next: MenuCategory[]): Promise<boolean> {
    setCategoriesSaving(true)
    const r = await updateMerchantConfig(merchantId, { product_categories: next })
    setCategoriesSaving(false)
    if (!r.ok) {
      toast.error(r.error.message || t('Could not save categories', '无法保存分类'))
      return false
    }
    await refreshMerchant()
    setBlocks(bs => (bs ? reseedCategories(bs, next) : bs))
    setSaved(s => ({ ...s, categories: JSON.stringify(next) }))
    toast.success(t('Categories saved', '分类已保存'))
    return true
  }

  if (!blocks) return <SkeletonText />

  const total = blocks.reduce((n, b) => n + b.products.length, 0)
  const counts = Object.fromEntries(
    blocks.filter(b => b.category).map(b => [b.category!.id, b.products.length]),
  )

  return (
    <div className="max-w-[560px]">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-[18px] font-medium text-foreground">{t('Storefront', '店面')}</h2>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => setCategoriesOpen(true)}>
            <Settings2 className="size-4 mr-1" />
            {t('Categories', '分类')}
          </Button>
          <Button type="button" onClick={save} disabled={!dirty || saving}>
            {saving ? t('Saving…', '保存中…') : t('Save', '保存')}
          </Button>
        </div>
      </div>

      <p className="text-[12px] text-muted-foreground leading-[1.6] mb-4">
        {t('Drag to arrange your menu. Customers see this order. Hidden items and hidden categories are shown here, marked — customers do not see them.',
           '拖动即可排列菜单，顾客看到的就是此顺序。已隐藏的产品和分类在此显示并标注，顾客看不到。')}
      </p>

      {total === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('No products yet', '暂无产品')}</EmptyTitle>
            <EmptyDescription>
              {t('Add products first. They appear here to arrange.', '请先添加产品，然后在此排列。')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          {/* The trailing block's id rides in this list even though the block cannot be dragged
              (its `useSortable` is disabled): dnd-kit warns about a sortable whose id its context
              does not hold. A section dropped ON it resolves to no index and is left alone. */}
          <SortableContext
            items={[...categoriesOf(blocks).map(c => categoryDragId(c.id)), categoryDragId('trailing')]}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-4">
              {blocks.map((block, i) => (
                <Block
                  key={block.category?.id ?? 'trailing'}
                  block={block}
                  index={i}
                  lang={lang}
                  currency={currency}
                  t={t}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <MenuCategoriesDialog
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        value={categoriesOf(blocks)}
        counts={counts}
        saving={categoriesSaving}
        onSave={saveCategories}
        t={t}
      />
    </div>
  )
}

/** One section, or the trailing un-headed block. */
function Block({
  block, index, lang, currency, t,
}: {
  block: ArrangedBlock<Row>
  index: number
  lang: string
  currency?: string
  t: (en: string, zh: string) => string
}) {
  // The trailing block has no heading to drag by, so it is not sortable — it is drawn last always.
  const category = block.category
  const sortable = useSortable({
    id: categoryDragId(category?.id ?? 'trailing'),
    data: { type: 'category' },
    disabled: !category,
  })
  // Every block is a droppable, so an EMPTY section still accepts a product.
  const { setNodeRef: setDropRef } = useDroppable({ id: blockDropId(index) })

  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={cn(sortable.isDragging && 'opacity-60')}
    >
      {category ? (
        <div className="flex items-center gap-1 mb-2">
          <button
            type="button"
            className="size-8 rounded-lg flex items-center justify-center cursor-grab text-muted-foreground hover:text-foreground touch-none"
            aria-label={t('Move category', '移动分类')}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <span className="text-[13px] font-semibold text-foreground">
            {(lang === 'zh' && category.name_zh) || category.name}
          </span>
          {!category.active && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <EyeOff className="size-3" />
              {t('hidden', '已隐藏')}
            </span>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground mb-2">
          {t('No category — listed last, without a heading', '未分类 — 排在最后，不带标题')}
        </div>
      )}

      <SortableContext items={block.products.map(p => p.id)} strategy={verticalListSortingStrategy}>
        <div ref={setDropRef} className="flex flex-col gap-[10px] min-h-[52px] rounded-xl">
          {block.products.length === 0 && (
            <div className="text-[12px] text-muted-foreground italic border-[0.5px] border-dashed border-border rounded-xl py-4 text-center">
              {t('Drop products here', '将产品拖到此处')}
            </div>
          )}
          {block.products.map(p => (
            <ProductRow key={p.id} product={p} lang={lang} currency={currency} t={t} />
          ))}
        </div>
      </SortableContext>
    </div>
  )
}

/** One product, drawn as the storefront draws it, with a handle and no cart. */
function ProductRow({
  product, lang, currency, t,
}: {
  product: Row
  lang: string
  currency?: string
  t: (en: string, zh: string) => string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: product.id,
    data: { type: 'product' },
  })
  const unit = formatUnit(product.unit_quantity, product.unit || t('unit', '个'))
  const name = (lang === 'zh' && product.name_zh) || product.name

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && 'opacity-60')}
    >
      <MenuRow
        imagePaths={product.image_urls ?? []}
        title={
          <span className="flex items-center gap-2">
            {name}
            {!product.active && (
              <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                <EyeOff className="size-3" />
                {t('hidden', '已隐藏')}
              </span>
            )}
          </span>
        }
        subtitle={product.descr || undefined}
        meta={
          <div className="text-[13px] font-medium text-primary mt-[5px]">
            {formatMoney(product.price, currency)} / {unit}
          </div>
        }
        className={cn(!product.active && 'opacity-60')}
        trailing={
          <button
            type="button"
            className="size-9 rounded-lg flex items-center justify-center cursor-grab text-muted-foreground hover:text-foreground touch-none"
            aria-label={t('Move product', '移动产品')}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        }
      />
    </div>
  )
}
```

- [ ] **Step 4: Add the dashboard section**

In `apps/frontend/src/merchant/Dashboard.tsx`:

```tsx
import { LayoutDashboard, ReceiptText, Cake, LayoutList, Ticket, Users, Settings } from 'lucide-react'
import StorefrontArranger from './StorefrontArranger'
```

```tsx
  { key: 'products',   en: 'Products',   zh: '产品',  icon: <Cake {...ICON} /> },
  { key: 'storefront', en: 'Storefront', zh: '店面',  icon: <LayoutList {...ICON} /> },
  { key: 'vouchers',   en: 'Vouchers',   zh: '优惠券', icon: <Ticket {...ICON} /> },
```

```tsx
        {section === 'storefront' && <StorefrontArranger />}
```

- [ ] **Step 5: Take ordering out of the categories dialog**

In `apps/frontend/src/merchant/MenuCategoriesDialog.tsx`:

1. Delete the `move` helper (lines 33–39).
2. Delete the two `ArrowUp` / `ArrowDown` buttons and the `<div className="flex gap-1">` that wraps
   them, leaving the Hide and Delete buttons in place.
3. Drop `ArrowUp, ArrowDown` from the `lucide-react` import.
4. Replace the paragraph of the header comment that begins "ARRAY ORDER IS DISPLAY ORDER, so
   reordering here" with:

```
 * ARRAY ORDER IS DISPLAY ORDER, so the ORDER of this list is a real decision — but it is not made
 * here. The merchant drags it on the Storefront tab, where they can see the menu they are
 * arranging (spec 2026-08-17). This dialog names, hides and deletes; the Storefront tab orders.
 * Two surfaces writing the same array would be two places to check when the order looks wrong.
 *
 * The Storefront tab hosts its own instance and seeds it from its DRAFT, so a rename made after a
 * drag saves the dragged order rather than writing the stored order back over it.
```

5. Update the intro paragraph the merchant reads: change the sentence
   `'Customers see these as headings on your storefront, in this order. …'` /
   `'顾客会按此顺序在店面看到这些标题。…'` to
   `'Customers see these as headings on your storefront. Drag them into order on the Storefront tab. Products you have not put in a category are listed last, without a heading.'` /
   `'顾客会在店面看到这些标题。请在“店面”页拖动排序。未归入分类的产品会排在最后，且不带标题。'`

- [ ] **Step 6: Typecheck, lint, test**

```bash
pnpm --filter @bitetime/frontend typecheck
pnpm --filter @bitetime/frontend lint
pnpm --filter @bitetime/frontend test
```

Expected: all PASS.

- [ ] **Step 7: Run the app and drive it**

```bash
# terminal 1, from apps/backend
supabase start
# terminal 2, from the repo root
pnpm dev
```

Sign in as a merchant with several products and at least two categories, open `#storefront`, and
check each of these:

1. The list draws every section in its stored order, its products under it, and the un-headed
   trailing block last.
2. Drag a product within a section with the mouse. The Save button becomes enabled.
3. Drag a product into another section. Drag one into the trailing block.
4. Drag a product into an EMPTY section, using its "Drop products here" area.
5. Drag a section's handle. Its products travel with it.
6. Tab to a handle, press Space, move with the arrow keys, press Space again. The item moves.
7. In Chrome's device toolbar (a phone profile), drag with touch.
8. Press Save. The toast appears. Reload the page: the order held.
9. Reload the storefront at `/s/<slug>` and confirm it matches, with hidden items absent.
10. Drag something, then click another sidebar section. The unsaved-changes confirm appears.
11. Drag something, open Categories, rename a section, save the dialog. The drag is still there and
    the Save button is still enabled.
12. Delete a category from the dialog. Its products appear in the trailing block.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/package.json pnpm-lock.yaml \
        apps/frontend/src/merchant/StorefrontArranger.tsx apps/frontend/src/merchant/Dashboard.tsx \
        apps/frontend/src/merchant/MenuCategoriesDialog.tsx apps/frontend/src/store.ts
git commit -m "feat(merchant): drag the storefront into order"
```

---

### Task 6: Documentation, and the whole suite

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CONTEXT.md`

- [ ] **Step 1: Record the section in `CLAUDE.md`**

In the *Data layer* section, after the sentence about a shop's config living in columns on
`merchants`, add:

```markdown
A shop's **menu arrangement** is two stored things: the order of `merchants.product_categories`
(array order is display order, ADR 0013) and `products.sort` + `products.category_id`. The merchant
sets both by dragging, on the dashboard's Storefront section. `products.sort` is written by
`PUT /api/merchants/:id/product-order` and by **nothing else** — it is deliberately absent from
`PRODUCT_FIELDS`, so an ordinary product upsert can never move a product. That endpoint is one
`unnest` statement through `db.ts`, whose `merchant_id` predicate is the whole tenancy guard.
```

- [ ] **Step 2: Record it in `CONTEXT.md`**

Under *Menu category*, add:

```markdown
**Arrangement.** Product order is a stored, merchant-set thing: a single `sort` per shop, dense and
global, numbered across the sections in render order so the storefront's flat product read returns
them ready to group. `menuArrangement.ts` (frontend) holds the rules and is a deliberate sibling of
`menuGroups.ts`: that module answers the customer's question and drops hidden, empty and dangling
cases; this one answers the merchant's and keeps all three, because a merchant must be able to drop
a product into a section a customer cannot see.
```

- [ ] **Step 3: Run everything**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @bitetime/backend test:db
```

Expected: all PASS. `test:db` needs the local stack (`supabase start` from `apps/backend`).

- [ ] **Step 4: Confirm dnd-kit stayed out of the customer bundle**

```bash
grep -rl "@dnd-kit" apps/frontend/src | grep -v "^apps/frontend/src/merchant/"
```

Expected: no output. Any file listed is a storefront or marketing module importing a merchant-only
dependency; move the import back behind `merchant/`.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md CONTEXT.md
git commit -m "docs: record the storefront arrangement"
```

---

## Notes for the reviewer

- **Production still needs the code deploy only.** There is no migration in this feature;
  `products.sort` and `products.category_id` already exist in every environment.
- **The spec's open ends are unchanged:** no undo, no version check between two browsers, no search
  on a long list. All three are recorded under *Known limits* in the spec.
