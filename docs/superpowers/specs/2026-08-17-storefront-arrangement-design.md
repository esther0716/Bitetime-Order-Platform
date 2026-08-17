# Storefront arrangement — the merchant drags their own menu into order

Date: 2026-08-17
No issue yet. Brainstormed directly; file one before implementation starts.
Builds on: [ADR 0013](../../adr/0013-menu-categories-live-on-the-merchant-row.md) — menu categories
live on the merchant row.

## Problem

A merchant cannot decide the order of their own menu.

Categories already carry an order: `merchants.product_categories` is a jsonb array, and array order
is display order (ADR 0013). The merchant sets that order with Up and Down buttons in
`MenuCategoriesDialog`.

Products carry no order at all. `products.sort` exists in the schema, and both product reads sort on
it (`order('sort').order('created_at')` in `app.ts`), but **nothing writes it**. `sort` is not in
`PRODUCT_FIELDS`, so every row holds the default `0` and the real order is creation order. A shop
that adds a drink after its cakes lists that drink last, for ever, and has no way to move it.

The merchant also cannot see the result. Category order lives in a dialog that shows a list of text
inputs. Product order lives nowhere. The storefront is the only place that shows the outcome, and
the merchant must open it in another tab to look.

## Goal

One dashboard screen shows the shop's menu as the storefront draws it. The merchant drags a heading
to move a section. The merchant drags an item to move it inside its section, or into another
section. One Save button writes the whole arrangement.

## Non-goals

- **Storefront appearance.** No theme colour, no banner, no grid-versus-list choice. This feature
  orders things; it does not style them.
- **Product editing.** `ProductsManager` stays the place to add, edit, price and photograph a
  product. The arrangement screen writes two fields and nothing else.
- **Category naming.** `MenuCategoriesDialog` keeps the name, the Chinese name, the hidden toggle
  and the delete. It loses only its Up and Down buttons — see *One place to order*.
- **A per-category sort key.** One global `sort` per shop. See *Sort is global*.
- **Sorting the merchant's product table.** The `ProductsManager` table keeps its own column sort,
  its search and its paging. Those answer "find this product", not "what does a customer see".
- **A second visibility control.** The screen shows hidden products and hidden categories, but it
  does not switch them. `active` is set where it already is: in the product dialog and in
  `MenuCategoriesDialog`.

## Decisions

| Decision | Choice |
|---|---|
| Where the merchant drags | A new dashboard section, `storefront` |
| What the drag surface looks like | The storefront's own menu, at phone width. The surface is the preview |
| Product order storage | `products.sort`, written by one new endpoint |
| Scope of `sort` | Global per shop, `0..n-1` across every section in render order |
| Category order storage | Unchanged — the jsonb array on the merchant row |
| Drag across a heading | Allowed. It rewrites `products.category_id` |
| Save | One button, an explicit draft until then |
| Drag library | `@dnd-kit/core` + `@dnd-kit/sortable`, merchant chunk only |
| Migration | None. The column is already there |

## Sort is global

The screen flattens the arrangement — first category in order with its items, then the second, then
the trailing uncategorized block — and numbers the result `0..n-1`.

A per-category counter would need the section to break the tie, and the storefront's read is one
flat query. A global number means the query already returns products in exact render order, and
`menuGroups.ts` only has to group them. There is no second opinion about order anywhere.

A product that moves between sections gets a new number for the same reason it gets a new
`category_id`: both describe where it now sits.

## The write path

One new endpoint:

```
PUT /api/merchants/:id/product-order
{ "items": [ { "id": "<uuid>", "sort": 0, "category_id": "<id|null>" }, … ] }
```

Guarded by `requireMerchantOwns`, like every other write under `/api/merchants/:id`.

The write is **one SQL statement** through `db.ts`:

```sql
update products p
   set sort = v.sort, category_id = v.category_id
  from unnest(${ids}::uuid[], ${sorts}::int[], ${categoryIds}::text[])
       as v(id, sort, category_id)
 where p.id = v.id
   and p.merchant_id = ${merchantId}
```

Three parallel arrays through `unnest`, not a built `values` list. The statement is then a fixed
string with three parameters, whatever the shop's size — no SQL is assembled from the body.

One statement is atomic, so no `withTransaction()` wrapper is needed. A merchant never sees half an
arrangement.

