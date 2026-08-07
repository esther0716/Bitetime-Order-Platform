# 13. Menu categories live on the merchant row

Date: 2026-08-07
Status: Accepted and implemented.

## Context

A shop's menu is one flat list. `Storefront.tsx` renders `activeProducts.map(...)` under a single "Menu / 菜单" eyebrow, and a shop with thirty items hands the shopper thirty rows to scroll. Merchants want the sections a printed menu has: 饮料, 甜点, 蛋糕. That is a **menu category** — see *Menu category* in `CONTEXT.md`.

The obvious shape is a `product_categories` table: `id, merchant_id, name, name_zh, sort`, with a foreign key from `products` and `on delete set null`. This repo's instincts point there — tenant-scoped rows with RLS and an isolation test are how `products`, `vouchers` and `merchant_secrets` are all held.

[ADR 0008](0008-option-groups-live-in-the-product-row.md) reached the opposite answer for option groups, and it is the first thing a reader will reach for. **Its three reasons do not transfer**, and saying so is the point of this document:

- **The `numeric` wire trap is absent.** 0008's strongest argument was that a `delta numeric` column comes back as a *string* from postgres.js and a *number* from PostgREST, and that mapping one side and not the other is a refused checkout. A category's fields are `text` and `boolean`, identical from both drivers. Categories are not a price input; `priceOrder` never sees one.
- **There is no atomic save to buy.** 0008 got the product and its groups committed in one existing upsert. The category *list* is a shop-level object saved on its own, by a different write, from a different dialog.
- **They are queried independently.** 0008's third reason was that groups are read with their product and never alone. A category list is exactly the opposite: the storefront needs the list and its order to render headings, and the product form needs it to populate a picker, both without reference to any one product.

So the table was priced honestly, and the bill is what decided it. Every product read and write already goes through the backend's service-role client (`GET /api/merchants/:id/products` is unauthenticated; the browser has held no grants since `20260718130000_revoke_all_browser_grants.sql`). A new tenant-scoped table therefore costs a public read endpoint plus three authenticated write endpoints, a new RLS policy set with the `tests/rls` isolation suite that convention requires, a `requireOwnsChild` guard, a second storefront fetch on mount, and — because array order would become a `sort int` column — a reorder that writes N rows and so wants `withTransaction` through `db.ts`.

Against that, one fact does most of the work: **`MerchantProvider` already fetches the whole merchant row** (`GET /api/merchants/:slug`) before any storefront renders, and `ProductsManager` holds the same row through `useMerchant()`. A list stored there is already loaded on both surfaces, and `PATCH /api/merchants/:id` with its `pickMerchantConfig` allowlist is already the write path for shop-level config.

The second fact is that the table's headline benefit — `on delete set null`, so no product ever points at a category that is gone — **buys tidiness rather than safety here**. A category is decoration. A product whose category vanished is still priced correctly, still in stock, still sellable; the honest reading of a dangling id is "uncategorized", which is a state the model needs anyway for every product a merchant has not filed and every shop that never opens the feature. The read rule has to exist either way, and once it does, the foreign key is enforcing something nothing depends on.

Whether to gate this behind Pro was settled separately and follows [ADR 0010](0010-menu-options-are-pro-and-downgrade-hides.md), which in turn follows the rule [ADR 0004](0004-plan-entitlement-follows-the-stripe-price.md) fixed and `revokeProArtifacts` implements: **the hot paths stay plan-blind**, and a step down to Basic is expressed as *data the storefront was already reading*. "Basic shops keep their categories but the storefront ignores them" is not available — that is precisely the plan check that must not exist.

## Decision

Menu categories are a **jsonb column on `merchants`**: `product_categories jsonb not null default '[]'`, holding an ordered list of `{ id, name, name_zh?, active }`. A product points into it with `products.category_id text null`. Ids are client-generated UUIDs, so a rename is free and never touches a product row.

**Array order is display order** — 0008's arrangement, with no `sort` column and no tie-break. Reordering is an array swap saved by the same `PATCH /api/merchants/:id` that saves the rest, adding `product_categories` to the `pickMerchantConfig` allowlist. No new endpoint, no new table, no new RLS policy.

**Exactly one category per product, and none is allowed.** A product with no `category_id`, or with an id the shop's list no longer holds, is uncategorized and renders last under no heading. A category holding no active product renders nothing. Together these mean a shop with zero categories renders exactly the markup it renders today.

**Deleting a category removes only the list entry.** Its products keep a now-dangling id and are read as uncategorized. The confirm dialog states how many products that is.

