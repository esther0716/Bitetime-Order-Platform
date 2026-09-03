# Order Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer rates an order 1–5 stars with an optional comment on the order-placed screen, and the shop reads that rating on its dashboard.

**Architecture:** Three columns on `orders` (no new table, no new RLS surface — the browser holds no grant on `orders`). One shared validator in `@bitetime/shared` that both sides run. Two backend doors, copied from the two invoice doors: a signed-in door scoped by `user_id`, and a guest door proving `shop + orderNumber + phone` through `phoneKey()` under an IP window.

**Tech Stack:** TypeScript everywhere. Hono + `@supabase/supabase-js` service-role client (backend), React 19 + Vite + Tailwind + shadcn (frontend), Vitest (all suites), Supabase/Postgres migrations.

**Spec:** `docs/superpowers/specs/2026-09-03-order-reviews-design.md`

## Global Constraints

- Rating is an integer, 1 to 5 inclusive. Comment is at most **500** characters (NOT the 2000 that `feedback.ts` and `trialFeedback.ts` use).
- Every user-facing string is `t('English', '中文')`. There is no i18n library.
- Backend relative imports keep `.js` specifiers that resolve to `.ts` source (`NodeNext`). Frontend imports are extensionless (`bundler`).
- `packages/shared` ships source, no build step. Every new export goes through `packages/shared/src/index.ts`.
- Adding a migration file does not apply it. Run `pnpm --filter @bitetime/backend db:migrate` (LOCAL). **Never run `db:push` or any other command that reaches production.**
- Refusals must not become an oracle: a stranger's order, a missing order and a wrong phone all return the same `404 not_found`.
- `db.ts` and the service-role client are RLS-exempt. Tenancy on the backend path is a TypeScript invariant — check ownership in the route.
- Commit messages end with:
  `Claude-Session: https://claude.ai/code/session_01BRVavEGGrMWjGofgxSuGT1`
- Commit message prose follows ASD-STE100 Simplified Technical English: active voice, one instruction per sentence, no dropped articles.

---

### Task 1: The shared validation rule

**Files:**
- Create: `packages/shared/src/orderReview.ts`
- Create: `packages/shared/src/orderReview.test.ts`
- Modify: `packages/shared/src/index.ts` (append to the export list)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `validateOrderReview(body: unknown): OrderReviewValidation`
  - `ORDER_REVIEW_RATING_MIN = 1`, `ORDER_REVIEW_RATING_MAX = 5`, `ORDER_REVIEW_COMMENT_MAX_LENGTH = 500`
  - `interface OrderReviewDraft { rating: number; comment: string | null }`
  - `type OrderReviewValidation = { ok: true; value: OrderReviewDraft } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/orderReview.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateOrderReview, ORDER_REVIEW_COMMENT_MAX_LENGTH } from './orderReview.js'

describe('validateOrderReview', () => {
  it('accepts a rating with no comment', () => {
    expect(validateOrderReview({ rating: 4 })).toEqual({ ok: true, value: { rating: 4, comment: null } })
  })

  it('accepts a rating with a trimmed comment', () => {
    expect(validateOrderReview({ rating: 5, comment: '  fast and hot  ' }))
      .toEqual({ ok: true, value: { rating: 5, comment: 'fast and hot' } })
  })

  it('treats an empty or whitespace-only comment as none', () => {
    expect(validateOrderReview({ rating: 3, comment: '   ' }))
      .toEqual({ ok: true, value: { rating: 3, comment: null } })
  })

  it('accepts an explicit null comment', () => {
    expect(validateOrderReview({ rating: 1, comment: null }))
      .toEqual({ ok: true, value: { rating: 1, comment: null } })
  })

  it('rejects a missing rating', () => {
    expect(validateOrderReview({ comment: 'good' }).ok).toBe(false)
  })

  it('rejects a rating outside 1-5', () => {
    expect(validateOrderReview({ rating: 0 }).ok).toBe(false)
    expect(validateOrderReview({ rating: 6 }).ok).toBe(false)
  })

  it('rejects a non-integer rating', () => {
    expect(validateOrderReview({ rating: 4.5 }).ok).toBe(false)
  })

  it('rejects a rating that is not a number', () => {
    expect(validateOrderReview({ rating: '5' }).ok).toBe(false)
  })

  it('rejects a comment that is not text', () => {
    expect(validateOrderReview({ rating: 3, comment: 42 }).ok).toBe(false)
  })

  it('rejects a comment over the cap', () => {
    expect(validateOrderReview({ rating: 3, comment: 'x'.repeat(ORDER_REVIEW_COMMENT_MAX_LENGTH + 1) }).ok)
      .toBe(false)
  })

  it('accepts a comment exactly at the cap', () => {
    const comment = 'x'.repeat(ORDER_REVIEW_COMMENT_MAX_LENGTH)
    expect(validateOrderReview({ rating: 3, comment })).toEqual({ ok: true, value: { rating: 3, comment } })
  })

  it('rejects a body that is not an object', () => {
    expect(validateOrderReview(null).ok).toBe(false)
    expect(validateOrderReview('5').ok).toBe(false)
  })

  // The allowlist. A caller must not be able to push its own review_at, user_id or status
  // through the validator and into the update.
  it('drops every field it does not name', () => {
    const out = validateOrderReview({
      rating: 5,
      comment: 'ok',
      review_at: '1999-01-01T00:00:00.000Z',
      user_id: 'someone-else',
      merchant_id: 'another-shop',
      status: 'completed',
    })
    expect(out).toEqual({ ok: true, value: { rating: 5, comment: 'ok' } })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @bitetime/shared test
```

Expected: FAIL — `Failed to resolve import "./orderReview.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/orderReview.ts`:

