# Comped Merchants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give complimentary-Pro shops an explicit `merchant_billing.comped` flag so they stop being mistaken for paying subscribers — which today renders a "Manage subscription" button that 502s against Stripe.

**Architecture:** One boolean column on `merchant_billing`, backfilled for existing comps. `comp-merchant` sets it, clears the dangling `stripe_customer_id`, and refuses shops with a live subscription; a new `uncomp-merchant` revokes it. Three backend routes refuse a comped shop before any Stripe call. The pure `subscriptionTabState` module turns every billing action off and the tab corrects its copy; the admin table labels comped shops and offers Un-comp.

**Tech Stack:** Postgres (Supabase migrations), Hono + `@supabase/supabase-js` (service role) on the backend, React 19 + TypeScript on the frontend, Vitest for both.

## Global Constraints

- Every user-visible string is `t(english, chinese)` — there is no i18n library. `t` comes from `useSession()`.
- Backend relative imports keep `.js` specifiers that resolve to `.ts` source. Leave them as `.js`.
- Never run `pnpm --filter @bitetime/backend db:push` or any `supabase` command that reaches production. Local migration only; a human pushes.
- `pnpm --filter @bitetime/backend test:db` needs a running local Supabase (`supabase start` from `apps/backend`). It reads its own keys from `supabase status`.
- Never mock the database in `tests/api` or `tests/rls`. Those suites exist to prove properties of real Postgres.
- The API suites are network-free: they assert the guard half of a route, never the half that calls Stripe.
- New error codes returned to the browser must be added to `apps/frontend/src/merchant/billingErrors.ts`, not toasted raw.
- Column name is exactly `comped`. Error codes are exactly `shop_is_comped` and `has_live_subscription`.

---

## File Structure

**Create:**
- `apps/backend/supabase/migrations/20260729140000_merchant_billing_comped.sql` — the column and its backfill.
- `apps/backend/tests/api/comp.test.ts` — comp/uncomp route guards and effects.

**Modify:**
- `apps/backend/src/app.ts` — `comp-merchant` precondition and writes (`:957`), new `uncomp-merchant` route, comped refusals in `/api/billing/portal` (`:1010`), `/api/checkout` (`:769`) and `liveSubscription` (`:1047`).
- `apps/frontend/src/merchant/subscriptionTabState.ts` — `comped` on the snapshot and the state; three gating terms.
- `apps/frontend/src/merchant/subscriptionTabState.test.ts` — comped cases including the production regression.
- `apps/frontend/src/merchant/SubscriptionTab.tsx` — price cell (`:471`) and status sentence (`:494`).
- `apps/frontend/src/merchant/billingErrors.ts` — `shop_is_comped` copy.
- `apps/frontend/src/store.ts` — `MerchantBilling.comped` (`:220`), `uncompMerchant`.
- `apps/frontend/src/admin/AdminMerchants.tsx` — comped label, Comp Pro gating, Un-comp item.
- `apps/backend/tests/api/billing-actions.test.ts` — comped refusal on the three wind-down routes.
- `apps/backend/tests/api/checkout.test.ts` — comped refusal.

No route needs a new `select` for the read path: both `/api/billing` (`app.ts:118`) and `/api/merchants/:id/billing` (`app.ts:505`) already `select('*')`.

---

### Task 1: The column and its backfill

**Files:**
- Create: `apps/backend/supabase/migrations/20260729140000_merchant_billing_comped.sql`

**Interfaces:**
- Produces: `merchant_billing.comped boolean not null default false`. Every later task reads or writes this column.

- [ ] **Step 1: Write the migration**

Create `apps/backend/supabase/migrations/20260729140000_merchant_billing_comped.sql`:

```sql
-- Complimentary Pro, as a fact rather than an inference.
--
-- A comped shop has no subscription, but comp-merchant wrote status='active' and preserved any
-- stripe_customer_id — and the Subscription tab reads exactly that pair as "this shop has a live
-- subscription", so it offered a billing portal. In production that portal call reached Stripe
-- holding a test-mode customer id under a live key and answered 502.
--
-- The column is deliberately separate from `status`: status stays what Stripe says, this stays
-- what we say. Widening the status CHECK would move every reader of it (LIVE_STATUSES on both
-- sides of the wire, the banner, the referral grant, the admin label map) for the same outcome.

alter table public.merchant_billing
  add column if not exists comped boolean not null default false;

-- Backfill: a comp is the only path that writes status='active' with no subscription id — every
-- real subscription gets its id from the webhook (billingFromSubscription writes both together).
--
-- The customer id goes with it: on a comped row it points at nothing we will ever call, and on at
-- least one production row it points at a test-mode customer the live key cannot see.
--
-- Known gap, accepted: a shop comped AFTER a cancelled subscription keeps its subscription id, so
-- this misses it and it still reads as paying. Loosening the rule to catch it would risk
-- mislabelling real subscribers, which is the worse error.
update public.merchant_billing
   set comped = true,
       stripe_customer_id = null
 where status = 'active'
   and stripe_subscription_id is null;
```

