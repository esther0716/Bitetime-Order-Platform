-- One plan (#222). `merchants.plan` was the entitlement signal and `merchant_billing.pending_plan`
-- the scheduled step down to Basic. With a single tier, entitlement is `merchants.status`, and a
-- column that still holds a tier is a trap for the next reader rather than a spare field.
--
-- Both are dropped rather than narrowed: no shop was ever on a Basic price, so there is no history
-- here worth keeping and nothing to grandfather.
--
-- The CHECK constraints on both columns go with them — Postgres drops a column's own constraints
-- as part of the drop, so naming them separately would only be a second chance to get a name wrong.
alter table public.merchants        drop column if exists plan;
alter table public.merchant_billing drop column if exists pending_plan;
