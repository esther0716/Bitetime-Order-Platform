# Remove the Basic Plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell one plan — Pro at RM39.90 a month — with the 7-day cardless trial on it, and delete the tier gate rather than leave it guarding a population of zero.

**Architecture:** Entitlement stops being `merchants.plan === 'pro'` and becomes `merchants.status === 'active'`, which the storefront gate and dashboard guard already enforce. The work is subtractive in eight passes — the downgrade route, the price map, the signup fork, the backend gate, the revocation machinery, the frontend gate, the plan-shaped UI, and the marketing copy — then a migration drops both columns, then the docs follow.

**Tech Stack:** pnpm + Turborepo. `@bitetime/frontend` (Vite + React 19 + React Router 7, TypeScript), `@bitetime/backend` (Hono + Stripe + Supabase, TypeScript), `@bitetime/shared` (TS source, no build). Vitest everywhere.

**Spec:** `docs/superpowers/specs/2026-08-11-remove-basic-plan-design.md`

## Global Constraints

- Every task ends green on `pnpm lint`, `pnpm typecheck` and `pnpm test` from the repo root. A task that leaves the monorepo un-typecheckable is not done.
- Backend DB-backed suites are `pnpm --filter @bitetime/backend test:db` and need a local Supabase (`supabase start` from `apps/backend`). Run them for any task that touches `apps/backend/src` routes.
- **Never run `pnpm --filter @bitetime/backend db:push`** or any `supabase` command that reaches production. Write the migration, apply it locally with `db:migrate`, and say that production still needs it.
- Backend relative imports keep their `.js` specifiers (`NodeNext`). Frontend imports are extensionless.
- Every user-facing string is `t(englishString, chineseString)`. There is no i18n library.
- **No price amount is hardcoded anywhere in the repo.** Amounts are read from Stripe at runtime through `/api/pricing`. `FALLBACK_PRICING` in `usePlatformPricing.ts` is the one exception and is a last-resort render value, not a quote.
- Marketing copy must be true of the product as shipped. `public/llms.txt` is the authoritative feature list; a claim added to a page is added there too.
- Commit after every task. Conventional Commits, and every commit message ends with the `Claude-Session:` trailer used by the rest of this branch.
- Do not touch: order pricing (`packages/shared/src/pricing.ts`), the order transaction, RLS policies, or anything in `apps/backend/tests/rls` beyond the `plan` seed field.

---

### Task 1: Delete the step-down-to-Basic route

Removes `POST /api/billing/downgrade`, the schedule helper that only it used, and the pending-tier UI. Cancel, undo-cancel and the portal are untouched.

**Files:**
- Modify: `apps/backend/src/app.ts` (the `/api/billing/downgrade` handler, ~line 1381–1439; the `subscriptionSchedule.js` import at line 21)
- Delete: `apps/backend/src/subscriptionSchedule.ts`
- Delete: `apps/backend/tests/unit/subscriptionSchedule.test.ts`
- Modify: `apps/backend/src/billing.ts` (the `pending_plan` clear inside `reconcileMerchantPlan`, ~line 80–86)
- Modify: `apps/frontend/src/merchant/subscriptionTabState.ts`
- Modify: `apps/frontend/src/merchant/subscriptionTabState.test.ts`
- Modify: `apps/frontend/src/merchant/SubscriptionTab.tsx`
- Modify: `apps/frontend/src/store.ts`, `apps/frontend/src/api.ts` (only if a `downgrade` caller lives there — grep first)

**Interfaces:**
- Produces: `subscriptionTabState(billing, plan, now)` keeps its signature this task; the `Actions` object loses `canDowngrade`, `pendingPlan` and `pendingAt`. Task 7 removes the `plan` parameter.

- [ ] **Step 1: Write the failing test**

In `apps/frontend/src/merchant/subscriptionTabState.test.ts`, replace the two tests that assert a pending downgrade (search for `pending_plan`) with one that proves the field is now ignored:

```ts
it('ignores a pending_plan left on the row by an older release', () => {
  const state = subscriptionTabState(
    {
      stripe_customer_id: 'cus_1',
      status: 'active',
      current_period_end: '2026-09-01T00:00:00Z',
      pending_plan: 'basic',
    } as never,
    'pro',
    new Date('2026-08-11T00:00:00Z'),
  )
  expect(state.kind).toBe('live')
  expect(state.canCancel).toBe(true)
  expect('canDowngrade' in state).toBe(false)
  expect('pendingPlan' in state).toBe(false)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @bitetime/frontend test subscriptionTabState`
Expected: FAIL — `canDowngrade` is still a key on the returned object.

- [ ] **Step 3: Strip the pending tier out of the state module**

In `apps/frontend/src/merchant/subscriptionTabState.ts`:
- Delete `pending_plan` from `SubscriptionSnapshot`.
- Delete `canDowngrade`, `pendingPlan` and `pendingAt` from `Actions` and from the `actions` object.
- Delete the `raw` / `pendingPlan` derivation (lines ~101–102).
- `canResume` becomes `live && ending` — a cancellation is the only wind-down left. Update its doc comment to say so.

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @bitetime/frontend test subscriptionTabState`
Expected: PASS.

- [ ] **Step 5: Remove the downgrade UI**

In `apps/frontend/src/merchant/SubscriptionTab.tsx`: delete the `state.pendingPlan === 'basic'` notice block (~line 524), the step-down button, its confirm dialog and its handler. Delete the `downgradeSubscription` (or equivalently named) caller from `apps/frontend/src/store.ts`. Grep `git grep -n "downgrade" -- apps/frontend/src` and leave no reference behind.

- [ ] **Step 6: Remove the backend route**

In `apps/backend/src/app.ts`: delete the whole `app.post('/api/billing/downgrade', …)` handler and the `subscriptionSchedule.js` import. In `apps/backend/src/billing.ts`, delete the `pending_plan` read-and-clear inside `reconcileMerchantPlan`. Delete `apps/backend/src/subscriptionSchedule.ts` and `apps/backend/tests/unit/subscriptionSchedule.test.ts`. Grep `git grep -n "pending_plan\|downgradePhases\|ScheduleError"` — `apps/backend/supabase/migrations/` is the only place left that may mention `pending_plan`, and that column is dropped in Task 9.

- [ ] **Step 7: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @bitetime/backend test:db
```
Expected: all green. A DB suite that references the deleted route fails here — delete that case rather than restoring the route.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(billing): remove the step down to Basic"
```

---

### Task 2: One price set

The Stripe price map stops being keyed by tier. `/api/pricing` keeps its envelope and loses its `basic` key.

**Files:**
- Modify: `apps/backend/src/pricing.ts`
- Modify: `apps/backend/src/env.ts:75-80`
- Modify: `apps/backend/src/stripe.ts:19-32`
- Modify: `apps/backend/src/trialSubscription.ts:65,90`
- Modify: `apps/backend/src/app.ts` (the `/api/checkout` handler, ~line 975–1030)
- Modify: `apps/backend/src/billing.ts` (`reconcileMerchantPlan`)
- Modify: `apps/backend/src/billingSync.ts` (~line 133)
- Modify: `apps/backend/tests/unit/pricing.test.ts`
- Modify: `apps/frontend/src/store.ts` (the `PlatformPricing` type), `apps/frontend/src/usePlatformPricing.ts`
- Modify: `apps/backend/.env` and `.env.example` if one exists (grep `STRIPE_PRICE_BASIC`)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `export type Prices = Record<string, string>` (unchanged shape, keys are now `monthly` / `yearly`)
  - `export function priceId(prices: Prices, cycle: string): string`
  - `export function cycleFromPriceId(prices: Prices, id: string): { cycle: Cycle } | null`
  - `export interface PricingPayload { currency: string; prices: { pro: Record<Cycle, number> } }`
  - `priceFor(cycle: string): string` in `stripe.ts`; `isValidPlan` is deleted, `isValidCycle` stays.

- [ ] **Step 1: Write the failing test**

Replace the `planFromPriceId` block in `apps/backend/tests/unit/pricing.test.ts` with:

```ts
import { cycleFromPriceId, fetchBasePricing } from '../../src/pricing.js'

