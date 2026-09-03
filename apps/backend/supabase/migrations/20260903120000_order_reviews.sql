-- The customer's own 1-5 star review of an order, left on the order-placed screen.
--
-- COLUMNS, not a table, for three reasons. One review per order becomes structural — a row
-- cannot hold two, so there is no uniqueness constraint to get wrong. The merchant already reads
-- whole order rows (`select('*')` in GET /api/merchants/:id/orders and /my-orders), so the review
-- arrives with no join and no second request. And there is no new RLS surface: `anon` and
-- `authenticated` hold NO grant on `orders` at all (20260718130000_revoke_all_browser_grants),
-- so every write goes through the backend's service-role client. This migration grants nothing.
--
-- These CHECK constraints are the final authority. `packages/shared/src/orderReview.ts` holds the
-- same two rules so the browser and the server agree with the database about what is acceptable.
alter table public.orders
  add column if not exists review_rating smallint,
  add column if not exists review_comment text,
  add column if not exists review_at timestamptz;

alter table public.orders
  drop constraint if exists orders_review_rating_range;
alter table public.orders
  add constraint orders_review_rating_range
    check (review_rating is null or (review_rating between 1 and 5));

alter table public.orders
  drop constraint if exists orders_review_comment_length;
alter table public.orders
  add constraint orders_review_comment_length
    check (review_comment is null or char_length(review_comment) <= 500);

comment on column public.orders.review_rating is
  'The customer''s own rating of this order, 1 to 5. Null until they leave one. Written only
   through the backend (POST /api/orders/:orderId/review for a signed-in customer, POST
   /api/orders/review for a guest). The merchant reads it and can never write it.';

comment on column public.orders.review_comment is
  'The optional free text beside `review_rating`, at most 500 characters. Null when the customer
   left stars only.';

comment on column public.orders.review_at is
  'When the review was last written. A customer may change their review, so this is the time of
   the most recent write, not of the first one.';
