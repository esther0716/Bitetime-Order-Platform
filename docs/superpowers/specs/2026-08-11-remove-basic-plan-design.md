# Remove the Basic plan

> Issue [#222](https://github.com/leongcheefai/Bitetime-Order-Platform/issues/222).
> Supersedes [ADR 0004](../../adr/0004-plan-entitlement-follows-the-stripe-price.md) and amends
> [ADR 0010](../../adr/0010-menu-options-are-pro-and-downgrade-hides.md) and
> [ADR 0015](../../adr/0015-a-shop-with-no-offerable-dates-pauses.md).

TinyOrder sells two tiers. It will sell one: **Pro, RM39.90 a month**, with the 7-day cardless
trial moved from Basic onto it. Every shop that signs up gets every feature.

No shop is on a Basic price today, so nothing is grandfathered and nothing is migrated. That is
what makes the deletion clean rather than a long-lived compatibility layer.

## The invariant that changes

Entitlement is `merchants.plan === 'pro'` today. It becomes **`merchants.status === 'active'`** —
a fact the storefront gate and the dashboard guard already enforce.

This is not a rename. With one tier, the only way a shop can lose a feature is to lose the shop,
and suspension already closes the storefront and locks the dashboard. A tier gate would then
guard a population of zero: it can never refuse a request that should be refused, and it can
still refuse one that should not — a stale `plan` in a long-open tab, a webhook that has not
landed yet. A gate with nothing behind it is a source of wrong 403s, so it goes.

`merchants.plan` and `merchant_billing.pending_plan` are **dropped**, not backfilled. A column
that still holds a tier is a trap for the next reader.

## Signup and the trial

One door. Signup provisions the cardless trialing Pro subscription and activates the shop, which
is what `startCardlessTrial` already does — the only change is which price it names.

- `POST /api/merchants` stops writing `plan` and stops returning early for a Pro signup. Every
  signup calls `startCardlessTrial`. Its failure posture is unchanged: the shop stays `pending`
  and the owner retries with `POST /api/merchants/:id/start-trial`.
- `priceFor(cycle)` loses its plan argument. `env.prices` keeps `pro_monthly` and `pro_yearly`.
- The trial itself is untouched: 7 days, no card, `trial_settings.end_behavior.missing_payment_method: 'cancel'`,
  one trial ever (`canStartTrial` reads `stripe_subscription_id`), and trial-end suspension driven
  by `customer.subscription.deleted` with the hourly sweep as the backstop.
- `POST /api/checkout` is untouched and keeps its real population: a shop with **no** live
  subscription — trial lapsed, cancelled, or un-comped.

### The signup URL must stay tolerant

The route becomes `/merchant/signup/:a?/:b?`, and whichever segment reads `monthly` or `yearly`
selects the cycle. Anything else is ignored.

This is not cosmetic. Stripe's `cancel_url` and every link already sent point at
`/merchant/signup/pro/monthly`. A two-segment path that stops matching renders no route at all,
which is a blank page rather than a 404. `canonicalPath` already collapses everything under
`/merchant/signup` to the bare URL, so the indexed page does not change.

## Backend

| Removed | Reason |
|---|---|
| `requirePro`, `hasProAccess`, `REQUIRES_PRO` (`mw.ts`) | guard a population of zero |
| plan gates in `writes.ts`: `promoChanged`, `optionsChanged`, `categoriesChanged`, `pixelIdsChanged` | same |
| `revokeProArtifacts`, `restoreCustomDates` (`billing.ts`) | fire on a tier transition that cannot happen |
| `deactivateAll` for groups and categories (`packages/shared`) | `revokeProArtifacts` was the only caller |
| `POST /api/billing/downgrade` (`app.ts`) | nothing to step down to |
| `downgradePhases`, `ScheduleError`, `LivePhase` (`subscriptionSchedule.ts`) | the downgrade route was the only caller |
| plan reads/writes in `reconcileMerchantPlan` | it reconciles `billing_cycle` only |
| `plan: 'basic'` in `lapseMerchant` | lapse means suspend |
| `plan: 'basic'` in `POST /api/admin/uncomp-merchant` | un-comp clears the flag |
| `STRIPE_PRICE_BASIC_MONTHLY`, `STRIPE_PRICE_BASIC_YEARLY` (`env.ts`) | archived in Stripe |

`planFromPriceId` becomes `cycleFromPriceId`. The price on the live subscription still answers a
real question — monthly or yearly — and the null-means-change-nothing rule is kept for the same
reason it was written: an unrecognised price is a price we did not configure, and guessing from
one moves real money.

Routes that shed the gate and become owner-only: `PUT /api/merchants/:id/secret` (Telegram),
`POST` and `DELETE .../vouchers`, `GET .../report.xlsx`, `PUT .../customers/:phoneKey` (notes and
tags), the conditional gate inside `GET .../customers` (sorting and tag filters), the
`mode: 'custom'` refusal in the fulfilment write, and the pixel-id write.

`notify.ts` stops skipping the Telegram send for a non-Pro shop. It keeps every other skip — no
token configured, no chat id — because those are still true.

The `active` flag on option groups, options and menu categories **stays**. It does double duty:
`revokeProArtifacts` set it, but it is also the merchant's own Hide control and the soft delete
ADR 0008 asks for. Only the bulk `deactivateAll` helpers go. `fulfilment_needs_review` stays too,
and loses one of its two causes — dates can still all expire; a downgrade can no longer pause a
shop.

### Comps

`merchant_billing.comped` survives and its meaning narrows to **"billing does not apply"**: the
shop runs with no subscription behind it and the reconciliation sweep skips it. The sweep's
`not comped is true` filter is already written that way and does not change.

`POST /api/admin/comp-merchant` sets the flag. `uncomp` clears it and winds the billing row back
to "no subscription", which is what leaves the shop able to pay. Neither writes a tier.

## Frontend

`plan.ts`, `plan.test.ts` and `ProLock.tsx` are deleted. Every lock they drew opens:

- Dashboard nav (the Vouchers entry)
- Shop Settings → Alerts (the Telegram form) and → Marketing (the pixel form)
- Vouchers manager
- Products manager (promo price fields, menu options, categories)
- Overview (the spreadsheet export)
- Customers (notes, tags, the tag-filter row, the sort control)
- Fulfilment (custom order dates)

`SubscriptionTab` loses the plan name row, the upgrade CTA, the step-down-to-Basic button and its
undo. It keeps the price, the renewal date, the trial countdown, cancel, undo-cancel and the
billing portal link. `subscriptionTabState` loses `plan`, `pendingPlan`, `pendingAt` and
`canDowngrade`.

`DeactivatedVouchers` is **deleted**, not unlocked. It exists to name the codes
`revokeProArtifacts` switched off at a downgrade; with no downgrade there is nothing for it to
report, and a panel that can only ever render nothing is worse than no panel.

`AdminMerchants` loses the plan badge and keeps the comp badge. `store.ts` drops `plan` from
`createMerchant` and `startCheckout`; `types.ts` drops `Merchant.plan`. `api.ts` needs only a doc
comment corrected — the `requires_pro` code was never handled there, it was recognised in
`plan.ts`.

## Marketing

`PRICING_TIERS` becomes one tier. Its note becomes *"Free for 7 days · no card"* in both
languages — the per-tier note existed only because the trial was Basic-only.

`PLAN_COMPARISON_GROUPS` becomes `INCLUDED_GROUPS`. The four sections survive (Storefront &
catalog, Orders & delivery, Customers & marketing, Alerts & support). Each row keeps its label and
its **Pro** value; the `basic` column, the `ComparisonValue` boolean form and every ✓/– icon go.
Rows whose two values differed in kind keep the Pro wording:

| Row | Becomes |
|---|---|
| Dates customers can order for | A rolling window, or the exact dates you tick |
| Your customer list | Included, plus sorting and tag filters |
| Support | Priority — your questions jump the queue |
| Free trial | 7 days, no card |

Rows that were `true` on both plans keep their text. Rows that were `false` on Basic become plain
included lines.

The landing summary and `/pricing` each render one card and the grouped included-list. The
monthly/yearly toggle stays. `/pricing` stays a route of its own — it is prerendered, in the
sitemap, and in `llms.txt`, and removing it would be six coordinated deletions for no gain.

Then the prose: `faq.ts`, `useCases.ts`, `FeaturesPage.tsx`, `public/llms.txt`.

### The Terms change with it

`legal/documents.ts` carries two paragraphs describing a move to a cheaper plan and what it
deactivates — vouchers and running promos. That behaviour will not exist. Leaving the words is a
promise about something that cannot happen, so both paragraphs go. The paid-plan wording around
the ad pixel is reworded to name the subscription rather than a tier.

## Migration

```sql
alter table merchants        drop column if exists plan;
alter table merchant_billing drop column if exists pending_plan;
```

Applied locally with `db:migrate`. **A human runs `db:push`.** It must land with the deploy, not
before it: the running backend still selects `plan` until the new build is out.

## Stripe (human only, no code)

1. Set the Pro monthly price to **RM39.90**; set yearly to ten months' worth.
2. Archive both Basic prices.
3. Turn **off** plan switching in the Customer Portal configuration. With one price it can only
   lead somewhere pointless.

Item 1 is load-bearing for the marketing pages: amounts are read from Stripe at runtime and no
number is frozen into the repo, so the price on the site is whatever Stripe says.

## Tests

- Delete the `403 requires_pro` cases in `tests/api/customers`, `report`, `writes-products`,
  `writes-secret`, `writes-vouchers`, `writes-merchants` and `tests/unit/notify`. Where the case
  proves a **refusal**, invert it to prove the request now succeeds — a deleted refusal test with
  nothing in its place leaves the route unexercised.
- `tests/unit/pricing.test.ts` — rewrite around `cycleFromPriceId`.
- `tests/unit/subscriptionSchedule.test.ts` — delete with `downgradePhases`.
- `tests/api/checkout.test.ts`, `start-trial.test.ts`, `webhook-plan.test.ts`,
  `webhook-lapse.test.ts`, `billing-sweep.test.ts`, `billing-sync.test.ts`, `comp.test.ts` —
  drop the plan assertions, keep the cycle, status and suspension ones.
- Frontend: delete `plan.test.ts`; rewrite `pricingTiers.test.ts`, `subscriptionTabState.test.ts`,
  `pendingShop.test.ts` and `reactivationChoice.test.ts`.
- `canonical.test.ts` — keep the preselection collapse, drop the plan segment from the fixtures.

UI is verified by running the app, per CLAUDE.md: sign up a shop, confirm the trial starts with no
card, and confirm Telegram, vouchers, promos, options, custom dates, the export and the pixel form
are all open on a brand-new shop.

## Docs

- `CONTEXT.md` — *Plan entitlement* is rewritten as *Subscription*. The Pro clauses in the
  fulfilment, menu options, menu categories, customers and order-notification sections lose their
  tier halves. The billing-lifecycle section drops the downgrade path.
- New ADR **"One plan"**, recording why the gate goes rather than staying dormant. It supersedes
  ADR 0004 and amends 0010 and 0015, both of which describe what a downgrade hides.
- `.claude/skills/verify/SKILL.md` walks a Basic shop through an upgrade; rewrite that step.

## Out of scope

- Any change to what the features do. This removes a gate and a price; it adds no capability.
- Annual pricing strategy. Yearly stays at ten months' worth.
- Re-introducing a cheaper tier later. If that happens it is a new design, not a revert — the
  columns are gone.