**Categories are Pro, and downgrade hides.** `revokeProArtifacts` sets `active: false` on every category where `active = true` — filtered, so a replayed webhook is idempotent — and deactivates **no product**, because a category is decoration rather than a fulfilment requirement. The storefront reads `active`, never the plan. `active` is also the merchant's own per-category Hide toggle, which is what makes a re-upgrade need no resurrection logic and keeps `revokeProArtifacts`' deliberate asymmetry with upgrade intact.

**The write gate refuses a value that differs from the stored one**, canonically compared, on both `PATCH /api/merchants/:id` (`product_categories`) and `PUT /api/merchants/:id/products/:productId` (`category_id`) — *not* a body that merely contains the field. That is the distinction the promo gate got wrong, where refusing on presence forced the dashboard to send explicit nulls and an ex-Pro shop editing a product's name cleared its sale.

**Invariants live in `packages/shared/src/menuCategories.ts`**, beside `options.ts`, called by the write endpoints: at most 20 categories, name 1–40 characters after trim, `name_zh` at most 40, and names unique within a shop on a folded key — case and punctuation stripped with `\p{P}\p{S}\s` so a Chinese name is not reduced to the empty string. The two languages fold into SEPARATE vocabularies: an English name colliding with a Chinese one is not a thing that can happen on screen, and sharing one set would refuse a legal list. The fold is a deliberate twin of `tagSuggestions`' private `matchKey` rather than a shared function — see the note on `categoryMatchKey` for why hoisting it into `@bitetime/shared` would be wrong. Postgres holds only that the column is an array.

Rejected:

- **A `product_categories` table with a foreign key** — priced above. Buys `on delete set null` for a relationship whose dangling case is benign and whose "uncategorized" reading is required regardless, and costs four endpoints, an RLS suite, a guard, a second storefront fetch, and a transactional reorder.
- **A denormalized `products.category text`** — no shop-level list, so category order is underivable beyond alphabetical, a rename is an N-row update, and `Drinks` / `drinks` fragment one section into two with nothing on the storefront to explain it.
- **Many categories per product** — that is a filter, not a section. It puts a chip bar above a six-item menu and reopens "why is this cake listed twice".
- **An auto-generated "Other / 其他" section** for uncategorized products — puts a platform string inside a shop's own menu design, and gives a shop with two filed products and thirty unfiled ones a heading that is a lie about its menu.
- **Render-time plan gating** (`plan !== 'pro'` in `Storefront.tsx`) — the exact plan check ADR 0004 and `revokeProArtifacts` exist to keep off the storefront.
- **Clearing `category_id` at downgrade** — 0010's own words: a shop that stops paying would not be downgraded, it would be dismantled.
- **Free for every shop** — the honest alternative, and the argument for it is real: sections help the *shopper*, and every menu on the platform being legible serves the platform. Rejected as a product decision; categories are wanted as a paid differentiator. The cost is recorded under Consequences.

## Consequences

- **A malformed category list is a TypeScript bug, not a constraint violation** — 0008's consequence, inherited whole. Postgres will store a 200-character name or two categories called "Cakes" if `validateMenuCategories` is wrong. It needs tests at the level `pricing.test.ts` sets, because it is the only thing standing there.
- **"Which products are in this category" is a scan, not a query.** Acceptable while only the merchant's own product table asks it, over a list capped at 20 against a menu of tens.
- **Dangling `category_id` values accumulate** and are never cleaned. Harmless by construction — the read rule folds them into uncategorized — but a merchant who deletes a category and recreates it with the same name does **not** get their products back, because the new entry has a new id. That is the correct behaviour and it will still read as surprising.
- **A newly added product with no category falls to the bottom of a long menu**, which a merchant can mistake for it not saving. Mitigated by a Category column in the dashboard's product table, not by changing where uncategorized renders.
- **A Basic shop's storefront visibly loses its structure at downgrade.** Menu options only ever hid a control; this is customer-facing. It degrades to today's flat list rather than to anything broken, and the merchant's authored list survives untouched — but it is a real cost of choosing Pro, and it is the thing to revisit if downgrade complaints appear.
- **Migrating to a table later is a real migration, not a refactor** — read every merchant row, explode the array, backfill ids, rewrite `products.category_id` as a foreign key. That is what makes this worth an ADR.
- **If categories ever need attributes of their own** — a header image, a visible-window, a per-category tax rate, revenue subtotals in the xlsx report — revisit this. A jsonb list is a poor place to grow a schema, and the first of those to be genuinely wanted is the fact that would change the answer.
