# Signup goes live: removing the superadmin approval gate

## Where this starts

A merchant signs up for Basic today and lands on this:

> ⏳ Pending review — **Your shop is under review.** ABC cafe is awaiting platform approval. You'll be able to manage it once approved.

Nothing else happens until a superadmin opens Admin → Merchants and clicks **Approve**. That click is what creates the Stripe customer, creates the 7-day cardless trial subscription, and flips `merchants.status` to `active` (`app.ts:824`). Until then the shop has no dashboard, no storefront, and no trial clock.

That gate was a deliberate decision (grilled 2026-07-02, shipped with the trial-expiry work): *approval is the abuse defense, and the trial clock starts at approval so the seven days are seven days of actually taking orders rather than seven days of waiting.* The comment above the handler still says so.

The trial has since become the product's front door — "7-day free trial, no card required" is on the pricing page, the signup form's plan banner, and the landing page. A self-serve trial that a human has to unlock is not self-serve. This spec removes the gate.

## What replaces it

Nothing, on the way in. Signup provisions the trial itself and the shop is live immediately. Moderation becomes reactive: a superadmin who finds a bad shop suspends it with the endpoint that already exists (`/api/admin/set-merchant-status`, `app.ts:931`).

Decisions taken during design:

| Question | Decision |
|---|---|
| Abuse posture | No gate. Suspend after the fact. Email confirmation (`config.toml`, `enable_confirmations = true`) stays the only pre-signup friction. |
| Signup notification to superadmin? | No. The admin merchant list is the surface; no Telegram or Resend ping. |
| Trial length now that setup time is inside the window | Stays 7 days. |
| Stripe fails during signup | The shop is created and stays `pending`; signup still succeeds. Merchant retries. |
| Does `pending` survive? | Yes, but its meaning changes: **provisioning not finished**, not **awaiting a human**. |
| Does `approve-merchant` survive? | Yes, unchanged, as the admin-side fallback for a shop stuck `pending`. |
| Pro signup | Unchanged. Pays upfront via Checkout; the webhook activates it. |

### Why not fail signup outright when Stripe fails

The cleaner invariant is "a merchant row exists only if its subscription does" — fail the whole signup, let them retry the form. It was rejected because the alternative failure is worse in the other direction and this one is worse for the merchant: a Stripe outage would block every new shop at the door, and the retry re-does the slug resolution and re-collects the form. Parking the shop at `pending` keeps the account, the slug and the business-nature answer, and costs one screen we already render.

### Why not activate anyway and provision later

Because `active` must imply "has a subscription". Trial-end suspension is entirely webhook-driven: Stripe cancels the trial sub for a missing payment method, `customer.subscription.deleted` arrives, and the shop is suspended (`app.ts:1791`). A shop that went `active` without a subscription has no such event coming — it is free forever, and nothing in the system will ever notice. That invariant is the reason provisioning gates activation rather than following it.

## Backend

### `startCardlessTrial` — one function, three callers

The body of `approve-merchant` (`app.ts:855–922`) is the whole trial-provisioning rule, and it is more than a Stripe call: it claims the row atomically, creates the customer only if `merchant_billing` has none, creates the sub with `trial_period_days: 7` and `trial_settings.end_behavior.missing_payment_method: 'cancel'`, persists it, and on either failure path reverts the claim and cancels an orphaned subscription so a retry cannot mint a second trial.

Extract it into `apps/backend/src/trialSubscription.ts` as `startCardlessTrial(merchant, billing)`. Three callers need it: signup, the merchant retry, and `approve-merchant` itself.

It keeps the ordering it has today — **the shop becomes `active` only after the subscription is persisted** — and returns enough for a caller to distinguish "trial started", "already had one, nothing to grant", and "Stripe refused". Stripe and Supabase effects stay inside it; unlike `billingLifecycle.ts` this is not a pure module, and should not pretend to be.

### `POST /api/merchants` (`app.ts:135`)

After the insert, which keeps forcing `status: 'pending'`:

- `plan === 'pro'` → return the row as today. Checkout is the activation path.
- Basic → call `startCardlessTrial`. On success the response carries the `active` row; on Stripe failure it still returns 200 with the `pending` row and a `trial: false` flag, and logs the failure.

Signup does not fail because Stripe hiccuped, and never returns an `active` shop without a subscription behind it.

### `POST /api/merchants/:id/start-trial` (new)

Owner-authorized (`requireMerchantOwns`) retry for a shop parked at `pending`. Guards, in order, all of them **before** any Stripe call:

1. `status === 'pending'` → else 409
2. plan is not `pro` → else 409 (`Pro shops activate via payment`, same wording as approval)
3. `canStartTrial(billing)` (`billingLifecycle.ts:13` — one trial ever, keyed on `stripe_subscription_id`) → else 409

Then `startCardlessTrial`. Guard ordering is not stylistic: `tests/api` is network-free, so a guard placed before the Stripe call is assertable there and a guard placed after it is not.

### What does not change

- **No migration.** `guard_merchant_status` (`20260702110000`) already exempts `service_role` and forces `pending` for everyone else, so the browser still cannot self-activate and the backend remains the only thing that can write `status`. The gate's removal is a change in *who the backend listens to*, not in what the database permits.
- `approve-merchant` keeps its guards, its atomic claim and its compensation, now calling the extracted function.
- Referral rewards. They key on `merchant_billing.status === 'active'` plus a resolvable customer and subscription (`referralReward.ts:73`) — that is "actually paying", so a shop on trial still pays out nothing. Signing up no longer needing approval does not open a referral farm.

## Frontend

**`PendingScreen.tsx`** — the `else` branch (line 58, the basic/cardless case) becomes a provisioning screen instead of a review notice: "Finishing setup", a **Try again** button calling the new endpoint, and the existing store-URL line. The `hasPlan` branch (Pro, abandoned Checkout → **Complete payment**) is untouched, as is the comment split it drives — only the sentence about waiting for approval goes.

**`MerchantHome.tsx:53`** — unchanged. `pending` still routes to `PendingScreen`; it is simply a screen almost nobody sees.

**`SignupScreen.tsx:84`** — the comment "The shop waits for platform approval, which is what starts the 7-day trial subscription" is now wrong. The code around it (basic → `window.location.replace('/merchant')`) is right either way.

**`AdminMerchants.tsx`** — the dropdown item at line 156 stays but is relabelled **Approve** → **Start trial**, which is what it does now that no one is waiting on it. Reject (`pending` → `suspended`), the pending badge (line 67) and `adminStats`' pending count (`adminStats.ts:104`) all stay: `pending` is still a real state worth seeing in the list, and a stuck shop is exactly what an admin should be able to push through.

## Copy

Three places promise the review, and the FAQ text is also the source of the landing page's FAQ JSON-LD (`marketing/structuredData.ts`), so this is public-facing in two ways.

| Location | Now says | Becomes |
|---|---|---|
| `faq.ts:108` (`id: 'approval'`) | "we review your shop before it goes live … Once approved, your order page is open and your free trial starts" | Sign up, add products, the order page is live immediately; the trial starts at signup |
| `faq.ts:59` (`id: 'website'`) | "ready as soon as your shop is approved" | ready as soon as you sign up |
| `Pricing.tsx:118` | "The clock starts when your shop is approved, not when you fill in the form" | The clock starts at signup — drop the sentence rather than invert it, since "your seven days include your setup time" is not a selling point |

Both languages, per the `t(en, zh)` convention — the FAQ entries carry `zh` for question and answer.

## Tests

`tests/api` suites are network-free by construction (`comp.test.ts` says so in its header, and it is the reason that whole route is assertable there). So the split is:

**Assertable in `tests/api`** — a new `writes-merchants` case or its own suite:

- Pro signup leaves the shop `pending` with no billing row (no Stripe on that path).
- `start-trial` refuses: a non-owner (403), a shop that is already `active` (409), a `pro` shop (409), and a shop whose `merchant_billing` row already carries a `stripe_subscription_id` (409, one-trial-ever). Each of these must be reachable without a Stripe call — see the guard ordering above.

**Run-and-verify** (per CLAUDE.md, with `stripe listen` forwarding): Basic signup → dashboard immediately, storefront reachable at `/s/<slug>`, `merchant_billing` row `trialing` with `trial_ends_at` seven days out, and the trial banner counting down. Then the failure path with a deliberately broken Stripe key: signup succeeds, shop sits at `pending`, the setup screen appears, and **Try again** with the key restored activates it.

**Unaffected but worth re-running:** `billingLifecycle.test.ts` (`canStartTrial` is unchanged and is now load-bearing in one more place) and any FAQ/prerender test that pins copy.

## Out of scope

- Heuristic hold-for-review (disposable email domains, blocked words in shop names, N shops per owner). Considered and rejected for now; if spam appears, this is the first thing to add.
- Any new-shop notification channel.
- Deleting `pending` from the status enum, or deleting `approve-merchant`.
- Trial length changes.
