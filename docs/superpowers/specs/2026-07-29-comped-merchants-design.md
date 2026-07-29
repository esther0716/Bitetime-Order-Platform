# Comped merchants: an explicit flag

## The bug this starts from

Production, 2026-07-29. A merchant clicks **Manage subscription** and gets `{"error":"stripe_unavailable"}`. The backend log:

```
Stripe portal session for merchant fdd4e3f8-9008-4814-8ef7-a3420212aad0 failed:
No such customer: 'cus_UoOgiTeqR1ylne'
```

The chain:

1. The shop went through (or started) checkout while the backend held a **test** Stripe key. `/api/checkout` wrote `cus_UoOgiTeqR1ylne` to `merchant_billing` before redirecting (`app.ts:790`).
2. A superadmin comped the shop. `comp-merchant` upserts `status: 'active'` and **deliberately preserves** any existing `stripe_customer_id` (`app.ts:974`).
3. The key was switched to live. The stored customer id now belongs to an account the live key cannot see.
4. `subscriptionTabState.ts:83` computes `live = !!customer && LIVE.includes('active')` — true — so `canManage` is true and `PortalButton` renders.
5. The portal route calls Stripe with a test-mode id under a live key. 502.

The key switch is what made it visible; **the comp is what made it possible**. A comped shop has no subscription at all, but its row says `active` and carries a customer id, and those two together are precisely the signal the UI reads as "this shop has a live subscription".

Two things found while tracing it:

- `billingBannerState` returns `none` for any status that is not `trialing`/`past_due`, and for a missing row entirely. So comp's `status: 'active'` is **not** what silences the trial/past-due banners, contrary to the comment at `app.ts:973`. We are free to represent a comp honestly.
- Admin → Merchants renders a comped shop as "Pro / active", identical to a paying Pro shop. There is no way to answer "who is comped" today.

## What we are building

An explicit `comped` boolean on `merchant_billing`, plus the guards, UI states and revoke path that make it mean something.

Decisions taken during design:

| Question | Decision |
|---|---|
| Can a comped shop buy a subscription itself? | No. Comp is terminal until a superadmin revokes it. |
| How is a comp revoked? | An explicit **Un-comp** superadmin action. Suspension stays orthogonal. |
| Comping a shop that already pays? | Refuse with 409. Cancel in Stripe first. |
| Existing comped shops? | Auto-backfilled by the migration. |
| What the merchant sees | Reuse `kind: 'none'`; correct the price cell and the sentence. |
| Admin display | Show `comped` in place of `active`. |

### Why a column, not a status or a derivation

`status = 'comped'` is truthful in one field but widens the check constraint and touches every reader of `status`: `LIVE_STATUSES` on both sides of the wire, `billingBannerState`, `referralRewardGrant.candidateFrom`, the admin label map, `subscriptionTabState` and its tests. Same outcome, far more blast radius.

Deriving it (`status = 'active' AND stripe_subscription_id IS NULL`) needs no migration and is demonstrably accurate today — it is the backfill rule below. Rejected anyway: implicit, so any future path writing `active` without a subscription id becomes silently comped; and Un-comp would have nothing to clear short of deleting the row, losing the record that a comp ever existed.

The column keeps `status` meaning what Stripe says and adds one field that means what we say.

## Schema

`apps/backend/supabase/migrations/20260729140000_merchant_billing_comped.sql`:

```sql
alter table public.merchant_billing
  add column if not exists comped boolean not null default false;

-- Backfill: a comp is the only path that writes status='active' with no
-- subscription id — every real subscription gets its id from the webhook.
-- The customer id goes with it: on a comped row it points at nothing we will
-- ever call, and on at least one production row it points at a test-mode
-- customer the live key cannot see (the 502 this migration exists for).
update public.merchant_billing
   set comped = true,
       stripe_customer_id = null
 where status = 'active'
   and stripe_subscription_id is null;
```

No RLS change. Owners already `select` the whole row; only `service_role` writes it.

### Which Stripe ids a comp clears

`stripe_customer_id` is cleared. It is the dangling pointer that produced the 502, and nothing about a comped shop needs it.

`stripe_subscription_id` is **kept**. `canStartTrial` (`billingLifecycle.ts:14`) reads it as the one-trial-ever record; clearing it would hand a previously-subscribed shop a fresh trial. The kept id is inert — `liveSubscription` is gated (see below), and `referralRewardGrant` wraps its retrieve in try/catch.

The cost, stated plainly: the backfill rule misses a shop comped *after* a cancelled subscription, because that row has a subscription id and a `status` overwritten to `active`. It keeps reading as paying. This is accepted rather than loosening the rule, which would risk mislabelling real subscribers. The update is small enough to `select` before running.

## Backend

### `POST /api/admin/comp-merchant`

Gains a precondition:

```ts
// Refuse a shop with a live subscription — comping it would leave Stripe billing a
// card while the local row claims the shop is free, and the ids we clear are the
// only pointer back to it. Cancel in Stripe first.
if (existingBilling?.stripe_subscription_id
    && LIVE_STATUSES.includes(existingBilling.status ?? '')) {
  return c.json({ error: 'has_live_subscription' }, 409)
}
```