`db.ts` is RLS-exempt. It connects as the database owner and no policy runs on it. **The
`p.merchant_id = ${id}` predicate is therefore the only tenancy guard on this path**, and it must
stay in the statement. A crafted body that names a stranger's product id updates zero rows, which
is the correct outcome and needs no separate check.

Bounds the handler enforces before it touches Postgres:

- At most 500 items. A shop with more products than that has a different problem, and an unbounded
  `values` list is an unbounded statement.
- Every `id` must be a uuid, or the `::uuid` cast raises and the request fails as a 500 instead of
  a 400.
- `sort` must be a non-negative integer. `category_id` must be a string or null; it is **not**
  checked against the shop's category list, for ADR 0013's reason — an id the list no longer holds
  reads as uncategorized, and a stale dashboard must not meet a refusal.

`sort` stays **out of `PRODUCT_FIELDS`**. This endpoint is the only writer. The product upsert must
never move an item, because `ProductsManager` spreads a whole row on edit and would otherwise carry
a stale `sort` back with it.

Categories keep the write they already have: `PATCH /api/merchants/:id` with `product_categories`,
which `pickMerchantConfig` already validates through `validateMenuCategories`.

## Save is two requests, and what a partial failure means

Save sends the product order first, then the categories.

The two writes are not atomic together. If the second fails, items moved and headings did not. That
order is deliberate: a wrong item order inside correct headings is a smaller wrong than headings
that name sections whose items never moved.

Both writes are idempotent, so the screen keeps the draft, keeps the dirty flag and shows a
refusal. Save retries the whole arrangement. Nothing is dropped and the merchant is told.

The screen registers a `NavGuard` blocker while the draft is dirty, the same guard `ShopSettings`
uses. A merchant who leaves the section with unsaved drags meets the existing Cancel / Discard
confirm.

## The screen

`Dashboard.tsx` gains one entry in `SECTIONS`, keyed `storefront`, between Products and Vouchers.
The label is "Storefront" / "店面". `useDashboardSection` already takes the key list, so the hash
route follows.

`src/merchant/StorefrontArranger.tsx` renders one phone-width column:

- One block per category, in array order, each with the category name as its heading.
- The products of that category under it, in `sort` order.
- The trailing block for products in no category, un-headed, exactly as the storefront draws it.
- An empty category still renders as a heading with an empty drop area. The storefront hides an
  empty section; the arrangement screen must show it, or the merchant cannot file anything into it.

Both levels are `@dnd-kit` sortables: categories in one list, products in a multi-container
sortable across the blocks.

### The surface is the preview

`Storefront.tsx` and this screen share a presentational `MenuRow` (`src/components/MenuRow.tsx`):
the thumbnail, the name and `name_zh`, the description, and a right-hand slot.

Only the shell is shared. The storefront passes its price line, promo badge and quantity control
into the slot. The arrangement screen passes a plain price. The storefront's promo computation
reads the cart and is about 60 lines; it stays where it is, and this screen never sees it.

So the two surfaces cannot drift in layout, which is what the merchant is judging, and they are
free to differ in behaviour, which the merchant is not judging here.

### What the preview is honest about, and what it is not

The preview is faithful about **order and layout**. It is deliberately not faithful about
**visibility**:

- A hidden product is drawn, dimmed, with a "hidden" tag.
- A hidden category is drawn as a section, with a "hidden" tag on its heading.

A merchant must be able to file an item into a section that is switched off — that is what a
seasonal section is for — and cannot do it if the section is not on screen. The tags are what stop
the merchant reading the screen as a promise about what a customer sees.

`menuSections()` is not used here for the same reason. That function answers the storefront's
question ("what does a customer see"), and this screen asks the merchant's question ("where is
everything filed"). Two questions, two functions.

### One place to order

`MenuCategoriesDialog` loses its Up and Down buttons.

Both surfaces would write the same array, so nothing would break — but two places that order the
same list is two places to check when the order looks wrong. Ordering moves to the arrangement
screen. Naming, hiding and deleting stay in the dialog, reachable from the arrangement screen's
header as well as from `ProductsManager`.

The dialog's comment that explains its buttons is rewritten, not deleted: it records why array
order is display order, which is still true.

The arrangement screen hosts its own instance of the dialog, and **seeds it from the draft**, not
from the merchant row. The dialog saves the list it was given, so a rename made after a drag keeps
the dragged order. Seeding from the row instead would write the stored order back over the
merchant's unsaved drags, behind a success toast. After that save the screen re-seeds its category
draft from the refreshed row; a dirty product order stays dirty.

