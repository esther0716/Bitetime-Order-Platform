# 7. A shop customer is keyed by phone, not by account

Date: 2026-07-28
Status: Accepted. Not yet implemented — the build is #143.

## Context

The dashboard's Customers tab is a throwaway grouping computed in the browser on every open: `fetchMerchantOrders`, a `Map` keyed on the raw `customer_wa` string, discarded on unmount. Nothing persists, so nothing has to be right for long.

Turning it into a CRM changes that. The grouping key stops being a rendering detail and becomes **persistent identity** — every note, every tag, every lifetime total hangs off it, and re-keying later means deciding what happens to a merchant's own writing when the rows it was attached to are redrawn.

Two real candidates existed, and the platform's instincts point at the wrong one.

`orders.user_id` is the identity this codebase already trusts: stamped from the verified JWT, never read from a body, guarded by the carve-out in `orders_backend_intake` and proved by `tests/rls/order-attribution`. It is also what **Customer** means in every other section of `CONTEXT.md`. Reaching for anything else looks, at first glance, like ignoring the good key in favour of a spoofable string.

Three facts make it the wrong key here:

- **Guest checkout is first-class and one tap**, and a guest order carries `user_id = null` **permanently** — there is no adoption path, by design (see *Checkout gate*). Whatever fraction of a shop's orders are guest orders is a fraction an account-keyed list simply cannot show.
- **`phone.ts` already defines "same phone"** — the digits, last eight — and calls it "the whole security of guest order tracking". A second definition of the same idea, five files away, is the drift this repo spends its comments preventing.
- **WhatsApp is how a merchant actually reaches a diner.** It is the only contact affordance the tab has ever had. Keying on something the merchant cannot act on optimises for the wrong verb.

## Decision

A **shop customer** is identified by `(merchant_id, phoneKey(customer_wa))`, reusing the existing last-eight-digits rule rather than deriving a second one. The account is an **attribute** — a has-an-account flag — and never the key.

An order whose phone yields **no key** (absent, blank, or digitless) is **not a shop customer at all**. It is excluded and counted, never bucketed. `phone.ts` already refuses to key on the empty string and says why; keying such orders on `customer_name` instead would assemble one person out of unrelated strangers, which is the failure this is removing.

Rejected:

- **Keying on `user_id`** — excludes every guest, which is most of the trade. A merchant would be shown a fraction of their own customers with nothing on screen to say so.
- **Keying on the raw `customer_wa` string** (the status quo) — `+60 12-345 6789` and `0123456789` become two people, so the product gives two different answers to "is this the same human" depending on which screen you are looking at.
- **A `customer_name` fallback** for phone-less orders — merges strangers, and does it silently.
- **A merchant-driven merge** to repair the two-numbers case — a real answer to a real problem, but it needs its own story for what happens to notes, tags and totals on both sides of the merge. Deferred, not dismissed.

## Consequences

- **One human with two numbers is two shop customers**, and the merchant has no way to say otherwise. This is the most likely first complaint, and it is the signal for whether merging is worth building.
- **Last-eight collisions merge two strangers** into one record with a wrong history. Accepted rather than tolerated: the same rule already guards guest order tracking, where the stakes are higher, so accepting it here is consistent rather than novel.
- **Guests are first-class in the CRM**, which is the entire reason for the decision.
- **"Same person" is now stated once** for the whole product. `/track` and the customer list cannot drift apart, because there is nothing to drift.
- **Reversal is expensive**, and deliberately so — notes and tags are attached to a phone key, so re-keying means deciding their fate. That is what makes this worth an ADR rather than a comment.
- **If guest orders ever became adoptable into an account, revisit this.** That is the one fact that would change the answer, and it is unlikely to change: the orphaning is a deliberate product stance, disclosed to the customer at the gate.
