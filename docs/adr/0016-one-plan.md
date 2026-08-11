# One plan

TinyOrder sold two tiers. It sells one — **Pro**, with the 7-day cardless trial moved onto it — and the tier concept is deleted rather than left dormant: `requirePro`, `merchants.plan`, `merchant_billing.pending_plan`, the step down to Basic and the artifact revocation that followed it are all gone.

**Entitlement becomes `merchants.status === 'active'`**, a fact the storefront gate and the dashboard guard already enforce. There is no second thing to check, and no hot path acquires a billing question it did not have.

The trial moves with the plan. Signup provisions the cardless trialing subscription for **every** shop (`startCardlessTrial`), so there is one door in and no signup asks for a card. Checkout keeps the population it always had — a shop with no live subscription — and grants no trial.

## Considered options

**Keeping the gate, hiding Basic** — signup writes `'pro'`, `requirePro` stays — was the smallest diff and was rejected on what a dormant gate is. With one tier it guards a population of zero: it can never make a correct refusal, and it can still make a wrong one. A stale `plan` in a long-open tab, a webhook that has not landed, a comp being revoked mid-session — each of those was already a way to 403 a merchant who was entitled, and the only thing that ever made that risk worth carrying was the revenue on the other side of it. Remove the revenue and only the risk is left.

**Backfilling `merchants.plan` to `'pro'` and narrowing its CHECK** was rejected for the same reason one step further out. A column that still holds a tier is a trap for the next reader: the next feature that wants to be "Pro only" finds a field that looks authoritative, and the tier is back without a decision having been made. No shop was ever on a Basic price, so there is no history in the column worth keeping.

**Keeping the step down to Basic as a "pause"** — a cheaper tier a shop could park on — was rejected because it is not what the code did. The step-down existed to move a subscription to a cheaper price; a pause is a different product with different Stripe mechanics (`pause_collection`, not a schedule) and a different answer for what the storefront does meanwhile. Reusing the machinery would have been the shape of a feature nobody had designed.

**Deleting `needs_review` with its writer** was rejected in favour of keeping the flag and its readers. `pauseFulfilment` was its only writer and went with the revocation, so nothing can pause a shop this way again — but a row written before this still carries it, and that row's owner was told their shop is paused until they confirm its dates. Dropping the reader would silently resume selling on a rolling window they never agreed to, which is the exact failure [ADR 0015](0015-a-shop-with-no-offerable-dates-pauses.md) exists to prevent. The Fulfilment tab's Confirm control still clears it.

## Consequences

**Every feature is now sold at one price, so the marketing pages state a feature list rather than a comparison.** `PLAN_COMPARISON_GROUPS` became `INCLUDED_GROUPS` and the ✓/– grid went with the second column. The rule that survived is the one that mattered: every line is checked against what the software does, because a line here the product does not do is a refund request.

**The Terms lost the downgrade clauses.** They described features stopping and vouchers deactivating at a step down. That cannot happen, and a legal document describing behaviour the software does not have is worse than one that is merely short.

**Re-introducing a cheaper tier later is a new design, not a revert.** The columns are dropped, the gate is deleted, and the marketing copy no longer has a shape to compare into. That is deliberate: the cost of this decision should be paid by whoever wants to undo it, not carried indefinitely by everyone who does not.

**Three things live in the Stripe dashboard and nowhere in this repo**: the Pro price itself, the archiving of the Basic prices, and turning plan-switching off in the Customer Portal configuration. Amounts are read from Stripe at runtime, so the site is wrong until the first is done, and nothing in CI will notice.

## Supersedes and amends

- **Supersedes [ADR 0004](0004-plan-entitlement-follows-the-stripe-price.md)** in full. The tier it derived from the Stripe price no longer exists; the price is still read backwards, but only for the billing cycle (`cycleFromPriceId`).
- **Amends [ADR 0010](0010-menu-options-are-pro-and-downgrade-hides.md).** Menu options are not Pro and no downgrade hides them. What survives is the reason `active` exists at all: it is the merchant's own Hide control and a soft delete, and `validateSelections` still treats a switched-off group as no question at all. Its SECOND clause does not survive: a *required* group switched off no longer takes its product off sale, because `hasRequiredGroup` had exactly one caller — the bulk revocation — and went with it. A merchant who hides a required group now has a product that simply stops asking that question.
- **Amends [ADR 0015](0015-a-shop-with-no-offerable-dates-pauses.md).** See the fourth option above: the pause survives as a state, and its cause does not.