const PRICES = { monthly: 'price_m', yearly: 'price_y' }

describe('cycleFromPriceId', () => {
  it('maps a configured price back to its cycle', () => {
    expect(cycleFromPriceId(PRICES, 'price_y')).toEqual({ cycle: 'yearly' })
  })

  it('returns null for a price we did not configure — never a guess', () => {
    expect(cycleFromPriceId(PRICES, 'price_made_by_hand')).toBeNull()
    expect(cycleFromPriceId(PRICES, '')).toBeNull()
  })
})

describe('fetchBasePricing', () => {
  it('reads both cycles from Stripe under a single pro key', async () => {
    const payload = await fetchBasePricing({
      prices: PRICES,
      retrievePrice: async (id) => ({ unit_amount: id === 'price_m' ? 3990 : 39900, currency: 'myr' }),
    })
    expect(payload).toEqual({ currency: 'MYR', prices: { pro: { monthly: 39.9, yearly: 399 } } })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @bitetime/backend test pricing`
Expected: FAIL — `cycleFromPriceId` is not exported.

- [ ] **Step 3: Collapse `pricing.ts`**

```ts
// Platform subscription pricing. One plan, charged in MYR, so there is one Stripe Price per
// billing cycle — amounts are read from the actual Stripe Prices so the displayed price can
// never drift from what is charged. Pure and dependency-injected.

const CYCLES = ['monthly', 'yearly'] as const
type Cycle = (typeof CYCLES)[number]

/** Cycle → Stripe Price ID (MYR). A missing/empty id is "not configured". */
export type Prices = Record<string, string>

export interface PricingPayload {
  currency: string
  /** Kept keyed under `pro` so the wire shape survives the tier's removal. */
  prices: { pro: Record<Cycle, number> }
}

/** Look up the Stripe Price ID for a cycle. Throws if absent. */
export function priceId(prices: Prices, cycle: string): string {
  const id = prices[cycle]
  if (!id) throw new Error(`No price configured for ${cycle}`)
  return id
}

/**
 * The inverse of `priceId`: which cycle is this subscription actually paying on?
 *
 * **Null means "change nothing"**, and every caller must honour that. A price made by hand in
 * the dashboard, a legacy price, a currency variant — guessing a cycle from one of those writes
 * a wrong renewal date onto a real shop. A stale column is the cheaper failure.
 */
export function cycleFromPriceId(prices: Prices, id: string): { cycle: Cycle } | null {
  if (!id) return null
  for (const cycle of CYCLES) {
    if (prices[cycle] === id) return { cycle }
  }
  return null
}

export async function fetchBasePricing(deps: {
  prices: Prices
  retrievePrice: (id: string) => Promise<{ unit_amount: number | null; currency: string }>
}): Promise<PricingPayload> {
  const amountOf = async (cycle: Cycle) => {
    const price = await deps.retrievePrice(priceId(deps.prices, cycle))
    if (price.currency.toLowerCase() !== 'myr') {
      throw new Error(`Price for ${cycle} is ${price.currency.toUpperCase()}, expected MYR`)
    }
    return (price.unit_amount ?? 0) / 100
  }

  const pro = {} as Record<Cycle, number>
  for (const cycle of CYCLES) pro[cycle] = await amountOf(cycle)

  return { currency: 'MYR', prices: { pro } }
}
```

Keep `createPricingCache` exactly as it is.

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @bitetime/backend test pricing`
Expected: PASS.

- [ ] **Step 5: Follow the type through the backend**

- `env.ts`: the `prices` block becomes
  ```ts
  prices: {
    monthly: required('STRIPE_PRICE_PRO_MONTHLY'),
    yearly: required('STRIPE_PRICE_PRO_YEARLY'),
  },
  ```
  and its comment becomes "Stripe Price IDs (MYR), keyed by cycle. One plan, charged in MYR, so there is one pair and both are required."
- `stripe.ts`: delete `PLANS` and `isValidPlan`; `priceFor(cycle: string)` returns `priceId(env.prices, cycle)`.
- `trialSubscription.ts`: delete the `plan` local (line 65) and `plan` from the subscription metadata; `items: [{ price: priceFor(cycle) }]`. `TrialMerchant` drops `plan`.
- `app.ts` `/api/checkout`: stop reading `plan` off the body, drop `isValidPlan` from the validation (`if (!isValidCycle(billing))` with error `'Invalid billing cycle'`), drop `plan` from both metadata objects, `line_items: [{ price: priceFor(billing), quantity: 1 }]`, and `cancel_url: \`${env.frontendUrl}/merchant/signup?billing=${billing}&canceled=1\``.
- `billing.ts` `reconcileMerchantPlan`: rename to `reconcileBillingCycle`, call `cycleFromPriceId`, and have it write `{ billing_cycle: tier.cycle }` only. Leave its callers' names alone until the grep in Step 6.
- `billingSync.ts`: update the call and the comment at line 133.
- Remove `STRIPE_PRICE_BASIC_MONTHLY` and `STRIPE_PRICE_BASIC_YEARLY` from `apps/backend/.env`, any `.env.example`, and `apps/backend/README.md`.

- [ ] **Step 6: Follow it through the frontend**

In `apps/frontend/src/store.ts`, `PlatformPricing.prices` becomes `{ pro: { monthly: number; yearly: number } }`. In `usePlatformPricing.ts`, `FALLBACK_PRICING` becomes:

```ts
export const FALLBACK_PRICING: PlatformPricing = {
  currency: 'MYR',
  prices: { pro: { monthly: 39.9, yearly: 399 } },
  estimate: null,
}
```

Then `pnpm typecheck` and fix each reported `pricing.prices[...]` read to `pricing.prices.pro`. Expect hits in `PricingCards.tsx`, `SignupScreen.tsx` and `SuspendedScreen.tsx`.

- [ ] **Step 7: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @bitetime/backend test:db
```
Expected: green. A checkout DB test that posts `plan` still passes — the field is now ignored — but update its body so the test says what it means.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(billing): key the Stripe prices by cycle alone"
```

---

### Task 3: Every signup starts a cardless trial

**Files:**
- Modify: `apps/backend/src/app.ts` (`POST /api/merchants`, ~line 195–230)
- Modify: `apps/frontend/src/merchant/SignupScreen.tsx`
- Modify: `apps/frontend/src/merchant/FinishSignupScreen.tsx:47,54-55,83`
- Modify: `apps/frontend/src/merchant/PendingScreen.tsx:17,33`
- Modify: `apps/frontend/src/merchant/pendingShop.ts:23,35,52` and `pendingShop.test.ts`
- Modify: `apps/frontend/src/store.ts` (`createMerchant`, `startCheckout`)
- Modify: `apps/frontend/src/AppRouter.tsx:262`
- Modify: `apps/backend/tests/api/start-trial.test.ts`, `apps/backend/tests/api/checkout.test.ts`

**Interfaces:**
- Consumes: `priceFor(cycle)` and `isValidCycle` from Task 2.
- Produces:
  - `createMerchant({ name, billing?, referredByCode?, businessNature?, currency? })` — no `plan`.
  - `startCheckout({ billing })` — no `plan`.
  - `POST /api/merchants` always answers `{ ...merchant, status: 'active', trial: boolean }` on the happy path.

- [ ] **Step 1: Write the failing test**

Add to `apps/backend/tests/api/start-trial.test.ts` (it already has the helpers). The body carrying `plan: 'pro'` is the point — that is the shape signup takes today when it skips the trial and hands off to Checkout, and it is the branch being deleted. A body with no `plan` at all already gets a trial today, so a test written that way would be green before the change and prove nothing.

```ts
it('provisions the cardless trial whatever the body claims, and ignores a plan field', async () => {
  const owner = await makeUser('signup-trial@example.com', 'password123')
  const { token } = await tokenOf(owner)

  const res = await post('/api/merchants', { name: 'Trial Shop', businessNature: 'bakery', plan: 'pro' }, token)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.status).toBe('active')
  expect(body.trial).toBe(true)

  await serviceClient().from('merchants').delete().eq('id', body.id)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @bitetime/backend test:db start-trial`
Expected: FAIL — the handler returns early on `plan === 'pro'`, so the shop comes back `pending` with no `trial` field. If Stripe is not reachable locally the suite already stubs it; do not add a new stub.

- [ ] **Step 3: Remove the fork from signup**

In `apps/backend/src/app.ts`, inside `POST /api/merchants`:
- Delete `plan: body?.plan ?? 'basic',` from the insert.
- Delete the early return `if ((data.plan ?? 'basic') === 'pro') return c.json(data)` and the comment above it that explains the Pro-pays-upfront branch. Replace that comment with: *"Self-serve: the trial is provisioned HERE, not by an approval. Two things this must not do — fail the signup because Stripe did (the account, the slug and the form's answers are worth more than the retry), and return an `active` shop with no subscription behind it (startCardlessTrial owns that ordering)."*

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @bitetime/backend test:db start-trial`
Expected: PASS.

- [ ] **Step 5: Collapse the signup screen**

In `apps/frontend/src/merchant/SignupScreen.tsx`:
- Delete the `PLANS` const and the `plan` derivation. Keep `pick` and use it for the cycle only, reading **both** path segments so an old two-segment link still works:
  ```ts
  const billing = pick(CYCLES, [path.a, path.b, params.get('billing')], 'monthly')
  ```
- Delete `planName`; `const perMoAmount = billing === 'yearly' ? pricing.prices.pro.yearly / 12 : pricing.prices.pro.monthly`.
- `signUp(...)` and `createMerchant(...)` stop passing `plan`.
- Delete the `if (plan === 'basic')` branch and the `startCheckout` call after it. Every signup now ends with:
  ```ts
  // Cardless trial: no Checkout. The backend provisioned the trial and activated the shop during
  // createMerchant, so this lands on the dashboard. If Stripe refused, the shop is still there at
  // `pending` and MerchantHome shows the retry screen.
  // `replace`, not `assign`: the shop now exists, so Back must not return to a signup form that
  // would try to create it a second time.
  window.location.replace('/merchant')
  ```
- Update the plan/cycle summary in the JSX below to name the cycle only.

In `apps/frontend/src/AppRouter.tsx`, the route becomes `<Route path="/merchant/signup/:a?/:b?" element={<SignupScreen />} />` with the comment rewritten to say the segments preselect the **cycle**, that either position is accepted, and that this is what keeps `/merchant/signup/pro/monthly` — still in Stripe's `cancel_url` history and in already-sent links — from rendering a blank page.

- [ ] **Step 6: Follow it through the other signup surfaces**

- `pendingShop.ts`: drop `plan` from the parked-shop bag and from `pendingShop.test.ts`.
- `FinishSignupScreen.tsx`: drop `plan` from the create call and delete the `shop.plan === 'pro'` Checkout branch.
- `PendingScreen.tsx`: delete `hasPlan` and the Checkout button it guarded. A pending shop now has exactly one action — retry the trial (`POST /api/merchants/:id/start-trial`).
- `store.ts`: drop `plan` from `createMerchant` and `startCheckout`.

- [ ] **Step 7: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @bitetime/backend test:db
```

- [ ] **Step 8: Run the app and watch a real signup**

Start the stack per the `verify` skill (`pnpm dev`, plus `stripe listen --forward-to http://localhost:8787/api/stripe/webhook`). Sign up a new shop. Confirm: no card is asked for, the browser lands on `/merchant`, and Settings → Subscription shows a trial with 7 days left. Then open `/merchant/signup/pro/monthly` and confirm the form renders.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(signup): start every shop on the cardless trial"
```

---

### Task 4: Remove the Pro gate from the backend

**Files:**
- Modify: `apps/backend/src/mw.ts` (delete `hasProAccess`, `REQUIRES_PRO`, `requirePro`)
- Modify: `apps/backend/src/app.ts:18,260,266,272,450,491,557,654,836-839,891,911`
- Modify: `apps/backend/src/writes.ts` (delete `promoChanged`, `optionGroupsChanged`, `menuCategoriesChanged`, `customDatesChanged`, `pixelIdsChanged`, `categoryChanged`)
- Modify: `apps/backend/src/notify.ts:142,150-154`
- Modify: `apps/backend/tests/unit/writes.test.ts`, `apps/backend/tests/unit/notify.test.ts`
- Modify: `apps/backend/tests/api/customers.test.ts`, `report.test.ts`, `writes-products.test.ts`, `writes-secret.test.ts`, `writes-vouchers.test.ts`, `writes-merchants.test.ts`, `notifyOrder.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `mw.ts` exports `requireUser`, `requireSuperadmin`, `requireMerchantOwns`, `requireOwnsChild`, `requireOwnMerchant`, `type AppEnv` — and nothing plan-shaped.

- [ ] **Step 1: Invert a refusal test**

In `apps/backend/tests/api/writes-vouchers.test.ts`, replace the test at line ~122 (`403 requires_pro for a basic shop's owner`) with:

```ts
// The tier is gone (#222): a shop's own owner may create a voucher, full stop. Kept as a
// positive test rather than deleted — the route still has to work, and a removed refusal with
// nothing in its place leaves it unexercised.
it('creates a voucher for the shop’s own owner', async () => {
  await resetMerchant('voucher-owner-shop')
  const owner = await makeUser('voucher-owner@example.com', 'password123')
  const { token, userId } = await tokenOf(owner)
  const id = await seedMerchant({ slug: 'voucher-owner-shop', owner_id: userId })

  const res = await post(`/api/merchants/${id}/vouchers`, { code: 'SAVE10', kind: 'percent', amount: 10 }, token)
  expect(res.status).toBe(200)

  const { data } = await serviceClient().from('vouchers').select('code').eq('merchant_id', id)
  expect(data?.map(r => r.code)).toEqual(['SAVE10'])

  await serviceClient().from('vouchers').delete().eq('merchant_id', id)
  await serviceClient().from('merchants').delete().eq('id', id)
})
```

Do the same for the delete-voucher refusal at line ~216 (assert `200` and that the row is gone).

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @bitetime/backend test:db writes-vouchers`
Expected: FAIL with `403` — the gate is still there.

- [ ] **Step 3: Delete the middleware**

In `apps/backend/src/mw.ts`, delete `hasProAccess`, `REQUIRES_PRO` and `requirePro` together with the doc comments that explain them.

- [ ] **Step 4: Unchain every gated route**

In `apps/backend/src/app.ts`:
- Line 18: shrink the `mw.js` import.
- Lines 260, 266, 272: delete the three `…Changed(patch, stored) && !(await hasProAccess(c))` refusals in the merchant PATCH, with their comments.
- Line 450: delete the sort/tag refusal in `GET …/customers` and rewrite the handler doc — the list, its sorting and its tag filter are one free feature now.
- Line 491 (`PUT …/customers/:phoneKey`), 557 (`GET …/report.xlsx`), 654 (`PUT …/secret`), 891 and 911 (vouchers): drop `requirePro` from the middleware chain and rewrite the comment above each to say what the route does rather than which tier bought it.
- Lines 824–840: delete `touchesPro` and its refusal from the product upsert, and the comment block naming the three helpers.

- [ ] **Step 5: Delete the diff helpers**

In `apps/backend/src/writes.ts`, delete `promoChanged`, `optionGroupsChanged`, `menuCategoriesChanged`, `customDatesChanged`, `pixelIdsChanged` and `categoryChanged`, and the sentences in `pickMerchantConfig`'s and `pickProductFields`' doc comments that point at them. `pickMerchantConfig` and `pickProductFields` themselves stay — they are the owner-cannot-self-activate guard (Global Constraint 1), not a tier gate. Delete their tests from `apps/backend/tests/unit/writes.test.ts` and leave every other test in that file alone.

- [ ] **Step 6: Ungate Telegram**

In `apps/backend/src/notify.ts`: the merchant read at line 142 selects `name` only; delete the `merchant?.plan !== 'pro'` skip and its comment. Every other skip — no token, no chat id — stays. Update `tests/unit/notify.test.ts` and `tests/api/notifyOrder.test.ts`: the case that proved a basic shop is skipped becomes one that proves a shop with a token gets its message.

- [ ] **Step 7: Sweep the remaining suites**

```bash
git grep -n "requires_pro\|requirePro\|hasProAccess" -- apps/backend
```
Every remaining hit is in `tests/api/customers.test.ts`, `report.test.ts`, `writes-products.test.ts`, `writes-secret.test.ts` or `writes-merchants.test.ts`. Convert each refusal into the positive test of the same behaviour, following Step 1's shape. Where a test seeds `plan: 'basic'` or `plan: 'pro'` purely to reach the gate, delete the field from the seed.

- [ ] **Step 8: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @bitetime/backend test:db
```
Expected: green, and `git grep -c "requires_pro" -- apps/backend` returns nothing.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(plans): open every gated route to any active shop"
```

---

### Task 5: Remove the revocation machinery

Nothing steps down any more, so nothing is revoked at a step-down. Lapsing suspends and stops there.

**Files:**
- Modify: `apps/backend/src/billing.ts` (`revokeProArtifacts`, `restoreCustomDates`, `lapseMerchant`, `reconcileBillingCycle`)
- Modify: `apps/backend/src/app.ts` (`POST /api/admin/uncomp-merchant`, ~line 1253–1278; `POST /api/admin/comp-merchant`, ~line 1191)
- Modify: `packages/shared/src/options.ts` (delete the bulk `deactivate…` helper at ~line 302)
- Modify: `packages/shared/src/menuCategories.ts` (delete the bulk `deactivate…` helper at ~line 144)
- Modify: `apps/backend/tests/api/webhook-lapse.test.ts`, `webhook-plan.test.ts`, `comp.test.ts`, `billing-sweep.test.ts`
- Modify: `apps/backend/tests/unit/billingLifecycle.test.ts` (only if it asserts on artifacts)

**Interfaces:**
- Consumes: `reconcileBillingCycle` from Task 2.
- Produces: `lapseMerchant(merchantId)` writes `{ status: 'suspended' }` and nothing else.

- [ ] **Step 1: Write the failing test**

In `apps/backend/tests/api/webhook-lapse.test.ts`, replace the assertion that a lapsed shop's vouchers go inactive with:

```ts
// A lapsed shop is a CLOSED shop (#222): the storefront gate refuses every order, so there is
// nothing left for a revocation to protect. The merchant's own vouchers survive the suspension
// and work again the day they resubscribe.
it('suspends the shop and leaves its vouchers intact', async () => {
  const id = await seedMerchant({ slug: 'lapse-vouchers' })
  const voucherId = await seedVoucher({ merchant_id: id, code: 'KEEPME' })

  await lapseMerchant(id)

  const { data: m } = await serviceClient().from('merchants').select('status').eq('id', id).single()
  expect(m?.status).toBe('suspended')
  const { data: v } = await serviceClient().from('vouchers').select('active').eq('id', voucherId).single()
  expect(v?.active).not.toBe(false)

  await serviceClient().from('vouchers').delete().eq('id', voucherId)
  await serviceClient().from('merchants').delete().eq('id', id)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @bitetime/backend test:db webhook-lapse`
Expected: FAIL — `revokeProArtifacts` has set `active` to false.

- [ ] **Step 3: Delete the revocation**

In `apps/backend/src/billing.ts`:
- Delete `revokeProArtifacts` and `restoreCustomDates` entirely, with their doc comments.
- `lapseMerchant` becomes a read-free suspend:
  ```ts
  /**
   * Close a shop whose subscription has ended — trial expired unpaid, dunning exhausted, or a
   * cancellation that has finally landed.
   *
   * ONE function, called from BOTH the `customer.subscription.deleted` webhook and the
   * reconciliation sweep, because those two are the same decision reached by different roads and
   * a second copy would eventually disagree about what "closed" means.
   *
   * Suspension is the whole of it. A suspended shop's storefront refuses every order and its
   * dashboard is locked, so there is no entitlement left to revoke — the tier that used to be
   * taken away here no longer exists (#222).
   *
   * Idempotent, and it has to be: the sweep exists precisely to run over shops the webhook may
   * or may not have already handled.
   */
  export async function lapseMerchant(merchantId: string) {
    const { error } = await admin
      .from('merchants')
      .update({ status: 'suspended' })
      .eq('id', merchantId)
    if (error) throw error
  }
  ```
- In `reconcileBillingCycle`, delete the read-before-write of `plan` and both transition branches.

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @bitetime/backend test:db webhook-lapse`
Expected: PASS.

- [ ] **Step 5: Strip the tier out of comp and un-comp**

In `apps/backend/src/app.ts`:
- `comp-merchant`: stop writing `plan: 'pro'`; keep the `upsertBilling(merchantId, { comped: true, … })` call. Rewrite the doc comment: a comp means **billing does not apply** — the shop runs with no subscription behind it and the reconciliation sweep skips it.
- `uncomp-merchant`: delete the whole `merchants.update({ plan: 'basic' })` block and its error branch. The endpoint now only clears the flag and winds the billing row back to "no subscription" (`comped: false, status: null, current_period_end: null`). Keep that second half and its comment verbatim — it is what leaves the shop able to pay.
- Update `apps/backend/tests/api/comp.test.ts` to assert on `comped` alone.

- [ ] **Step 6: Delete the shared bulk helpers**

Delete the `deactivate…` helper in `packages/shared/src/options.ts` (~line 302, the one that maps every group to `active: false`) and its twin in `packages/shared/src/menuCategories.ts` (~line 144). **Leave the `active` field itself and every other helper alone** — `active` is also the merchant's own Hide control and the soft delete ADR 0008 asks for. Delete only the unit tests that covered the two deleted functions.

- [ ] **Step 7: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @bitetime/backend test:db
git grep -n "revokeProArtifacts\|restoreCustomDates" -- apps packages
```
Expected: green, and the grep returns nothing outside `docs/`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(billing): lapse a shop by suspending it, nothing more"
```

---

### Task 6: Remove the Pro gate from the dashboard

**Files:**
- Delete: `apps/frontend/src/plan.ts`, `apps/frontend/src/plan.test.ts`, `apps/frontend/src/merchant/ProLock.tsx`, `apps/frontend/src/merchant/DeactivatedVouchers.tsx`
- Modify: `apps/frontend/src/merchant/Dashboard.tsx`, `ShopSettings.tsx`, `VouchersManager.tsx`, `ProductsManager.tsx`, `Overview.tsx`, `CustomersView.tsx`, `FulfilmentTab.tsx`, `apps/frontend/src/pixels/useMerchantPixels.ts`, `apps/frontend/src/components/DashboardShell.tsx`
- Modify: `apps/frontend/src/api.ts:100` (doc comment only)
- Modify: `apps/frontend/src/merchant/UpgradeNav.tsx` — delete it if `ProLock` was its only consumer (grep first)

**Interfaces:**
- Consumes: nothing.
- Produces: no `useProAccess`, no `ProLock`, no `ProBadge`, no `UpgradeLink` anywhere in the tree.

- [ ] **Step 1: Find every call site**

```bash
git grep -n "useProAccess\|isRequiresPro\|ProLock\|ProBadge\|UpgradeLink\|DeactivatedVouchers" -- apps/frontend/src
```
Write the list down. Each one is a `const pro = useProAccess()` plus a branch that renders either the feature or a lock.

- [ ] **Step 2: Unlock each one**

For every site: delete the `useProAccess()` call, delete the locked branch, and keep the live branch unconditionally. Concretely:
- `Dashboard.tsx` — the Vouchers nav entry renders plainly; delete the comment about a basic shop seeing a locked section.
- `DashboardShell.tsx` — delete the locked-section styling and the comment at line 14.
- `ShopSettings.tsx` — the Alerts (Telegram) and Marketing (pixel) forms render; delete the `ProLock` panels, the `requires_pro` catch at line ~762 and the comments at 130/141.
- `VouchersManager.tsx` — the manager renders; delete the `<DeactivatedVouchers />` mount with the lock.
- `ProductsManager.tsx` — promo price, option groups and category controls are always enabled; delete the disabled-field fallbacks at lines ~296–303 and ~386 and the comment at ~764.
- `Overview.tsx` — the export button is always live; delete the lock and the comments at ~41–45 and ~84.
- `CustomersView.tsx` — notes, tags, the tag-filter row, the tag column and the sort control all render; delete the gates at ~92, ~260, ~304 and ~621.
- `FulfilmentTab.tsx` — custom order dates are selectable; delete the lock.
- `useMerchantPixels.ts` — delete the `plan === 'pro'` check before reading the shop's pixel ids.

- [ ] **Step 3: Delete the modules**

```bash
git rm apps/frontend/src/plan.ts apps/frontend/src/plan.test.ts \
      apps/frontend/src/merchant/ProLock.tsx \
      apps/frontend/src/merchant/DeactivatedVouchers.tsx
```

`DeactivatedVouchers` is deleted rather than unlocked: it exists to name the codes `revokeProArtifacts` switched off at a step-down, and with Task 5 done there is nothing for it to report. Then fix the `requires_pro` sentence in `apps/frontend/src/api.ts:100` — it points at a module that no longer exists.

- [ ] **Step 4: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test
git grep -n "useProAccess\|requires_pro\|ProLock" -- apps/frontend/src
```
Expected: green, and the grep returns nothing.

- [ ] **Step 5: Run the app and open a brand-new shop**

Sign up a fresh shop and confirm every one of these is open with no padlock: Vouchers, Settings → Alerts (Telegram), Settings → Marketing (pixel ids), product promo prices, product option groups, menu categories, Fulfilment → custom dates, Overview → export, Customers → notes, tags, tag filter and sort.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(dashboard): open every locked feature to every shop"
```

---

### Task 7: Drop the tier from the subscription and admin surfaces

**Files:**
- Modify: `apps/frontend/src/merchant/subscriptionTabState.ts` and `.test.ts`
- Modify: `apps/frontend/src/merchant/SubscriptionTab.tsx`
- Modify: `apps/frontend/src/merchant/SuspendedScreen.tsx`
- Modify: `apps/frontend/src/merchant/reactivationChoice.ts` and `.test.ts`
- Modify: `apps/frontend/src/admin/AdminMerchants.tsx:85`
- Modify: `apps/frontend/src/types.ts:26`
- Modify: `apps/frontend/src/store.ts`, `store.test.ts` (any `plan` in a merchant fixture)

**Interfaces:**
- Consumes: `subscriptionTabState` as Task 1 left it.
- Produces:
  - `subscriptionTabState(billing: SubscriptionSnapshot | null | undefined, now: Date): SubscriptionState` — the `plan` parameter is gone and every variant loses its `plan` field.
  - `defaultReactivation(merchant): { cycle: Cycle }` — `Plan` and the `plan` field are gone.
  - `Merchant` in `types.ts` has no `plan`.

- [ ] **Step 1: Write the failing test**

In `apps/frontend/src/merchant/subscriptionTabState.test.ts`, change every call to the two-argument form and add:

```ts
it('takes no tier and reports none', () => {
  const state = subscriptionTabState(
    { stripe_customer_id: 'cus_1', status: 'active', current_period_end: '2026-09-01T00:00:00Z' } as never,
    new Date('2026-08-11T00:00:00Z'),
  )
  expect(state.kind).toBe('live')
  expect(state.canManage).toBe(true)
  expect('plan' in state).toBe(false)
  expect('canUpgrade' in state).toBe(false)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @bitetime/frontend test subscriptionTabState`
Expected: FAIL — the second argument is still `plan`, so `now` arrives as the tier.

- [ ] **Step 3: Drop the tier from the state module**

In `subscriptionTabState.ts`: delete the `plan` parameter, the `tier` local, `canUpgrade` from `Actions`, and `plan` from all five `SubscriptionState` variants. Rewrite the module's opening comment — it answers "what is this shop's subscription?", and there is no longer a tier in the answer.

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @bitetime/frontend test subscriptionTabState`
Expected: PASS.

- [ ] **Step 5: Follow it into the components**

- `SubscriptionTab.tsx`: pass two arguments; delete the plan-name row, the upgrade pitch and its feature list. Keep the price, the renewal date, the trial countdown, cancel, undo-cancel and the portal button.
- `reactivationChoice.ts`: delete `type Plan` and the `plan` field, so `defaultReactivation` answers `{ cycle }` only. Rewrite its doc comment: the picker chooses a **cycle**, and the reason it defaults to the shop's last one is unchanged. Update `reactivationChoice.test.ts`.
- `SuspendedScreen.tsx`: delete the tier picker and the `plan` state; keep the monthly/yearly toggle, read `pricing.prices.pro`, and the button reads `t('Reopen — pay now', '恢复营业——立即付款')`.
- `AdminMerchants.tsx:85`: delete the plan badge expression; keep the comp badge.
- `types.ts`: delete `plan?: string` from `Merchant`.

- [ ] **Step 6: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test
git grep -n "\.plan\b" -- apps/frontend/src
```
Expected: green, and the grep returns nothing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(subscription): drop the tier from the billing surfaces"
```

---

### Task 8: One plan on the marketing pages

**Files:**
- Modify: `apps/frontend/src/marketing/pricingTiers.ts` and `pricingTiers.test.ts`
- Modify: `apps/frontend/src/marketing/PricingCards.tsx`
- Modify: `apps/frontend/src/marketing/Pricing.tsx`
- Modify: `apps/frontend/src/marketing/Landing.tsx:254`
- Modify: `apps/frontend/src/marketing/faq.ts:26,70`
- Modify: `apps/frontend/src/marketing/useCases.ts:242,344,514`
- Modify: `apps/frontend/src/marketing/FeaturesPage.tsx`
- Modify: `apps/frontend/src/routeMeta.ts:41,70` and `routeMeta.test.ts` if it pins those strings
- Modify: `apps/frontend/src/legal/documents.ts:115,116,155,158`
- Modify: `apps/frontend/public/llms.txt:27,34,38,49,55`
- Modify: `apps/frontend/src/canonical.ts` (doc comment at ~line 21–28)

**Interfaces:**
- Consumes: `pricing.prices.pro` from Task 2.
- Produces:
  - `PRICING_TIERS: PricingTier[]` with one entry, `id: 'pro'`.
  - `INCLUDED_GROUPS: IncludedGroup[]` replaces `PLAN_COMPARISON_GROUPS`, where
    ```ts
    export interface IncludedRow { id: string; label: { en: string; zh: string }; detail?: { en: string; zh: string } }
    export interface IncludedGroup { id: string; label: { en: string; zh: string }; rows: IncludedRow[] }
    ```
    `ComparisonValue` and `ComparisonRow` are deleted.

- [ ] **Step 1: Write the failing test**

Replace the comparison assertions in `apps/frontend/src/marketing/pricingTiers.test.ts` with:

```ts
import { PRICING_TIERS, INCLUDED_GROUPS } from './pricingTiers'

it('sells exactly one plan', () => {
  expect(PRICING_TIERS.map(tier => tier.id)).toEqual(['pro'])
})

it('promises the cardless trial on the plan it sells', () => {
  expect(PRICING_TIERS[0].note.en).toContain('no card')
})

it('states every included row in both languages, with no tier left in the shape', () => {
  for (const group of INCLUDED_GROUPS) {
    expect(group.label.en).toBeTruthy()
    expect(group.label.zh).toBeTruthy()
    for (const row of group.rows) {
      expect(row.label.en).toBeTruthy()
      expect(row.label.zh).toBeTruthy()
      expect(row).not.toHaveProperty('basic')
      expect(row).not.toHaveProperty('pro')
    }
  }
})
```

Keep every existing test that checks both languages are present on a tier's features.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @bitetime/frontend test pricingTiers`
Expected: FAIL — `INCLUDED_GROUPS` is not exported.

- [ ] **Step 3: Rewrite `pricingTiers.ts`**

- `PricingTier.id` becomes `'pro'`. Delete the `inherits` field and the Basic entry. The Pro entry keeps its blurb, its five features, its CTA and its badge, and its `note` becomes `{ en: 'Free for 7 days · no card', zh: '免费试用 7 天 · 无需信用卡' }`. Rewrite the `note` doc comment: the trial is on the plan we sell, and the line sits at the click rather than at the foot of the section.
- Rename `PLAN_COMPARISON_GROUPS` to `INCLUDED_GROUPS` and reshape each row to `{ id, label, detail? }`. Keep the four groups and their order. Rows that were `true` on both plans keep their text as `detail`; rows that were `false` on Basic become a bare `label`; the four split rows take the Pro wording:

| `id` | `detail.en` | `detail.zh` |
|---|---|---|
| `orderdates` | A rolling window, or the exact dates you tick | 滚动日期范围，或你逐一勾选的日期 |
| `customers` | Included, plus sorting and tag filters | 包含，另可排序与标签筛选 |
| `support` | Priority — your questions jump the queue | 优先——你的问题优先处理 |
| `trial` | 7 days, no card | 7 天，无需信用卡 |

Keep the file header's two standing rules verbatim — every line must be true of the product as shipped, and no amounts live here.

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @bitetime/frontend test pricingTiers`
Expected: PASS.

- [ ] **Step 5: Render one card**

In `PricingCards.tsx`: keep the monthly/yearly toggle exactly as it is. Replace the `PRICING_TIERS.map(...)` grid with a single centred card (`max-w-[420px] mx-auto`) built from `PRICING_TIERS[0]`, reading `pricing.prices.pro`. Delete the `tier.inherits` block. The CTA becomes `` `/merchant/signup/${billing}` ``.

In `Pricing.tsx`: replace the comparison table with the included-list — for each `INCLUDED_GROUPS` entry, the group label as a heading and its rows as `✓ label` with `detail` in muted text beside it. Delete `ComparisonCell` and the "What is in each plan" heading; it becomes `t('What is included', '包含什么')`. Rewrite the yearly explainer at line ~191 to drop "Monthly and yearly buy exactly the same thing" if it now reads as comparing tiers — the sentence about two months free stays.

In `Landing.tsx`: the summary shows one price and the trial line, and keeps its link to `/pricing`.

- [ ] **Step 6: Fix the prose**

- `faq.ts:26` — the subscription answer names one plan.
- `faq.ts:70`, `useCases.ts:242,514` — "Every plan emails you… Pro adds a Telegram alert" becomes one sentence: an email **and** an instant Telegram alert land on every order.
- `useCases.ts:344` — "flat subscription, monthly or yearly" stays; delete any tier comparison around it.
- `FeaturesPage.tsx` — grep `basic` and `Pro` and remove tier framing.
- `routeMeta.ts:41` — the `/pricing` description becomes `'Simple monthly pricing with no commission on your orders. See everything the plan includes, and start free for 7 days without a card.'` Line 70's `/merchant/signup` description drops "Pick a plan". **The `/` entry must stay character-identical to `index.html`'s own tags** — `routeMeta.test.ts` pins that join and will fail if it drifts.
- `canonical.ts` — the `PRESELECTION_ROUTES` doc comment describes a plan segment; it now describes a cycle segment. `PRESELECTION_ROUTES` itself does not change.
- `public/llms.txt` — line 34 ("Plans: **Basic** and **Pro**…") and line 38 (the trial sentence) collapse into one plan with the cardless trial; line 49's `/pricing` line drops "Basic and Pro" and "the full plan comparison"; lines 27 and 55 lose their per-plan framing.

- [ ] **Step 7: Fix the Terms**

In `apps/frontend/src/legal/documents.ts`: delete the two paragraphs at lines 115 and 116 that describe moving to a cheaper plan and what it deactivates — that behaviour no longer exists, and the words would be a promise about something that cannot happen. Reword lines 155 and 158 so the ad-pixel clause names *your subscription* rather than *a paid plan*.

- [ ] **Step 8: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git grep -ni "basic" -- apps/frontend/src apps/frontend/public
```
Expected: green, and the only surviving hit is the "basic technical data" sentence in `documents.ts:221`, which is unrelated.

- [ ] **Step 9: Look at the pages**

Run `pnpm --filter @bitetime/frontend preview` against the build and open `/` and `/pricing` in both languages. Confirm one card, the correct price from Stripe, the trial line under the CTA, and the included-list rendering all four groups with no empty column where the table used to be.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(pricing): sell one plan on the marketing pages"
```

---

### Task 9: Drop the columns

**Files:**
- Create: `apps/backend/supabase/migrations/20260812090000_remove_basic_plan.sql`
- Modify: `apps/backend/tests/rls/helpers.ts:102-105,134`
- Modify: any remaining test that seeds `plan`

- [ ] **Step 1: Prove nothing reads them**

```bash
git grep -n "\bplan\b" -- apps/backend/src apps/frontend/src packages
git grep -n "pending_plan" -- apps/backend/src apps/frontend/src
```
Expected: nothing but incidental prose (a comment using the English word "plan"). **If either grep finds a live read, stop and finish the task that owns it** — dropping a column a running query still names is a 500 on a real route, not a compile error.

- [ ] **Step 2: Write the migration**

```sql
-- One plan (#222). `merchants.plan` was the entitlement signal and `merchant_billing.pending_plan`
-- the scheduled step down to Basic. With a single tier, entitlement is `merchants.status`, and a
-- column that still holds a tier is a trap for the next reader rather than a spare field.
--
-- Both columns are dropped rather than narrowed: no shop was ever on a Basic price, so there is
-- no history here worth keeping and nothing to grandfather.
alter table public.merchants        drop column if exists plan;
alter table public.merchant_billing drop column if exists pending_plan;
```

- [ ] **Step 3: Apply it locally**

Run: `pnpm --filter @bitetime/backend db:migrate`
Expected: the migration applies. If it refuses because the local history holds a version whose file is gone, repair that row **against the local database explicitly** — `supabase migration repair --status reverted <version> --db-url "postgresql://postgres:postgres@127.0.0.1:55322/postgres"`, run from `apps/backend/`. Never run a bare `repair`; it targets production.

- [ ] **Step 4: Clean the seeds**

In `apps/backend/tests/rls/helpers.ts`: delete the `plan` field from `seedMerchant`'s options type (line ~105), its spread (line ~134) and the doc comment above it (line ~102). Then `git grep -n "plan:" -- apps/backend/tests` and delete every remaining seed of it.

- [ ] **Step 5: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @bitetime/backend test:db
```
Expected: green against the migrated local database.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): drop the plan and pending_plan columns"
```

- [ ] **Step 7: Say what production still needs**

The migration is applied **locally only**. Report to the user, in the task summary, that a human must run `db:push`, and that it has to land **with** the deploy rather than before it — the running backend still selects `plan` until the new build is out.

---

### Task 10: Documentation

**Files:**
- Modify: `CONTEXT.md`
- Create: `docs/adr/0016-one-plan.md` (confirm the next free number with `ls docs/adr/`)
- Modify: `docs/adr/0004-plan-entitlement-follows-the-stripe-price.md` (superseded banner)
- Modify: `docs/adr/0010-menu-options-are-pro-and-downgrade-hides.md`, `docs/adr/0015-a-shop-with-no-offerable-dates-pauses.md` (amendment banners)
- Modify: `.claude/skills/verify/SKILL.md`
- Modify: `CLAUDE.md` if it names the tiers (grep first)

- [ ] **Step 1: Write the ADR**

`docs/adr/0016-one-plan.md`, following the shape of the ADRs beside it — the decision, the options considered and rejected, and the consequences. It must record:
- The decision: one plan, the 7-day cardless trial moved onto it, entitlement becomes `merchants.status === 'active'`.
- Why the gate was deleted rather than left dormant: with one tier it guards a population of zero, so it can never make a correct refusal and can still make a wrong one — a stale `plan` in a long-open tab, a webhook that has not landed.
- Why the columns were dropped rather than backfilled: no shop was ever on a Basic price, and a column still holding a tier is a trap for the next reader.
- The consequence worth naming: re-introducing a cheaper tier later is a new design, not a revert.

- [ ] **Step 2: Amend the three older ADRs**

Add a banner to the top of each, matching the style of ADR 0004's existing "Amended by" banner:
- **0004** — superseded in full by 0016. The tier it derived from the Stripe price no longer exists; the price is now read only for the billing cycle.
- **0010** — menu options are no longer Pro and no downgrade hides them. What survives is the reason `active` exists at all: it is the merchant's own Hide control and a soft delete.
- **0015** — a shop with no offerable dates still pauses; the *downgrade* cause of that pause is gone.

- [ ] **Step 3: Rewrite CONTEXT.md**

- Replace the **Plan entitlement** section with **Subscription**: one plan, what the trial grants, how a lapse closes a shop, and what a comp means now (billing does not apply). State the new invariant plainly — entitlement is `merchants.status === 'active'`, and no hot path asks about billing.
- In the billing-lifecycle section, delete the step-down path and the `pending_plan` sentences.
- Strip the tier halves from the fulfilment (line ~66, ~73, ~75), menu options (~121), menu categories (~135), customers (~221, ~223) and order-notification (~175, ~177, ~183) sections. In each case the behaviour stays and only the tier framing goes. The merchant order email keeps its own reason for existing — it is the shop's own copy — but it stops being "the one arm blind to `merchants.plan`".
- Update the referral-reward paragraph (~203) if it quotes a per-plan value.

- [ ] **Step 4: Update the verify skill**

`.claude/skills/verify/SKILL.md` walks a Basic shop through an upgrade. Rewrite that step as: sign up a shop, confirm the cardless trial starts, and confirm the features listed in Task 6 Step 5 are all open.

- [ ] **Step 5: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test
git grep -ni "requirePro\|requires_pro\|pending_plan\|revokeProArtifacts" -- . ':!docs/superpowers' ':!docs/adr'
```
Expected: green, and the grep returns nothing. Historical plans and specs under `docs/superpowers/`, and the superseded ADRs, keep their original wording — they are a record of what was decided then.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs(plans): record the move to one plan"
```

---

## Closing out

- [ ] Run the whole suite once more from a clean state: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then `pnpm --filter @bitetime/backend test:db`.
- [ ] Open a PR against `dev` whose body closes #222.
- [ ] In the PR body, list the four actions only a human can take, because none of them is in the diff and all four are load-bearing:
  1. Set the Pro monthly Stripe price to **RM39.90** and the yearly price to ten months' worth. Every amount on the site is read from Stripe, so the site is wrong until this is done.
  2. Archive both Basic prices.
  3. Turn **off** plan switching in the Stripe Customer Portal configuration.
  4. Run `db:push` for the Task 9 migration, with the deploy rather than before it.
