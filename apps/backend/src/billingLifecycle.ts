// Pure billing-lifecycle decisions. No I/O: callers pass rows in; Stripe and
// Supabase effects stay in the route handlers (mirrors notify.ts).

export interface BillingRow {
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  status?: string | null
  trial_ends_at?: string | null
  current_period_end?: string | null
  comped?: boolean | null
}

/**
 * The Stripe subscription statuses that mean nothing is paying for this shop any more, and it
 * must close.
 *
 * An ALLOWLIST, deliberately — the opposite direction from LIVE_STATUSES in billing.ts, and for a
 * reason worth stating: a status Stripe adds tomorrow must default to "leave the shop open". The
 * cost of being wrong is asymmetric. A shop left open one sweep too long is a few hours of free
 * service; a shop closed on a status we misread is a merchant's storefront dark with orders
 * coming in and no idea why.
 *
 * `past_due` is NOT here. It is Stripe still retrying the card, which is what dunning is; the
 * shop stays open until Stripe gives up and reports one of these three.
 */
export const LAPSED_STATUSES = ['canceled', 'incomplete_expired', 'unpaid']

export function isLapsed(status: string | null | undefined): boolean {
  return !!status && LAPSED_STATUSES.includes(status)
}

/** The billing-row statuses this sweep considers still-running, and so worth re-checking. */
const RUNNING = ['trialing', 'active', 'past_due']

/** The shape `pickSubscription` decides on — everything else about a Stripe subscription is noise. */
export interface SubscriptionChoice {
  id: string
  status: string
  /** Stripe's creation timestamp, in seconds. */
  created?: number | null
}

/**
 * Which of a customer's subscriptions the shop is actually paying for.
 *
 * A LIVE one wins over any other, and the newest live one wins among those. Recency alone is
 * wrong, and so is trusting the stored `stripe_subscription_id`: a shop reactivating after a
 * lapse has a brand-new live subscription sitting beside the canceled one that closed it, and
 * the stored id still names the OLD one until a webhook overwrites it — which, on the path
 * billingSync.ts exists for, never happened. Asking Stripe about the stored id would read
 * "canceled" and leave the shop shut on a payment that went through.
 *
 * With no live candidate it returns the newest of what there is, so the billing row is still
 * brought up to date and the merchant can be told which non-running state they are in.
 */
export function pickSubscription<T extends SubscriptionChoice>(subs: T[]): T | null {
  if (subs.length === 0) return null
  const newestFirst = [...subs].sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
  return newestFirst.find(s => RUNNING.includes(s.status)) ?? newestFirst[0]
}

/**
 * Is this billing row worth asking Stripe about?
 *
 * The sweep's whole worklist, as a pure predicate. It selects rows whose stored DEADLINE has
 * passed while the stored STATUS still says the subscription is running — which is precisely the
 * shape a lost webhook leaves behind: Stripe moved on at the trial end or the period end, and
 * nothing told us.
 *
 * The point of narrowing here rather than re-reading every subscription is cost. One Stripe API
 * call per shop per run, forever, for shops nothing has happened to, is a bill and a rate limit
 * for no information.
 */
export function needsReconcile(billing: BillingRow, now: Date): boolean {
  if (billing.comped) return false // a comp has no Stripe object to read
  if (!billing.stripe_subscription_id) return false
  if (!billing.status || !RUNNING.includes(billing.status)) return false

  const elapsed = (iso: string | null | undefined) =>
    !!iso && new Date(iso).getTime() <= now.getTime()
  return elapsed(billing.trial_ends_at) || elapsed(billing.current_period_end)
}

// One trial ever: a merchant that has ever had a subscription (trialing,
// canceled, anything) can't be granted another trial by approval.
export function canStartTrial(billing: BillingRow | null | undefined): boolean {
  return !billing?.stripe_subscription_id
}

/**
 * Why a trial may NOT be started for this shop, as the `error` string to refuse with — or null
 * when it may. The two questions here are the ones every caller asks identically; "has this shop
 * already had a subscription" is deliberately NOT among them, because approval activates a shop
 * it cannot re-trial while an owner's retry refuses it (see the routes in app.ts).
 */
export function trialStartRefusal(m: { status?: string | null; plan?: string | null }): string | null {
  if (m.status !== 'pending') return 'Merchant is not pending'
  if (m.plan === 'pro') return 'Pro shops activate via payment, not approval'
  return null
}

export interface TrialReminderInput {
  shopName: string
  trialEndsAt: string // ISO timestamp
  dashboardUrl: string
}

// The 72-hour reminder sent when Stripe fires customer.subscription.trial_will_end.
export function buildTrialReminderEmail({ shopName, trialEndsAt, dashboardUrl }: TrialReminderInput) {
  const endsText =
    new Date(trialEndsAt).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }) + ' UTC'
  const subject = `Your TinyOrder trial for ${shopName} ends in 3 days`
  const text = `Hi,

The free trial for ${shopName} ends on ${endsText}.

Add a payment method before then to keep your shop open:
${dashboardUrl}

If no payment method is added, your shop will be suspended when the trial ends. You can reactivate it any time by subscribing.

— TinyOrder`
  return { subject, text }
}
