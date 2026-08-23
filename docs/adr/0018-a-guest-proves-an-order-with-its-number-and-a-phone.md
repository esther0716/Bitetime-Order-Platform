# 18. A guest proves an order with its number and a phone

Date: 2026-08-20
Status: Accepted and implemented in #242.

## Context

The invoice must reach a guest ([ADR 0017](0017-the-invoice-is-a-pdf-and-the-only-invoice.md)), and a
guest holds no account. A guest order carries `user_id = null` permanently, by design (*Checkout
gate*), so every other order asset the platform serves — the payment proof, the order history — is
unreachable to them: `GET /api/orders/:orderId/payment-proof` is `requireUser`, and nothing else is
served without a JWT.

So a new kind of door is needed, and the question is what a guest can prove.

They know the order number. They know the WhatsApp number they typed. And the platform already has a
trusted rule for the second one: `phoneKey()` — the digits, last eight — which stamps
`orders.customer_phone_key` on every order and is the identity
[ADR 0007](0007-shop-customers-are-keyed-by-phone.md) keys a shop customer on.

## Decision

**The public invoice door takes an order number and a phone, scoped to one shop, and matches the
phone with `phoneKey()`.** No new secret, no signed link, no expiry.

The lookup page is **top-level `/invoice?shop=<slug>`**, outside the storefront shell — the same rule
`ResetPasswordPage` follows, and for the same reason: the shell gates on `status === 'active'`, and a
suspended shop must not hold its past customers' invoices hostage. The slug is also the scope the
match needs, because an order number is **not globally unique** — the prefix is the first two
alphanumerics of the slug (`orderPrefix.ts`), so two shops can mint `BI-260820-0051`.

The signed-in customer and the merchant keep their own doors — JWT ownership and
`requireMerchantOwns` — and never use this one.

Rejected:

- **A public endpoint keyed on the order UUID alone.** Simplest possible, and the UUID becomes a
  bearer token with no expiry: anyone ever forwarded that link holds the customer's name, address,
  items and total, for ever, unrevocably.
- **A signed link the merchant sends.** Safe, and it puts the merchant back in the loop for every
  request — the exact pain that started this.
- **Requiring the pair from signed-in customers too.** One code path, at the cost of making the
  people who created an account retype their phone.
- **Nesting the page under `/s/:slug`.** Reads better; dies under the shell's status gate at the
  moment invoices matter most.

## Consequences

- **The pair is guessable, and this is accepted knowingly.** Order numbers are structured and
  near-sequential (`PREFIX-YYMMDD-XXXX`, the daily counter starting at 50), so someone who knows a
  shop's prefix and a victim's phone can pull that order's invoice — name, address, items, total.
  Rate limiting narrows the window; it does not close it. The alternative was a human in front of
  every disclosure, which is the pain being removed.
- **The endpoint must not become an oracle.** A wrong phone and a missing order return the **same**
  404, or the door reports which order numbers are real.
- **The limit is in memory.** `rateLimit.ts` sliding windows are per process, so a second backend
  instance doubles every ceiling — the known #101 caveat, the same one the AI daily windows carry.
  Accepted for now; a Postgres counter is the fix if it ever matters.
- **Last-eight collisions apply here too.** Two different numbers sharing their last eight digits
  are one key. Consistent with ADR 0007 rather than novel.
- **A guest who lost their order number has no self-serve path.** They ask the merchant, who has a
  button. This is the residual case, and it is small.
