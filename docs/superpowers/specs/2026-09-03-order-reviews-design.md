# Order reviews — design

Date: 2026-09-03

## Purpose

A customer rates an order from 1 to 5 stars and adds an optional comment. The merchant reads
that rating on their own dashboard. Nothing is public.

## Decisions

| Decision | Choice |
|---|---|
| When the customer rates | On the order-placed screen, immediately after checkout |
| Who can rate | Signed-in customers and guests |
| Who reads the rating | The shop that took the order, on the dashboard only |
| How many reviews | One per order, and the customer can change it |

The rating measures the checkout, not the food. The customer rates before the shop prepares
the order. This is deliberate: the order-placed screen is the only screen a guest reliably
comes back to, and a guest order carries `user_id = null` for ever.

## Storage

Three columns on `orders`. There is no new table.

```sql
-- 20260903120000_order_reviews.sql
alter table public.orders
  add column if not exists review_rating smallint,
  add column if not exists review_comment text,
  add column if not exists review_at timestamptz;

alter table public.orders
  drop constraint if exists orders_review_rating_range,
  add constraint orders_review_rating_range
    check (review_rating is null or (review_rating between 1 and 5));

alter table public.orders
  drop constraint if exists orders_review_comment_length,
  add constraint orders_review_comment_length
    check (review_comment is null or char_length(review_comment) <= 500);
```

Columns, not a table, for three reasons:

1. One review per order becomes structural. A row cannot hold two.
2. The merchant already reads whole order rows. `OrdersView`, the detail sheet and
   `fetchMyOrdersAtShop` get the review with no join and no second request.
3. There is no new RLS surface. The browser holds no grant on `orders`
   (`20260718130000_revoke_all_browser_grants.sql`), so every write goes through the backend.
   This migration changes no grant.

The `CHECK` constraints are the final authority. The shared module below exists to stop the
browser and the server from disagreeing about what the database accepts.

## Shared rule — `packages/shared/src/orderReview.ts`

This mirrors `trialFeedback.ts`, which is the same shape of rule.

```ts
export const ORDER_REVIEW_RATING_MIN = 1
export const ORDER_REVIEW_RATING_MAX = 5
export const ORDER_REVIEW_COMMENT_MAX_LENGTH = 500

export interface OrderReviewDraft { rating: number; comment: string | null }

export type OrderReviewValidation =
  | { ok: true; value: OrderReviewDraft }
  | { ok: false; error: string }

export function validateOrderReview(body: unknown): OrderReviewValidation
```

`validateOrderReview` BUILDS its result field by field. It never spreads the body. This makes
it the write allowlist: a caller cannot smuggle `review_at`, `user_id`, `merchant_id` or
`status` through it. The backend derives `review_at` itself.

The comment cap is 500, not the 2000 that `feedback.ts` and `trialFeedback.ts` use. A customer
review is one or two sentences. A merchant bug report is not.

Export from `packages/shared/src/index.ts` in the same style as the two modules above it.

## Backend — two doors

The invoice endpoints already solve this exact problem. The review endpoints copy them.

### Door 1 — the signed-in customer

`POST /api/orders/:orderId/review`, behind `requireUser`.

1. Read the order with the service-role client.
2. Refuse with 404 if the order does not exist, or if `order.user_id` is not the caller.
   A stranger's order and a missing order must look the same.
3. Refuse with 409 `order_cancelled` if `status === 'cancelled'`.
4. Validate the body with `validateOrderReview`. A failure is a 400.
5. Write `review_rating`, `review_comment` and `review_at = now()`.
6. Return the three stored values.

### Door 2 — the guest

`POST /api/orders/review`, unauthenticated.

The guest proves the order number and the phone they typed, matched on `phoneKey()`. This is
the same proof `POST /api/orders/invoice` takes, and the same ADR 0018 trade: the pair is
guessable, and the IP window is what bounds it.