```ts
// Customer order reviews — validation for the 1-5 star rating a customer leaves on their own
// order. Shared because both sides enforce it: the storefront card disables submit until a star
// is picked and counts the comment down, and the backend refuses anything else. The database
// CHECK constraints in 20260903120000_order_reviews.sql are the final authority; this exists to
// keep the browser and the server from disagreeing about what will be accepted. Mirrors
// trialFeedback.ts's shape and reasoning.
//
// The comment cap is 500, not the 2000 feedback.ts and trialFeedback.ts allow. A customer review
// is a sentence or two written on a phone straight after checkout. A merchant bug report is not.

export const ORDER_REVIEW_RATING_MIN = 1
export const ORDER_REVIEW_RATING_MAX = 5
export const ORDER_REVIEW_COMMENT_MAX_LENGTH = 500

export interface OrderReviewDraft {
  rating: number
  comment: string | null
}

export type OrderReviewValidation =
  | { ok: true; value: OrderReviewDraft }
  | { ok: false; error: string }

/**
 * Validates an order review and returns a clean draft.
 *
 * This is also the write allowlist: it BUILDS its result field by field rather than spreading
 * the body, so a caller cannot smuggle `review_at`, `user_id`, `merchant_id` or `status` through
 * it — the backend derives the timestamp itself and never takes ownership from a body. Never
 * bypass this and update from a raw body.
 */
export function validateOrderReview(body: unknown): OrderReviewValidation {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as {
    rating?: unknown
    comment?: unknown
  }

  if (
    typeof raw.rating !== 'number' ||
    !Number.isInteger(raw.rating) ||
    raw.rating < ORDER_REVIEW_RATING_MIN ||
    raw.rating > ORDER_REVIEW_RATING_MAX
  ) {
    return {
      ok: false,
      error: `Rating must be an integer between ${ORDER_REVIEW_RATING_MIN} and ${ORDER_REVIEW_RATING_MAX}`,
    }
  }

  let comment: string | null = null
  if (raw.comment !== undefined && raw.comment !== null) {
    if (typeof raw.comment !== 'string') {
      return { ok: false, error: 'Comment must be text' }
    }
    const trimmed = raw.comment.trim()
    if (trimmed.length > ORDER_REVIEW_COMMENT_MAX_LENGTH) {
      return { ok: false, error: `Comment must be ${ORDER_REVIEW_COMMENT_MAX_LENGTH} characters or fewer` }
    }
    comment = trimmed.length > 0 ? trimmed : null
  }

  return { ok: true, value: { rating: raw.rating, comment } }
}
```

- [ ] **Step 4: Export it from the package index**

In `packages/shared/src/index.ts`, directly under the `trialFeedback.js` export block, add:

```ts
export {
  validateOrderReview,
  ORDER_REVIEW_RATING_MIN, ORDER_REVIEW_RATING_MAX, ORDER_REVIEW_COMMENT_MAX_LENGTH,
} from './orderReview.js'
export type { OrderReviewDraft, OrderReviewValidation } from './orderReview.js'
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @bitetime/shared test
pnpm typecheck
```

Expected: PASS, and typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/orderReview.ts packages/shared/src/orderReview.test.ts packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(reviews): add the shared order review rule

The rating is an integer from 1 to 5. The comment is optional and has a
limit of 500 characters. The validator builds its result field by field,
so a caller cannot add a field that it does not name.

Claude-Session: https://claude.ai/code/session_01BRVavEGGrMWjGofgxSuGT1
EOF
)"
```

---

### Task 2: The migration

**Files:**
- Create: `apps/backend/supabase/migrations/20260903120000_order_reviews.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `orders.review_rating` (`smallint`, null or 1–5), `orders.review_comment` (`text`, null or ≤500 chars), `orders.review_at` (`timestamptz`). No grant change: `anon` and `authenticated` hold nothing on `orders`.

- [ ] **Step 1: Write the migration**

Create `apps/backend/supabase/migrations/20260903120000_order_reviews.sql`:

```sql
-- The customer's own 1-5 star review of an order, left on the order-placed screen.
--
-- COLUMNS, not a table, for three reasons. One review per order becomes structural — a row
-- cannot hold two, so there is no uniqueness constraint to get wrong. The merchant already reads
-- whole order rows (`select('*')` in GET /api/merchants/:id/orders and /my-orders), so the review
-- arrives with no join and no second request. And there is no new RLS surface: `anon` and
-- `authenticated` hold NO grant on `orders` at all (20260718130000_revoke_all_browser_grants),
-- so every write goes through the backend's service-role client. This migration grants nothing.
--
-- These CHECK constraints are the final authority. `packages/shared/src/orderReview.ts` holds the
-- same two rules so the browser and the server agree with the database about what is acceptable.
alter table public.orders
  add column if not exists review_rating smallint,
  add column if not exists review_comment text,
  add column if not exists review_at timestamptz;

alter table public.orders
  drop constraint if exists orders_review_rating_range;
alter table public.orders
  add constraint orders_review_rating_range
    check (review_rating is null or (review_rating between 1 and 5));

alter table public.orders
  drop constraint if exists orders_review_comment_length;
alter table public.orders
  add constraint orders_review_comment_length
    check (review_comment is null or char_length(review_comment) <= 500);

comment on column public.orders.review_rating is
  'The customer''s own rating of this order, 1 to 5. Null until they leave one. Written only
   through the backend (POST /api/orders/:orderId/review for a signed-in customer, POST
   /api/orders/review for a guest). The merchant reads it and can never write it.';

comment on column public.orders.review_comment is
  'The optional free text beside `review_rating`, at most 500 characters. Null when the customer
   left stars only.';

comment on column public.orders.review_at is
  'When the review was last written. A customer may change their review, so this is the time of
   the most recent write, not of the first one.';
```

- [ ] **Step 2: Apply it to the LOCAL database**

```bash
pnpm --filter @bitetime/backend db:migrate
```

Expected: the migration applies. If it refuses because the local history holds a version whose file is gone, repair that version LOCALLY only — `supabase migration repair --status reverted <version> --db-url "postgresql://postgres:postgres@127.0.0.1:55322/postgres"` from `apps/backend/`. Never run `db:push`.

If Supabase is not running, start it first: `cd apps/backend && supabase start`.

- [ ] **Step 3: Verify the columns and the constraints exist**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -c \
  "select column_name, data_type from information_schema.columns
   where table_name = 'orders' and column_name like 'review%' order by column_name;"
```

Expected: three rows — `review_at | timestamp with time zone`, `review_comment | text`, `review_rating | smallint`.

```bash
psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -c \
  "select conname from pg_constraint where conname like 'orders_review%' order by conname;"
```

Expected: `orders_review_comment_length` and `orders_review_rating_range`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/supabase/migrations/20260903120000_order_reviews.sql
git commit -m "$(cat <<'EOF'
feat(reviews): add the review columns to orders

Three columns hold one review for each order. A row cannot hold two
reviews, so the limit of one review for each order is structural. The
browser holds no grant on orders, so this migration grants nothing.

Production still needs this migration. A human must push it.

Claude-Session: https://claude.ai/code/session_01BRVavEGGrMWjGofgxSuGT1
EOF
)"
```

