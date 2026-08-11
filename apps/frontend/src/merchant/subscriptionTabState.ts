// Pure state derivation for the Settings → Subscription tab (#112).
// Mirrors billingBannerState's discipline: the billing row, the entitled plan and the clock go
// in, a decision comes out. The component renders; this module decides.
//
// Deliberately NOT an extension of billingBannerState. That module answers "must I interrupt the
// merchant?", so a healthy subscription is `none` there and the banner stays silent — an
// invariant its own comment defends. This one answers "what is this shop's subscription?", where
// healthy is the most important answer of all. Same payload, different question.
import type { BillingSnapshot } from './billingBannerState'

// Extends the banner's snapshot rather than restating it: both read the same `merchant_billing`
// row, and two hand-maintained copies of one payload shape drift.
export interface SubscriptionSnapshot extends BillingSnapshot {
  stripe_customer_id?: string | null
  /**
   * Complimentary tier, granted by a superadmin, with no Stripe subscription behind it. Every
   * billing action is off: there is nothing to manage, buy, cancel or downgrade, and only a
   * superadmin can reverse it. Kept separate from `status`, which stays whatever Stripe says.
   */
  comped?: boolean | null
}

/** What the merchant can do from here. Every flag gates exactly one button. */
interface Actions {
  /** Show the Pro pitch (price + feature list). */
  canUpgrade: boolean
  /** Open the Stripe Customer Portal — false without a Stripe customer, where it 404s. */
  canManage: boolean
  /**
   * Buy a subscription outright. The exact complement of `canManage`, so the two can never both
   * apply and this can never create a second subscription on a shop that already pays.
   */
  canSubscribe: boolean
  /** Cancel at the end of the current period. */
  canCancel: boolean
  /** Undo the pending cancellation — the only wind-down there is (#222). */
  canResume: boolean
  /** Complimentary tier — the tab says so instead of quoting a price the shop does not pay. */
  comped: boolean
}

/**
 * `plan` is what the shop is entitled to RIGHT NOW; it comes from `merchants.plan`, which moves
 * only when money does.
 *
 * `ending` outranks every other kind, including `past-due`. Once a subscription is winding down,
 * "your shop closes on the 1st" is the only fact that matters — a failing card no longer is one.
 */
export type SubscriptionState = Actions &
  (
    | { kind: 'none'; plan: string }
    | { kind: 'trial'; plan: string; daysLeft: number; trialEndsAt: string; progress: number }
    | { kind: 'live'; plan: string; renewsAt: string | null }
    | { kind: 'past-due'; plan: string }
    | { kind: 'ending'; plan: string; endsAt: string | null }
  )

const DAY = 24 * 60 * 60 * 1000

// The trial length granted at superadmin approval (backend `trial_period_days: 7`), and the
// denominator of the banner's draining progress bar. The module does not assume the row matches
// it — progress is clamped, so a differently-sized trial shows a full or empty bar, never overflow.
const TRIAL_TOTAL_DAYS = 7

// Statuses where a subscription is actually running. Twin of `LIVE_STATUSES` in the backend's
// billing.ts, which is what the cancel/downgrade/resume routes refuse on — a button this module
// offers must be one those routes will act on.
// `canceled`/`incomplete` are deliberately absent: SuspendedScreen owns reactivation via
// Checkout, and a second payment path on this tab would compete with it.
const LIVE = ['trialing', 'active', 'past_due']

export function subscriptionTabState(
  billing: SubscriptionSnapshot | null | undefined,
  plan: string | null | undefined,
  now: Date,
): SubscriptionState {
  const tier = plan === 'pro' ? 'pro' : 'basic'
  const customer = billing?.stripe_customer_id
  const status = billing?.status ?? null
  // A comp is not a subscription, whatever the row says. `status` stays 'active' on a comped
  // row (it is what silences nothing in particular — the banner ignores it either way), so
  // without this term a comped shop reads as live and is offered a portal that 502s.
  const comped = !!billing?.comped
  const live = !!customer && !!status && LIVE.includes(status) && !comped

  const ending = live && !!billing?.cancel_at_period_end

  const actions: Actions = {
    comped,
    canManage: live,
    canSubscribe: !live && !comped,
    // Hidden while the shop is winding down (no selling Pro to someone on their way out) and
    // while the card is failing (answering a question they did not ask, days from suspension).
    // `!comped` is inert today — a comp always grants Pro, so `tier !== 'pro'` is already false —
    // and stands between a future Basic comp and an Upgrade button /api/checkout now refuses.
    canUpgrade: tier !== 'pro' && !comped && !ending && status !== 'past_due',
    canCancel: live && !ending,
    canResume: live && ending,
  }

  // No customer, or nothing running: there is no subscription to manage or change here.
  // A comped Pro shop lands here too — entitled, with no Stripe behind it — which is why the
  // entitled tier is still reported rather than assumed to be basic.
  if (!live) return { ...actions, kind: 'none', plan: tier }

  // Ahead of the trial and past-due branches on purpose: a cancelling trial ends in a suspended
  // shop just as a cancelling subscription does, and "3 days left" without "and then it stops"
  // is the same silence in a friendlier voice.
  if (ending) {
    return { ...actions, kind: 'ending', plan: tier, endsAt: billing?.current_period_end ?? null }
  }

  // Past due: the card is the problem, not the tier.
  if (status === 'past_due') return { ...actions, kind: 'past-due', plan: tier }

  if (status === 'trialing' && billing?.trial_ends_at) {
    const msLeft = Math.max(0, new Date(billing.trial_ends_at).getTime() - now.getTime())
    const daysLeft = Math.floor(msLeft / DAY)
    return {
      ...actions,
      kind: 'trial',
      plan: tier,
      daysLeft,
      trialEndsAt: billing.trial_ends_at,
      progress: Math.min(1, Math.max(0, daysLeft / TRIAL_TOTAL_DAYS)),
    }
  }

  return { ...actions, kind: 'live', plan: tier, renewsAt: billing?.current_period_end ?? null }
}
