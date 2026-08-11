# 10. Menu options are Pro, and downgrade hides rather than deletes

Date: 2026-07-28
Status: Accepted and implemented (#145). **Amended by [ADR 0016](0016-one-plan.md).**

> Menu options are no longer Pro and no downgrade hides them — there is one plan (#222). What
> survives is the reason `active` exists at all: it is the merchant's own Hide control and a soft
> delete, and a *required* group switched off still takes its product off sale, because a product
> whose mandatory question cannot be asked is unfulfillable rather than merely degraded. The bulk
> `deactivateGroups` helper went with the revocation that called it.

## Context

Menu options — a box of six muffins whose flavours the customer allocates, a coffee whose milk the customer picks — are the first Pro feature that is part of the **menu itself** rather than something a shop does with a menu it already has. Telegram alerts, vouchers, promos, the XLSX export and customer notes are all things a shop wants *after* it is selling. An option group is how some shops describe what they sell at all.

That makes the downgrade path the whole decision, because of the rule [ADR 0004](0004-plan-entitlement-follows-the-stripe-price.md) fixed and `revokeProArtifacts` implements: **the hot paths stay plan-blind**, and a step down to Basic is expressed as *data the order transaction was already reading*. A plan lookup inside `placeOrder`'s transaction puts billing state on the checkout path, where a slow or wrong answer costs an order. So "Basic shops keep their groups but the storefront ignores them" is not available — that is precisely the plan check that must not exist.

What *is* available is what vouchers and promos already do, and it is worth being exact, because it is easy to remember it as deletion and it is not. A revoked voucher keeps its row, its code and its redemption history and merely stops being redeemable. A revoked promo keeps its configured `promo_price` as the merchant's own record and has its `promo_end` moved to now, which `promoState` already reads as no promo. Both neutralise into a state the plan-blind hot path was already checking. Neither destroys the merchant's work.

The genuine argument against gating this at all: a shop that cannot express "box of six, choose your flavours" cannot list its actual product, so the gate is met during onboarding rather than during growth, and it may stop shops from starting rather than convert them to Pro. That argument was made and not taken. What follows is the arrangement that makes the decision survivable.

## Decision

Option groups are a **Pro feature**.

**The write gate compares, it does not sniff.** A non-Pro shop is refused when the submitted `option_groups` **differs from the stored one**, compared with the canonical serialiser the cart key already uses. `requireOwnsChild('products', 'productId')` has loaded the stored row before the handler runs, so the comparison costs no query. The entitlement being enforced is "a Basic shop may not *change* its option groups", and the gate states that rather than something adjacent to it.

**Stepping down to Basic hides, and never deletes.** `revokeProArtifacts` additionally sets `active: false` on every option group in the shop, **and** `active: false` on every product carrying a group with `minSelect >= 1`. A product whose mandatory question can no longer be asked is unfulfillable, not degraded: it would sell a six-muffin box with no flavours chosen and leave the merchant guessing what to pack. Products whose groups are all optional stay on sale at base price and lose the upsell.

As with vouchers and promos, the cutoff is **not symmetric**: re-subscribing does not switch anything back on. A merchant who wants their menu back says so.

Rejected:

- **Free for every shop** — the honest alternative, and the one that avoids this entire ADR. Rejected as a product decision: options are wanted as a paid differentiator. The cost is recorded under Consequences.
- **Deleting the groups at downgrade** — irreversible, with no history to restore from once [ADR 0008](0008-option-groups-live-in-the-product-row.md) put them in a jsonb column on the product row. A shop that stops paying would not be downgraded, it would be dismantled.
- **Keeping the groups and having the storefront ignore them** — makes `priceOrder` plan-aware. This is the thing ADR 0004 exists to prevent.
- **Gating only paid options (`delta > 0`) and zeroing deltas at downgrade** — worse than deleting: the menu looks intact while quietly selling oat milk for free. "Success toast, wrong data".
- **Deactivating every product that carries any group** — removes the coffee because "extra shot?" was an upsell.
- **A limit rather than a gate** (so many groups per product on Basic) — has this ADR's downgrade problem in miniature, and needs an answer for *which* group survives.
- **Refusing any body containing groups** — forces the dashboard to send explicit nulls to save anything else, leaving a shop's config one payload mistake from being cleared behind a success toast. This is what the promo gate did until `981f95a` replaced it with a comparison; reproducing it here would re-open a bug that has already been closed once.

## Consequences

- **A shop that downgrades loses part of its storefront**, visibly and without warning unless the dashboard says so. `DeactivatedVouchers.tsx` is the precedent for surfacing "these are switched off, and why"; options need the same, and products hidden this way need it more, because the merchant will otherwise see orders stop.
- **Onboarding is where the gate bites.** A shop whose product *is* a mix-and-match box meets the paywall before it has sold anything. This is the cost of the rejected alternative, and the signal that would justify revisiting: shops that sign up, build such a product, and never activate.
- **The hot paths stay plan-blind**, which is the point. `priceOrder`, the order transaction and the storefront read `active` — a flag they were already reading — and never ask what tier a shop is on.
- **The promo gate on the same endpoint already works this way** (`promoChanged`, `writes.ts`), so the two are consistent rather than merely similar. That gate was fixed for exactly this reason: asking whether a promo column was *present* refused a Basic shop an ordinary rename, and the workaround — omit the columns and trust the upsert — put a live sale one payload mistake away from being cleared behind a success toast. `optionGroupsChanged` is its twin and should stay one, including the rule that clearing is a change like any other: the groups a Basic shop may no longer edit stay put until it is Pro again.
- **The canonical serialiser becomes security-relevant.** If it normalises away a difference, a Basic shop can edit its groups; if it invents one, no Basic shop can save a product at all. It is also the cart key, so a shared test covers both uses.
- **`revokeProArtifacts` gains an idempotency requirement it already had** — filter on `active = true`, as the voucher update does, so a replayed webhook cannot deactivate something a merchant switched back on.
