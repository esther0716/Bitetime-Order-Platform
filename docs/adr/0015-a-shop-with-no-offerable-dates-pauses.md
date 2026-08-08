# 15. A shop with no offerable dates pauses, and never falls back to a window nobody chose

Date: 2026-08-08
Status: Accepted and implemented (#210).

## Context

A merchant asked for **custom order dates**: instead of the rolling window (`lead_days` + `window_days` − `closed_weekdays`), tick the specific calendar dates the shop delivers on, up to three months out, with closed weekdays no longer applying. A festive baker does not sell "any day in the next fortnight"; they sell 14 February and 20 February and nothing else.

The feature itself is small — an allowlist beside a computed range, read by the same `fulfilmentConfig` bag and the same `selectableDates`. What is not small is that an allowlist can become **empty**, and a rolling window never could. Two ordinary events empty it:

- The merchant ticked three dates in August and it is now September.
- The shop stepped down from Pro, and custom dates are Pro.

Both leave the platform holding a shop whose owner has said, in effect, *these dates and no others*, at a moment when none of those dates is available. Every answer to that is uncomfortable, which is why this is written down.

The tempting answer is to resume the rolling window — the shop keeps selling, nobody files a support ticket. It is also the one answer that does something the merchant never agreed to. A shop that switched to custom dates because it bakes on Saturdays has a dormant rolling window sitting in its config, quite possibly the untouched `0 / 14 / none` default, and resuming it starts taking Tuesday same-day orders on that merchant's behalf. The failure is silent, it is on the money path, and the merchant discovers it when an order they cannot fill arrives.

The opposite answer — go dark and stay dark — is honest and costs the merchant every order until they notice. On the expiry path that is acceptable, because the merchant caused it and can be warned before it happens. On the downgrade path it is a lapsed credit card silently ending a business's revenue, which is a different order of harm.

## Decision

**A shop with no offerable date pauses.** `selectableDates` returns `[]` and `isDateSelectable` returns false — the pause lives *inside the shared rule*, not in the storefront, so the browser and order intake reach it identically and a caller who skips the picker cannot sell on a paused shop. `merchants.status` stays `active`, the menu still renders and is still crawlable, and the customer is told at the date step. A stray POST is refused with the existing `fulfil_date_unavailable`.

**Expiry pauses with warning.** Amber dashboard banner when the last remaining date falls within 7 days, red at zero. Computed from config on the client — no cron, no email, nothing new to operate.

**Downgrade pauses with a review.** `revokeProArtifacts` forces `mode` to `rolling` and sets `needs_review`, keeping `custom_dates`. The shop does not sell until the merchant opens the Fulfilment tab and confirms, with an alert above the values explaining why they are being asked. **The confirmation is a press, not an edit.** Requiring the merchant to change something cannot distinguish "reviewed and agreed" from "fiddled and reverted" — a change-then-revert leaves the form clean — and it forces a merchant whose window was already correct to make it wrong first. What the rule is actually buying is that the merchant is *looking at* `lead_days`, `window_days` and `closed_weekdays` at the moment they take responsibility for them, and a confirm button rendered directly beneath those three fields buys that.

**Re-subscribing restores custom mode and clears `needs_review`**, on the surviving dates. A
paused shop holding NO dates at all is the one exception and is not resumed: there is nothing to
go back to, so the review still stands. (A shop whose dates have all merely *expired* is resumed —
it lands in the ordinary dry state, red banner and all, which is the honest reading of what its
owner configured.) This is a **deliberate break with vouchers, promos and option groups**, where a step back up switches nothing on and [ADR 0010](0010-menu-options-are-pro-and-downgrade-hides.md) says so explicitly. The asymmetry there is safe because a dormant voucher costs the merchant nothing while it waits. Here the dormant state is a **stopped shop**, and there is no ambiguity to resolve on the way back — the dates are the merchant's own list, unchanged, minus the ones that expired on their own. Making a paying shop stay dark for want of a click is not a rule worth having for consistency's sake.

Rejected:

- **Silent fallback to the rolling window** (either path) — sells on dates the merchant never chose, from a config they may never have opened, and the first sign of it is an unfulfillable order.
- **Fail closed at downgrade with no restore** — consistent with vouchers, and turns a card that expired over a weekend into a shop that is still dark on Monday after payment succeeded.
- **A dismissible "your dates were paused" banner with selling resumed immediately** — the merchant may never read it, which makes it the silent fallback wearing a notice.
- **Clearing `needs_review` from a banner button** — the point is to be looking at the window that is about to become the shop's promise; a button in a different screen is not that.
- **Requiring an actual edit to clear it** — undetectable, and punishes the merchant whose settings were right.
- **Reusing the suspended-shop screen** — conflates a config gap with something the platform did to you, and throws away the menu.
- **A new refusal code for "this shop has no dates"** — `fulfil_date_unavailable` is already true of it, and the refusal vocabulary is worth keeping small.
- **Custom dates as an additive layer or a blackout list on top of the rolling window** — both keep closed weekdays live, which is the opposite of what was asked, and neither expresses "these dates and no others".
- **Three calendar months rather than 90 days** — a second horizon concept and month arithmetic in a module deliberately built from day counts. the cap the rolling window already used was 90, now named `FULFILMENT_HORIZON_DAYS`.

## Consequences

- **A lapsed subscription can leave a shop dark until a human acts.** Accepted, with the mitigation being that paying again is enough — the merchant who fixes their card is selling again without touching the tab.
- **`needs_review` is load-bearing on the money path.** If it is checked in the storefront but not inside `selectableDates` / `isDateSelectable`, the pause is cosmetic and a scripted POST sells on the reverted window — the exact outcome this ADR rejects. A shared test should pin that a `needs_review` shop offers nothing on both sides.
- **The plan→pro path gains a restore hook it does not have today.** `revokeProArtifacts` has no counterpart; this is the first thing that comes back on re-subscribe, and it must be idempotent against a replayed webhook like its opposite number is.
- **The Fulfilment tab now has a transient state**, and it is the only screen in the dashboard whose submit button changes meaning. Worth keeping that confined to the tab rather than growing a general "shop needs attention" mechanism for one case.
- **`window_days`, `lead_days` and `closed_weekdays` now live under a mode not named "window"** — `rolling` was chosen because it is the merchant's own register, matching `custom`. A mild dissonance in the config bag, accepted knowingly; renaming the fields would rewrite every saved merchant row for cosmetics.
- **Writing the config bag is as load-bearing as reading it.** The pause lives in a jsonb key, and
  `config` is written as a whole column, so any handler that derives the bag from an incomplete body
  erases `needs_review` and lifts the pause behind a success toast. Normalisation must therefore key
  on whether the body CARRIES a `fulfilment` bag, never on whether it carries a `config` — the same
  presence-versus-change distinction the Pro gate is built on. Both review axes found this latent on
  first implementation; it is the likeliest way this decision gets quietly undone.
- **Zero future dates is refused at save**, mirroring the existing all-seven-days-closed refusal, so the merchant cannot walk into the paused state from the form itself — only time or billing can put them there.
