-- Complimentary Pro, as a fact rather than an inference.
--
-- A comped shop has no subscription, but comp-merchant wrote status='active' and preserved any
-- stripe_customer_id — and the Subscription tab reads exactly that pair as "this shop has a live
-- subscription", so it offered a billing portal. In production that portal call reached Stripe
-- holding a test-mode customer id under a live key and answered 502.
--
-- The column is deliberately separate from `status`: status stays what Stripe says, this stays
-- what we say. Widening the status CHECK would move every reader of it (LIVE_STATUSES on both
-- sides of the wire, the banner, the referral grant, the admin label map) for the same outcome.

alter table public.merchant_billing
  add column if not exists comped boolean not null default false;

-- Backfill: a comp is the only path that writes status='active' with no subscription id — every
-- real subscription gets its id from the webhook (billingFromSubscription writes both together).
--
-- The customer id goes with it: on a comped row it points at nothing we will ever call, and on at
-- least one production row it points at a test-mode customer the live key cannot see.
--
-- Known gap, accepted: a shop comped AFTER a cancelled subscription keeps its subscription id, so
-- this misses it and it still reads as paying. Loosening the rule to catch it would risk
-- mislabelling real subscribers, which is the worse error.
update public.merchant_billing
   set comped = true,
       stripe_customer_id = null
 where status = 'active'
   and stripe_subscription_id is null;
