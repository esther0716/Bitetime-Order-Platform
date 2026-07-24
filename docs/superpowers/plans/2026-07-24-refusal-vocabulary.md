# Refusal Vocabulary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the order and delivery-quote refusal codes one shared module instead of two hand-copied twins, and move the storefront's 13-branch recovery chain behind a pure, tested interface.

**Architecture:** Two seams. `packages/shared/src/refusal.ts` owns the wire vocabulary — the codes, their meaning (the doc comments move there from `orders.ts`), and the HTTP status each carries — because it is a rule that must hold identically on both sides of the wire, the same reason `pricing.ts` lives there. `apps/frontend/src/store/orderRefusal.ts` owns what a refusal *says* and what it *does to the browser*: `orderRefusalPlan` returns a message plus an **ordered** list of named recovery actions, `quoteRefusalPlan` returns a message. Copy and effects never enter the shared package — the backend renders neither.

The status map is a **total** `Record`, so adding a code fails the backend build; the plan switch is exhaustive with a `never` check, so it fails the frontend build. Neither side can be forgotten, which is what the "DELIBERATE TWIN" comment at `orders.ts:14` currently asks a human to remember — and which already failed once: `method_not_offered` is on the backend, handled in `Storefront.tsx:849` as a bare string, and missing from the frontend's own union.

**Tech Stack:** TypeScript (strict, `noEmit`), pnpm + Turborepo, Vitest, Hono, React 19.

## Global Constraints

- **No wire code is renamed.** `app.ts:1240` already pins the rule: *"`not_distance_priced` keeps its wire name — the storefront already branches on it, and renaming a refusal code is a separate, customer-visible change."* Every existing `tests/api` exact-body assertion must still pass untouched.
- **Nothing that the backend cannot emit goes in `@bitetime/shared`.** `network` is the browser's own code and stays frontend-side.
- **No copy in the shared package.** The backend renders no customer message; `t(en, zh)` lives in `SessionContext`.
- Every user-visible string is bilingual via `t(en, zh)`. Exactly **one** new string is introduced in this plan (`quota_exceeded`); every other message is moved verbatim from its current site.
- `@bitetime/shared` ships TypeScript source, no build step. A new file must be re-exported from `packages/shared/src/index.ts` or consumers cannot import it.
- Backend imports keep `.js` specifiers (`NodeNext`); frontend imports are extensionless (`bundler`).
- UI is verified by running the app (CLAUDE.md), not component tests. Only the pure modules get unit tests.
- Existing behaviour is preserved except for one deliberate change: the delivery quote stops collapsing 8 backend codes into 5 (`store.ts:705`).

---

## File Structure

- **Create** `packages/shared/src/refusal.ts` — the wire vocabulary: `OrderRefusal` (17 codes, documented), `REFUSAL_STATUS` (total), `ORDER_REFUSALS` (derived runtime list), and the same three for the quote family.
- **Create** `packages/shared/src/refusal.test.ts` — runtime guards the type cannot give: no duplicates, the drifted code is present, both lists non-empty.
- **Modify** `packages/shared/src/index.ts` — re-export the new module.
- **Modify** `apps/backend/src/orders.ts:14–73` — delete the local union, import the shared type, rewrite the twin comment.
- **Modify** `apps/backend/src/app.ts:1131` and the quote route's 8 status literals — read `REFUSAL_STATUS` / `QUOTE_REFUSAL_STATUS`.
- **Create** `apps/frontend/src/store/orderRefusal.ts` — `RefusalAction`, `orderRefusalPlan`, `quoteRefusalPlan`.
- **Create** `apps/frontend/src/store/orderRefusal.test.ts` — table-driven sweep plus the invariants.
- **Modify** `apps/frontend/src/store.ts:564–613` (delete the twin union, retype `OrderError`) and `676–709` (`DeliveryQuoteError` stops narrowing).
- **Modify** `apps/frontend/src/store/Storefront.tsx` — delete `VOUCHER_REFUSALS` (72–89), replace the `handleSubmit` chain (775–922) with `orderRefusalPlan` + one `applyActions`, replace `fetchQuote`'s inline ternary (153–176) with `quoteRefusalPlan`.
- **Modify** `CONTEXT.md` — add a *Refusal* section.

---

### Task 1: The shared refusal module

**Files:**
- Create: `packages/shared/src/refusal.ts`
- Create: `packages/shared/src/refusal.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `type OrderRefusal` — union of the 17 codes a `POST /api/orders` error response can carry.
  - `const REFUSAL_STATUS: Record<OrderRefusal, 400 | 404 | 409 | 500>` — total; no default.
  - `const ORDER_REFUSALS: readonly OrderRefusal[]` — derived from the map's keys, for table-driven tests.
  - `type QuoteRefusal` — union of the 8 codes `POST /api/shipping/quote` can carry.
  - `const QUOTE_REFUSAL_STATUS: Record<QuoteRefusal, 400 | 404 | 409 | 429>` and `const QUOTE_REFUSALS: readonly QuoteRefusal[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/refusal.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  ORDER_REFUSALS, REFUSAL_STATUS,
  QUOTE_REFUSALS, QUOTE_REFUSAL_STATUS,
} from './refusal.js'

describe('order refusals', () => {
  it('carries the code the hand-copied twin lost', () => {
    // The whole reason this module exists: `method_not_offered` was thrown by the backend,
    // handled in the storefront as a bare string, and absent from the frontend's own union.
    expect(ORDER_REFUSALS).toContain('method_not_offered')
  })

  it('lists every code exactly once', () => {
    expect(new Set(ORDER_REFUSALS).size).toBe(ORDER_REFUSALS.length)
  })

  it('gives every code a status', () => {
    for (const code of ORDER_REFUSALS) {
      expect(typeof REFUSAL_STATUS[code]).toBe('number')
    }
  })

  it('keeps the two statuses that are not 409', () => {
    expect(REFUSAL_STATUS.merchant_not_found).toBe(404)
    expect(REFUSAL_STATUS.invalid_body).toBe(400)
    expect(REFUSAL_STATUS.order_failed).toBe(500)
  })
})