- [ ] **Step 5: Say plainly that production still needs the push**

State in the task report: the migration is applied LOCALLY only. A human runs `db:push`.

---

### Task 3: The two backend doors

**Files:**
- Modify: `apps/backend/src/quotaWindows.ts` (append after the `invoiceLookupIpWindow` block, near line 137)
- Modify: `apps/backend/src/app.ts` (import the new symbols; add the routes directly after `app.post('/api/orders/invoice', …)`, which ends near line 1723)
- Create: `apps/backend/tests/api/order-review.test.ts`

**Interfaces:**
- Consumes: `validateOrderReview` from `@bitetime/shared` (Task 1); the `review_*` columns (Task 2).
- Produces:
  - `reviewSubmitIpWindow: { allow(key: string): boolean }` in `quotaWindows.ts`
  - `POST /api/orders/:orderId/review` → `200 { review_rating, review_comment, review_at }`
  - `POST /api/orders/review` → the same body
  - Refusals: `400 { error: <validator message> }`, `404 { error: 'not_found' }`, `409 { error: 'order_cancelled' }`, `429 { error: 'rate_limited' }`, `500 { error: 'lookup_failed' | 'review_failed' }`

- [ ] **Step 1: Write the failing API test**

Create `apps/backend/tests/api/order-review.test.ts`:

```ts
// tests/api/order-review.test.ts
// The two review doors, driven in-process against real Postgres.
//
// The questions here are the DOORS, not the rating: does a stranger get in, does the guest pair
// match the way `phoneKey` says it does, does every refusal look the same to a caller probing for
// real order numbers, and does a second review replace the first rather than add one.
import { describe, it, expect, beforeAll } from 'vitest'
import { app } from '../../src/app.js'
import { serviceClient, resetMerchant, seedMerchant, makeUser } from '../rls/helpers.js'

let ownerCounter = 0
async function shopWithOwner(slug: string): Promise<{ merchantId: string; token: string }> {
  await resetMerchant(slug)
  ownerCounter += 1
  const owner = await makeUser(`review-owner-${ownerCounter}@example.com`, 'password123')
  const { data } = await owner.auth.getSession()
  const merchantId = await seedMerchant({ slug, owner_id: data.session!.user.id })
  return { merchantId, token: data.session!.access_token }
}

async function seedOrder(
  merchantId: string,
  over: Record<string, unknown> = {},
): Promise<{ id: string; order_number: string }> {
  const orderNumber = `RV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  const { data, error } = await serviceClient()
    .from('orders')
    .insert({
      merchant_id: merchantId,
      order_number: orderNumber,
      status: 'new',
      mode: 'pickup',
      customer_name: 'Ah Meng',
      customer_wa: '+60 12-345 6789',
      customer_phone_key: '23456789',
      currency: 'MYR',
      items: [{ id: 'p1', name: 'Butter cake', qty: 2, price: 18 }],
      total: 36,
      ...over,
    })
    .select('id, order_number')
    .single()
  if (error) throw new Error(`seeding order: ${error.message}`)
  return data as { id: string; order_number: string }
}

// Every guest call gets its OWN address unless the caller names one: the door is rate-limited per
// IP (10/minute), the window is module state shared by the whole file, and a suite sharing one
// address would fail on its eleventh assertion for a reason unrelated to what it asserts.
let ipCounter = 0
const guestReview = (body: Record<string, unknown>, ip?: string) => {
  ipCounter += 1
  return app.request('/api/orders/review', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip ?? `10.${Math.floor(ipCounter / 250)}.${ipCounter % 250}.1`,
    },
    body: JSON.stringify(body),
  })
}

