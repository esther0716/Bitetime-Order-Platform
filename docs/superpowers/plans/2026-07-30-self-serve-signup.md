# Self-Serve Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Basic merchant who signs up gets a live shop and a running 7-day cardless trial immediately, with no superadmin approval in the path.

**Architecture:** The trial-provisioning body of `POST /api/admin/approve-merchant` moves into one module (`trialSubscription.ts`) that three callers share: signup, a new owner-side retry endpoint, and the surviving admin fallback. `merchants.status = 'pending'` stops meaning "awaiting a human" and starts meaning "provisioning did not finish" — which is where a Stripe failure at signup parks the shop, and where a Pro shop waits for payment. No SQL changes: `guard_merchant_status` already gives the backend sole authority over `status`.

**Tech Stack:** Hono + `supabase-js` (service role) + Stripe Node SDK on the backend; React 19 + Vite on the frontend; Vitest for both. Spec: `docs/superpowers/specs/2026-07-30-remove-superadmin-approval-design.md`.

## Global Constraints

- **No migration.** `20260702110000_guard_merchant_status.sql` already exempts `service_role` and forces `pending` for every other role. Do not add, edit or apply SQL in this plan. Never run `db:push`.
- **`active` must imply "has a Stripe subscription".** Trial-end suspension is driven entirely by Stripe's `customer.subscription.deleted` webhook (`app.ts:1791`), so an `active` shop with no subscription is free forever and nothing will notice.
- **One trial ever.** `canStartTrial(billing)` (`apps/backend/src/billingLifecycle.ts:13`) stays the only answer to "has this shop ever had a subscription", and no new code path may grant a trial without consulting it.
- **Every guard runs before the first Stripe call.** `tests/api` is network-free; a guard placed after a Stripe call is not assertable there.
- **Trial length stays 7 days.**
- **Backend relative imports keep their `.js` specifiers** (`NodeNext`); they resolve to the `.ts` source. Frontend imports are extensionless.
- **Every user-visible string is `t(english, chinese)`.** FAQ entries carry `q.zh` and `a.zh`; `faq.test.ts` fails on an English string in a Chinese slot.
- **`sk_test_stub`** is the Stripe key `vitest.db.config.ts` injects (line 35). It can never authenticate, so in `tests/api` the Basic-signup path is *deterministically* the Stripe-failure path — that is what makes the failure contract assertable without a network.

---

### Task 1: `trialStartRefusal` — the two guards both trial callers share

The shared half of approval's preconditions, pure so it can be unit-tested: is this shop in a state where a trial may be started at all? "Has it already had one" stays separate, in `canStartTrial`, because the two callers answer it differently (see Task 4).

**Files:**
- Modify: `apps/backend/src/billingLifecycle.ts` (append after `canStartTrial`, line 15)
- Test: `apps/backend/tests/unit/billingLifecycle.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `trialStartRefusal(m: { status?: string | null; plan?: string | null }): string | null` — the `error` string to refuse with, or `null` when a trial may be started. Returns exactly the strings `approve-merchant` returns today, so its HTTP contract does not move.

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/tests/unit/billingLifecycle.test.ts`:

```ts
describe('trialStartRefusal', () => {
  it('allows a pending basic shop', () => {
    expect(trialStartRefusal({ status: 'pending', plan: 'basic' })).toBeNull()
  })

  // A NULL plan column reads as basic everywhere else (see seedMerchant's note), and must here.
  it('allows a pending shop whose plan column was never set', () => {
    expect(trialStartRefusal({ status: 'pending', plan: null })).toBeNull()
  })

  it('refuses a shop that is not pending', () => {
    expect(trialStartRefusal({ status: 'active', plan: 'basic' })).toBe('Merchant is not pending')
    expect(trialStartRefusal({ status: 'suspended', plan: 'basic' })).toBe('Merchant is not pending')
  })

  // Pro is pay-upfront: granting it a cardless trial would hand away the paid tier for a week.
  it('refuses a pro shop even when pending', () => {
    expect(trialStartRefusal({ status: 'pending', plan: 'pro' }))
      .toBe('Pro shops activate via payment, not approval')
  })

  // Status is checked first: a suspended pro shop is refused for the reason a caller can act on.
  it('reports the status refusal before the plan refusal', () => {
    expect(trialStartRefusal({ status: 'suspended', plan: 'pro' })).toBe('Merchant is not pending')
  })
})
```

