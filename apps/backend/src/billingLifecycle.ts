// Pure billing-lifecycle decisions. No I/O: callers pass rows in; Stripe and
// Supabase effects stay in the route handlers (mirrors notify.ts).

export interface BillingRow {
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  status?: string | null
  trial_ends_at?: string | null
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
