# 9. The cart is a list of lines keyed by selection

Date: 2026-07-28
Status: Accepted. Not yet implemented — the build is #145.

## Context

A cart is `Record<string, number>` — product id to quantity — in `priceOrder`'s input, in `isCart`, in `Storefront`'s state and in the body of `POST /api/orders`.

Menu options break it outright. Two boxes of six muffins with different flavour mixes are two things a customer wants in one cart, and they share a product id. There is no arrangement of a map keyed on product id that holds both.

The map was already the odd one out. `priceOrder` **returns** an array, and it has to: the promo cap binds per unit, so a cart of ten against three remaining promo units splits into two `PriceLine`s carrying the **same product id** — which is why *Promo* in `CONTEXT.md` says anything rendering those lines must key by index. The output outgrew keying-by-product-id long ago; only the input still pretended otherwise, and every consumer paid for the translation.

The map was also doing real safety work by accident, and this is the part that must not be lost. Because one product could appear once, `promoState`'s `remaining` could be read independently per entry with no risk. Under an array, "Latte (oat) ×3" and "Latte (soy) ×3" each read `remaining = 3`, each claim three, and a cap of three sells six — the cap failing **open**, silently, with `promoClaims` summing the two and pushing `promo_sold` past its own limit. That is the shape of the swallowed voucher claim that `POST /api/orders` was rewritten to remove.

## Decision

A cart is a **list of `CartLine`** — `{ productId, qty, selections }` — on both sides of the wire.

A line's identity is a **derived key**: the product id plus its selections, canonically serialised. Two adds of the same product with the same selections produce the same key and **merge** into one line at qty 2. A random client-generated line id was rejected for one reason: a derived key is something the backend **re-derives** from data it already validates, where a random one is data it must trust or discard. The same canonical serialiser is what the Pro write gate uses to compare submitted groups against stored ones — one canonicaliser, two jobs, so it cannot rot in one place unnoticed.

**A selection describes one unit, and `qty` repeats it.** Line total is `(base + Σ(delta × optionQty)) × qty`, rounded once, and `PriceLine.unitPrice` becomes **all-in**.

**Promo `remaining` is a budget consumed across lines**, walked in canonical key order rather than in the order the customer happened to click. The total is identical either way — `min(Σqty, remaining)` — so this changes no money; it decides which line is *labelled* promo and which order items are written, and those should not depend on click sequence or JSON key order. `promoClaims` is unchanged: it counts units of a product, which is what `promo_sold` means.

**The cart caps keep their per-*product* meaning.** `MAX_CART_QTY` sums across a product's lines; `MAX_CART_LINES` still counts distinct products; a new separate cap bounds lines. Reinterpreting both per line was rejected because it multiplies a documented guarantee by the line cap and leaves the comment above it false.

Rejected:

- **Reinterpreting the caps per line** — a hundred thousand cookies is a smaller number with the same shape as the trillion the caps were written to stop, and it makes the storefront's limit message and the backend's refusal describe different rules.
- **A random line id** — the backend cannot verify it, and merging becomes impossible, so the cart shows the same drink twice and reads as a bug.
- **Keeping a `Record` with an encoded composite key** — the value has to carry the selections anyway, so it is this decision wearing a map's clothing, with `Object.keys` ordering deciding the promo split.
- **Pre-aggregating by product id, splitting, then redistributing to lines** — same total, but it distributes fractional promo units, and `promo_sold` is an integer count whose cap already needed a guard trigger plus a read-back assertion to be trustworthy.
- **Forbidding two lines of one product while its promo runs** — blocks buying an oat latte and a soy latte.

## Consequences

- **`.find` by product id is wrong from here on**, everywhere. It answers about the first matching line and says nothing about the rest. `Storefront.tsx`'s promo badge does exactly this today and under-reports as soon as this lands.
- **The blast radius is wide and shallow**: `priceOrder`, `isCart`, `cartRules` (`nextCart`, `pruneCart`), `submitGate`, `Storefront` state, and the order intake body. Mechanical, but it touches the two most safety-critical modules in the repo.
- **`CartLine` is a name already taken** — `Storefront.tsx` uses it for a *priced display line*. That type becomes `ReceiptLine`; `CartLine` means what the customer put in the cart. One name for both is how the promo split came to strain it.
- **The stepper on a product card can no longer edit a line that has selections** — there is no answer to which selection it would increment. Products with groups get an "Add" that opens a picker; quantity is adjusted in the cart.
- **The cart is not persisted**, so there is no stored-cart migration and no returning customer holding an unreadable shape. If persistence is ever added, this decision is what makes a version tag necessary.
- **Canonical ordering is now load-bearing** for which line is labelled promo. It changes no total, so `assertQuoteHolds` cannot catch a mismatch — a divergence between the two sides would show up only as an order item that reads oddly. Worth a shared test on the serialiser rather than trust.