describe('quote refusals', () => {
  it('lists all eight the quote endpoint can emit', () => {
    expect([...QUOTE_REFUSALS].sort()).toEqual([
      'invalid_body', 'lookup_failed', 'merchant_inactive', 'merchant_not_found',
      'not_distance_priced', 'out_of_range', 'quota_exceeded', 'rate_limited',
    ])
  })

  it('meters the two 429s', () => {
    expect(QUOTE_REFUSAL_STATUS.rate_limited).toBe(429)
    expect(QUOTE_REFUSAL_STATUS.quota_exceeded).toBe(429)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bitetime/shared test`

Expected: FAIL — `Failed to resolve import "./refusal.js"`.

- [ ] **Step 3: Write the module**

Create `packages/shared/src/refusal.ts`:

```ts
/**
 * The REFUSAL VOCABULARY: every code the backend can put in an error body on the two
 * customer-facing money paths — order intake (`POST /api/orders`) and the delivery quote
 * (`POST /api/shipping/quote`).
 *
 * It lives in `@bitetime/shared` for the reason `pricing.ts` does: it is a rule that must hold
 * identically on both sides of the wire. It used to be a hand-copied twin — `OrderErrorCode` in
 * `apps/backend/src/orders.ts` and again in `apps/frontend/src/store.ts` — kept in step by a
 * comment asking a human to remember. That failed: `method_not_offered` was added to the
 * backend, handled in `Storefront.tsx` as a bare string comparison, and never added to the
 * frontend's union, so the compiler could not see the gap.
 *
 * Adding a code now breaks BOTH builds until it is handled:
 *   * the backend fails on the missing `REFUSAL_STATUS` entry (the Record is TOTAL — no default);
 *   * the frontend fails on `orderRefusalPlan`'s exhaustiveness check.
 *
 * WHAT IS NOT HERE, DELIBERATELY: the customer's message and the recovery it triggers. The
 * backend renders neither, `t(en, zh)` lives in the browser's `SessionContext`, and two of the
 * messages depend on browser state (whether the shop offers pickup). They live in
 * `apps/frontend/src/store/orderRefusal.ts`.
 */

/** A refusal `POST /api/orders` can return. Thrown as `OrderError` inside the transaction, except where noted. */
export type OrderRefusal =
  /** No shop with that id. The only refusal here that is a 404. */
  | 'merchant_not_found'
  /** The shop exists but is not `active` — pending approval, or suspended. */
  | 'merchant_inactive'
  | 'voucher_not_found'
  | 'voucher_already_used'
  | 'voucher_fully_used'
  /**
   * A voucher's one-per-customer key is the verified JWT's email and nothing else. A guest has
   * no verified identity, so their claim is refused rather than keyed on something they can
   * vary at will.
   */
  | 'voucher_requires_account'
  /**
   * The backend priced the order differently from the quote the customer confirmed. NOTHING was
   * written — not even a counter slot. The response to this code alone also carries `now`, the
   * server's own clock, which is what lets a browser with a persistently unreachable `/api/time`
   * still recover (I-3, #69).
   */
  | 'price_changed'
  /** Something in the cart stopped being on sale mid-checkout. */
  | 'product_unavailable'
  /**
   * A `delivery` that declared no state. Refused, never priced: with no state `shippingFee`
   * falls through to 0 and the shop would ship to Sabah for free.
   */
  | 'delivery_state_required'
  /** The chosen date is outside the shop's fulfilment window — reachable honestly by a checkout left open past midnight. */
  | 'fulfil_date_unavailable'
  /** No date on an order that needs one. */
  | 'fulfil_date_required'
  /**
   * A distance-priced shop was handed a delivery with no destination place id. The same rule as
   * `delivery_state_required` one policy over: an unresolvable destination is REFUSED, never
   * priced — with no distance, `shippingFee` would fall through to 0 and the shop would drive
   * 40 km for free.
   */
  | 'delivery_place_required'
  /**
   * Beyond the shop's `max_km`, OR no road route exists. ONE code, because to the customer they
   * are the same fact: this shop does not deliver there. Only `distance_lookup_failed` is worth
   * retrying.
   */
  | 'delivery_out_of_range'
  /**
   * The shop does not offer the method this order names. Checked in the transaction because the
   * flags live on the shop's row, which only the backend reads — the storefront renders no
   * button for a disabled method, so an honest checkout never sees this.
   *
   * THIS IS THE CODE THE HAND-COPIED TWIN LOST. It is the reason this module exists.
   */
  | 'method_not_offered'
  /**
   * The routing lookup itself did not happen, and the ONLY distance failure that is retryable
   * at all — but "retryable" covers two causes that recover on very different clocks, and the
   * wire code does not distinguish them:
   *
   *   * a provider outage — retryable within seconds, the ordinary case;
   *   * the shop's daily Google-spend ceiling — does NOT clear for up to 24 hours. A customer
   *     who retries this one moments later meets the same refusal.
   *
   * One code for both anyway: the customer's only available action is "try again later" either
   * way, and a fourth wire code would cost a distinction they cannot act on differently. It is
   * also why this code's copy must not promise "in a moment".
   *
   * ONE EXCEPTION: a distance-priced shop whose configuration cannot price (`!policy.usable`)
   * raises this code too, and no amount of retrying fixes a merchant's own incomplete setup.
   * The schema constraint `merchants_distance_requires_origin` is what makes that case rare;
   * the throw stays because a config that predates the constraint must not silently fall back
   * to a dormant region rate.
   */
  | 'distance_lookup_failed'
  /**
   * The ROUTE's own 400, not the transaction's — the body did not have the shape an order has,
   * almost always a cart past `MAX_CART_QTY` / `MAX_CART_LINES`. A permanent refusal: the same
   * cart is refused identically, so the copy must say what would change it.
   */
  | 'invalid_body'
  /** A server fault with no domain reason. The 500 catch-all; never thrown as an `OrderError`. */
  | 'order_failed'

/**
 * The HTTP status each refusal carries, and the reason a new code cannot be added quietly: this
 * Record is TOTAL and has no default, so `tsc` refuses a union member with no entry here. The
 * backend indexes it in `app.ts`'s `OrderError` handler.
 *
 * `invalid_body` and `order_failed` are listed because they are on the wire with those statuses,
 * even though the route emits them from their own paths rather than through the handler.
 */
export const REFUSAL_STATUS: Record<OrderRefusal, 400 | 404 | 409 | 500> = {
  merchant_not_found: 404,
  merchant_inactive: 409,
  voucher_not_found: 409,
  voucher_already_used: 409,
  voucher_fully_used: 409,
  voucher_requires_account: 409,
  price_changed: 409,
  product_unavailable: 409,
  delivery_state_required: 409,
  fulfil_date_unavailable: 409,
  fulfil_date_required: 409,
  delivery_place_required: 409,
  delivery_out_of_range: 409,
  method_not_offered: 409,
  distance_lookup_failed: 409,
  invalid_body: 400,
  order_failed: 500,
}

/**
 * Every order refusal, at runtime. Derived from the status map's keys rather than written twice
 * — the map is total, so this list cannot fall behind the union.
 */
export const ORDER_REFUSALS = Object.keys(REFUSAL_STATUS) as readonly OrderRefusal[]

/** A refusal `POST /api/shipping/quote` can return. */
export type QuoteRefusal =
  /** No `merchantId` / `placeId` in the body. */
  | 'invalid_body'
  /** The per-IP sliding window. Cheap flood protection; clears in seconds. */
  | 'rate_limited'
  | 'merchant_not_found'
  | 'merchant_inactive'
  /** This shop does not price by distance, or its distance configuration cannot price. */
  | 'not_distance_priced'
  /**
   * The shop's daily ceiling on billable provider calls, charged only on a cache miss. Does NOT
   * clear for up to 24 hours — which is why it must not be shown as "try again".
   */
  | 'quota_exceeded'
  /** Beyond `max_km`, or no road route. One fact, one code — the quote path's twin of `delivery_out_of_range`. */
  | 'out_of_range'
  /** The routing lookup itself failed. The one code here worth retrying soon. */
  | 'lookup_failed'

/** Total, for the same reason `REFUSAL_STATUS` is. Read by the quote route. */
export const QUOTE_REFUSAL_STATUS: Record<QuoteRefusal, 400 | 404 | 409 | 429> = {
  invalid_body: 400,
  rate_limited: 429,
  merchant_not_found: 404,
  merchant_inactive: 409,
  not_distance_priced: 409,
  quota_exceeded: 429,
  out_of_range: 409,
  lookup_failed: 409,
}

/** Every quote refusal, at runtime. Derived from the map's keys, as above. */
export const QUOTE_REFUSALS = Object.keys(QUOTE_REFUSAL_STATUS) as readonly QuoteRefusal[]
```

- [ ] **Step 4: Re-export from the package index**

In `packages/shared/src/index.ts`, append after the `fulfilment.js` exports:

```ts
export { REFUSAL_STATUS, ORDER_REFUSALS, QUOTE_REFUSAL_STATUS, QUOTE_REFUSALS } from './refusal.js'
export type { OrderRefusal, QuoteRefusal } from './refusal.js'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @bitetime/shared test`

Expected: PASS — 6 tests.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`

Expected: no errors. (Nothing consumes the module yet; this proves the total Records are satisfied.)

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/refusal.ts packages/shared/src/refusal.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): one refusal vocabulary for order intake and the delivery quote"
```

---

### Task 2: The backend reads the shared vocabulary

**Files:**
- Modify: `apps/backend/src/orders.ts:14–73`
- Modify: `apps/backend/src/app.ts:1131` and the `/api/shipping/quote` handler at `1217–1277`

**Interfaces:**
- Consumes: `OrderRefusal`, `REFUSAL_STATUS`, `QUOTE_REFUSAL_STATUS` from Task 1.
- Produces: `OrderError.code` is typed `OrderRefusal`. `OrderErrorCode` is **removed** from `orders.ts`; anything importing it must import `OrderRefusal` from `@bitetime/shared` instead.

- [ ] **Step 1: Delete the local union in `orders.ts`**

Replace the whole block at `apps/backend/src/orders.ts:14–73` (the doc comment starting "DELIBERATE TWIN", the `export type OrderErrorCode = …` union and all its per-code doc comments) with:

```ts
/**
 * The codes this module refuses with. They used to be declared here and hand-copied into the
 * frontend, which drifted — see `packages/shared/src/refusal.ts`, which now owns the vocabulary,
 * each code's meaning, and the HTTP status it carries. Adding a code there fails this build
 * until `REFUSAL_STATUS` names its status, and fails the frontend's until the storefront gives
 * it copy.
 */
export type OrderErrorCode = OrderRefusal
```

and add to the imports at the top of the file (alongside the existing `@bitetime/shared` import):

```ts
import type { OrderRefusal } from '@bitetime/shared'
```

> The alias is kept so the ~30 `throw new OrderError('…')` sites and `tests/api/orders.test.ts`'s imports do not churn in this task. It is one line and it points at the real home.

- [ ] **Step 2: Run the backend unit tests to verify nothing moved**

Run: `pnpm --filter @bitetime/backend test`

Expected: PASS — the pure suites do not touch these types, so this proves the alias compiles under Vitest's own transform.

- [ ] **Step 3: Read the status from the shared map**

In `apps/backend/src/app.ts`, replace line 1131:

```ts
      return c.json(body, err.code === 'merchant_not_found' ? 404 : 409)
```

with:

```ts
      // The status is a property of the code, and it lives with the code (`REFUSAL_STATUS` is a
      // TOTAL Record, so a new refusal cannot reach here without someone deciding its status).
      return c.json(body, REFUSAL_STATUS[err.code])
```

In the `/api/shipping/quote` handler (`app.ts:1217–1277`), replace each literal status with its entry — the codes are unchanged, only the numbers move:

```ts
    return c.json({ error: 'invalid_body' }, QUOTE_REFUSAL_STATUS.invalid_body)
  }

  if (!quoteIpWindow.allow(ipOf(c))) return c.json({ error: 'rate_limited' }, QUOTE_REFUSAL_STATUS.rate_limited)
```

```ts
  if (!merchant) return c.json({ error: 'merchant_not_found' }, QUOTE_REFUSAL_STATUS.merchant_not_found)
  if (merchant.status !== 'active') return c.json({ error: 'merchant_inactive' }, QUOTE_REFUSAL_STATUS.merchant_inactive)
```

```ts
  if (!policy.enabled || !policy.usable) return c.json({ error: 'not_distance_priced' }, QUOTE_REFUSAL_STATUS.not_distance_priced)
```

```ts
  if (cached === null && !quoteMerchantWindow.allow(merchant.id)) {
    return c.json({ error: 'quota_exceeded' }, QUOTE_REFUSAL_STATUS.quota_exceeded)
  }
```

```ts
  if (outcome.status === 'no_route') return c.json({ error: 'out_of_range' }, QUOTE_REFUSAL_STATUS.out_of_range)
  if (outcome.status === 'failed') return c.json({ error: 'lookup_failed' }, QUOTE_REFUSAL_STATUS.lookup_failed)
```

```ts
  if (exceedsMaxKm(policy, km)) return c.json({ error: 'out_of_range' }, QUOTE_REFUSAL_STATUS.out_of_range)
```

Add the import to `app.ts`'s existing `@bitetime/shared` import list:

```ts
import { REFUSAL_STATUS, QUOTE_REFUSAL_STATUS } from '@bitetime/shared'
```

- [ ] **Step 4: Typecheck and run the unit tests**

Run: `pnpm typecheck && pnpm --filter @bitetime/backend test`

Expected: no type errors; unit suites PASS.

- [ ] **Step 5: Run the DB-backed API suites**

Requires a running local Supabase (`cd apps/backend && supabase start`).

Run: `pnpm --filter @bitetime/backend test:db`

Expected: PASS with **no test edited**. `orders.test.ts` and `shippingQuote.test.ts` assert exact bodies and statuses; they are the proof this task changed no wire behaviour. If any status assertion fails, the map is wrong — fix the map, never the test.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/orders.ts apps/backend/src/app.ts
git commit -m "refactor(backend): refusal codes and their statuses come from @bitetime/shared"
```

---

### Task 3: `orderRefusalPlan` — the storefront's refusal decisions, extracted

**Files:**
- Create: `apps/frontend/src/store/orderRefusal.ts`
- Create: `apps/frontend/src/store/orderRefusal.test.ts`

**Interfaces:**
- Consumes: `OrderRefusal`, `ORDER_REFUSALS`, `MAX_CART_QTY`, `MAX_CART_LINES` from `@bitetime/shared`.
- Produces:
  - `type Translate = (en: string, zh: string) => string`
  - `type RefusalAction = 'drop_voucher' | 'refresh_sources' | 'clear_quote' | 'requote' | 'clear_date'`
  - `interface RefusalPlan { message: string; actions: readonly RefusalAction[] }`
  - `interface OrderRefusalCtx { t: Translate; pickupEscape: boolean; canRequote: boolean }`
  - `type OrderRefusalCode = OrderRefusal | 'network'`
  - `function orderRefusalPlan(code: OrderRefusalCode | undefined, ctx: OrderRefusalCtx): RefusalPlan`

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/store/orderRefusal.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ORDER_REFUSALS } from '@bitetime/shared'
import { orderRefusalPlan, type OrderRefusalCtx } from './orderRefusal'

const t = (en: string) => en
const ctx = (over: Partial<OrderRefusalCtx> = {}): OrderRefusalCtx =>
  ({ t, pickupEscape: false, canRequote: false, ...over })

const GENERIC = 'Failed to place order. Please try again.'

describe('orderRefusalPlan', () => {
  it.each([...ORDER_REFUSALS, 'network' as const])('%s has copy of its own', (code) => {
    // `order_failed` is the one code that legitimately wears the generic sentence: it is a
    // server fault with no reason to give. Everything else knows why it refused and must say so.
    const { message } = orderRefusalPlan(code, ctx())
    if (code === 'order_failed') expect(message).toBe(GENERIC)
    else expect(message).not.toBe(GENERIC)
  })

  it('falls back rather than showing a stale client a raw code', () => {
    // A deployed browser is always older than the server. An unknown code must read as a
    // sentence, never as `some_new_code` on the checkout screen.
    expect(orderRefusalPlan('some_new_code' as never, ctx()).message).toBe(GENERIC)
    expect(orderRefusalPlan(undefined, ctx()).message).toBe(GENERIC)
  })

  it('adopts the clock before it re-quotes', () => {
    // Load-bearing ORDER, not a list. `refresh_sources` carries the server clock out of the
    // refusal body; re-quoting first would re-quote against the skewed offset and be refused
    // again — the permanent refusal loop of I-3, #69.
    const { actions } = orderRefusalPlan('price_changed', ctx({ canRequote: true }))
    expect(actions).toEqual(['refresh_sources', 'clear_quote', 'requote'])
  })

  it('does not re-quote an order that has nothing to re-quote', () => {
    const { actions } = orderRefusalPlan('price_changed', ctx({ canRequote: false }))
    expect(actions).toEqual(['refresh_sources', 'clear_quote'])
  })

  it('drops the voucher on every voucher refusal', () => {
    for (const code of ['voucher_not_found', 'voucher_already_used', 'voucher_fully_used', 'voucher_requires_account'] as const) {
      expect(orderRefusalPlan(code, ctx()).actions).toEqual(['drop_voucher'])
    }
  })

  it('refetches the menu when something in the cart went away', () => {
    expect(orderRefusalPlan('product_unavailable', ctx()).actions).toEqual(['refresh_sources'])
  })

  it('clears the date so the stale one leaves the grid', () => {
    expect(orderRefusalPlan('fulfil_date_unavailable', ctx()).actions).toEqual(['clear_date'])
    expect(orderRefusalPlan('fulfil_date_required', ctx()).actions).toEqual(['clear_date'])
  })

  it('offers pickup only when the shop offers pickup', () => {
    // Pointing at a button that is not on screen is worse than no suggestion at all.
    for (const code of ['delivery_out_of_range', 'distance_lookup_failed'] as const) {
      expect(orderRefusalPlan(code, ctx({ pickupEscape: true })).message).toContain('pickup')
      expect(orderRefusalPlan(code, ctx({ pickupEscape: false })).message).not.toContain('pickup')
    }
  })

  it('never promises a retry for the distance lookup', () => {
    // The same code is thrown by a shop whose daily Google ceiling is spent, and that does not
    // clear for up to 24 hours — "in a moment" is a lie for that shop.
    expect(orderRefusalPlan('distance_lookup_failed', ctx()).message).not.toContain('moment')
  })

  it('names the caps the customer has to get under', () => {
    const { message } = orderRefusalPlan('invalid_body', ctx())
    expect(message).toContain('1000')
    expect(message).toContain('100')
  })

  it('asks for nothing back when the shop is closed', () => {
    expect(orderRefusalPlan('merchant_inactive', ctx()).actions).toEqual([])
    expect(orderRefusalPlan('merchant_not_found', ctx()).actions).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bitetime/frontend test -- orderRefusal`

Expected: FAIL — `Failed to resolve import "./orderRefusal"`.

- [ ] **Step 3: Write the module**

Create `apps/frontend/src/store/orderRefusal.ts`:

```ts
import { MAX_CART_QTY, MAX_CART_LINES, type OrderRefusal } from '@bitetime/shared'

/**
 * What a refusal SAYS and what it DOES to the checkout, as data.
 *
 * The vocabulary itself lives in `@bitetime/shared` (`refusal.ts`) because both sides of the
 * wire must agree on it. Copy and recovery live here because the backend renders neither, and
 * because two of the messages depend on browser state the backend cannot know.
 *
 * This used to be a 13-branch `if/else` chain inside `Storefront.tsx`'s `handleSubmit` catch
 * block — a closure over component state, so the mapping from "the server refused" to "this is
 * what the customer is told and this is what we do about it" could only be exercised by mounting
 * the storefront and driving a checkout. It is the highest-stakes decision in the flow: it
 * decides whether a customer can get their order placed at all after a refusal.
 */

export type Translate = (en: string, zh: string) => string

/**
 * A recovery step, named rather than performed. The component owns the state these act on; this
 * module only decides WHICH of them run and IN WHAT ORDER — and the order is load-bearing, so
 * it is data a test can assert rather than statement order in a catch block.
 */
export type RefusalAction =
  /** The server refused the voucher, so the discount is gone; drop it before the retry. */
  | 'drop_voucher'
  /** Re-read the menu, the voucher and the clock — and adopt the server clock the refusal carried. */
  | 'refresh_sources'
  /** Throw away the distance quote; it may be what moved. */
  | 'clear_quote'
  /** Ask for the distance again. MUST come after `refresh_sources`. */
  | 'requote'
  /** Clear the chosen fulfilment date so the stale one leaves the grid. */
  | 'clear_date'

export interface RefusalPlan {
  readonly message: string
  /** Ordered. Run them in sequence — `refresh_sources` before `requote` is not a preference. */
  readonly actions: readonly RefusalAction[]
}

export interface OrderRefusalCtx {
  readonly t: Translate
  /** The shop offers pickup, so a delivery refusal may point at it. */
  readonly pickupEscape: boolean
  /** This order is distance-priced and holds a place id, so a re-quote is possible. */
  readonly canRequote: boolean
}

/** Everything the checkout's catch block can see: the wire codes plus the browser's own. */
export type OrderRefusalCode = OrderRefusal | 'network'

const generic = (t: Translate): RefusalPlan => ({
  message: t('Failed to place order. Please try again.', '下单失败，请重试。'),
  actions: [],
})

/**
 * Every voucher refusal means the order rolled back and NOTHING was written, so each message
 * ends by asking for the order again without the voucher. Saying "failed, try again" while
 * silently keeping a voucher the server has already refused would fail them again, forever.
 */
const dropVoucher = (message: string): RefusalPlan => ({ message, actions: ['drop_voucher'] })

export function orderRefusalPlan(code: OrderRefusalCode | undefined, ctx: OrderRefusalCtx): RefusalPlan {
  const { t, pickupEscape, canRequote } = ctx
  switch (code) {
    case 'voucher_not_found':
      return dropVoucher(t('That voucher is no longer valid. Please place the order without it.', '该优惠券已失效，请不使用优惠券重新下单。'))
    case 'voucher_already_used':
      return dropVoucher(t('You have already used this voucher. Please place the order without it.', '你已使用过此优惠券，请不使用优惠券重新下单。'))
    case 'voucher_fully_used':
      return dropVoucher(t('This voucher has been fully claimed. Please place the order without it.', '此优惠券已被领完，请不使用优惠券重新下单。'))
    case 'voucher_requires_account':
      return dropVoucher(t('Please sign in to use a voucher, then place the order again.', '使用优惠券需先登录，登录后请重新下单。'))

    case 'merchant_inactive':
    case 'merchant_not_found':
      return { message: t('This shop is not taking orders right now.', '本店目前暂不接单。'), actions: [] }

    case 'price_changed':
      // The shop's prices moved mid-checkout. NOTHING was written. Show the new numbers and let
      // the customer decide — charging the new total silently would bill a number they never
      // agreed to, and honouring the stale one would let an old quote buy a withdrawn discount.
      //
      // The VOUCHER is re-read alongside the products, and has to be: an edited `vouchers.amount`
      // moves the total exactly as an edited price does, and re-quoting from the stale voucher
      // would be refused again on the very next tap.
      //
      // The DISTANCE can be part of what moved (a merchant editing the rate prices exactly like
      // an edited product), so the stale quote is dropped and asked for again. The re-quote is
      // explicit rather than left to the auto-quote effect, which cannot re-fire: it is guarded
      // on a ref already stamped with this place id, so without it the customer is left holding
      // a disabled button and an instruction they have no way to act on (#101 review).
      return {
        message: t(
          'Prices at this shop just changed. Please review your order and place it again.',
          '本店价格刚刚有所调整，请确认订单后重新下单。',
        ),
        actions: canRequote ? ['refresh_sources', 'clear_quote', 'requote'] : ['refresh_sources', 'clear_quote'],
      }

    case 'product_unavailable':
      // Refetching is what RECOVERS the checkout, not just what refreshes the menu: adopting the
      // new menu drops the cart ids that are gone. Without it the invisible id stayed in the
      // cart and every retry was refused identically.
      return {
        message: t(
          'Something in your cart is no longer available. It has been removed — please review your order and place it again.',
          '购物车中有商品已下架，已为你移除，请确认订单后重新下单。',
        ),
        actions: ['refresh_sources'],
      }

    case 'delivery_state_required':
      // Unreachable from the form — the submit gate will not let a stateless delivery through —
      // and messaged anyway, because that gate is the ONLY thing making it so.
      return { message: t('Please choose the state you are delivering to.', '请选择送货的州属。'), actions: [] }

    case 'method_not_offered':
      // Fires if the merchant switches a method off while someone is mid-checkout.
      return { message: t('This shop no longer offers that option. Please choose another.', '本店已不再提供该方式，请另选一种。'), actions: [] }

    case 'delivery_out_of_range':
      return {
        message: pickupEscape
          ? t('Sorry, this shop does not deliver to that address. Please choose pickup instead.', '抱歉，本店不配送到该地址，请改选自取。')
          : t('Sorry, this shop does not deliver to that address.', '抱歉，本店不配送到该地址。'),
        actions: [],
      }

    case 'distance_lookup_failed':
      // Deliberately does NOT promise "in a moment": this code is also what a QUOTA-exhausted
      // shop throws, and quota does not clear for up to 24 hours.
      return {
        message: pickupEscape
          ? t('We could not work out the delivery fee just now. Please try again, or choose pickup.', '暂时无法计算运费，请重试或选择自取。')
          : t('We could not work out the delivery fee just now. Please try again.', '暂时无法计算运费，请重试。'),
        actions: [],
      }

    case 'delivery_place_required':
      return { message: t('Please pick your delivery address from the suggestions.', '请从建议列表中选择您的配送地址。'), actions: [] }

    case 'fulfil_date_unavailable':
    case 'fulfil_date_required':
      // Clearing the selection is what recovers it: the re-render drops the stale date from the grid.
      return { message: t('Please choose a date for your order.', '请选择订单日期。'), actions: ['clear_date'] }

    case 'invalid_body':
      // A permanent refusal — the same cart is refused identically — so say what would change it.
      return {
        message: t(
          `Your order is too large. Please order at most ${MAX_CART_QTY} of any one item, and at most ${MAX_CART_LINES} different items.`,
          `订单过大。每种商品最多 ${MAX_CART_QTY} 件，每单最多 ${MAX_CART_LINES} 种不同商品。`,
        ),
        actions: [],
      }

    case 'network':
      // The request never landed, so no order exists and retrying is safe to suggest.
      return { message: t('Could not reach the shop. Check your connection and try again.', '无法连接店铺，请检查网络后重试。'), actions: [] }

    case 'order_failed':
      // A server fault with no reason to give. The one code that honestly wears the generic line.
      return generic(t)

    default: {
      // A NEW code in `@bitetime/shared` fails this build here, which is the point. The runtime
      // fallback below is for the other direction: a deployed browser is always older than the
      // server, and a stale client must read a sentence, never a raw wire code.
      const _exhaustive: never = code as never
      void _exhaustive
      return generic(t)
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bitetime/frontend test -- orderRefusal`

Expected: PASS — 11 test cases (the `it.each` sweep counts 18).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/store/orderRefusal.ts apps/frontend/src/store/orderRefusal.test.ts
git commit -m "feat(storefront): order refusals become a pure plan of copy plus ordered actions"
```

---

### Task 4: `quoteRefusalPlan` — the delivery quote stops collapsing codes

**Files:**
- Modify: `apps/frontend/src/store/orderRefusal.ts`
- Modify: `apps/frontend/src/store/orderRefusal.test.ts`

**Interfaces:**
- Consumes: `QuoteRefusal`, `QUOTE_REFUSALS` from `@bitetime/shared`.
- Produces:
  - `interface QuoteRefusalCtx { t: Translate; pickupEscape: boolean }`
  - `type QuoteRefusalCode = QuoteRefusal | 'network'`
  - `function quoteRefusalPlan(code: QuoteRefusalCode | undefined, ctx: QuoteRefusalCtx): string` — a message only; the quote path has no recovery to run, so it returns no action list.

- [ ] **Step 1: Write the failing tests**

Widen the two existing imports at the **top** of `apps/frontend/src/store/orderRefusal.test.ts` — import declarations must stay at the head of the file:

```ts
import { ORDER_REFUSALS, QUOTE_REFUSALS } from '@bitetime/shared'
import { orderRefusalPlan, quoteRefusalPlan, type OrderRefusalCtx, type QuoteRefusalCtx } from './orderRefusal'
```

Then append at the end of the file:

```ts
const qctx = (over: Partial<QuoteRefusalCtx> = {}): QuoteRefusalCtx =>
  ({ t, pickupEscape: false, ...over })

const QUOTE_GENERIC = 'We could not work out the delivery fee just now. Please try again.'

describe('quoteRefusalPlan', () => {
  it.each([...QUOTE_REFUSALS, 'network' as const])('%s has a message', (code) => {
    expect(quoteRefusalPlan(code, qctx()).length).toBeGreaterThan(0)
  })

  it('stops telling a quota-exhausted shop to try again', () => {
    // The collapse this replaces mapped `quota_exceeded` onto `lookup_failed`'s copy, which says
    // "try again" — for a ceiling that does not clear for up to 24 hours.
    const msg = quoteRefusalPlan('quota_exceeded', qctx())
    expect(msg).not.toBe(QUOTE_GENERIC)
    expect(msg).not.toContain('try again')
  })

  it('says a closed shop is closed instead of blaming the lookup', () => {
    for (const code of ['merchant_inactive', 'merchant_not_found'] as const) {
      expect(quoteRefusalPlan(code, qctx())).toBe('This shop is not taking orders right now.')
    }
  })

  it('keeps out-of-range as one message for both facts', () => {
    expect(quoteRefusalPlan('out_of_range', qctx())).toContain('does not deliver')
  })

  it('offers pickup only when the shop offers pickup', () => {
    expect(quoteRefusalPlan('lookup_failed', qctx({ pickupEscape: true }))).toContain('pickup')
    expect(quoteRefusalPlan('lookup_failed', qctx({ pickupEscape: false }))).not.toContain('pickup')
  })

  it('falls back for a stale client', () => {
    expect(quoteRefusalPlan('some_new_code' as never, qctx())).toBe(QUOTE_GENERIC)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bitetime/frontend test -- orderRefusal`

Expected: FAIL — `quoteRefusalPlan is not a function`.

- [ ] **Step 3: Extend the module**

Add to `apps/frontend/src/store/orderRefusal.ts` (import `type QuoteRefusal` alongside `OrderRefusal`):

```ts
export interface QuoteRefusalCtx {
  readonly t: Translate
  readonly pickupEscape: boolean
}

/** Everything the quote's catch block can see: the wire codes plus the browser's own. */
export type QuoteRefusalCode = QuoteRefusal | 'network'

/**
 * Why a delivery could not be quoted, in the customer's words.
 *
 * A MESSAGE ONLY, no action list: the quote path has nothing to recover — it shows the reason
 * beside the address field and waits for the customer to change something.
 *
 * This used to receive a NARROWED code. `quoteDelivery` collapsed the endpoint's eight refusals
 * into five, folding `merchant_not_found`, `merchant_inactive` and `quota_exceeded` into
 * `lookup_failed` — so a closed shop and a shop whose daily Google ceiling is spent both told
 * the customer to try again. The ceiling does not clear for up to 24 hours, and the order path
 * has always refused to make that promise (see `distance_lookup_failed`). The quote path now
 * agrees with it.
 */
export function quoteRefusalPlan(code: QuoteRefusalCode | undefined, ctx: QuoteRefusalCtx): string {
  const { t, pickupEscape } = ctx
  const lookupFailed = pickupEscape
    ? t('We could not work out the delivery fee just now. Please try again, or choose pickup.', '暂时无法计算运费，请重试或选择自取。')
    : t('We could not work out the delivery fee just now. Please try again.', '暂时无法计算运费，请重试。')

  switch (code) {
    case 'out_of_range':
      // Beyond max_km and no-road-route are ONE message because they are one fact.
      return pickupEscape
        ? t('Sorry, this shop does not deliver to that address. You can still choose pickup.', '抱歉，本店不配送到该地址。您仍可选择自取。')
        : t('Sorry, this shop does not deliver to that address.', '抱歉，本店不配送到该地址。')

    case 'rate_limited':
      return t('Too many address lookups just now. Please wait a moment and try again.', '地址查询过于频繁，请稍候再试。')

    case 'quota_exceeded':
      // The one new string this change introduces. It must not say "try again": the shop's daily
      // ceiling on billable lookups does not clear for up to 24 hours, so a retry meets the same
      // refusal. The honest advice is a different method or a different day.
      return pickupEscape
        ? t('This shop cannot quote delivery for the rest of today. Please choose pickup, or try again tomorrow.', '本店今日已无法计算运费，请改选自取或明日再试。')
        : t('This shop cannot quote delivery for the rest of today. Please try again tomorrow.', '本店今日已无法计算运费，请明日再试。')

    case 'merchant_inactive':
    case 'merchant_not_found':
      // The same sentence the order path uses for these two codes — one fact, one wording.
      return t('This shop is not taking orders right now.', '本店目前暂不接单。')

    case 'not_distance_priced':
    case 'lookup_failed':
      return lookupFailed

    case 'network':
      return t('Could not reach the shop. Check your connection and try again.', '无法连接店铺，请检查网络后重试。')

    case 'invalid_body':
      return lookupFailed

    default: {
      const _exhaustive: never = code as never
      void _exhaustive
      return lookupFailed
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bitetime/frontend test -- orderRefusal`

Expected: PASS — both describes green.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/store/orderRefusal.ts apps/frontend/src/store/orderRefusal.test.ts
git commit -m "feat(storefront): quote refusals keep all eight codes, quota stops promising a retry"
```

---

### Task 5: `store.ts` drops the twin union and the narrowing

**Files:**
- Modify: `apps/frontend/src/store.ts:562–613` (the twin union and `OrderError`)
- Modify: `apps/frontend/src/store.ts:676–709` (`DeliveryQuoteError` and `quoteDelivery`)
- Test: `apps/frontend/src/store.test.ts`

**Interfaces:**
- Consumes: `OrderRefusal`, `QuoteRefusal` from `@bitetime/shared`.
- Produces: `OrderError.code: OrderRefusal | 'network'`; `DeliveryQuoteError.code: QuoteRefusal | 'network'`. `OrderErrorCode` is no longer exported from `store.ts` — the type is `OrderRefusal`.

- [ ] **Step 1: Write the failing test**

Append to `apps/frontend/src/store.test.ts` (inside the existing top-level `describe` structure, or as a new `describe` at the end of the file):

```ts
describe('quoteDelivery', () => {
  const quoteResponse = (status: number, body: unknown) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) as never,
    )

  afterEach(() => { vi.restoreAllMocks() })

  it('passes a quota refusal through instead of calling it a lookup failure', async () => {
    // The narrowing this replaces mapped `quota_exceeded` onto `lookup_failed`, and the customer
    // was told to try again for a ceiling that does not clear for up to 24 hours.
    quoteResponse(429, { error: 'quota_exceeded' })
    await expect(quoteDelivery('m1', 'place-1')).rejects.toMatchObject({ code: 'quota_exceeded' })
  })

  it('passes a closed shop through as a closed shop', async () => {
    quoteResponse(409, { error: 'merchant_inactive' })
    await expect(quoteDelivery('m1', 'place-1')).rejects.toMatchObject({ code: 'merchant_inactive' })
  })

  it('still reports an unrecognised body as a lookup failure', async () => {
    quoteResponse(500, {})
    await expect(quoteDelivery('m1', 'place-1')).rejects.toMatchObject({ code: 'lookup_failed' })
  })
})
```

Add `quoteDelivery` to the file's existing import from `./store`, and `afterEach` / `vi` to its `vitest` import if not already present.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bitetime/frontend test -- store.test`

Expected: FAIL — the first two cases receive `code: 'lookup_failed'`.

- [ ] **Step 3: Retype `OrderError`**

In `apps/frontend/src/store.ts`, replace the doc comment and union at lines 562–585 (from `* A DELIBERATE TWIN of …` through `| 'distance_lookup_failed'`) with nothing, and replace the `OrderError` class declaration's constructor signature so the block reads:

```ts
/**
 * A refusal the customer can act on, as opposed to a bug.
 *
 * The codes come from `@bitetime/shared` (`refusal.ts`) — they used to be declared here as a
 * hand-copied twin of the backend's union, and they drifted. `network` is the browser's own and
 * has no backend twin: a fetch that never landed.
 *
 * The copy and the recovery for each code live in `store/orderRefusal.ts`.
 */
export class OrderError extends Error {
  constructor(
    readonly code: OrderRefusal | 'network',
    /**
     * The server's own clock, present only on `price_changed` (`app.ts`'s OrderError handler).
     * This is what lets `price_changed` recovery fix a persistently-unreachable `/api/time`
     * (I-3, #69): the refusal that proves the connection works also states the time, so
     * `serverClock.ts`'s `adopt()` can correct the offset without a second request that could
     * fail the same way. See serverClock.ts for the failure this closes.
     */
    readonly now?: string,
  ) {
    super(code)
    this.name = 'OrderError'
  }
}
```

Add to the file's imports:

```ts
import type { OrderRefusal, QuoteRefusal } from '@bitetime/shared'
```

`placeOrder`'s throw sites need no change: `throw new OrderError('network')` and `throw new OrderError(payload?.error ?? 'order_failed', …)` both still typecheck, the second because `payload?.error` is `any` off an untyped JSON body.

- [ ] **Step 4: Stop narrowing the quote refusal**

Replace `DeliveryQuoteError` (lines 676–685) and `quoteDelivery`'s catch block (the `throw new DeliveryQuoteError(...)` at 703–706) with:

```ts
/**
 * Why a delivery could not be quoted. Every code the endpoint can return survives to the caller:
 * this used to narrow eight into five, folding `merchant_not_found`, `merchant_inactive` and
 * `quota_exceeded` into `lookup_failed` — so a closed shop and a shop out of daily lookup budget
 * both told the customer to try again. See `store/orderRefusal.ts` for what each one says now.
 */
export class DeliveryQuoteError extends Error {
  constructor(readonly code: QuoteRefusal | 'network') {
    super(code)
    this.name = 'DeliveryQuoteError'
  }
}
```

and, in `quoteDelivery`:

```ts
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    const code = payload.error
    // Recognised codes pass through untouched; anything else is a body we do not understand,
    // which is a lookup failure as far as the customer is concerned.
    throw new DeliveryQuoteError(
      code && (QUOTE_REFUSALS as readonly string[]).includes(code) ? (code as QuoteRefusal) : 'lookup_failed',
    )
  }
```

Add `QUOTE_REFUSALS` to the file's value import from `@bitetime/shared`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @bitetime/frontend test -- store.test`

Expected: PASS — all three new cases green, every existing case unchanged.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`

Expected: **one expected failure** — `Storefront.tsx` still references `VOUCHER_REFUSALS` keyed by the old type and compares `code` against string literals. Task 6 fixes it. If any *other* file errors, a consumer of `OrderErrorCode` was missed; fix it before continuing.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/store.ts apps/frontend/src/store.test.ts
git commit -m "refactor(storefront): error types come from @bitetime/shared; quote codes stop collapsing"
```

---

### Task 6: The storefront consumes the plan

**Files:**
- Modify: `apps/frontend/src/store/Storefront.tsx` — delete 72–89, rewrite 148–176 and 774–922.

**Interfaces:**
- Consumes: `orderRefusalPlan`, `quoteRefusalPlan`, `RefusalAction` from `./orderRefusal`; `DeliveryQuoteError`, `OrderError` from `../store`.
- Produces: nothing new. `applyActions` is local to the component.

- [ ] **Step 1: Delete `VOUCHER_REFUSALS`**

Remove lines 72–89 of `apps/frontend/src/store/Storefront.tsx` entirely — the doc comment and the whole `const VOUCHER_REFUSALS = { … } as const` object. Its four messages now live in `orderRefusalPlan`.

- [ ] **Step 2: Add the imports**

```ts
import { orderRefusalPlan, quoteRefusalPlan, type RefusalAction } from './orderRefusal'
```

- [ ] **Step 3: Replace `fetchQuote`'s inline ternary**

In `fetchQuote`'s catch block (lines 148–176), replace everything from `const code = err instanceof DeliveryQuoteError …` through the closing `})` of `setQuoteError({ … })` with:

```ts
      setQuote(null)
      setQuoteError({
        placeId,
        message: quoteRefusalPlan(
          err instanceof DeliveryQuoteError ? err.code : undefined,
          { t, pickupEscape },
        ),
      })
```

- [ ] **Step 4: Add `applyActions` beside `handleSubmit`**

Insert immediately above `handleSubmit` (around line 699):

```ts
  /**
   * Run a refusal's recovery, IN ORDER. The order is the module's decision, not this
   * function's — `refresh_sources` adopts the server clock the refusal carried, and re-quoting
   * before that would re-quote against the same skewed offset and be refused again (I-3, #69).
   *
   * `serverNow` is `price_changed`'s own `now` field; every other refusal passes undefined and
   * `refreshQuoteSources` falls back to re-syncing.
   */
  const applyActions = async (actions: readonly RefusalAction[], serverNow?: string) => {
    for (const action of actions) {
      if (action === 'drop_voucher') {
        setAppliedVoucher(null)
      } else if (action === 'refresh_sources') {
        await refreshQuoteSources(serverNow)
      } else if (action === 'clear_quote') {
        setQuote(null)
      } else if (action === 'requote') {
        // A re-quote moments after the original is a cache HIT, which consumes no ceiling.
        if (address.place_id) void fetchQuote(address.place_id)
      } else if (action === 'clear_date') {
        setFulfilDate(null)
      }
    }
  }
```

- [ ] **Step 5: Replace the 13-branch chain**

Replace the entire `catch (err: any) { … }` body of `handleSubmit` (lines 774–922, from the `// A refused order wrote NOTHING` comment down to the closing brace before `} finally {`) with:

```ts
    } catch (err: any) {
      // Which refusal this is, what the customer is told, and what we do about it are all one
      // decision, and it lives in `orderRefusal.ts` where it can be tested. This block only
      // performs it. A refused order wrote NOTHING — the transaction rolled back — which is why
      // several of the plans ask for the order again rather than reporting a failure.
      const plan = orderRefusalPlan(err?.code, {
        t,
        pickupEscape,
        // A re-quote is only possible for a distance-priced order that still holds a place id.
        canRequote: expressPriced && Boolean(address.place_id),
      })
      await applyActions(plan.actions, typeof err?.now === 'string' ? err.now : undefined)
      // The voucher's own strip echoes the refusal, so a customer who scrolls back up sees why
      // the discount went away.
      if (plan.actions.includes('drop_voucher')) setVoucherMsg(plan.message)
      setError(plan.message)
      toast.error(plan.message)
    } finally {
```

- [ ] **Step 6: Typecheck and run the whole suite**

Run: `pnpm typecheck && pnpm test`

Expected: no type errors; every workspace's tests PASS. The `Storefront.tsx` error from Task 5 Step 6 is now gone.

- [ ] **Step 7: Lint**

Run: `pnpm lint`

Expected: clean. If `DeliveryQuoteError` or `MAX_CART_QTY` is now unused in `Storefront.tsx`, remove it from the import list.

- [ ] **Step 8: Verify by running the app**

Per CLAUDE.md, UI is verified by running the app. Start local Supabase and the dev servers, then drive these four refusals in a storefront:

1. **`price_changed`** — put an item in the cart, edit that product's price in the merchant dashboard, then place the order. Expect the price-changed sentence, the summary showing the new total, and — on a distance-priced shop — the fee re-quoted rather than a dead Place Order button.
2. **A voucher refusal** — apply a voucher, delete it in the dashboard, place the order. Expect the voucher to be dropped, the message on the voucher strip *and* in the error, and a second attempt to succeed.
3. **`fulfil_date_unavailable`** — choose a date, close that day in Shop Settings, place the order. Expect the date to clear from the grid.
4. **`quota_exceeded` copy** (quote path) — hard to trigger honestly; instead confirm the ordinary `lookup_failed` path still reads "Please try again" by pointing the shop at an unroutable destination.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/store/Storefront.tsx
git commit -m "refactor(storefront): checkout refusals go through the refusal plan"
```

---

### Task 7: Name the concept in the domain glossary

**Files:**
- Modify: `CONTEXT.md`

**Interfaces:**
- Consumes: nothing. Documentation only.

- [ ] **Step 1: Add the section**

Insert a new section in `CONTEXT.md` immediately after *Order intake* (which ends with the `notifyOrder` sentence, around line 73):

```markdown
## Refusal

A reason the backend would not take an order or price a delivery, named by a **wire code** the
customer's browser can act on — as opposed to a bug, which carries no code and is never dressed
up as one. The vocabulary is `packages/shared/src/refusal.ts`: the codes, what each one means,
and the HTTP status it carries.

It is shared for the same reason `priceOrder` is — it must hold identically on both sides of the
wire — and it is shared because the hand-copied version **drifted**. `method_not_offered` was
added to the backend's union, handled in the storefront as a bare string comparison, and never
added to the frontend's own union, so nothing could see the gap. A code is now added in one
place and **breaks both builds** until it is handled: the backend's on `REFUSAL_STATUS` (a total
`Record`, no default), the frontend's on `orderRefusalPlan`'s exhaustiveness check.

**What a refusal says and does is not shared, deliberately.** The backend renders no message,
`t(en, zh)` is the browser's, and two messages depend on whether the shop offers pickup — a
refusal cannot point at a button that is not on screen. `orderRefusalPlan` (frontend) turns a
code into `{ message, actions }`, where `actions` is an **ordered** list:
`refresh_sources` → `clear_quote` → `requote` for `price_changed`, and the order is load-bearing.
`refresh_sources` adopts the server clock the refusal itself carried; re-quoting first would
re-quote against the same skewed offset and be refused again — the permanent refusal loop of
I-3, #69. Order as data is what lets a test hold that shut.

**The plan is exhaustive at build time and forgiving at run time.** A deployed browser is always
older than the server, so an unknown code falls back to a generic sentence — never the raw wire
code on the checkout screen, which is what used to happen before `invalid_body` had a branch.

**The quote path tells the same truth as the order path.** `quoteDelivery` used to narrow the
endpoint's eight codes to five, folding `merchant_not_found`, `merchant_inactive` and
`quota_exceeded` into `lookup_failed` — whose copy says *try again*. A shop's daily ceiling on
billable lookups does not clear for up to 24 hours, and the order path had always refused to
make that promise (see `distance_lookup_failed`). All eight now survive, and a closed shop reads
as a closed shop.
```

- [ ] **Step 2: Point the glossary's neighbours at it**

In *Order pricing*, the sentence "A disagreement is refused (`price_changed`)…" and in *Fulfilment methods* the "(`method_not_offered`)" mention both now have a home to point at. Append to the *Order intake* section:

> Every refusal on this path is named — see *Refusal* below.

- [ ] **Step 3: Commit**

```bash
git add CONTEXT.md
git commit -m "docs(domain): name the refusal vocabulary in the glossary"
```

---

## What this plan deliberately does not do

- **Does not touch the signup, billing or `requires_pro` refusal families.** They have the same shape (`SignupErrorCode` is its own hand-copied twin; the five billing codes have no frontend type at all), and they follow on this module once it has proven itself. Widening now would put a new design — the billing codes have never had a consumer type — inside a consolidation.
- **Does not rename a single wire code.** `out_of_range` and `delivery_out_of_range` stay two names for one fact, on two endpoints, because renaming is customer-visible and is its own change.
- **Does not add component tests.** The decisions moved out from behind the render so they never needed one.