Add `trialStartRefusal` to the existing import at the top of that file (it currently imports `canStartTrial` and `buildTrialReminderEmail`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bitetime/backend test -- billingLifecycle`
Expected: FAIL — `trialStartRefusal is not a function` / TS error "has no exported member 'trialStartRefusal'".

- [ ] **Step 3: Write the implementation**

Append to `apps/backend/src/billingLifecycle.ts`:

```ts
/**
 * Why a trial may NOT be started for this shop, as the `error` string to refuse with — or null
 * when it may. The two questions here are the ones every caller asks identically; "has this shop
 * already had a subscription" is deliberately NOT among them, because approval activates a shop
 * it cannot re-trial while an owner's retry refuses it (see the routes in app.ts).
 */
export function trialStartRefusal(m: { status?: string | null; plan?: string | null }): string | null {
  if (m.status !== 'pending') return 'Merchant is not pending'
  if (m.plan === 'pro') return 'Pro shops activate via payment, not approval'
  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @bitetime/backend test -- billingLifecycle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/billingLifecycle.ts apps/backend/tests/unit/billingLifecycle.test.ts
git commit -m "feat(billing): pure guard for whether a shop may start a trial"
```

---

### Task 2: `startCardlessTrial` — one module, three callers

Pure move. `approve-merchant`'s body is the whole trial-provisioning rule — atomic claim, customer reuse, subscription, persistence, and compensation on both failure paths — and signup plus the retry endpoint need every part of it. Behaviour must not change in this task; the next two tasks add the new callers.

**Files:**
- Create: `apps/backend/src/trialSubscription.ts`
- Modify: `apps/backend/src/app.ts:824-925` (the `approve-merchant` handler) and its import block (line 22)

**Interfaces:**
- Consumes: `trialStartRefusal` (Task 1); `canStartTrial`, `BillingRow` (`billingLifecycle.ts`); `stripe`, `priceFor` (`stripe.js`); `upsertBilling`, `billingFromSubscription`, `setMerchantStatus` (`billing.js`); `admin` (`supabase.js`).
- Produces:
  - `TRIAL_DAYS = 7`
  - `interface TrialMerchant { id: string; name: string; owner_id: string; plan?: string | null; billing_cycle?: string | null }`
  - `type TrialOutcome = { ok: true; trial: boolean } | { ok: false; error: string; http: 409 | 500 | 502 }`
  - `startCardlessTrial(merchant: TrialMerchant, billing: BillingRow | null | undefined): Promise<TrialOutcome>`

- [ ] **Step 1: Create the module**

Create `apps/backend/src/trialSubscription.ts`:

```ts
// Provisioning a shop's cardless trial: the Stripe customer, the 7-day trialing subscription,
// the persisted billing row and the activation — one step with its own compensation. Three
// callers ask for it (signup, the owner's retry, the superadmin fallback) and none of them may
// be left holding half of it.
//
// This module does I/O. billingLifecycle.ts next door stays pure and decides WHETHER; this
// decides nothing and performs everything.
//
// Two orderings here are load-bearing:
//
//   * The pending→active flip is an ATOMIC CLAIM (`.eq('status', 'pending')`), so two concurrent
//     callers — a double-clicked admin, a retry racing the signup that spawned it — cannot both
//     go on to create a subscription. The loser is told the shop is no longer pending.
//   * Every failure path REVERTS that claim, and a subscription that exists but could not be
//     persisted is CANCELLED. An `active` shop with no subscription is free forever: trial-end
//     suspension is driven entirely by Stripe's subscription.deleted webhook, so for a shop
//     Stripe does not know about there is no event coming, and nothing else looks.
import { stripe, priceFor } from './stripe.js'
import { admin } from './supabase.js'
import { upsertBilling, billingFromSubscription, setMerchantStatus } from './billing.js'
import { canStartTrial, type BillingRow } from './billingLifecycle.js'

/** The free days a trial grants. Pinned here because more than one route grants one. */
export const TRIAL_DAYS = 7

/** The merchant columns a caller must have loaded before asking. */
export interface TrialMerchant {
  id: string
  name: string
  owner_id: string
  plan?: string | null
  billing_cycle?: string | null
}

/**
 * `trial: false` on success is not a failure: it means the shop was activated but had already
 * used its one trial, which is approval's reactivation semantics.
 */
export type TrialOutcome =
  | { ok: true; trial: boolean }
  | { ok: false; error: string; http: 409 | 500 | 502 }

export async function startCardlessTrial(
  merchant: TrialMerchant,
  billing: BillingRow | null | undefined,
): Promise<TrialOutcome> {
  const { data: claimed, error: claimErr } = await admin
    .from('merchants')
    .update({ status: 'active' })
    .eq('id', merchant.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (claimErr) return { ok: false, error: 'Claim failed', http: 500 }
  if (!claimed) return { ok: false, error: 'Merchant is not pending', http: 409 }

  // Had a subscription once already — the activation stands, but a trial is never granted twice.
  if (!canStartTrial(billing)) return { ok: true, trial: false }

  // Owner email comes from Auth, not profiles — the profiles row may not exist (the client-side
  // profile upsert is currently RLS-blocked for new signups).
  const { data: ownerUser } = await admin.auth.admin.getUserById(merchant.owner_id)
  const ownerEmail = ownerUser?.user?.email

  const plan = merchant.plan || 'basic'
  const cycle = merchant.billing_cycle || 'monthly'

  // Undo the claim; never throw from a failure path.
  const revertClaim = async () => {
    try {
      await setMerchantStatus(merchant.id, 'pending')
    } catch (e) {
      console.error('Claim revert failed — merchant left active without a subscription:', e instanceof Error ? e.message : String(e))
    }
  }

  let customerId = billing?.stripe_customer_id
  let sub
  try {
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: ownerEmail || undefined,
        name: merchant.name,
        metadata: { merchant_id: merchant.id },
      })
      customerId = customer.id
    }
    sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceFor(plan, cycle) }],
      trial_period_days: TRIAL_DAYS,
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      metadata: { merchant_id: merchant.id, plan, billing: cycle, region: 'MY' },
    })
  } catch (err) {
    console.error('Trial subscription creation failed:', err instanceof Error ? err.message : String(err))
    await revertClaim()
    return { ok: false, error: 'Subscription creation failed', http: 502 }
  }

  try {
    await upsertBilling(merchant.id, billingFromSubscription(sub))
  } catch (err) {
    // The subscription exists but wasn't persisted — cancel it so a retry can't mint a second
    // trial against an orphaned live one.
    console.error('Billing persist failed — canceling trial subscription', sub.id, err instanceof Error ? err.message : String(err))
    try {
      await stripe.subscriptions.cancel(sub.id)
    } catch (cancelErr) {
      console.error('Cancel failed — ORPHANED Stripe subscription', sub.id, cancelErr instanceof Error ? cancelErr.message : String(cancelErr))
    }
    await revertClaim()
    return { ok: false, error: 'Subscription creation failed', http: 502 }
  }

  return { ok: true, trial: true }
}
```

- [ ] **Step 2: Rewire `approve-merchant` to call it**

In `apps/backend/src/app.ts`, replace the whole handler at line 824 (everything from `app.post('/api/admin/approve-merchant'` down to its closing `})`, i.e. through the old line 925) with:

```ts
// ── Superadmin: push a stuck merchant through to active ────────────────────────
// Signup provisions its own trial now (POST /api/merchants), so this is no longer a gate
// anybody waits at — it is the admin-side fallback for a shop parked at `pending` because
// Stripe refused during signup and the merchant never retried. Same rule, different caller:
// trialSubscription.ts holds it.
//
// Unlike the owner's retry, this ACTIVATES a shop it cannot re-trial (`canStartTrial` false →
// `{ ok: true, trial: false }`): an admin pushing a shop through means "open this shop", and
// the one-trial-ever rule limits the trial, not the activation.
app.post('/api/admin/approve-merchant', requireSuperadmin, async (c) => {
  const { merchantId } = await c.req.json().catch(() => ({}))
  if (!merchantId) return c.json({ error: 'Missing merchantId' }, 400)

  // These reads are independent — the target merchant + its billing load in parallel.
  // merchant_billing keys on the merchants PK, so both use merchantId directly.
  const [merchantRes, billingRes] = await Promise.all([
    admin
      .from('merchants')
      .select('id, name, status, plan, billing_cycle, owner_id')
      .eq('id', merchantId)
      .maybeSingle(),
    admin.from('merchant_billing').select('*').eq('merchant_id', merchantId).maybeSingle(),
  ])

  const { data: merchant, error } = merchantRes
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  if (!merchant) return c.json({ error: 'Merchant not found' }, 404)

  const refusal = trialStartRefusal(merchant)
  if (refusal) return c.json({ error: refusal }, 409)

  const outcome = await startCardlessTrial(merchant, billingRes.data)
  if (!outcome.ok) return c.json({ error: outcome.error }, outcome.http)
  return c.json({ ok: true, trial: outcome.trial })
})
```

- [ ] **Step 3: Fix the imports**

In `apps/backend/src/app.ts`, change line 22 to add `trialStartRefusal`, and add the new module's import beneath it:

```ts
import { canStartTrial, trialStartRefusal, buildTrialReminderEmail } from './billingLifecycle.js'
import { startCardlessTrial } from './trialSubscription.js'
```

- [ ] **Step 4: Verify nothing moved**

Run:
```bash
pnpm typecheck
pnpm --filter @bitetime/backend test
pnpm --filter @bitetime/backend test:db
```
Expected: all pass — this task must change no behaviour.

Two things to expect rather than debug:

- **`pnpm lint` is deferred to Task 4.** `canStartTrial` is now unused in `app.ts` and comes back in the retry endpoint; `no-unused-vars` will flag the import until then. Leave the import alone.
- If `c.json({ error: outcome.error }, outcome.http)` does not typecheck, narrow at the call site (`if (outcome.http === 409) return c.json(...)` etc.) rather than widening `TrialOutcome` to `number` — Hono types the status as a literal union, and keeping it literal is what stops a 200 being returned as a failure.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/trialSubscription.ts apps/backend/src/app.ts
git commit -m "refactor(billing): extract startCardlessTrial from approve-merchant"
```