No RLS or grant change: owners already `select` the whole row, and only `service_role` writes it.

- [ ] **Step 2: Inspect what the backfill will touch before applying**

The local database is shared across branches and may hold rows from other work. Look before you write:

```bash
cd apps/backend
supabase status -o env | grep DB_URL
```

Take the port from that line (it is **55322** here, not the 54322 default) and run:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -c \
  "select merchant_id, status, stripe_customer_id, stripe_subscription_id
     from merchant_billing
    where status = 'active' and stripe_subscription_id is null;"
```

Expected: zero or more rows, each with no subscription id. Any row here with a subscription id means the query is wrong — stop and re-read it.

- [ ] **Step 3: Apply the migration locally**

```bash
pnpm --filter @bitetime/backend db:migrate
```

Expected: the migration applies with no error. If it refuses because the local history holds a version whose file is gone (a leftover from another branch), repair that version **explicitly against local** — never bare, which targets production:

```bash
cd apps/backend
supabase migration repair --status reverted <version> \
  --db-url "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
```

- [ ] **Step 4: Verify the column exists and defaults false**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -c \
  "select column_name, data_type, is_nullable, column_default
     from information_schema.columns
    where table_name = 'merchant_billing' and column_name = 'comped';"
```

Expected: one row — `comped | boolean | NO | false`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/supabase/migrations/20260729140000_merchant_billing_comped.sql
git commit -m "feat(billing): add merchant_billing.comped and backfill existing comps"
```

---

### Task 2: `subscriptionTabState` turns every billing action off

**Files:**
- Modify: `apps/frontend/src/merchant/subscriptionTabState.ts`
- Test: `apps/frontend/src/merchant/subscriptionTabState.test.ts`

**Interfaces:**
- Consumes: the `comped` column from Task 1, arriving on the billing row.
- Produces: `SubscriptionSnapshot.comped?: boolean | null` (input) and `SubscriptionState.comped: boolean` (output, a plain field on `Actions` — **not** a new `kind`). Task 5 branches its copy on the output field.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('subscriptionTabState', …)` block in `apps/frontend/src/merchant/subscriptionTabState.test.ts`:

```ts
  // A comped shop is entitled to Pro with no Stripe behind it. Every billing action is off:
  // the portal has nothing to open, checkout is superadmin-only to reverse, and the wind-down
  // actions have no subscription to wind down.
  it('turns every billing action off for a comped shop', () => {
    const state = subscriptionTabState(
      { status: 'active', stripe_customer_id: null, comped: true, current_period_end: '2126-08-01T00:00:00Z' },
      'pro',
      NOW,
    )
    expect(state).toMatchObject({
      kind: 'none',
      plan: 'pro',
      comped: true,
      canManage: false,
      canSubscribe: false,
      canUpgrade: false,
      canCancel: false,
      canDowngrade: false,
      canResume: false,
    })
  })

  // The production 502, as a unit test. This row is what comp-merchant used to leave behind: a
  // customer id from a test-mode key plus status 'active'. That pair read as a live subscription,
  // rendered "Manage subscription", and sent a dead customer id to Stripe under a live key.
  it('offers no portal to a comped shop that still carries a stale customer id', () => {
    const state = subscriptionTabState(
      { status: 'active', stripe_customer_id: 'cus_stale', comped: true },
      'pro',
      NOW,
    )
    expect(state).toMatchObject({ kind: 'none', comped: true, canManage: false, canSubscribe: false })
  })

  // The flag is the only thing that changed. Without it the same row is a paying shop, and every
  // action stays available — this is what stops `comped` becoming a blanket off-switch.
  it('leaves a paying shop untouched', () => {
    const state = subscriptionTabState(
      { status: 'active', stripe_customer_id: 'cus_1', comped: false, current_period_end: '2026-09-01T00:00:00Z' },
      'pro',
      NOW,
    )
    expect(state).toMatchObject({ kind: 'live', comped: false, canManage: true, canCancel: true })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @bitetime/frontend test -- subscriptionTabState
```

Expected: FAIL. The first two report `kind: 'live'` where `'none'` was expected and `canManage: true` where `false` was expected; all three report `comped: undefined`.

- [ ] **Step 3: Add `comped` to the snapshot type**

In `apps/frontend/src/merchant/subscriptionTabState.ts`, extend `SubscriptionSnapshot`:

```ts
export interface SubscriptionSnapshot extends BillingSnapshot {
  stripe_customer_id?: string | null
  /** The tier scheduled to take effect next period. Intent, never entitlement — see below. */
  pending_plan?: string | null
  /**
   * Complimentary tier, granted by a superadmin, with no Stripe subscription behind it. Every
   * billing action is off: there is nothing to manage, buy, cancel or downgrade, and only a
   * superadmin can reverse it. Kept separate from `status`, which stays whatever Stripe says.
   */
  comped?: boolean | null
}
```

