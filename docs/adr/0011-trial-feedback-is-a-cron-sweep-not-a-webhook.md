# Trial feedback is sent by a cron sweep, not a Stripe webhook

Every other billing effect in this repo (`merchant_billing`, plan reconciliation, suspension) is driven by a Stripe webhook — Stripe is the event source of truth for trial state. The day-7 trial feedback survey needs to fire once for *every* merchant whose trial ended, including one who just sits `trialing` past day 7 with no card and no Stripe event at all — so there is no webhook that reliably marks "trial ended" for every outcome. We introduce a new daily sweep instead: a GitHub Actions scheduled workflow calls a protected backend endpoint that scans `trial_feedback` for merchants whose `trial_ends_at` has passed and no survey has been sent, and sends one. This is the first scheduled-job (as opposed to webhook- or request-driven) piece of infra in this backend.

Scope: only merchants whose trial ends after this feature ships are surveyed — no backfill for trials that already ended.