---

### Task 3: Signup provisions the trial

**Files:**
- Modify: `apps/backend/src/app.ts:135-167` (the `POST /api/merchants` handler — the part after the insert)
- Test: `apps/backend/tests/api/writes-merchants.test.ts`

**Interfaces:**
- Consumes: `startCardlessTrial` (Task 2).
- Produces: `POST /api/merchants` response gains a `trial: boolean` field. `true` only when a trial was actually created. The merchant row is returned either way, and the endpoint never fails because Stripe did.

- [ ] **Step 1: Write the failing tests**

Add to `apps/backend/tests/api/writes-merchants.test.ts`, inside the existing `describe('POST /api/merchants')`:

```ts
  // Signup provisions the trial itself — no approval in the path. This suite is network-free and
  // vitest.db.config.ts injects STRIPE_SECRET_KEY='sk_test_stub', which can never authenticate,
  // so the Stripe call here DETERMINISTICALLY fails. That is the contract under test: a shop is
  // still created, it is parked at `pending`, `trial` is false, and no billing row is written —
  // the merchant retries from the dashboard. The happy path needs a real key and is covered by
  // run-and-verify (see the plan's last task).
  it('keeps the shop when Stripe refuses, parked at pending with no trial', async () => {
    await resetMerchant('stripe-down-cafe')
    const client = await makeUser('stripe-down@example.com', 'password123')
    const { token } = await tokenOf(client)

    const res = await post('/api/merchants', { name: 'Stripe Down Cafe', plan: 'basic', billing: 'monthly' }, token)

    expect(res.status).toBe(200)
    const m = (await res.json()) as MerchantRow & { trial: boolean }
    expect(m.trial).toBe(false)
    expect(m.status).toBe('pending')

    const { data: row } = await serviceClient()
      .from('merchants').select('status').eq('id', m.id).maybeSingle()
    expect(row!.status).toBe('pending')

    const { data: billing } = await serviceClient()
      .from('merchant_billing').select('merchant_id').eq('merchant_id', m.id).maybeSingle()
    expect(billing).toBeNull()

    await serviceClient().from('merchants').delete().eq('id', m.id)
  })

  // Pro is the pay-upfront path: no trial is provisioned and Stripe is not called at all here —
  // the Checkout webhook is what activates the shop.
  it('leaves a pro signup pending without touching Stripe', async () => {
    await resetMerchant('pro-cafe')
    const client = await makeUser('pro-signup@example.com', 'password123')
    const { token } = await tokenOf(client)

    const res = await post('/api/merchants', { name: 'Pro Cafe', plan: 'pro', billing: 'monthly' }, token)

    expect(res.status).toBe(200)
    const m = (await res.json()) as MerchantRow & { trial: boolean }
    expect(m.status).toBe('pending')
    expect(m.trial).toBe(false)

    const { data: billing } = await serviceClient()
      .from('merchant_billing').select('merchant_id').eq('merchant_id', m.id).maybeSingle()
    expect(billing).toBeNull()

    await serviceClient().from('merchants').delete().eq('id', m.id)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bitetime/backend test:db -- writes-merchants`