### Keyboard and touch

`@dnd-kit`'s `KeyboardSensor` and `PointerSensor` cover both, and the library ships screen-reader
announcements for pick-up, move and drop. No parallel button path is kept, which is the trade ADR
0013's dialog refused when the repo had no drag library. This feature is the reason to add one.

The library loads in the merchant route chunk only. It never reaches the storefront or the
marketing pages, whose first-paint budget is the reason the webfont is self-hosted.

## The pure part

`src/merchant/menuArrangement.ts` — presentation, so it sits beside `menuGroups.ts` in the frontend
and **not** in `@bitetime/shared`. The backend has no opinion about the order of headings on a page.

```ts
/** The draft the screen holds: every category, hidden ones included, plus the trailing block. */
interface ArrangedBlock<T> { category: MenuCategory | null; products: T[] }

/** Build the draft from the two stored things. */
function arrangeMenu<T>(products: T[], categories: MenuCategory[]): ArrangedBlock<T>[]

/** A position in the draft: which block, and which index inside it. */
interface Slot { block: number; index: number }

/** Apply one drop: an item moved to a slot, or a block moved to an index. */
function moveProduct<T>(blocks: ArrangedBlock<T>[], from: Slot, to: Slot): ArrangedBlock<T>[]
function moveCategory<T>(blocks: ArrangedBlock<T>[], from: number, to: number): ArrangedBlock<T>[]

/** Flatten to the request body: global sort, and the block each product now sits in. */
function productOrderPatch<T>(blocks: ArrangedBlock<T>[]): { id: string; sort: number; category_id: string | null }[]
```

`arrangeMenu` differs from `menuSections` in three ways, and each is the merchant's question rather
than the customer's: it keeps hidden categories, it keeps empty categories, and it puts a product
whose `category_id` no longer resolves into the trailing block without dropping the id — the save
then writes `null` and the dangling id is finally cleaned up by the act of arranging.

`productOrderPatch` returns **every** product, not a diff. A diff is smaller and is wrong the moment
two browsers arrange the same shop: the second save would carry only its own changes and leave the
first save's numbering interleaved with them. The full list is last-writer-wins, which is the
behaviour every other merchant write already has.

## Tests

Unit, `src/merchant/menuArrangement.test.ts`:

- Move an item inside its section.
- Move an item into another section; its `category_id` changes.
- Move an item into the trailing block; its `category_id` becomes null.
- Move an item into a hidden section; it is allowed.
- Move a section; every product in it renumbers.
- A product with a dangling `category_id` starts in the trailing block, and the patch writes null.
- An empty shop produces an empty patch.
- The patch is dense: `0..n-1`, no gaps, no repeats.

API, `apps/backend/tests/api/productOrder.test.ts` (needs local Supabase, real Postgres, never a
mock):

- A valid body writes `sort` and `category_id`, and the public product read returns the new order.
- A body naming another shop's product changes nothing in either shop.
- A caller who does not own `:id` is refused by `requireMerchantOwns`.
- Over 500 items is a 400.
- A non-uuid id is a 400, not a 500.
- A `category_id` that the shop's list does not hold is accepted, per ADR 0013.

Unit, `apps/backend/tests/unit/writes.test.ts`: `pickProductFields` still drops `sort`.

The UI is verified by running the app, per CLAUDE.md — drag with a mouse, drag on a touch emulation,
move an item with the keyboard, then load the storefront and confirm the order matches.

## Documentation to update

- `CLAUDE.md` — the routing and data-layer sections gain the new dashboard section and the new
  endpoint.
- `CONTEXT.md` → Menu category — record that product order is now a stored, merchant-set thing.
- ADR 0013 is **not** amended. Nothing it decided changes; this feature spends the affordance it
  bought.

## Known limits

- **Two browsers arranging one shop.** Last save wins, whole-list. There is no version check and no
  merge. Same as every other merchant write.
- **No undo.** A merchant who drags wrongly drags back, or leaves without saving. The explicit Save
  is what makes leaving a real escape.
- **A shop with hundreds of products** gets one long column with no search. Acceptable at the 500
  cap; a shop that outgrows it needs a per-section collapse, which is a later change.
- **The preview shows no cart, no options dialog and no promo badge.** It answers "what order" and
  not "what does buying feel like".