1. Refuse with 429 if `reviewSubmitIpWindow.allow(ipOf(c))` is false.
2. Read `shop`, `orderNumber` and `phone` from the body. Lower-case the slug, upper-case the
   order number, and reduce the phone with `phoneKey()`. A missing part is a 404.
3. Find the merchant by slug. Find the order by `merchant_id` + `order_number` +
   `customer_phone_key`. A miss is a 404.
4. Steps 3 to 6 of door 1 follow unchanged.

The shop is required. An order number is unique per shop only, because the prefix is the first
two alphanumerics of the slug.

### Rate limit — `quotaWindows.ts`

Add `reviewSubmitIpWindow`, built like `invoiceLookupIpWindow`: a minute window and an hour
window, both recording every hit, and `allow()` returns true only if both agree. Figures: 10 a
minute and 60 an hour, the same as the invoice door, because the guessing cost is the same.

The window is in memory. A second backend instance doubles it (#101).

## Customer UI

### `store/OrderReviewCard.tsx`

A new component. The star widget comes from `merchant/TrialFeedbackPrompt.tsx`: five buttons
in a `role="radiogroup"`, a hover fill, and `Star` from `lucide-react`. Below it sits an
optional `Textarea` and a submit button. The submit button is disabled until the customer
picks a star.

The card holds its own submitted state. After a send it shows the stored rating and a "Change"
control that returns it to the editable form.

### Mounting — `store/Storefront.tsx`

Mount the card on the success view, under `PaymentInstructions` and above the invoice block.

The card needs no new data. Everything the two doors want is already on the screen:
`success.orderId` for the signed-in door, and `success.orderNumber` plus the phone the customer
typed (`wa`) plus `merchant.slug` for the guest door. The card chooses its door on `account`,
exactly as the invoice button beside it already does.

### `store/OrderHistory.tsx`

Each order row shows its stored rating, and a signed-in customer can change it there. The rows
already carry the three new columns, because `fetchMyOrdersAtShop` returns whole order rows.

### The guest gap, stated

A guest who leaves the order-placed screen cannot change their review. The `/invoice` page is a
door to a PDF, not a view of an order, and making it show a review is separate work. This is
accepted for now.

### `store.ts`

Two functions, in the style of `fetchGuestInvoice`:

```ts
export async function reviewMyOrder(orderId: string, rating: number, comment: string | null)
export async function reviewGuestOrder(shop: string, orderNumber: string, phone: string,
                                       rating: number, comment: string | null)
```

Both return `Result<OrderReview>` through `apiSend`. The first passes `{ auth: true }`, the
second `{ auth: false }`.

### `types.ts`

Add `review_rating`, `review_comment` and `review_at` to `Order`.

## Merchant UI

### `merchant/orderDetail/ReviewCard.tsx`

A read-only `DrawerCard`. It shows the stars and the comment. It renders nothing when the order
has no rating. The merchant cannot write or delete a review. Mount it in `OrderDetailSheet`
above `NoteCard`.

### `merchant/OrdersView.tsx`

Show the rating on the order row, so a merchant reading the table sees it without opening the
drawer. An unrated order shows nothing.

## Tests

| Suite | Proves |
|---|---|
| `packages/shared/src/orderReview.test.ts` | Rating bounds, integer rule, comment trim and cap, and that the validator drops every field it does not name |
| `apps/backend/tests/api/orderReview.test.ts` | The owner writes; a stranger gets 404; a missing order gets 404; the guest triple writes; a wrong phone gets 404; a second send overwrites the first; a cancelled order gets 409 |

The API suite drives the real routes in-process with `app.request()`. It uses the real local
database. It mocks nothing.

The UI is verified by running the app, per CLAUDE.md.

## Out of scope

- A public shop rating or a shop average.
- A merchant reply to a review.
- Moderation, reporting or deletion.
- A guest changing a review after they leave the order-placed screen.
- Any e-mail or Telegram notice about a new review.