Expected: FAIL — `expect(m.trial).toBe(false)` gets `undefined`, because the response has no `trial` field yet.

- [ ] **Step 3: Write the implementation**

In `apps/backend/src/app.ts`, replace the tail of the `POST /api/merchants` handler — the two lines currently reading:

```ts
  if (error) return c.json({ error: 'Create failed' }, 500)
  return c.json(data)
```

with:

```ts
  if (error) return c.json({ error: 'Create failed' }, 500)

  // Self-serve: the trial is provisioned HERE, not by an approval. Two things this must not do —
  // fail the signup because Stripe did (the account, the slug and the form's answers are worth
  // more than the retry), and return an `active` shop with no subscription behind it
  // (startCardlessTrial owns that ordering). A shop Stripe refused stays `pending` and the owner
  // retries from the dashboard via POST /api/merchants/:id/start-trial.
  if ((data.plan ?? 'basic') === 'pro') return c.json({ ...data, trial: false })

  const outcome = await startCardlessTrial(data, null)
  if (!outcome.ok) {
    console.error('Trial provisioning failed at signup for', data.id, '—', outcome.error)
    return c.json({ ...data, trial: false })
  }
  // `data` was read back before the claim flipped it, so say what is true now rather than making
  // the client refetch to find out.
  return c.json({ ...data, status: 'active', trial: outcome.trial })
```

The `null` second argument is not a shortcut: a shop created milliseconds ago has no `merchant_billing` row, so there is no customer id to reuse and nothing for `canStartTrial` to refuse.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bitetime/backend test:db -- writes-merchants`
Expected: PASS, including the pre-existing `creates a pending shop owned by the caller with a resolved slug` case — a Basic signup still lands on `pending` under a stub key, so that assertion holds for a new reason.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app.ts apps/backend/tests/api/writes-merchants.test.ts
git commit -m "feat(signup): provision the cardless trial at signup"
```

---

### Task 4: `POST /api/merchants/:id/start-trial` — the owner's retry

**Files:**
- Modify: `apps/backend/src/app.ts` (insert immediately after the `approve-merchant` handler from Task 2)
- Test: `apps/backend/tests/api/start-trial.test.ts` (create)

