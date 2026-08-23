# 20. Two Stripe voucher restrictions BiteTime cannot key

Date: 2026-08-21
Status: Accepted; the two restrictions are not built. Decided while spec'ing #241.

## Context

Stripe's promotion-code screen offers five restrictions on a code: an expiry, a minimum order value,
a redemption cap, **first-time order only**, and **limit to a specific customer**. It is the obvious
model to copy, and BiteTime's voucher is being grown toward it.

Three of the five are built (#241): `expires_at`, `min_order` and the existing `max_uses`. The other
two are not, and this records why — because the Stripe screen is a screenshot away, and the request
will be made again.

Both need to name a **person**. BiteTime has two identities for a person, and
[ADR 0007](0007-shop-customers-are-keyed-by-phone.md) established that there is no path from one to
the other:

- The **voucher's** key is the verified JWT's email. A key the client can name is not a key (#72), so
  it can be nothing else, and a guest is refused outright (`voucher_requires_account`).
- The **shop customer's** key is `phoneKey(customer_wa)` — the number the customer types at checkout.
  It is what a merchant actually sees of their own trade, because guest checkout is first-class and
  permanent.

## Decision

**Neither restriction is offered.**

**Limit to a specific customer** is structurally unbuildable, not merely awkward. The only value that
would work is the account email, and CONTEXT.md → *Shop customer* states that a merchant is
deliberately never shown one: "no account email, no saved address, nothing from the global profile."
A merchant cannot type a value the platform forbids them to see. Building it means either breaking
that boundary — which exists so that a number volunteered to receive one order does not become a
platform profile handed to a shop — or keying on the phone, which the customer supplies at checkout
and can change per order.

**First-time order only** fails the same way, more quietly, which makes it worse. Keyed on the phone
it fails open: the field is self-declared, so the discount is claimable for ever by anyone who varies
a digit, and the merchant is never shown that it happened. Keyed on the voucher's own email it is
sound but means "you have never placed a **signed-in** order at this shop" — and since most of a
shop's trade is guest orders, that set is far smaller and far stranger than any merchant reading the
words "first-time customers" would expect. A restriction the merchant misreads is worse than one
they do not have.

## Consequences

- Vouchers stay **broadcast** instruments: a code is a string anyone holding it can try. Targeting
  one person is not a voucher feature and should not be built as one.
- Reversing this needs real email verification, or a verified phone at checkout. Both reverse a
  deliberate product decision (signup is pre-confirmed, guest checkout is one tap) and are their own
  work — see CONTEXT.md → *Voucher*, "friction, not a wall".