const myReview = (orderId: string, body: Record<string, unknown>, token?: string) =>
  app.request(`/api/orders/${orderId}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

async function readReview(orderId: string) {
  const { data } = await serviceClient()
    .from('orders').select('review_rating, review_comment, review_at').eq('id', orderId).single()
  return data as { review_rating: number | null; review_comment: string | null; review_at: string | null }
}

let shop: { merchantId: string; token: string }
let customer: { id: string; token: string }
let stranger: { id: string; token: string }

beforeAll(async () => {
  shop = await shopWithOwner('review-shop')

  const a = await makeUser('review-customer@example.com', 'password123')
  const aSession = (await a.auth.getSession()).data.session!
  customer = { id: aSession.user.id, token: aSession.access_token }

  const b = await makeUser('review-stranger@example.com', 'password123')
  const bSession = (await b.auth.getSession()).data.session!
  stranger = { id: bSession.user.id, token: bSession.access_token }
})

describe('POST /api/orders/:orderId/review — the signed-in door', () => {
  it('stores the rating and the comment on the caller’s own order', async () => {
    const order = await seedOrder(shop.merchantId, { user_id: customer.id })
    const res = await myReview(order.id, { rating: 5, comment: '  hot and fast  ' }, customer.token)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.review_rating).toBe(5)
    expect(body.review_comment).toBe('hot and fast')
    expect(body.review_at).toBeTruthy()

    const stored = await readReview(order.id)
    expect(stored.review_rating).toBe(5)
    expect(stored.review_comment).toBe('hot and fast')
  })

  it('replaces an earlier review instead of adding one', async () => {
    const order = await seedOrder(shop.merchantId, { user_id: customer.id })
    await myReview(order.id, { rating: 1 }, customer.token)
    const res = await myReview(order.id, { rating: 4, comment: 'they fixed it' }, customer.token)
    expect(res.status).toBe(200)

    const stored = await readReview(order.id)
    expect(stored.review_rating).toBe(4)
    expect(stored.review_comment).toBe('they fixed it')
  })

  it('refuses a stranger’s order with the same 404 a missing order gets', async () => {
    const order = await seedOrder(shop.merchantId, { user_id: customer.id })
    const mine = await myReview(order.id, { rating: 5 }, stranger.token)
    expect(mine.status).toBe(404)
    expect(await mine.json()).toEqual({ error: 'not_found' })

    const missing = await myReview(crypto.randomUUID(), { rating: 5 }, stranger.token)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'not_found' })

    const stored = await readReview(order.id)
    expect(stored.review_rating).toBeNull()
  })

  it('refuses a guest order, which belongs to nobody', async () => {
    const order = await seedOrder(shop.merchantId, { user_id: null })
    const res = await myReview(order.id, { rating: 5 }, customer.token)
    expect(res.status).toBe(404)
  })

  it('refuses a caller with no token', async () => {
    const order = await seedOrder(shop.merchantId, { user_id: customer.id })
    expect((await myReview(order.id, { rating: 5 })).status).toBe(401)
  })

  it('refuses a rating outside 1-5', async () => {
    const order = await seedOrder(shop.merchantId, { user_id: customer.id })
    expect((await myReview(order.id, { rating: 0 }, customer.token)).status).toBe(400)
    expect((await myReview(order.id, { rating: 6 }, customer.token)).status).toBe(400)
    expect((await readReview(order.id)).review_rating).toBeNull()
  })

  it('refuses a cancelled order', async () => {
    const order = await seedOrder(shop.merchantId, { user_id: customer.id, status: 'cancelled' })
    const res = await myReview(order.id, { rating: 5 }, customer.token)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'order_cancelled' })
  })
})

describe('POST /api/orders/review — the guest door', () => {
  it('stores a review for the order number and phone the guest proves', async () => {
    const order = await seedOrder(shop.merchantId)
    const res = await guestReview({
      shop: 'review-shop',
      orderNumber: order.order_number,
      phone: '+60 12-345 6789',
      rating: 4,
      comment: 'good',
    })
    expect(res.status).toBe(200)
    const stored = await readReview(order.id)
    expect(stored.review_rating).toBe(4)
    expect(stored.review_comment).toBe('good')
  })

  it('matches the phone on the last eight digits, however it is written', async () => {
    const order = await seedOrder(shop.merchantId)
    const res = await guestReview({
      shop: 'REVIEW-SHOP',
      orderNumber: order.order_number.toLowerCase(),
      phone: '012 345 6789',
      rating: 3,
    })
    expect(res.status).toBe(200)
    expect((await readReview(order.id)).review_rating).toBe(3)
  })

  it('refuses a wrong phone, an unknown order and an unknown shop with the same 404', async () => {
    const order = await seedOrder(shop.merchantId)
    const base = { shop: 'review-shop', orderNumber: order.order_number, phone: '+60 12-345 6789', rating: 5 }

    const wrongPhone = await guestReview({ ...base, phone: '+60 19-999 8888' })
    expect(wrongPhone.status).toBe(404)
    expect(await wrongPhone.json()).toEqual({ error: 'not_found' })

    const wrongOrder = await guestReview({ ...base, orderNumber: 'RV-DOESNOTEXIST' })
    expect(wrongOrder.status).toBe(404)
    expect(await wrongOrder.json()).toEqual({ error: 'not_found' })

    const wrongShop = await guestReview({ ...base, shop: 'no-such-shop' })
    expect(wrongShop.status).toBe(404)
    expect(await wrongShop.json()).toEqual({ error: 'not_found' })

    const noPhone = await guestReview({ ...base, phone: '' })
    expect(noPhone.status).toBe(404)

    expect((await readReview(order.id)).review_rating).toBeNull()
  })

  it('refuses a cancelled order', async () => {
    const order = await seedOrder(shop.merchantId, { status: 'cancelled' })
    const res = await guestReview({
      shop: 'review-shop', orderNumber: order.order_number, phone: '+60 12-345 6789', rating: 5,
    })
    expect(res.status).toBe(409)
  })

  it('rate-limits one address after ten calls in a minute', async () => {
    const order = await seedOrder(shop.merchantId)
    const ip = '203.0.113.77'
    const body = {
      shop: 'review-shop', orderNumber: order.order_number, phone: '+60 12-345 6789', rating: 5,
    }
    for (let i = 0; i < 10; i++) {
      expect((await guestReview(body, ip)).status).toBe(200)
    }
    const res = await guestReview(body, ip)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Local Supabase must be running (`cd apps/backend && supabase start`).

```bash
pnpm --filter @bitetime/backend test:db -- order-review
```

Expected: FAIL — every request returns 404 because no such route exists.

> If EVERY test in the file times out inside `makeUser`, that is local Supabase auth latency on a loaded machine, not the code. Time one signup before debugging.

- [ ] **Step 3: Add the rate-limit window**

In `apps/backend/src/quotaWindows.ts`, after the `invoiceLookupIpWindow` export block, add:

```ts
// The guest review door (POST /api/orders/review) proves the SAME guessable pair the guest
// invoice door does — an order number and a phone — so it carries the same bound, and for the
// same reason. A customer who mistypes their phone tries three or four times in a minute; a
// script enumerating order numbers tries thousands.
//
// Its own windows, not a share of the invoice door's: a customer who downloaded their invoice and
// then rates the order must not be refused for having used a different door a moment earlier.
//
// Same in-memory weaknesses as every other limiter here, inherited knowingly: resets on redeploy,
// and stops protecting anything past one backend instance (#101, Out of Scope).
const reviewSubmitMinuteWindow = createSlidingWindow({ limit: 10, windowMs: 60_000, now: () => Date.now() })
const reviewSubmitHourWindow = createSlidingWindow({ limit: 60, windowMs: 60 * 60_000, now: () => Date.now() })

export const reviewSubmitIpWindow = {
  allow(key: string): boolean {
    // BOTH windows record the hit — an early return from the minute window would leave the hour
    // window under-counting exactly the caller it exists to stop.
    const minute = reviewSubmitMinuteWindow.allow(key)
    const hour = reviewSubmitHourWindow.allow(key)
    return minute && hour
  },
}
```

- [ ] **Step 4: Add the two routes**

In `apps/backend/src/app.ts`:

Add `reviewSubmitIpWindow` to the existing `./quotaWindows.js` import list (near line 53), so it reads `import { invoiceLookupIpWindow, reviewSubmitIpWindow, quoteIpWindow, … }`.

Add `validateOrderReview` to the existing `@bitetime/shared` value import (line 87, the long one that already begins `import { canIssueInvoice, isCart, …`). Do NOT write a second import from that package.

Then, directly AFTER the closing `})` of `app.post('/api/orders/invoice', …)` (near line 1723), insert:

```ts
// ── Order reviews — the customer's own 1-5 stars on their own order ────────────────────────────
//
// Two doors, and they are the invoice doors' twins on purpose: the same two customers exist here
// (a signed-in one holding a `user_id`, a guest holding nothing but the order number and the
// phone they typed), so the same two proofs answer them. See
// docs/superpowers/specs/2026-09-03-order-reviews-design.md.
//
// Both write through the service-role client. `orders` grants the browser nothing at all, so
// there is no client path to close and no policy to lean on — the ownership check IS the route's.

