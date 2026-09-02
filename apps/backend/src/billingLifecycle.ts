// Pure billing-lifecycle decisions. No I/O: callers pass rows in; Stripe and
// Supabase effects stay in the route handlers (mirrors notify.ts).

export interface BillingRow {
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  status?: string | null
  trial_ends_at?: string | null
  current_period_end?: string | null
  /** Start of the period the shop has not paid for — the grace clock. See @bitetime/shared. */
  current_period_start?: string | null
  /** When the merchant was last told to settle. Null means never. */
  past_due_notified_at?: string | null
  /** Set when non-payment closed this shop; cleared when a payment reopens it. */
  dunning_suspended_at?: string | null
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
 * `past_due` is NOT here. It is Stripe still retrying the card, which is what dunning is — but
 * dunning does not reliably END, so a status is not the only thing that closes a shop. See
 * `pastDueGraceExpired` in @bitetime/shared, and `reconcileOne` in billingSweep.ts.
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

  // A `past_due` row is ALWAYS worth re-reading, whatever its stored deadline says. Stripe moves
  // the period forward when it issues the unpaid invoice, so a shop in dunning carries a
  // `current_period_end` a month in the future — the deadline test below drops it, and the shop
  // then goes a whole month unexamined while the grace deadline has nothing to run on. The
  // cost of the exception is one Stripe call an hour per shop in dunning, which is a small set.
  if (billing.status === 'past_due') return true

  // And so is a shop this sweep CLOSED for non-payment. Its status may already read `active`
  // again — the merchant paid — while the storefront is still shut, waiting on a
  // `customer.subscription.updated` that may never arrive. Dropping it here would leave a paying
  // merchant closed indefinitely, which is the same lost-webhook failure pointed the expensive
  // way round.
  if (billing.dunning_suspended_at) return true

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
 * when it may. "Has this shop already had a subscription" is deliberately NOT asked here, because
 * approval activates a shop it cannot re-trial while an owner's retry refuses it (see the routes
 * in app.ts).
 */
export function trialStartRefusal(m: { status?: string | null }): string | null {
  if (m.status !== 'pending') return 'Merchant is not pending'
  return null
}

/**
 * Is the merchant due another "settle your invoice" reminder?
 *
 * The sweep runs HOURLY and the reminder is DAILY, so without this a shop in dunning gets
 * twenty-four identical emails a day and the merchant learns to delete them — which defeats the
 * only warning they get before the storefront closes.
 *
 * 20 hours, not 24: the sweep fires at a fixed minute past the hour, so a strict 24 would drift a
 * whole day forward every time an hourly run was slow or skipped, and a three-day window has room
 * for exactly three reminders. 20 keeps them landing at roughly the same hour each day.
 *
 * Never notified (null) is always due — that is the first failure, and it is the reminder that
 * tells the merchant this is happening at all.
 */
export const REMINDER_INTERVAL_MS = 20 * 60 * 60 * 1000

export function needsPastDueReminder(lastNotifiedAt: string | null | undefined, now: Date): boolean {
  if (!lastNotifiedAt) return true
  const last = new Date(lastNotifiedAt).getTime()
  if (Number.isNaN(last)) return true
  return now.getTime() - last >= REMINDER_INTERVAL_MS
}

export interface PastDueNoticeInput {
  shopName: string
  /** When the storefront closes (or closed) — the deadline both sides count to. */
  closesAt: Date
  /** Whole days left, as the banner words it. 0 means "today". */
  daysLeft: number
  billingUrl: string
}

const noticeDate = (d: Date) =>
  d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'

/**
 * The daily reminder while a shop is still open on an unpaid invoice.
 *
 * Says the DATE, not just "soon". A merchant deciding whether to deal with this today needs to
 * know what today costs them, and "3 days" in an email read on day two is a lie the reader cannot
 * detect.
 */
export function buildPastDueReminderEmail({ shopName, closesAt, daysLeft, billingUrl }: PastDueNoticeInput) {
  const when = daysLeft === 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`
  const subject = `Payment failed for ${shopName} — your shop closes ${when}`
  const text = `Hi,

We could not take the subscription payment for ${shopName}, so the invoice is unpaid.

Your storefront stays open until ${noticeDate(closesAt)} (${when}). After that it closes to customers until the payment goes through.

Update your card or pay the invoice here:
${billingUrl}

Your menu, orders and settings are untouched — a closed shop reopens by itself the moment the payment succeeds.

— TinyOrder`
  return { subject, text }
}

/**
 * The notice that the storefront has actually closed.
 *
 * A separate email from the reminders, because it reports a different fact: customers can no
 * longer order. It must also say how to undo it, since the undo is not "sign up again" — the
 * subscription is still there and still being retried.
 */
export function buildShopClosedEmail({ shopName, billingUrl }: Omit<PastDueNoticeInput, 'closesAt' | 'daysLeft'>) {
  const subject = `${shopName} is closed — unpaid subscription`
  const text = `Hi,

The subscription payment for ${shopName} is still unpaid, so the storefront is now closed. Customers cannot place orders.

Pay the invoice or update your card here:
${billingUrl}

Your shop reopens automatically as soon as the payment succeeds — nothing is deleted, and you do not need to sign up again.

— TinyOrder`
  return { subject, text }
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
