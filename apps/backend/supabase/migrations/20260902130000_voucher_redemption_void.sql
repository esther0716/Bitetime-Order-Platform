-- A redemption can be RELEASED, and a cancelled order is what releases it.
--
-- ADR 0019 recorded the answer as "a cancellation returns nothing", and this reverses it. What
-- makes the reversal safe is the thing that ADR built: a redemption is a row carrying `order_id`,
-- so "which uses belong to cancelled orders" is a question the data can answer. It could not be
-- asked of the old `used_by` array at all.
--
-- NOT a delete. The row stays, and `voided_at` says when its order was cancelled — a merchant
-- asking "has this customer ever used the code?" still gets a true answer, and un-cancelling is
-- a null-out rather than an insert that would have to race the caps all over again.
--
-- The rule is state-driven: a redemption is void if and only if its order is `cancelled`. Nothing
-- reads the transition, so the write is idempotent and a failed void is repaired by the next
-- patch of the same order rather than lost.
alter table public.voucher_redemptions
  add column if not exists voided_at timestamptz;

-- No new index. Both caps still count under the voucher's row lock through
-- `voucher_redemptions_voucher_customer_idx`; `voided_at` is a filter on rows that index already
-- returns, and the rows a single voucher holds are bounded by `max_uses`.
