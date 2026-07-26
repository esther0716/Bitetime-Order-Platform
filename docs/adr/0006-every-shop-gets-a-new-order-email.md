# 6. Every shop gets a new-order email; Telegram stays the thing Pro sells

Date: 2026-07-26
Status: Accepted.

Amends [ADR 0003](0003-order-confirmation-email-signed-in-only.md), whose *Consequences* argued that the anonymous notify endpoint was safe because the worst an enumerator could achieve was triggering one legitimate customer email early. That argument does not survive a recipient who is not the customer — see *The stamp is what keeps 0003's argument true* below.

## Context

Telegram alerts are a Pro entitlement (#110): `requirePro` gates the write that stores the shop's bot token, and `notifyOrderPlaced` skips any shop whose `plan` is not `pro`. A **basic** shop therefore had no order notification at all. The customer received their confirmation email; the shop received nothing, and found out about the order by refreshing the dashboard — which is not a notification, and which the Orders nav badge did not do on its own either.

That is the blocking gap for onboarding a real shop, and it sits directly on the tier boundary. The obvious fix — ungate Telegram — is the one that cannot be taken: "Instant Telegram alerts the second an order comes in" is the first bullet of the Pro tier on the landing page, and removing it leaves Pro selling vouchers and priority support.

## Decision

**A third arm on the post-commit fan-out: a new-order email to the shop owner, on every plan.** `POST /api/notify/order` now fans out to three independent, best-effort recipients — the merchant's Telegram, the customer's receipt, and the owner's alert — none of which blocks or suppresses another.

**Telegram stays Pro, and stays the difference the tier sells.** The two channels are not the same product. Telegram is the loud one: it buzzes a phone and lands in the group the whole shop is already sitting in, which is what "the second an order comes in" means to someone working a counter. Email is the floor — the guarantee that no shop, on any plan, silently misses an order. A Pro shop receives both, and there is no setting to turn either off.

**The merchant email follows the Telegram rules, not the receipt's**, because it is the same surface: English only (the request body's `lang` is the *customer's* presentation and never reaches this arm), carrying the operational detail the receipt deliberately omits — the customer's WhatsApp number and the routed distance. It is sent from the **platform's** address rather than the shop-named sender the receipt wears; the shop is the recipient here, and an alert appearing to come from itself reads as a copy of the customer's mail.

**The recipient is the owner's Auth email**, read from `merchants.owner_id`, never from `profiles` (which a fresh signup may not have) and never from the request body.

**Sent once per order**, stamped `orders.merchant_emailed_at` under the same atomic null→now() claim that guards the customer receipt — a separate column, not a shared "notified" flag, because the two arms skip and fail independently.

Rejected: ungating Telegram (above); a per-shop toggle (a Pro shop receiving both is the intent, and the Notifications settings tab is itself Pro-gated, so a basic merchant would have nowhere to put the switch); bilingual merchant mail (the merchant surface is English by existing rule, and a shop has no language column); and web push or SMS (email plus Telegram is the channel set).

## The stamp is what keeps 0003's argument true

ADR 0003 accepted an anonymous notify endpoint on this reasoning: order numbers are a guessable per-shop daily counter, so an enumerator *can* hit the endpoint with a valid pair — but the worst outcome is triggering the one legitimate confirmation slightly early, to the real customer, with no exfiltration.

That reasoning is specific to a recipient who was going to receive exactly one message anyway. It does not extend to the merchant arm on its own: without a stamp, a guessed order number is an **unbounded mail flood at a merchant's inbox**, since nothing else bounds how many times the endpoint may be called for one order. `orders.merchant_emailed_at` is therefore not tidiness — it is the control that keeps the endpoint anonymous. Rate-limiting the endpoint, which 0003 rejected as real work against a non-harm, stays rejected on the same grounds now that the one-shot claim covers the harm that actually appeared.

The owner is resolved **before** the claim, so a shop with no reachable owner leaves the stamp unclaimed rather than burning its one alert on a send that was never going to happen.

## Consequences

- **A basic shop is notified.** The tier still differs, and the difference is now a real one about *how fast and how loudly*, rather than *whether at all*.
- **The fan-out's three arms are deliberately asymmetric**, and the asymmetry has to be held in mind when changing any of them: Telegram is Pro-gated and undeduplicated; the receipt is signed-in-only and one-shot; the merchant alert is plan-blind and one-shot. `CONTEXT.md → Order notifications` is the reference.
- **A Pro shop gets two notifications per order.** Accepted as noise a shop can ignore, rather than a setting to maintain.
- **Guest orders now notify the shop.** They always should have; before this, a guest order on a basic shop notified nobody at all.
- **The merchant email can reach an unverified address** in the same way the customer receipt can — but the owner's address is the one they signed in with, so the exposure is narrower than 0003's.