- [ ] **Step 4: Add `comped` to the `Actions` interface**

In the same file, inside `interface Actions`:

```ts
  /** Complimentary tier — the tab says so instead of quoting a price the shop does not pay. */
  comped: boolean
```

- [ ] **Step 5: Gate the three derived flags**

In `subscriptionTabState`, replace the `live` derivation and the `actions` object's `canSubscribe` / `canUpgrade` lines:

```ts
  const tier = plan === 'pro' ? 'pro' : 'basic'
  const customer = billing?.stripe_customer_id
  const status = billing?.status ?? null
  // A comp is not a subscription, whatever the row says. `status` stays 'active' on a comped
  // row (it is what silences nothing in particular — the banner ignores it either way), so
  // without this term a comped shop reads as live and is offered a portal that 502s.
  const comped = !!billing?.comped
  const live = !!customer && !!status && LIVE.includes(status) && !comped
```

and in the `actions` object:

```ts
    comped,
    canManage: live,
    canSubscribe: !live && !comped,
    // Hidden while the shop is winding down (no selling Pro to someone on their way out) and
    // while the card is failing (answering a question they did not ask, days from suspension).
    // `!comped` is inert today — a comp always grants Pro, so `tier !== 'pro'` is already false —
    // and stands between a future Basic comp and an Upgrade button /api/checkout now refuses.
    canUpgrade: tier !== 'pro' && !comped && !ending && status !== 'past_due',
```

Leave `canCancel`, `canDowngrade` and `canResume` alone: all three are already `live &&` something, and `live` is now false for a comped shop.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @bitetime/frontend test -- subscriptionTabState
```

Expected: PASS, including every pre-existing case. `canSubscribe` is asserted as the exact complement of `canManage` in an existing test — a comped shop makes both false, so read that test's expectations if it fails and confirm it is not asserting on a comped row.

- [ ] **Step 7: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/merchant/subscriptionTabState.ts apps/frontend/src/merchant/subscriptionTabState.test.ts
git commit -m "feat(billing): turn every billing action off for a comped shop"
```

---

### Task 3: `comp-merchant` refuses paying shops; `uncomp-merchant` revokes

**Files:**
- Modify: `apps/backend/src/app.ts:957-988` (the `comp-merchant` handler)
- Create: `apps/backend/tests/api/comp.test.ts`

**Interfaces:**
- Consumes: `merchant_billing.comped` (Task 1); `upsertBilling(merchantId, fields)` and `LIVE_STATUSES` from `./billing.js`, both already imported in `app.ts:19`.
- Produces: `POST /api/admin/uncomp-merchant` taking `{ merchantId }`, returning `{ ok: true }` or `{ error: 'Merchant not found' }` (404). `POST /api/admin/comp-merchant` additionally returns `{ error: 'has_live_subscription' }` (409). Task 6 calls the new route from the browser.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/tests/api/comp.test.ts`:

```ts
// tests/api/comp.test.ts
// POST /api/admin/{comp,uncomp}-merchant — the superadmin grant and its reverse.
//
// Network-free like the other API suites: neither route calls Stripe, which is what makes the
// whole of both assertable here rather than just their guards.
//
// The precondition is the point. Comping a shop that already pays would leave Stripe billing a
// card while the local row claims the shop is free, and comp clears the customer id — the very
// pointer back to that subscription. So it refuses instead.
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

async function billingRow(merchantId: string) {
  const { data } = await serviceClient()
    .from('merchant_billing')
    .select('comped, status, stripe_customer_id, stripe_subscription_id')
    .eq('merchant_id', merchantId)
    .maybeSingle()
  return data
}

async function merchantRow(merchantId: string) {
  const { data } = await serviceClient()
    .from('merchants').select('status, plan').eq('id', merchantId).maybeSingle()
  return data
}