/**
 * The write itself, shared by both doors. The caller has already PROVED the order is the one it
 * may review; this does not re-check ownership and must never be reached before that proof.
 *
 * The parsed body is passed in rather than re-read, so the guest door reads the request once.
 */
async function writeOrderReview(
  c: Context,
  order: { id: string; status: string | null },
  body: unknown,
) {
  // A cancelled order has nothing to rate, and the shop cannot act on the answer. 409 rather
  // than 404: the customer proved this order, so pretending it is missing would be a lie they
  // can see through.
  if (order.status === 'cancelled') return c.json({ error: 'order_cancelled' }, 409)

  const parsed = validateOrderReview(body)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  // `review_at` is derived here and never taken from the body — the validator drops it, and this
  // is the other half of that rule. A change to a review moves the timestamp: it records the last
  // write, not the first.
  const { data, error } = await admin
    .from('orders')
    .update({
      review_rating: parsed.value.rating,
      review_comment: parsed.value.comment,
      review_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .select('review_rating, review_comment, review_at')
    .single()
  if (error) {
    console.error('Order review write failed:', error.message)
    return c.json({ error: 'review_failed' }, 500)
  }
  return c.json(data)
}

// The signed-in customer's door, scoped by the order's `user_id`. Inline ownership check for the
// same reason the payment-proof and invoice twins have one: `requireOwnsChild` proves MERCHANT
// ownership, which is the wrong question for a customer. A stranger's order, a guest order and a
// missing order all return the same 404, or the 404 becomes an oracle.
app.post('/api/orders/:orderId/review', requireUser, async (c) => {
  const user = c.get('user')
  const { data: order, error } = await admin
    .from('orders').select('id, status, user_id').eq('id', c.req.param('orderId')).maybeSingle()
  if (error) return c.json({ error: 'lookup_failed' }, 500)
  if (!order || order.user_id !== user.id) return c.json({ error: 'not_found' }, 404)

  const body = await c.req.json().catch(() => ({}))
  return writeOrderReview(c, order as { id: string; status: string | null }, body)
})

/**
 * The guest's door — the same proof `POST /api/orders/invoice` takes.
 *
 * A guest order carries `user_id = null` for ever, so the only thing that customer can prove is
 * the order number and the phone they typed, matched on `phoneKey()` (ADR 0007's last-eight-digit
 * rule). The shop is REQUIRED and is not decoration: an order number is unique per shop only.
 *
 * The pair is guessable, and ADR 0018 accepts that knowingly. `reviewSubmitIpWindow` is what
 * bounds it; it is in memory, so a second backend instance doubles it (#101). What a successful
 * guess wins here is the ability to leave a star rating on a stranger's order — no read of the
 * order, and nothing in the response that a guesser did not already send.
 */
app.post('/api/orders/review', async (c) => {
  if (!reviewSubmitIpWindow.allow(ipOf(c))) return c.json({ error: 'rate_limited' }, 429)

  const body = await c.req.json().catch(() => ({}))
  const slug = typeof body.shop === 'string' ? body.shop.trim().toLowerCase() : ''
  const orderNumber = typeof body.orderNumber === 'string' ? body.orderNumber.trim().toUpperCase() : ''
  // Null for a phone with no digits, which must never become a key: '' is what BOTH an absent
  // phone and a phone-less order reduce to, and matching those would hand back the enumeration
  // the phone requirement exists to remove.
  const key = phoneKey(typeof body.phone === 'string' ? body.phone : '')
  if (!slug || !orderNumber || !key) return c.json({ error: 'not_found' }, 404)

  const { data: merchant, error: mErr } = await admin
    .from('merchants').select('id').eq('slug', slug).maybeSingle()
  if (mErr) return c.json({ error: 'lookup_failed' }, 500)
  if (!merchant) return c.json({ error: 'not_found' }, 404)

  const { data: order, error } = await admin
    .from('orders').select('id, status')
    .eq('merchant_id', merchant.id)
    .eq('order_number', orderNumber)
    .eq('customer_phone_key', key)
    .maybeSingle()
  if (error) return c.json({ error: 'lookup_failed' }, 500)
  if (!order) return c.json({ error: 'not_found' }, 404)

  return writeOrderReview(c, order as { id: string; status: string | null }, body)
})
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @bitetime/backend test:db -- order-review
pnpm --filter @bitetime/backend test
pnpm typecheck && pnpm lint
```

Expected: the new suite passes, the unit suites still pass, typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/app.ts apps/backend/src/quotaWindows.ts apps/backend/tests/api/order-review.test.ts
git commit -m "$(cat <<'EOF'
feat(reviews): add the two order review doors

A signed-in customer proves the order with their token. A guest proves
the shop, the order number and the phone, which is the proof the guest
invoice door already takes. An IP window bounds the guest door.

A cancelled order refuses the review with 409. Every other refusal
returns the same 404, so the response tells a guesser nothing.

Claude-Session: https://claude.ai/code/session_01BRVavEGGrMWjGofgxSuGT1
EOF
)"
```

---

### Task 4: The customer's review card on the order-placed screen

**Files:**
- Modify: `apps/frontend/src/types.ts` (the `Order` interface, near line 169)
- Modify: `apps/frontend/src/store.ts` (add the two calls beside `fetchGuestInvoice`, near line 1371)
- Create: `apps/frontend/src/store/OrderReviewCard.tsx`
- Modify: `apps/frontend/src/store/Storefront.tsx` (success view, after the `PaymentInstructions` block near line 993)

**Interfaces:**
- Consumes: `POST /api/orders/:orderId/review` and `POST /api/orders/review` (Task 3); `ORDER_REVIEW_COMMENT_MAX_LENGTH` from `@bitetime/shared` (Task 1).
- Produces:
  - `interface OrderReview { review_rating: number; review_comment: string | null; review_at: string }` exported from `store.ts`
  - `reviewMyOrder(orderId: string, rating: number, comment: string | null): Promise<Result<OrderReview>>`
  - `reviewGuestOrder(shop: string, orderNumber: string, phone: string, rating: number, comment: string | null): Promise<Result<OrderReview>>`
  - `<OrderReviewCard initial={…} submit={…} className={…} />` — default export of `store/OrderReviewCard.tsx`
  - `Order.review_rating`, `Order.review_comment`, `Order.review_at`

- [ ] **Step 1: Add the three fields to the `Order` type**

In `apps/frontend/src/types.ts`, inside `export interface Order`, add:

```ts
  /**
   * The customer's own 1-5 star review of this order, and the optional text beside it. Null
   * until they leave one. Written only through the two review doors; the merchant reads these
   * and can never write them.
   */
  review_rating?: number | null
  review_comment?: string | null
  /** When the review was LAST written — a customer may change theirs. */
  review_at?: string | null
```

- [ ] **Step 2: Add the two store calls**

In `apps/frontend/src/store.ts`, directly after `fetchGuestInvoice` (near line 1371), add:

```ts
/** The three fields either review door writes back. */
export interface OrderReview {
  review_rating: number
  review_comment: string | null
  review_at: string
}

/**
 * The signed-in customer's review of their own order. The order's `user_id` is what scopes it,
 * so the token is the whole proof and nothing about the order needs to be re-stated.
 */
export async function reviewMyOrder(
  orderId: string,
  rating: number,
  comment: string | null,
): Promise<Result<OrderReview>> {
  return apiSend<OrderReview>(`/api/orders/${orderId}/review`, 'POST', { rating, comment }, { auth: true })
}

/**
 * The guest's review, through the same door their invoice comes from: the shop, the order number
 * and the phone they typed. A guest order carries no `user_id`, so there is nothing else to prove.
 */
export async function reviewGuestOrder(
  shop: string,
  orderNumber: string,
  phone: string,
  rating: number,
  comment: string | null,
): Promise<Result<OrderReview>> {
  return apiSend<OrderReview>(
    '/api/orders/review',
    'POST',
    { shop, orderNumber, phone, rating, comment },
    { auth: false },
  )
}
```

- [ ] **Step 3: Write the review card**

Create `apps/frontend/src/store/OrderReviewCard.tsx`:

```tsx
import { useState } from 'react'
import { Star } from 'lucide-react'
import { ORDER_REVIEW_COMMENT_MAX_LENGTH } from '@bitetime/shared'
import { useSession } from '../SessionContext'
import { Button } from '../components/ui/button'
import { Textarea } from '../components/ui/textarea'
import { cn } from '@/lib/utils'
import type { Result } from '../api'
import type { OrderReview } from '../store'

/**
 * One customer, one order, one to five stars.
 *
 * It knows nothing about WHICH door it writes through: `submit` is handed in, so the same card
 * serves the signed-in customer (scoped by the order's `user_id`) and the guest (proving the
 * order number and their phone). The order-placed screen and order history both mount it.
 *
 * The star widget is the one `merchant/TrialFeedbackPrompt.tsx` already uses — a radiogroup of
 * five buttons, filled to the hovered or chosen star. Copied rather than shared: the two live on
 * opposite sides of the product and answer different questions, and a shared widget would tie a
 * merchant survey's layout to a storefront receipt's.
 */
export default function OrderReviewCard({
  initial,
  submit,
  className,
}: {
  /** What is already stored for this order, or null when the customer has not rated it. */
  initial: { rating: number; comment: string | null } | null
  submit: (rating: number, comment: string | null) => Promise<Result<OrderReview>>
  className?: string
}) {
  const { t } = useSession()
  // `sent` is what is STORED. `editing` is whether the form is open. A card that opens with a
  // stored review shows it, and opens the form only when the customer asks to change it.
  const [sent, setSent] = useState(initial)
  const [editing, setEditing] = useState(initial === null)
  const [rating, setRating] = useState(initial?.rating ?? 0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState(initial?.comment ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const trimmed = comment.trim()
  const tooLong = trimmed.length > ORDER_REVIEW_COMMENT_MAX_LENGTH

  const send = async () => {
    if (rating < 1 || tooLong || busy) return
    setBusy(true); setError('')
    const r = await submit(rating, trimmed || null)
    setBusy(false)
    if (r.ok) {
      setSent({ rating: r.data.review_rating, comment: r.data.review_comment })
      setEditing(false)
    } else {
      setError(r.error.message || t('Could not send your review', '无法提交你的评价'))
    }
  }

  const stars = (value: number, interactive: boolean) => (
    <div
      className="flex gap-1"
      role={interactive ? 'radiogroup' : undefined}
      aria-label={interactive ? t('Rating', '评分') : undefined}
    >
      {[1, 2, 3, 4, 5].map(n => {
        const filled = value >= n
        const cls = cn('size-[22px]', filled ? 'fill-primary text-primary' : 'text-muted-foreground')
        if (!interactive) return <Star key={n} size={22} strokeWidth={1.75} className={cls} aria-hidden />
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={String(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}
          >
            <Star size={22} strokeWidth={1.75} className={cls} />
          </button>
        )
      })}
    </div>
  )

  return (
    <div className={cn('bg-card border-[0.5px] border-border rounded-2xl p-[15px]', className)}>
      {!editing && sent ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-muted-foreground">
            {t('Thank you for rating this order.', '感谢你的评价。')}
          </p>
          {stars(sent.rating, false)}
          {sent.comment && (
            <p className="text-[13px] text-foreground break-words whitespace-pre-wrap">{sent.comment}</p>
          )}
          <Button
            type="button"
            variant="link"
            size="none"
            className="self-start text-[13px]"
            onClick={() => { setRating(sent.rating); setComment(sent.comment ?? ''); setEditing(true) }}
          >
            {t('Change my rating', '修改评价')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[14px] font-medium text-foreground">
            {t('How was ordering here?', '这次下单体验如何？')}
          </p>
          {stars(hover || rating, true)}
          <Textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={3}
            placeholder={t('Anything you want the shop to know? (optional)', '有什么想告诉店家的吗？（可选）')}
            aria-label={t('Comment', '留言')}
          />
          {tooLong && (
            <p className="text-[12px] text-danger-fg">
              {t(`Comment must be ${ORDER_REVIEW_COMMENT_MAX_LENGTH} characters or fewer`,
                 `留言不能超过 ${ORDER_REVIEW_COMMENT_MAX_LENGTH} 个字`)}
            </p>
          )}
          {error && <p className="text-[13px] text-danger-fg">{error}</p>}
          <Button
            type="button"
            onClick={() => void send()}
            disabled={rating < 1 || tooLong || busy}
            className="self-start"
          >
            {busy ? t('Sending…', '提交中…') : t('Send my rating', '提交评价')}
          </Button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Mount it on the success view**

In `apps/frontend/src/store/Storefront.tsx`:

Add to the imports:

```tsx
import OrderReviewCard from './OrderReviewCard'
```

and add `reviewMyOrder, reviewGuestOrder` to the existing `from '../store'` import list.

Then, directly AFTER the `</PaymentInstructions>` closing tag on the success view (near line 993) and BEFORE the `<div className="flex flex-col items-center gap-2 mt-5">` that holds the invoice block, insert:

```tsx
            {/* The rating, asked at the one moment this customer is certainly still here. A guest
                order is orphaned the moment this tab closes, so any later screen would reach the
                signed-in customer only. It chooses its door exactly as the invoice button below
                does: the account's own `user_id`, or the same (shop, order number, phone) triple
                the guest already typed. */}
            <OrderReviewCard
              className="max-w-[360px] mx-auto mb-4"
              initial={null}
              submit={(rating, comment) => (account
                ? reviewMyOrder(success.orderId, rating, comment)
                : reviewGuestOrder(merchant.slug, success.orderNumber, wa, rating, comment))}
            />
```

`wa` is the phone already in scope (`const wa = waInput ?? prefill.wa ?? ''`, near line 160) — the same variable the invoice button below passes to `fetchGuestInvoice`.

- [ ] **Step 5: Check it compiles**

```bash
pnpm typecheck && pnpm lint
```

Expected: clean.

- [ ] **Step 6: Verify it in the running app**

Start both dev servers (`pnpm dev`) with local Supabase up. Then, as a **guest** (signed out):

1. Open a shop's storefront, add an item, place an order.
2. On the "Order Placed!" screen, confirm the card appears under the payment instructions.
3. Confirm the send button is disabled until a star is picked.
4. Pick 4 stars, type a comment, send.
5. Confirm the card switches to the thank-you state showing 4 filled stars and the comment.
6. Press "Change my rating", pick 2 stars, send, and confirm the thank-you state shows 2.
7. Check the row: `psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -c "select order_number, review_rating, review_comment from orders order by created_at desc limit 1;"`

Repeat steps 1–6 signed in as a customer, to exercise the other door.

> If the app serves code you did not write, the backend dev server may be running pre-edit code from the jiti cache, or a stale service worker may be serving old modules on :5173. Restart the backend and remove the jiti cache; unregister the service worker.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/types.ts apps/frontend/src/store.ts apps/frontend/src/store/OrderReviewCard.tsx apps/frontend/src/store/Storefront.tsx
git commit -m "$(cat <<'EOF'
feat(reviews): let the customer rate the order they just placed

The card sits on the order-placed screen, which is the one screen a
guest reliably sees. A guest order carries no user id, so a later screen
would reach only the customers who have an account.

The card chooses its door in the same way the invoice button beside it
does.

Claude-Session: https://claude.ai/code/session_01BRVavEGGrMWjGofgxSuGT1
EOF
)"
```

---

### Task 5: The review in the customer's order history

**Files:**
- Modify: `apps/frontend/src/store/OrderHistory.tsx` (imports; inside `AccordionContent`, after the totals and before the payment block)

**Interfaces:**
- Consumes: `OrderReviewCard` and `reviewMyOrder` (Task 4); `Order.review_rating` / `review_comment` (Task 4); `patchLoadedOrder` (already in the file, near line 64).
- Produces: nothing new.

- [ ] **Step 1: Add the imports**

In `apps/frontend/src/store/OrderHistory.tsx`, add `reviewMyOrder` to the existing `from '../store'` import list, and add:

```tsx
import OrderReviewCard from './OrderReviewCard'
```

- [ ] **Step 2: Mount the card inside the expanded row**

Inside the `<AccordionContent>` for each order, after the money lines and before the payment-proof block, insert:

```tsx
                      {/* The same card the order-placed screen shows, now the only way a
                          signed-in customer can change their mind. It writes through the
                          signed-in door — history is signed-in-only by construction, so there
                          is no guest branch to write here.

                          A cancelled order has nothing to rate and the backend refuses it with
                          409, so the card is not offered. `key` on the order id keeps one row's
                          card from carrying another row's state when the accordion switches. */}
                      {o.status !== 'cancelled' && (
                        <OrderReviewCard
                          key={o.id}
                          className="mt-3"
                          initial={o.review_rating
                            ? { rating: o.review_rating, comment: o.review_comment ?? null }
                            : null}
                          submit={async (rating, comment) => {
                            const r = await reviewMyOrder(o.id!, rating, comment)
                            // Patch the loaded row so the stored review survives collapsing and
                            // re-opening this order, without refetching the whole list (which
                            // would close the accordion).
                            if (r.ok) patchLoadedOrder(o.id!, {
                              review_rating: r.data.review_rating,
                              review_comment: r.data.review_comment,
                              review_at: r.data.review_at,
                            })
                            return r
                          }}
                        />
                      )}
```

- [ ] **Step 3: Check it compiles**

```bash
pnpm typecheck && pnpm lint
```

Expected: clean.

- [ ] **Step 4: Verify it in the running app**

Signed in as a customer at a shop where you placed an order in Task 4:

1. Open `/s/<slug>/orders`.
2. Expand the order you rated. Confirm the card shows the stored stars and comment, not an empty form.
3. Press "Change my rating", pick a different star count, send.
4. Collapse the row and expand it again. Confirm the new rating is still shown (this proves the patch, not a refetch).
5. Expand an order with no review. Confirm the card shows the empty form.
6. Confirm a cancelled order shows no card. (Set one with `psql … -c "update orders set status='cancelled' where id='<id>';"`.)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/store/OrderHistory.tsx
git commit -m "$(cat <<'EOF'
feat(reviews): show and edit the review in order history

The expanded order row carries the same card. A signed-in customer can
change a rating that they gave earlier. The write patches the loaded row,
so the open accordion stays open.

Claude-Session: https://claude.ai/code/session_01BRVavEGGrMWjGofgxSuGT1
EOF
)"
```

---

### Task 6: The merchant reads the review

**Files:**
- Create: `apps/frontend/src/merchant/orderDetail/ReviewCard.tsx`
- Modify: `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx` (import; render above `NoteCard`, near line 135)
- Modify: `apps/frontend/src/merchant/OrdersView.tsx` (add a column to the `columns` array, after `status`, near line 100)

**Interfaces:**
- Consumes: `Order.review_rating` / `review_comment` (Task 4). Both merchant order reads already `select('*')`, so no backend change is needed.
- Produces: `<ReviewCard order={order} />` — default export of `merchant/orderDetail/ReviewCard.tsx`.

- [ ] **Step 1: Write the merchant's read-only card**

Create `apps/frontend/src/merchant/orderDetail/ReviewCard.tsx`:

```tsx
import { Star } from 'lucide-react'
import { useSession } from '../../SessionContext'
import { cn } from '@/lib/utils'
import DrawerCard from './DrawerCard'
import type { Order } from '../../types'

/**
 * What the customer said about this order — read-only, always.
 *
 * A merchant cannot write, edit or delete a review. There is no door for it on the backend
 * either: both review routes scope to the CUSTOMER, so this is a display and nothing more.
 *
 * Renders nothing for an unrated order. An empty "Review" card on every order the customer never
 * rated would put a hole in six drawers out of seven, and say nothing in any of them.
 */
export default function ReviewCard({ order }: { order: Order }) {
  const { t } = useSession()
  const rating = order.review_rating ?? null
  if (!rating) return null

  return (
    <DrawerCard title={t('Customer review', '顾客评价')}>
      <div className="flex items-center gap-1" aria-label={t('Rating', '评分')}>
        {[1, 2, 3, 4, 5].map(n => (
          <Star
            key={n}
            size={18}
            strokeWidth={1.75}
            aria-hidden
            className={cn(rating >= n ? 'fill-primary text-primary' : 'text-muted-foreground')}
          />
        ))}
        <span className="ml-1 text-[13px] text-muted-foreground tabular-nums">{rating}/5</span>
      </div>
      {order.review_comment && (
        <p className="text-[13px] text-foreground break-words whitespace-pre-wrap">
          {order.review_comment}
        </p>
      )}
    </DrawerCard>
  )
}
```

- [ ] **Step 2: Mount it in the order drawer**

In `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx`, add the import beside the other cards:

```tsx
import ReviewCard from './ReviewCard'
```

and render it directly above `<NoteCard …>`:

```tsx
              <ReviewCard order={order} />
```

- [ ] **Step 3: Add the rating to the order table**

In `apps/frontend/src/merchant/OrdersView.tsx`, add the `Star` import:

```tsx
import { Star } from 'lucide-react'
```

and append this column to the `columns` array, after the `status` column:

```tsx
  {
    accessorKey: 'review_rating',
    enableSorting: false,
    header: ({ table }) => (
      <span>{(table.options.meta as OrderTableMeta).t('Rating', '评分')}</span>
    ),
    // The number beside ONE star, not five drawn stars: this cell sits in a dense table, and five
    // glyphs in every row would out-shout the status badge next to it. An unrated order shows
    // nothing at all — a row of five empty stars reads as "rated nothing", which is a different
    // and untrue statement.
    cell: ({ row }) => {
      const rating = row.original.review_rating as number | null | undefined
      if (!rating) return <span className="text-muted-foreground">—</span>
      return (
        <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
          <Star size={14} strokeWidth={2} className="fill-primary text-primary" aria-hidden />
          {rating}
        </span>
      )
    },
  },
```

- [ ] **Step 4: Check it compiles**

```bash
pnpm typecheck && pnpm lint
```

Expected: clean.

- [ ] **Step 5: Verify it in the running app**

Signed in as the merchant who owns the shop used in Task 4:

1. Open the dashboard's Orders section.
2. Confirm the rated order shows its star and number in the Rating column, and an unrated order shows `—`.
3. Open the rated order's drawer. Confirm the "Customer review" card sits above the note, shows the right number of filled stars, and shows the comment.
4. Confirm there is no way to edit it.
5. Open an unrated order's drawer. Confirm no review card appears at all.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/merchant/orderDetail/ReviewCard.tsx apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx apps/frontend/src/merchant/OrdersView.tsx
git commit -m "$(cat <<'EOF'
feat(reviews): show the customer review to the merchant

The order table shows the rating in one column. The order drawer shows
the stars and the comment. The merchant can read a review and can never
write one, because both review doors scope to the customer.

Claude-Session: https://claude.ai/code/session_01BRVavEGGrMWjGofgxSuGT1
EOF
)"
```

---

### Task 7: Record the domain rule, and run everything

**Files:**
- Modify: `CONTEXT.md` (a new `## Order review` section, placed after `## Order notifications`)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing in code.

- [ ] **Step 1: Add the CONTEXT.md section**

Insert after the `## Order notifications` section, before `## Invoice`:

```markdown
## Order review

One customer's 1-to-5 star rating of ONE order, with an optional comment of at most 500
characters. It is three columns on `orders` (`review_rating`, `review_comment`, `review_at`),
not a table: a row cannot hold two reviews, so one review per order is structural, and the
merchant's existing `select('*')` reads carry it with no join.

The customer rates on the **order-placed screen**, immediately after checkout. This measures the
ordering, not the food, and that is deliberate: a guest order carries `user_id = null` for ever,
so the order-placed screen is the only screen a guest reliably sees. A signed-in customer can
also rate and re-rate from their order history.

Two doors write it, and they are the invoice doors' twins: `POST /api/orders/:orderId/review`
scoped by the order's `user_id`, and `POST /api/orders/review` proving `(shop, order number,
phone)` through `phoneKey()` under `reviewSubmitIpWindow`. A cancelled order refuses with 409;
every other refusal is the same 404.

The merchant READS it — a column in the order table, a card in the order drawer — and can never
write it. Nothing is public: there is no shop average, no reply and no moderation.

A guest who leaves the order-placed screen cannot change their review. `/invoice` is a door to a
PDF, not a view of an order. Accepted, and stated in
`docs/superpowers/specs/2026-09-03-order-reviews-design.md`.
```

- [ ] **Step 2: Run every check the CI runs**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @bitetime/backend test:db
```

Expected: all green. Report the actual output — do not claim a pass you have not seen.

- [ ] **Step 3: Commit**

```bash
git add CONTEXT.md
git commit -m "$(cat <<'EOF'
docs(reviews): record the order review rule in CONTEXT.md

Claude-Session: https://claude.ai/code/session_01BRVavEGGrMWjGofgxSuGT1
EOF
)"
```

- [ ] **Step 4: State what production still needs**

The migration `20260903120000_order_reviews.sql` is applied to the LOCAL database only. A human
runs `db:push`. Until then, the two review routes fail against production with
`Could not find the 'review_rating' column … in the schema cache`.
