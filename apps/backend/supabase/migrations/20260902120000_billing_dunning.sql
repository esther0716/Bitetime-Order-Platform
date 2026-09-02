-- Dunning: close a shop whose renewal has gone unpaid, and reopen it when the money arrives.
--
-- Three columns, one per thing the code could not previously know:
--
-- current_period_start — when the period the shop has NOT paid for began. The grace clock runs
--   from here, not from current_period_end: Stripe advances the billing period when it issues the
--   renewal invoice, whether or not that invoice is paid, so a past_due subscription's period end
--   is a month in the FUTURE and measures nothing. The merchant dashboard counts down from this
--   same column, so the date a merchant is shown and the date the shop closes are one fact.
--
-- past_due_notified_at — when the merchant was last told to settle. The reminder sweep runs
--   hourly and the reminder is daily, so this is what stops twenty-four emails a day.
--
-- dunning_suspended_at — set when the sweep closes a shop for non-payment, cleared when a payment
--   reopens it. Without it a dunning closure is indistinguishable from a moderation suspension
--   (both are merchants.status = 'suspended' beside a live subscription), and syncMerchantBilling
--   deliberately refuses to reopen the latter — see its `suspended_by_admin` reason. Paying must
--   reopen the first and must NOT reopen the second.
alter table public.merchant_billing
  add column if not exists current_period_start timestamptz,
  add column if not exists past_due_notified_at  timestamptz,
  add column if not exists dunning_suspended_at  timestamptz;