Then upserts `comped: true`, `stripe_customer_id: null`, `status: 'active'`, `trial_ends_at: null` and the far-future `current_period_end` (unchanged), leaving `stripe_subscription_id` alone. `merchants` still gets `status: 'active'`, `plan: 'pro'`.

This replaces the current comment that merely warns "don't comp a paying shop" with a refusal.

### `POST /api/admin/uncomp-merchant` (new)

`requireSuperadmin`. Sets `comped: false` and `merchants.plan = 'basic'`. Touches neither `merchants.status` nor `current_period_end`: suspension is a separate decision, and conflating them is what makes a temporary suspension silently end a comp.

### Comped refusals

Three routes refuse a comped shop with `{ error: 'shop_is_comped' }`, 409, **before** any Stripe call:

- `/api/billing/portal` — the reported bug.
- `/api/checkout` — terminal comp means no self-serve purchase.
- `liveSubscription` (`app.ts:1056`), backing cancel / downgrade / resume.

The third is load-bearing and follows directly from keeping `stripe_subscription_id`. Its gate is `!stripe_subscription_id || !LIVE_STATUSES.includes(status)`. A comped row has `status: 'active'` and, for a shop comped after a cancelled subscription, a surviving subscription id — both pass. Without the check, `POST /api/billing/cancel` on a comped shop reaches Stripe holding an id that is either dead or someone's real cancelled subscription. The UI never shows those buttons once `canManage` is false; the route has to guard itself regardless.

`requirePro` reads `merchants.plan`, so Pro entitlement is untouched throughout.

## Frontend

### `subscriptionTabState.ts`

The module keeps owning the decision; the component gets one boolean.

```ts
export interface SubscriptionSnapshot extends BillingSnapshot {
  stripe_customer_id?: string | null
  pending_plan?: string | null
  /** Complimentary tier, no Stripe behind it. Every billing action is off. */
  comped?: boolean | null
}
```

`comped` joins `Actions` as a plain field. Three terms change:

```ts
const comped = !!billing?.comped
const live = !!customer && !!status && LIVE.includes(status) && !comped
// canSubscribe: !live && !comped
// canUpgrade:   tier !== 'pro' && !comped && !ending && status !== 'past_due'
```

`canUpgrade` takes `!comped` even though comp always grants Pro today, making the term inert. It is one word standing between a future Basic comp and an Upgrade button that `/api/checkout` now refuses.

### `SubscriptionTab.tsx`

Kind stays `'none'`. Two branches on `state.comped`:

- price cell renders `t('Free', '免费')` rather than `formatMoney(planPrice, …)` — a comped shop must not be shown a price it does not pay;
- the sentence reads *"Complimentary Pro — no billing on this shop."* rather than *"No subscription on file for this shop yet."*, which currently sits under a Pro badge and contradicts it.

Everything else falls away on flags that are now false: no Summary grid, no buttons, no upgrade card.

### `billingErrors.ts`

```ts
case 'shop_is_comped':
  return t(
    'This shop is on complimentary Pro. There is no billing to manage.',
    '此店铺为赠送的 Pro 方案，无需管理账单。',
  )
```

Not folded into `no_live_subscription`: that message tells the merchant to reload, which is wrong advice for a state that will not change on reload.

### `AdminMerchants.tsx`

`comped` joins the `MerchantBilling` type and `fetchAllBilling`'s select. The Subscription cell's label map gains `comped ? t('comped', '赠送')` ahead of the status branches, in `text-text-tertiary` — neutral, being neither healthy nor failing. "Comp Pro" is additionally hidden when `m.comped`; a new "Un-comp" item shows only when it is true.

## Tests

- `subscriptionTabState.test.ts` — a comped row yields `kind: 'none'`, `plan: 'pro'`, `comped: true`, all six action flags false. Plus the regression case: comped **with** a leftover `stripe_customer_id` and `status: 'active'` still gives `canManage: false`. That case is the production 502, written as a unit test.
- `billing-actions.test.ts` — a comped shop gets 409 / `shop_is_comped` from downgrade, cancel and resume. Fits the suite's network-free scope: these are guards, so nothing reaches Stripe.
- `tests/api/comp.test.ts` (new) — comp refuses a shop with a live subscription (409); comp clears `stripe_customer_id` and keeps `stripe_subscription_id`; un-comp clears the flag and drops `plan` to basic without touching `merchants.status`; both routes refuse a non-superadmin.
- `checkout.test.ts` — a comped shop is refused.

## Out of scope

Recovering from a dangling `stripe_customer_id` in general — `/api/billing/portal` and `/api/checkout` both trust a stored id blindly and could clear and recreate on Stripe's `resource_missing` rather than failing. Worth a separate issue; this spec removes the one path that was reliably producing dangling ids.

## Deployment

The migration is applied locally only. Production needs `db:push` run by a human after merge.