describe('comp / uncomp', () => {
  let superToken: string
  let plainToken: string
  let merchantId: string

  beforeAll(async () => {
    const superClient = await makeUser('super-comp@example.com', 'password123')
    const { data: sess } = await superClient.auth.getSession()
    const svc = serviceClient()
    await svc.from('profiles').delete().eq('user_id', sess.session!.user.id)
    await svc.from('profiles').insert({ user_id: sess.session!.user.id, name: 'Super', app_role: 'superadmin' })
    superToken = await tokenOf(superClient)

    const owner = await makeUser('owner-comp@example.com', 'password123')
    const { data: osess } = await owner.auth.getSession()
    merchantId = await seedMerchant({ slug: 'comp-shop', owner_id: osess.session!.user.id })
    plainToken = await tokenOf(owner)
  })

  it('refuses an unauthenticated caller', async () => {
    expect((await post('/api/admin/comp-merchant', { merchantId })).status).toBe(401)
    expect((await post('/api/admin/uncomp-merchant', { merchantId })).status).toBe(401)
  })

  it('refuses a non-superadmin', async () => {
    expect((await post('/api/admin/comp-merchant', { merchantId }, plainToken)).status).toBe(403)
    expect((await post('/api/admin/uncomp-merchant', { merchantId }, plainToken)).status).toBe(403)
  })

  it('comps a shop: flag on, customer id gone, pro and active', async () => {
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId,
      stripe_customer_id: 'cus_stale_from_test_mode',
      status: null,
    }, { onConflict: 'merchant_id' })

    const res = await post('/api/admin/comp-merchant', { merchantId }, superToken)
    expect(res.status).toBe(200)

    const billing = await billingRow(merchantId)
    expect(billing).toMatchObject({ comped: true, status: 'active', stripe_customer_id: null })
    expect(await merchantRow(merchantId)).toMatchObject({ status: 'active', plan: 'pro' })
  })

  // The one-trial-ever record (canStartTrial reads this id). Clearing it would hand a shop that
  // has already had a trial a fresh one, so comp leaves it exactly where it is.
  it('keeps the subscription id when comping', async () => {
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId,
      stripe_subscription_id: 'sub_old',
      status: 'canceled',
    }, { onConflict: 'merchant_id' })

    expect((await post('/api/admin/comp-merchant', { merchantId }, superToken)).status).toBe(200)
    expect(await billingRow(merchantId)).toMatchObject({
      comped: true,
      stripe_subscription_id: 'sub_old',
    })
  })

  it('refuses to comp a shop with a live subscription', async () => {
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId,
      stripe_subscription_id: 'sub_live',
      status: 'active',
      comped: false,
    }, { onConflict: 'merchant_id' })

    const res = await post('/api/admin/comp-merchant', { merchantId }, superToken)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'has_live_subscription' })
    expect(await billingRow(merchantId)).toMatchObject({ comped: false })
  })

  // Revoking a comp is not the same as suspending a shop, and must not do it by accident: a
  // suspended comped shop that gets reactivated would otherwise silently hand back free Pro.
  it('un-comps: flag off, plan basic, shop status untouched', async () => {
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId,
      comped: true,
      status: 'active',
      stripe_subscription_id: null,
    }, { onConflict: 'merchant_id' })
    await serviceClient().from('merchants').update({ status: 'active', plan: 'pro' }).eq('id', merchantId)

    expect((await post('/api/admin/uncomp-merchant', { merchantId }, superToken)).status).toBe(200)
    expect(await billingRow(merchantId)).toMatchObject({ comped: false })
    expect(await merchantRow(merchantId)).toMatchObject({ status: 'active', plan: 'basic' })
  })

  it('answers 404 for a merchant that does not exist', async () => {
    const res = await post(
      '/api/admin/uncomp-merchant',
      { merchantId: '00000000-0000-0000-0000-000000000000' },
      superToken,
    )
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Local Supabase must be running (`cd apps/backend && supabase start`).

```bash
pnpm --filter @bitetime/backend test:db -- comp.test
```

Expected: FAIL. The `uncomp` cases 404 (no such route), and the comp cases report `comped: undefined` and a surviving `stripe_customer_id`.

- [ ] **Step 3: Add the precondition and change what comp writes**

In `apps/backend/src/app.ts`, in the `/api/admin/comp-merchant` handler, replace the merchant lookup and the `merchants` update with:

```ts
  const { data: merchant } = await admin
    .from('merchants').select('id').eq('id', merchantId).maybeSingle()
  if (!merchant) return c.json({ error: 'Merchant not found' }, 404)

  // Refuse a shop that is actually paying. Comping it would leave Stripe billing a card while
  // the local row claims the shop is free — and the customer id this route clears is the only
  // pointer back to that subscription. Cancel in Stripe first, then comp.
  const { data: existingBilling } = await admin
    .from('merchant_billing')
    .select('stripe_subscription_id, status')
    .eq('merchant_id', merchantId)
    .maybeSingle()
  if (existingBilling?.stripe_subscription_id
      && LIVE_STATUSES.includes(existingBilling.status ?? '')) {
    return c.json({ error: 'has_live_subscription' }, 409)
  }

  // Activate + mark pro. Service role bypasses the guard_merchant_status trigger.
  const { error: mErr } = await admin
    .from('merchants').update({ status: 'active', plan: 'pro' }).eq('id', merchantId)
  if (mErr) {
    console.error('comp-merchant merchants update failed:', mErr.message)
    return c.json({ error: 'Comp failed' }, 500)
  }
```

Then replace the `upsertBilling` call in the same handler:

```ts
  // Mark the comp and silence the billing banners: active status, far-future period end, no
  // trial. `stripe_customer_id` is cleared — on a comped shop it points at nothing we will ever
  // call, and a stale one is exactly what sent a dead id to Stripe and answered 502.
  // `stripe_subscription_id` is deliberately KEPT: canStartTrial reads it as the one-trial-ever
  // record, and clearing it would hand a previously-subscribed shop a fresh trial.
  try {
    const farFuture = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString()
    await upsertBilling(merchantId, {
      comped: true,
      stripe_customer_id: null,
      status: 'active',
      trial_ends_at: null,
      current_period_end: farFuture,
    })
  } catch (err) {
    console.error('comp-merchant billing upsert failed:', err instanceof Error ? err.message : String(err))
    return c.json({ error: 'Comp failed' }, 500)
  }
```

Also update the handler's doc comment: the sentence "Revoke by suspending in the console (set-merchant-status → suspended)" is now wrong. Replace it with "Revoke with `/api/admin/uncomp-merchant`, which clears the flag and drops the shop to Basic without touching its status — suspension is a separate decision." and delete the trailing "If the merchant already carries a real Stripe subscription this overwrites its local status to active — don't comp a paying shop.", which the 409 now enforces.

- [ ] **Step 4: Add the uncomp route**

Immediately after the `comp-merchant` handler in `apps/backend/src/app.ts`:

```ts
// ── Superadmin: revoke a comp ──────────────────────────────────────────────────
// Clears the flag and drops the shop to Basic. Deliberately touches neither `merchants.status`
// nor the billing row's far-future `current_period_end`: suspension is a separate decision, and
// conflating the two is what makes a temporary suspension silently end a comp — or a later
// reactivation silently hand free Pro back.
app.post('/api/admin/uncomp-merchant', requireSuperadmin, async (c) => {
  const { merchantId } = await c.req.json().catch(() => ({}))
  if (!merchantId) return c.json({ error: 'Missing merchantId' }, 400)

  const { data: merchant } = await admin
    .from('merchants').select('id').eq('id', merchantId).maybeSingle()
  if (!merchant) return c.json({ error: 'Merchant not found' }, 404)

  const { error: mErr } = await admin
    .from('merchants').update({ plan: 'basic' }).eq('id', merchantId)
  if (mErr) {
    console.error('uncomp-merchant merchants update failed:', mErr.message)
    return c.json({ error: 'Un-comp failed' }, 500)
  }

  try {
    await upsertBilling(merchantId, { comped: false })
  } catch (err) {
    console.error('uncomp-merchant billing upsert failed:', err instanceof Error ? err.message : String(err))
    return c.json({ error: 'Un-comp failed' }, 500)
  }

  return c.json({ ok: true })
})
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @bitetime/backend test:db -- comp.test
```

Expected: PASS, all eight cases.

If the run fails with `Could not find the 'comped' column … in the schema cache`, Task 1's migration has not been applied to the running stack — run `pnpm --filter @bitetime/backend db:migrate` and retry.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/app.ts apps/backend/tests/api/comp.test.ts
git commit -m "feat(billing): refuse comping a paying shop, add uncomp-merchant"
```

---

### Task 4: Comped shops are refused before any Stripe call

**Files:**
- Modify: `apps/backend/src/app.ts` — `/api/checkout` (`:769`), `/api/billing/portal` (`:1010`), `liveSubscription` (`:1047`)
- Modify: `apps/frontend/src/merchant/billingErrors.ts`
- Test: `apps/backend/tests/api/billing-actions.test.ts`, `apps/backend/tests/api/checkout.test.ts`

**Interfaces:**
- Consumes: `merchant_billing.comped` (Task 1).
- Produces: `{ error: 'shop_is_comped' }` with status 409 from `/api/checkout`, `/api/billing/portal`, `/api/billing/downgrade`, `/api/billing/cancel` and `/api/billing/resume`; and its bilingual copy in `billingErrorMessage`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/backend/tests/api/billing-actions.test.ts`, inside the existing `describe('billing wind-down routes', …)`:

```ts
  // A comped shop has nothing to wind down. This guard is load-bearing rather than belt-and-
  // braces: comp KEEPS stripe_subscription_id (the one-trial-ever record) and leaves status
  // 'active', so a comped row passes liveSubscription's `!subId || !LIVE_STATUSES` gate on both
  // terms. Without the check, cancel would reach Stripe holding an id that is either dead or a
  // real cancelled subscription. The tab never renders these buttons for a comped shop, which is
  // exactly why the route has to refuse on its own.
  it('refuses a comped shop', async () => {
    const owner = await makeUser('comped-winddown@example.com', 'password123')
    const { token, userId } = await sessionOf(owner)
    const merchantId = await seedMerchant({ slug: 'comped-winddown-shop', owner_id: userId, plan: 'pro' })
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId,
      comped: true,
      status: 'active',
      stripe_subscription_id: 'sub_kept',
    }, { onConflict: 'merchant_id' })

    for (const route of ROUTES) {
      const res = await post(route, token)
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ error: 'shop_is_comped' })
    }
  })
```

Append to `apps/backend/tests/api/checkout.test.ts`, inside its `describe('POST /api/checkout', …)`. This file's helpers are narrower than the wind-down suite's — `post()` takes only a token, and `seedMerchant`/`serviceClient` need importing — so add `serviceClient` to the existing import from `../rls/helpers.js`:

```ts
  // Comp is terminal until a superadmin revokes it: a comped shop cannot buy its way out. The
  // refusal comes before the Stripe customer is created, so a comped shop can never acquire a
  // new customer id — the thing this whole change exists to stop accumulating.
  it('refuses a comped shop', async () => {
    const owner = await makeUser('comped-checkout@example.com', 'password123')
    const { data } = await owner.auth.getSession()
    const merchantId = await seedMerchant({ slug: 'comped-checkout-shop', owner_id: data.session!.user.id })
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId,
      comped: true,
      status: 'active',
    }, { onConflict: 'merchant_id' })

    const res = await post(await tokenOf(owner))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'shop_is_comped' })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @bitetime/backend test:db -- billing-actions checkout
```

Expected: FAIL. The wind-down cases return 200 or a Stripe error rather than 409; checkout returns 409 with `This shop already has an active subscription` (the wrong refusal — it fires on `status: 'active'`, not on the comp) or 200.

- [ ] **Step 3: Refuse in `/api/checkout`**

In `apps/backend/src/app.ts`, widen the existing billing select in the checkout handler and add the refusal above the live-subscription check:

```ts
  const { data: existing } = await admin
    .from('merchant_billing')
    .select('stripe_customer_id, status, comped')
    .eq('merchant_id', merchant.id)
    .maybeSingle()

  // Comp is terminal until a superadmin revokes it. Ahead of the live-subscription check on
  // purpose: a comped row carries status 'active', so that check would fire first and tell the
  // merchant they already have a subscription — which is the one thing they do not have.
  if (existing?.comped) return c.json({ error: 'shop_is_comped' }, 409)
```

- [ ] **Step 4: Refuse in `/api/billing/portal`**

In the same file, in the portal handler:

```ts
  const { data: billing } = await admin
    .from('merchant_billing').select('stripe_customer_id, comped').eq('merchant_id', merchant.id).maybeSingle()
  // The bug this whole change exists for. A comped shop has no Stripe customer to open a portal
  // against; before the flag existed it had a stale one, and this route sent it to Stripe.
  if (billing?.comped) return c.json({ error: 'shop_is_comped' }, 409)
  if (!billing?.stripe_customer_id) return c.json({ error: 'No billing account yet' }, 404)
```

- [ ] **Step 5: Refuse in `liveSubscription`**

In the same file, in `liveSubscription`:

```ts
  const { data: billing } = await admin
    .from('merchant_billing')
    .select('stripe_subscription_id, status, comped')
    .eq('merchant_id', merchant.id).maybeSingle()
  // Ahead of the gate below, which a comped row passes on both terms: comp keeps
  // stripe_subscription_id (canStartTrial's one-trial-ever record) and leaves status 'active'.
  // Without this, cancel/downgrade/resume would act on an id that is dead or belongs to a real
  // cancelled subscription.
  if (billing?.comped) return { res: c.json({ error: 'shop_is_comped' }, 409) }
  // 409 rather than 404: the shop is fine, the request just does not apply to it. The
  // Subscription tab hides these buttons in that state, so this is the long-open-tab case.
  if (!billing?.stripe_subscription_id || !LIVE_STATUSES.includes(billing.status ?? '')) {
    return { res: c.json({ error: 'no_live_subscription' }, 409) }
  }
```

- [ ] **Step 6: Add the bilingual copy**

In `apps/frontend/src/merchant/billingErrors.ts`, add a case before `default`:

```ts
    case 'shop_is_comped':
      // Not folded into `no_live_subscription`: that one tells the merchant to reload, which is
      // wrong advice for a state that will not change on reload. Only a superadmin can end it.
      return t(
        'This shop is on complimentary Pro. There is no billing to manage.',
        '此店铺为赠送的 Pro 方案，无需管理账单。',
      )
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter @bitetime/backend test:db -- billing-actions checkout comp.test
```

Expected: PASS. `comp.test` is included to confirm Task 3 still passes with the wider selects.

- [ ] **Step 8: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/app.ts apps/backend/tests/api/billing-actions.test.ts apps/backend/tests/api/checkout.test.ts apps/frontend/src/merchant/billingErrors.ts
git commit -m "feat(billing): refuse portal, checkout and wind-down for a comped shop"
```

---

### Task 5: The Subscription tab stops quoting a price the shop does not pay

**Files:**
- Modify: `apps/frontend/src/merchant/SubscriptionTab.tsx:471` (price cell) and `:494-497` (status sentence)

**Interfaces:**
- Consumes: `state.comped` from Task 2. `state.kind` is `'none'` for a comped shop — no new kind exists.

- [ ] **Step 1: Replace the price in the plan card header**

Without this, a comped shop reads a Pro badge beside `RM 59/month`. In `apps/frontend/src/merchant/SubscriptionTab.tsx`, replace the price span at line 470-472:

```tsx
          <span className="font-heading text-[18px] text-oxblood whitespace-nowrap shrink-0">
            {/* A comped shop is Pro and pays nothing. Quoting the Pro price here — beside a Pro
                badge, with no subscription behind it — reads as a bill. */}
            {state.comped
              ? t('Free', '免费')
              : <>{formatMoney(planPrice, pricing.currency)}<span className="text-[13px] text-text-secondary">{per}</span></>}
          </span>
```

- [ ] **Step 2: Replace the fall-through sentence**

The `kind: 'none'` branch currently ends the chain with "No subscription on file for this shop yet." — which sits directly under a Pro badge and contradicts it. Replace the final ternary arm at lines 494-497:

```tsx
                  : state.comped
                    ? t('Complimentary Pro — no billing on this shop.',
                        '赠送的 Pro 方案——此店铺无账单。')
                    : t('No subscription on file for this shop yet.',
                        '此店铺尚无订阅记录。')}
```

Keep the `state.kind === 'live'` arm immediately above it unchanged; `comped` is only ever reached through `kind: 'none'`.

- [ ] **Step 3: Typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: clean.

- [ ] **Step 4: Run and verify in the browser**

UI in this repo is verified by running the app, not by component tests.

```bash
pnpm dev
```

Comp a shop you own from the admin console (or set its row directly with the service key), then open `http://localhost:5173/merchant#settings/subscription` as that merchant. Verify:

- the plan card shows the **Pro** badge and **Free** — no price, no `/month`;
- the sentence reads "Complimentary Pro — no billing on this shop.";
- there is **no** Manage subscription button, no Summary card, no Cancel/Switch-to-Basic, and no Upgrade to Pro card;
- switching the language toggle to 中文 shows the Chinese strings.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/merchant/SubscriptionTab.tsx
git commit -m "feat(billing): say Complimentary Pro instead of quoting an unpaid price"
```

---

### Task 6: Admin can see and revoke comps

**Files:**
- Modify: `apps/frontend/src/store.ts:220-227` (`MerchantBilling`), and near `compMerchant` at `:138`
- Modify: `apps/frontend/src/admin/AdminMerchants.tsx` — subscription cell (`:75-107`), row menu (`:161-163`), meta wiring (`:210-230`)

**Interfaces:**
- Consumes: `POST /api/admin/uncomp-merchant` (Task 3); `merchant_billing.comped` reaching the browser through `/api/billing`, which already does `select('*')`.
- Produces: `uncompMerchant(id: string): Promise<Result<any>>` in `store.ts`; `MerchantBilling.comped?: boolean | null`.

- [ ] **Step 1: Add `comped` to the billing type and the un-comp call**

In `apps/frontend/src/store.ts`, extend the interface:

```ts
export interface MerchantBilling {
  merchant_id: string
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  status?: string | null
  trial_ends_at?: string | null
  current_period_end?: string | null
  /** Complimentary tier — no Stripe subscription behind this shop. */
  comped?: boolean | null
}
```

and add, directly below `compMerchant`:

```ts
// Superadmin: revoke a comp. Drops the shop to Basic and clears the flag; the shop's own
// status is untouched, because suspending is a separate decision.
export async function uncompMerchant(id: string): Promise<Result<any>> {
  return apiSend<any>('/api/admin/uncomp-merchant', 'POST', { merchantId: id }, { auth: 'required' })
}
```

- [ ] **Step 2: Carry `comped` onto the table row**

`AdminMerchants` folds the billing row onto each merchant so the Subscription column can sort on it (`accessorFn` sees only the row, never table meta). `comped` has to ride along the same way.

At `AdminMerchants.tsx:19`, extend the row type:

```ts
type MerchantRow = Merchant & { billingStatus?: string | null; comped?: boolean }
```

and at the `data` memo (`:216`):

```tsx
  const data = useMemo<MerchantRow[]>(
    () => (rows ?? []).map(m => ({
      ...m,
      billingStatus: billing[m.id]?.status ?? null,
      comped: !!billing[m.id]?.comped,
    })),
    [rows, billing],
  )
```

- [ ] **Step 3: Label comped shops in the Subscription cell**

In the `cell` renderer for the subscription column, add the comped branch ahead of the status labels so it wins over the raw `active`:

```tsx
      const subLabel = m.comped ? t('comped', '赠送')
        : sub === 'active' ? t('active', '有效')
        : sub === 'trialing' ? t('trialing', '试用')
        : sub === 'past_due' ? t('past due', '逾期')
        : sub === 'canceled' ? t('canceled', '已取消')
        : sub === 'incomplete' ? t('incomplete', '未完成')
        : sub
      // Neutral, not green: a comp is neither a healthy subscription nor a failing one, and
      // colouring it `active` is what made comped and paying shops indistinguishable here.
      const subCls = m.comped ? 'text-text-tertiary'
        : sub === 'active' ? 'text-success-deep'
        : sub === 'trialing' ? 'text-warn-fg'
        : (sub === 'past_due' || sub === 'canceled' || sub === 'incomplete') ? 'text-danger-fg'
        : 'text-text-tertiary'
```

The cell's early return is `if (!plan && !sub) return …` — a comped row always has `plan: 'pro'`, so it never takes that path.

- [ ] **Step 4: Swap the menu item on comped shops**

In the row menu, replace the single Comp Pro item:

```tsx
              {m.comped ? (
                <DropdownMenuItem className="cursor-pointer" onClick={() => meta.onUncomp(m.id)}>
                  {t('Un-comp', '取消赠送')}
                </DropdownMenuItem>
              ) : !(m.status === 'active' && m.plan === 'pro') && (
                <DropdownMenuItem className="cursor-pointer" onClick={() => meta.onComp(m.id)}>
                  {t('Comp Pro', '赠送 Pro')}
                </DropdownMenuItem>
              )}
```

Add `onUncomp: (id: string) => void` to the `AdminTableMeta` interface beside `onComp`.

- [ ] **Step 5: Wire the handler, and say why a comp was refused**

Add `uncompMerchant` to the existing `../store` import at `AdminMerchants.tsx:5`, beside `compMerchant`.

The existing `comp` function toasts `r.error.message`, which for the new 409 would put the raw code `has_live_subscription` in front of a superadmin. Give it a sentence naming the fix, and add `uncomp` beside it (`:210`):

```tsx
  async function comp(id: string) {
    setBusy(id)
    const r = await compMerchant(id)
    if (r.ok) { toast.success(t('Comped to Pro', '已赠送 Pro')); await load() }
    // The one refusal a superadmin can act on: cancel the subscription in Stripe, then comp.
    // Without this the toast reads `has_live_subscription`, which names the state but not the way out.
    else if (r.error.code === 'has_live_subscription') {
      toast.error(t('This shop has a live subscription. Cancel it in Stripe first.',
        '此店铺有生效中的订阅，请先在 Stripe 中取消。'))
    }
    else toast.error(r.error.message || t('Comp failed', '赠送失败'))
    setBusy(null)
  }

  async function uncomp(id: string) {
    setBusy(id)
    const r = await uncompMerchant(id)
    if (r.ok) { toast.success(t('Comp revoked', '已取消赠送')); await load() }
    else toast.error(r.error.message || t('Un-comp failed', '取消赠送失败'))
    setBusy(null)
  }
```

Then add `onUncomp: uncomp,` to the `meta` object (`:229`), beside `onComp: comp,`.

`r.error.code` is the backend's `error` string verbatim (`api.ts:77`: `code: body.error`), and `message` falls back to the same string — which is why the raw code would otherwise reach the toast.

- [ ] **Step 6: Typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: clean.

- [ ] **Step 7: Run and verify in the browser**

```bash
pnpm dev
```

Sign in as a superadmin and open `http://localhost:5173/admin/merchants`. Verify:

- comping a shop from the row menu turns its Subscription cell to "Pro / comped" in grey after the reload;
- that row's menu now offers **Un-comp** and no longer offers Comp Pro;
- Un-comp drops the cell to "Basic" and returns the Comp Pro item;
- the shop's own status column is unchanged by both actions;
- a paying shop still reads "Pro / active" in green.

- [ ] **Step 8: Run the full suite**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @bitetime/backend test:db
```

Expected: all green. This is what CI runs on the pull request.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/store.ts apps/frontend/src/admin/AdminMerchants.tsx
git commit -m "feat(admin): show comped shops and offer un-comp"
```

---

## After the plan

The migration has been applied **locally only**. Production still needs it: a human runs `pnpm --filter @bitetime/backend db:push`. Say so in the pull request body — until it runs, the backend's `comped` writes will fail in production with `Could not find the 'comped' column … in the schema cache`.

Once it is pushed, merchant `fdd4e3f8-9008-4814-8ef7-a3420212aad0` is fixed by the backfill: `comped = true`, `stripe_customer_id = null`, and the Manage subscription button is gone rather than broken.

Out of scope, worth a follow-up issue: `/api/billing/portal` and `/api/checkout` both trust a stored `stripe_customer_id` blindly and could clear and recreate it on Stripe's `resource_missing` rather than failing. This plan removes the path that was reliably producing dangling ids; it does not make the routes resilient to one arriving another way.
