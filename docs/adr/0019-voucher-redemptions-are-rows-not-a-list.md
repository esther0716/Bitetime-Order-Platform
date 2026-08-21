# 19. Voucher redemptions are rows, not a list

Date: 2026-08-21
Status: Accepted; not yet implemented. Originates in #241.

## Context

A voucher recorded who had redeemed it in `vouchers.used_by`, a jsonb array of lowercased account
emails. Two rules read it, and both read it as a **set**: `claimVoucher` refused a key already in
the array (one redemption per customer, hardcoded), and `max_uses` was checked as
`used_by.length >= max_uses`.

#241 asked for a code one customer can use more than once. That request alone turns the array into a
**multiset**, and everything the shape was quietly getting away with stops holding:

- The array is read and rewritten (`used_by = used_by || …`) **inside the order transaction, under
  the voucher's row lock**. One growing blob on the checkout's critical section.
- It becomes unbounded in a configuration the merchant can now reach. `per_customer_limit = 3` with
  `max_uses = null` is legal, and the total redemption count then has no ceiling at all.
- It carries junk that cannot be cleaned. `used_by` still holds WhatsApp numbers from historical
  guest redemptions — keys that can no longer be produced and will never match again, still eating
  `max_uses` slots.
- It leaks. `GET /api/merchants/:id/vouchers/:code` is **unauthenticated** and did `select('*')`, so
  every redeemer's email address was served to anyone holding a code printed on a flyer.
- It cannot answer "which order used this?", so "does a cancellation give the redemption back?" was
  not a question anyone could research.

## Decision

**A redemption is a row in `voucher_redemptions`** — `(id, voucher_id, customer_key, order_id,
redeemed_at)`. Both caps become aggregates over it: the total against `max_uses`, the per-customer
count against `per_customer_limit`. Indexed on `(voucher_id, customer_key)`.

`order_id` is written for live redemptions, inside the same transaction, after the order insert.
It is **nullable** because backfilled rows have no order, and `redeemed_at` is nullable for the same
reason — no timestamp exists for a historical entry, and inventing one is a lie.

The claim keeps the voucher's row lock. The lock is what serialises the read-then-write, and moving
the count to another table does not change that.

**The backfill is verbatim.** One row per array element, WhatsApp keys included, `customer_key`
exactly as stored. The migration therefore changes no merchant's numbers at the instant it runs.

**`used_by` is not dropped in that migration.** `claimVoucher` names the column in an `update`, so an
older backend build still serving traffic would fail every voucher checkout. The column stays dead
until a later migration removes it — expand, then contract.

**The public lookup returns derived flags only** — `fullyUsed`, `expired`, `minOrder`, and
`yoursRemaining` when the caller presents a JWT. There is no longer a field that could carry an
email, so the leak is closed by construction rather than by an allowlist someone must maintain.

## Rejected

- **Keep `used_by`, allow duplicates.** Zero migration, smallest diff, and `used_by.length` stays the
  total so the `max_uses` check is unchanged. Rejected on the unbounded case: the array a popular
  reusable voucher accumulates is rewritten under the checkout lock on every order.
- **`used_by` becomes an object, `email → count`.** Bounded by distinct customers rather than by
  redemptions, and one `UPDATE` to migrate. Rejected because it still answers nothing about *when* or
  *which order*, it carries the historical junk across unchanged, and every reader of the field
  changes shape at once for a gain that a table gives permanently.
- **Discard non-email keys during the backfill.** Cleans the WhatsApp junk. Rejected: every live
  voucher would silently gain capacity on deploy day. That is the platform editing a merchant's
  running campaign without telling them.

## Consequences

- "Does cancelling an order return the redemption?" stays answered **no**, unchanged — but it is now
  a question that can be revisited from data instead of from opinion. See CONTEXT.md → *Voucher*.
- Two voucher rows can share a `code` (see the partial unique index under *Voucher*), so any query
  reading a redemption back to a code must go through `voucher_id`, never the string.
