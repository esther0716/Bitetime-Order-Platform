# 8. Option groups live in the product row

Date: 2026-07-28
Status: Accepted. Not yet implemented — the build is #145.

## Context

Merchants need to attach questions to a product: a box of six muffins whose flavours the customer allocates, a coffee whose milk the customer picks. That is an **option group** (the question), its **options** (the answers), and a **selection** (what one customer chose) — see *Menu options* in `CONTEXT.md`.

The obvious shape is two child tables, `product_option_groups` and `product_options`, with foreign keys and cascade deletes. This repo's instincts point there: load-bearing invariants live in Postgres here — `products_promo_sold_guard`, `merchants_one_fulfilment_method`, the promo constraints — and a config row with `minSelect > maxSelect` is exactly the kind of nonsense a `check` exists to forbid.

Three facts push the other way.

**An option's `delta` is a price input on both sides of the wire.** `priceOrder` runs in the browser to quote and on the backend to charge, and a disagreement is a hard `price_changed` refusal, not a rounding gap. A `delta numeric` **column** comes back as a **string** from postgres.js and as a **number** from PostgREST — the precise trap `CONTEXT.md` records under `productFromRow`, where mapping one side and not the other refused every promo checkout and only a cross-driver test held it shut. Numbers inside `jsonb` parse as JavaScript numbers from **both** drivers, so the trap does not exist. And it costs no precision that is not already spent: `priceOrder` works in JavaScript numbers via `num()` and `round2`, so `price` is a float long before it is used.

**The save is atomic for free.** A product and its groups are one row, committed by the existing `PUT /api/merchants/:id/products/:productId` upsert. Child tables need `withTransaction`, a third `requireOwnsChild` guard, and an answer for a half-saved menu item.

**Nothing queries them independently.** Groups are read with their product, written with their product, and never referenced by the order — which snapshots names and deltas precisely so that editing a menu cannot rewrite a receipt. There is no foreign key that orders would have wanted.

The reuse question was settled first and settles this one: groups are **per product**, with a "copy options from…" action in the editor, and no shared library. A café editing "Milk" once and changing twelve drinks sounds like a saving until it changes the one drink that was deliberately priced differently — and the fix for that is per-product overrides, which is a library plus an override layer for a shop with a twenty-item menu.

## Decision

Option groups are a **jsonb column on `products`**: `option_groups jsonb not null default '[]'`. Groups own their options; array order **is** display order for both, so there is no `sort` column and no tie-break.

They are authored in a collapsible section of the existing product form and saved by the existing product upsert — one write, one dirty-tracking path, one failure mode.

Their invariants — `minSelect <= maxSelect`, `delta >= 0`, non-empty option list, unique names, and the caps on group count, option count and `maxSelect` — are enforced in **backend TypeScript**, at the write endpoint. This is a deliberate departure from putting load-bearing invariants in SQL, and it is affordable for one reason: after `20260718130000_revoke_all_browser_grants.sql` the backend is the **only** writer. RLS remains the backstop it already is.

Rejected:

- **`product_option_groups` + `product_options` tables** — reintroduces the numeric string/number split on a new price input, on both sides of the wire, where the failure is a refused checkout rather than a wrong pixel. Buys SQL constraints and a query ("which products use oat milk") nothing has asked for.
- **A merchant-level shared library** with attachment to products — editing one group silently repricing twelve products is a worse surprise than authoring them twice, and the mitigation is an override layer nobody wants to maintain.
- **A separate options editor screen** — implies a separate save, which reintroduces exactly the partial-write problem the jsonb column removes.
- **A top-level Options tab** — that is the shape of a shared library, and would teach merchants to expect the semantics we just rejected.

## Consequences

- **A malformed group is a TypeScript bug, not a constraint violation.** Nothing in Postgres stops `minSelect: 9, maxSelect: 2` if the validator is wrong; the database will store it and the storefront will render something absurd. The validator needs tests at the same level as `pricing.test.ts`, because it is the only thing standing there.
- **"Which products use this option" is not answerable** without scanning jsonb. Acceptable while nothing asks; a GIN index is the escape if something does.
- **Migrating to tables later is a real migration**, not a refactor — read every product, explode the arrays, backfill ids. That is what makes this worth an ADR.
- **Option ids need only be unique within their product**, since nothing outside the row points at them. The order snapshots names and deltas rather than referencing ids, so a deleted option never dangles.
- **The product form gets longer.** Mitigated by collapsing the section for the shops — most of them — that have no options at all.
- **If per-option stock is ever built, revisit this.** Inventory wants a row it can lock, and a jsonb array is the wrong thing to hold a lock on. That is the one fact that would change the answer.