**Interfaces:**
- Consumes: `requireMerchantOwns` (`mw.js` — 401 no token, 404 unknown id, 403 not the owner), `trialStartRefusal` (Task 1), `canStartTrial` (`billingLifecycle.js`), `startCardlessTrial` (Task 2).
- Produces: `POST /api/merchants/:id/start-trial` → `{ ok: true, trial: boolean }`, or `{ error }` with 401/403/404/409/500/502.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/tests/api/start-trial.test.ts`:

```ts
// tests/api/start-trial.test.ts
// POST /api/merchants/:id/start-trial — the owner-side retry for a shop whose trial
// provisioning failed at signup.
//
// Network-free, like checkout.test.ts and comp.test.ts: everything PAST the guards calls Stripe.
// What is asserted here is every refusal — which is the whole reason the guards are ordered
// before the first Stripe call. The success path needs a real key and is covered by
// run-and-verify.
//
// The refusals are the security surface: this endpoint activates a shop and creates a
// subscription, so "who may ask" and "for which shop" are the questions that matter.
import { describe, it, expect } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, serviceClient } from '../rls/helpers.js'

function post(id: string, token?: string) {
  return app.request(`/api/merchants/${id}/start-trial`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000'

describe('POST /api/merchants/:id/start-trial', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await post(UNKNOWN_ID)).status).toBe(401)
  })

  it('refuses a bad token', async () => {
    expect((await post(UNKNOWN_ID, 'not-a-jwt')).status).toBe(401)
  })

  it('404s an id that is no shop', async () => {
    const { token } = await tokenOf(await makeUser('trial-no-shop@example.com', 'password123'))
    expect((await post(UNKNOWN_ID, token)).status).toBe(404)
  })

  // A stranger's pending shop is exactly what this must not open — activation and a subscription
  // on someone else's account.
  it("refuses a shop the caller does not own", async () => {
    const owner = await makeUser('trial-owner@example.com', 'password123')
    const { userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'retry-owned', owner_id: userId, status: 'pending', plan: 'basic' })

    const stranger = await makeUser('trial-stranger@example.com', 'password123')
    const { token } = await tokenOf(stranger)

    expect((await post(merchantId, token)).status).toBe(403)
  })

  it('refuses a shop that is already active', async () => {
    const owner = await makeUser('trial-active@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'retry-active', owner_id: userId, status: 'active', plan: 'basic' })

    const res = await post(merchantId, token)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Merchant is not pending')
  })

  it('refuses a pending pro shop — Pro pays upfront', async () => {
    const owner = await makeUser('trial-pro@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'retry-pro', owner_id: userId, status: 'pending', plan: 'pro' })

    const res = await post(merchantId, token)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Pro shops activate via payment, not approval')
  })

  // One trial ever. Without this an owner could park a shop at pending and re-trial it forever.
  it('refuses a shop that has already had a subscription', async () => {
    const owner = await makeUser('trial-used@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'retry-used', owner_id: userId, status: 'pending', plan: 'basic' })
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId,
      stripe_customer_id: 'cus_test_used',
      stripe_subscription_id: 'sub_test_used',
      status: 'canceled',
    }, { onConflict: 'merchant_id' })

    const res = await post(merchantId, token)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already used its free trial/)

    // Refused BEFORE Stripe: the shop is untouched.
    const { data: row } = await serviceClient()
      .from('merchants').select('status').eq('id', merchantId).maybeSingle()
    expect(row!.status).toBe('pending')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bitetime/backend test:db -- start-trial`
Expected: FAIL — the route does not exist, so every case gets 404 (the Hono not-found), including the ones expecting 401 and 409.

- [ ] **Step 3: Write the implementation**

In `apps/backend/src/app.ts`, immediately after the `approve-merchant` handler:

```ts
// ── Owner: retry trial provisioning for a shop parked at `pending` ─────────────
// The self-serve twin of approve-merchant. `pending` means "provisioning did not finish" now,
// which is a Stripe failure during signup — so the merchant, not an admin, is who should be
// able to push it through.
//
// Every guard runs BEFORE the first Stripe call. That is what makes them assertable in
// tests/api, which is network-free, and it is why one-trial-ever is checked HERE rather than
// left to startCardlessTrial: that function deliberately activates a shop it cannot re-trial
// (approval's semantics), which is not what an owner asking for a trial should be handed.
app.post('/api/merchants/:id/start-trial', requireMerchantOwns, async (c) => {
  const merchant = c.get('merchant') // loaded by the guard with select('*')

  const refusal = trialStartRefusal(merchant)
  if (refusal) return c.json({ error: refusal }, 409)

  const { data: billing } = await admin
    .from('merchant_billing').select('*').eq('merchant_id', merchant.id).maybeSingle()
  if (!canStartTrial(billing)) {
    return c.json({ error: 'This shop has already used its free trial — subscribe to reopen it.' }, 409)
  }

  const outcome = await startCardlessTrial(merchant, billing)
  if (!outcome.ok) return c.json({ error: outcome.error }, outcome.http)
  return c.json({ ok: true, trial: outcome.trial })
})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bitetime/backend test:db -- start-trial`
Expected: PASS (7 cases).

- [ ] **Step 5: Run the whole backend gate and commit**

```bash
pnpm typecheck
pnpm lint
pnpm --filter @bitetime/backend test
pnpm --filter @bitetime/backend test:db
git add apps/backend/src/app.ts apps/backend/tests/api/start-trial.test.ts
git commit -m "feat(billing): owner-side retry for a shop stuck pending"
```

---

### Task 5: The dashboard screen a stuck shop lands on

`PendingScreen`'s cardless branch stops being a review notice. Its Pro branch (abandoned Checkout → **Complete payment**) is untouched.

**Files:**
- Modify: `apps/frontend/src/store.ts:250-253` (add `startShopTrial`, correct `approveMerchant`'s comment)
- Modify: `apps/frontend/src/merchant/PendingScreen.tsx`
- Modify: `apps/frontend/src/merchant/SignupScreen.tsx:82-85` (comment only)

**Interfaces:**
- Consumes: `POST /api/merchants/:id/start-trial` (Task 4); `apiSend`, `Result` (`api.ts`); `useSession()` → `{ t, merchant, refreshMerchant }`.
- Produces: `startShopTrial(merchantId: string): Promise<Result<{ ok: true; trial: boolean }>>`.

- [ ] **Step 1: Add the client call**

In `apps/frontend/src/store.ts`, replace the `approveMerchant` block (its comment and body) with:

```ts
// Superadmin fallback for a shop stuck at `pending` — signup provisions its own trial now, so
// nobody waits on this. Creates the Stripe customer + cardless trialing subscription and
// activates the shop in one step.
export async function approveMerchant(merchantId: string): Promise<Result<any>> {
  return apiSend<any>('/api/admin/approve-merchant', 'POST', { merchantId }, { auth: 'required' })
}

// The owner's own retry when trial provisioning failed during signup. Same rule as the admin
// fallback above, asked for by the merchant — which is who is actually looking at the screen.
export async function startShopTrial(merchantId: string): Promise<Result<{ ok: true; trial: boolean }>> {
  return apiSend<{ ok: true; trial: boolean }>(`/api/merchants/${merchantId}/start-trial`, 'POST', undefined, { auth: 'required' })
}
```

- [ ] **Step 2: Rewrite the cardless branch of `PendingScreen`**

In `apps/frontend/src/merchant/PendingScreen.tsx`:

Change the imports on lines 2-3 to:

```tsx
import { useSession } from '../SessionContext'
import { startCheckout, startShopTrial } from '../store'
```

Replace the `const { t, merchant } = useSession()` line and the comment block above `hasPlan` (lines 9-16) with:

```tsx
  const { t, merchant, refreshMerchant } = useSession()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // `pending` has two causes now, and they need different screens. A Pro shop is waiting for
  // PAYMENT — it abandoned Checkout and can finish here. A Basic shop is waiting for nothing:
  // signup provisions its cardless trial itself, so a Basic shop only lands here when that call
  // to Stripe failed, and what it needs is a retry.
  const hasPlan = !!merchant?.plan && merchant.plan !== 'basic'
```

Then add, next to `completePayment`:

```tsx
  async function retrySetup() {
    setBusy(true); setErr('')
    const r = await startShopTrial(merchant!.id)
    if (r.ok) {
      // The shop is active now; refreshing the session swaps this screen for the dashboard.
      await refreshMerchant()
      return
    }
    setErr(r.error.message || t('Could not finish setting up your shop', '无法完成店铺设置'))
    setBusy(false)
  }
```

Replace the `else` branch's JSX (the "Pending review" / "Your shop is under review" block, lines 58-71) with:

```tsx
          <>
            <span className="inline-flex items-center gap-[5px] px-3 py-[4px] rounded-pill bg-warn-bg text-warn-fg text-[12px] font-semibold tracking-[0.04em] mb-4">
              ⏳ {t('Finishing setup', '正在完成设置')}
            </span>
            <h2 className="font-heading text-[20px] font-medium text-oxblood mb-1">{t('One step left', '还差一步')}</h2>
            <p className="text-[13px] text-rose-muted mb-6">
              <strong>{merchant?.name}</strong>{' '}
              {t(
                "is created, but we could not start your free trial just now. Try again and your shop opens straight away.",
                '已创建，但刚才未能开始你的免费试用。再试一次，店铺即可立即开放。',
              )}
            </p>
            {err && (
              <div className="text-[13px] text-ink-soft bg-oxblood-tint border border-rose-border rounded-sm px-[13px] py-[10px] mb-[10px] leading-[1.5]">
                {err}
              </div>
            )}
            <Button type="button" variant="default" size="md" className="py-3" onClick={retrySetup} disabled={busy}>
              {busy ? t('Starting…', '正在开始…') : t('Try again', '重试')}
            </Button>
          </>
```

- [ ] **Step 3: Correct the signup comment**

In `apps/frontend/src/merchant/SignupScreen.tsx`, replace the comment inside the `plan === 'basic'` branch (lines 82-85) with:

```tsx
        // Cardless trial: no Checkout. The backend provisioned the trial and activated the shop
        // during createMerchant, so this lands on the dashboard. If Stripe refused, the shop is
        // still there at `pending` and MerchantHome shows the retry screen.
        // `replace`, not `assign`: the shop now exists, so Back must not return to a signup form
        // that would try to create it a second time.
```

- [ ] **Step 4: Verify**

Run:
```bash
pnpm typecheck
pnpm lint
pnpm --filter @bitetime/frontend test
```
Expected: all pass. (No component test exists for this screen by design — UI is verified by running the app, in the final task.)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/store.ts apps/frontend/src/merchant/PendingScreen.tsx apps/frontend/src/merchant/SignupScreen.tsx
git commit -m "feat(merchant): retry screen for a shop whose trial setup failed"
```

---

### Task 6: Admin action says what it now does

**Files:**
- Modify: `apps/frontend/src/admin/AdminMerchants.tsx:154-158` and `:213-219`

**Interfaces:**
- Consumes: `approveMerchant` (unchanged).
- Produces: nothing.

- [ ] **Step 1: Relabel the menu item**

Replace lines 154-158 of `apps/frontend/src/admin/AdminMerchants.tsx`:

```tsx
              {m.status === 'pending' && (
                <>
                  {/* Not an approval any more — signup provisions its own trial. This is the
                      fallback for a shop whose provisioning failed and whose owner never retried. */}
                  <DropdownMenuItem className="cursor-pointer" onClick={() => meta.onApprove(m.id)}>{t('Start trial', '开始试用')}</DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer" onClick={() => meta.onReject(m.id)}>{t('Reject', '拒绝')}</DropdownMenuItem>
                </>
              )}
```

- [ ] **Step 2: Match the failure toast**

Replace the `approve` function's error line (line 216):

```tsx
    else toast.error(r.error.message || t('Could not start the trial', '无法开始试用'))
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @bitetime/frontend test`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/admin/AdminMerchants.tsx
git commit -m "feat(admin): relabel Approve as Start trial"
```

---

### Task 7: The copy that promises a review

Three public strings claim a human reviews shops before they go live. The FAQ text is also the source of the landing page's FAQ JSON-LD (`marketing/structuredData.ts`), so leaving it would ship the false claim to crawlers as structured data.

**Files:**
- Modify: `apps/frontend/src/marketing/faq.ts:50-62` (`id: 'website'`) and `:107-118` (`id: 'approval'`)
- Modify: `apps/frontend/src/marketing/Pricing.tsx:106-121`

**Interfaces:** none.

- [ ] **Step 1: Rewrite the `approval` FAQ entry**

Replace the entry's `a` block (both languages), leaving `id` and `q` as they are:

```ts
    a: {
      en: 'Straight away. Your shop and its order page go live the moment you sign up, and your seven free days start there — nothing to wait for. Add your products and share your link. We suspend shops that misuse the platform, but nothing holds you up on the way in.',
      zh: '马上就能开始。注册完成的那一刻，店铺和订单页面即刻上线，七天免费期同时开始——无需等待。添加产品、分享链接即可。若有店铺滥用平台，我们会将其暂停，但开店过程不会让你等。',
    },
```

The `id` stays `'approval'`: it is the accordion's key and changing it changes nothing a reader sees while breaking any deep link to the panel.

- [ ] **Step 2: Rewrite the `website` FAQ answer**

```ts
    a: {
      en: 'No. Every shop gets its own order page with its own link, ready the moment you sign up. Share that link on WhatsApp, Instagram or anywhere else — that is your storefront.',
      zh: '不需要。每家店都有专属订单页面和专属链接，注册后即刻可用。把链接分享到 WhatsApp、Instagram 或任何地方——那就是你的店面。',
    },
```

- [ ] **Step 3: Rewrite the billing paragraph and the comment above it**

In `apps/frontend/src/marketing/Pricing.tsx`, the section comment on lines 107-108 says the trial claim is "enforced somewhere real — the trial in the approval flow". Replace `the trial in the approval flow` with `the trial in signup`.

Then replace the first paragraph's `t(...)` call:

```tsx
              {t(
                'Basic starts with seven free days and asks for no card. The clock starts when you sign up, and your shop is open from that moment. We remind you before it ends. If you decide not to continue, it stops on its own and you are never charged.',
                '基础版有七天免费期，且无需绑定信用卡。计时从你注册那一刻开始，店铺也同时开放。结束前我们会提醒你。若决定不继续，试用期结束即自动停止，不会产生任何费用。',
              )}
```

- [ ] **Step 4: Verify**

Run:
```bash
pnpm --filter @bitetime/frontend test
pnpm build
```
Expected: `faq.test.ts` and `structuredData.test.ts` pass (both languages present, no English in a `zh` slot, ids still unique); the build's prerender step regenerates `dist/index.html` with the new FAQ JSON-LD and `dist/pricing.html` with the new paragraph.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/marketing/faq.ts apps/frontend/src/marketing/Pricing.tsx
git commit -m "docs(marketing): shops go live at signup, not at approval"
```

---

### Task 8: The docs that describe the old gate

Three prose claims are now wrong, and two of them are the files an agent reads first.

**Files:**
- Modify: `CLAUDE.md:100`
- Modify: `CONTEXT.md:239-246` and `CONTEXT.md:352-357`

**Interfaces:** none.

- [ ] **Step 1: `CLAUDE.md`**

Replace the last sentence of the *Merchant onboarding & slugs* paragraph — `New shops start `pending` until a superadmin approves.` — with:

```markdown
New shops go live at **signup**: `POST /api/merchants` provisions the 7-day cardless trial itself (`trialSubscription.ts`). `pending` therefore means **provisioning did not finish** — a Pro shop waiting for Checkout, or a Basic shop whose Stripe call failed, which its owner retries via `POST /api/merchants/:id/start-trial`. `POST /api/admin/approve-merchant` survives as the admin-side fallback for a shop stuck there; it is no longer a gate anyone waits at, and moderation is reactive (suspend).
```

- [ ] **Step 2: `CONTEXT.md` — Billing lifecycle**

Replace the first sentence of the section (through "the trial clock starts at approval") with:

```markdown
A merchant's platform-subscription journey. Basic signup is cardless and
**provisions its own trial**: `POST /api/merchants` creates the 7-day trialing
Stripe subscription via `startCardlessTrial` (`trialSubscription.ts` — the only
place a trial is ever granted) and activates the shop, so the clock starts at
signup. A shop stays `pending` only when that provisioning did not finish: its
owner retries with `POST /api/merchants/:id/start-trial`, and
`POST /api/admin/approve-merchant` is the admin-side fallback for one nobody
retried.
```

- [ ] **Step 3: `CONTEXT.md` — the upgrade-routes paragraph**

In the paragraph at line 352, replace `the usual case: an approved shop on its cardless trial` with `the usual case: a shop on its cardless trial`, and replace `an active shop `approve-merchant` activated but did not re-trial (`canStartTrial` false)` with `an active shop that was activated but not re-trialled (`canStartTrial` false)`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CONTEXT.md
git commit -m "docs: signup provisions the trial; pending means unfinished setup"
```

---

### Task 9: Run and verify

Per CLAUDE.md, UI and payment flows are verified by running the app. Both paths matter here: the happy path (which no test can reach, because it needs a real Stripe key) and the failure path (which the tests assert but only at the API layer).

**Files:** none — this task changes nothing.

- [ ] **Step 1: Bring up the stack**

```bash
cd apps/backend && supabase start && cd ../..
pnpm --filter @bitetime/backend db:migrate
stripe listen --forward-to http://localhost:8787/api/stripe/webhook   # leave running
pnpm dev
```

Confirm the signing secret the CLI prints equals `STRIPE_WEBHOOK_SECRET` in `apps/backend/.env`, and that `apps/backend/.env` holds a **real test-mode** `STRIPE_SECRET_KEY` — not `sk_test_stub`.

- [ ] **Step 2: Verify the happy path**

Sign up at `http://localhost:5173/merchant/signup` with a fresh email on **Basic**. Expected, in order:

1. The browser lands on `/merchant` showing the **dashboard**, not a pending screen.
2. `/s/<slug>` serves the storefront (not "shop closed").
3. The trial banner shows a countdown of about 7 days.
4. In `apps/backend`, `supabase status -o env` gives `DB_URL`; query it:
   ```bash
   psql "<DB_URL>" -c "select m.slug, m.status, b.status, b.trial_ends_at from merchants m join merchant_billing b on b.merchant_id = m.id order by m.created_at desc limit 1;"
   ```
   Expected: `active`, `trialing`, `trial_ends_at` ≈ 7 days out.

- [ ] **Step 3: Verify the failure path and the retry**

```bash
# In apps/backend/.env, temporarily set STRIPE_SECRET_KEY=sk_test_stub
rm -rf apps/backend/node_modules/.cache/jiti   # --watch alone can re-run the OLD transpile
```

Restart the backend, then sign up with another fresh email on Basic. Expected:

1. Signup succeeds — no error toast on the form.
2. `/merchant` shows **One step left** with a **Try again** button.
3. The shop row is `pending` with no `merchant_billing` row.

Then restore the real key, `rm -rf apps/backend/node_modules/.cache/jiti`, restart, and click **Try again**. Expected: the dashboard replaces the screen and the row is `active` + `trialing`.

- [ ] **Step 4: Verify the Pro path still behaves**

Sign up on **Pro** with a fresh email, abandon Stripe Checkout, and land on `/merchant`. Expected: the **Complete payment** screen (not the retry screen). Complete the payment with `4242 4242 4242 4242`; the shop flips to `active` via the webhook, and the listener shows a `200` for `checkout.session.completed`.

- [ ] **Step 5: Verify the admin fallback**

As superadmin, on a shop left at `pending` (re-park one by setting `status='pending'` through psql), open Admin → Merchants → **Start trial**. Expected: the row becomes `active` and a `trialing` billing row appears.

- [ ] **Step 6: Full gate, then open the PR**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @bitetime/backend test:db
pnpm build
```

All green → open the PR against `main`, describing the behaviour change (shops live at signup; `pending` now means unfinished provisioning) and noting that **no migration is included** because none is needed.

---

## What this plan does not do

Carried from the spec's out-of-scope list, so a reviewer does not read them as omissions: no heuristic hold-for-review (disposable-email or blocked-word checks), no new-shop notification to superadmins, no removal of `pending` from the status CHECK, no deletion of `approve-merchant`, and no change to the 7-day trial length.
