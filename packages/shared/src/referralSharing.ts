// May this shop hand out its referral code?
//
// Shared because both sides of the wire answer it about the same shop and must agree. The
// dashboard asks about the SIGNED-IN merchant, to decide whether to show them a code at all;
// `GET /api/referrals/check` asks about the OWNER OF A TYPED CODE, to decide whether the signup
// form calls that code good. Two copies of the rule drift into a code shown in one place and
// refused in the other — which is the exact confusion this module exists to prevent.
//
// The rule tracks `referralReward.ts`'s `isEligible`, which decides the payout at a LATER moment
// (when the invited shop pays its first invoice) and demands a shop that is genuinely paying.
// This is that same demand, moved to the moment the promise is made. It cannot guarantee the
// payout — a merchant can cancel the day after they share — but it stops the code being handed
// out by a shop that already cannot earn.

export interface ReferralBillingSnapshot {
  /** `merchant_billing.status` — whatever Stripe last said. */
  status?: string | null
  /** Comped by a superadmin: status reads 'active' with no subscription behind it. */
  comped?: boolean | null
  /** Cancelled and winding down. Stripe keeps `status` 'active' until the period ends. */
  cancel_at_period_end?: boolean | null
}

export function canShareReferral(billing: ReferralBillingSnapshot | null | undefined): boolean {
  if (!billing) return false
  // Three separate columns and three separate reasons, none inferable from another. `status`
  // alone says yes to a comped shop (nothing to credit) and to a cancelling one (nothing left to
  // credit by the time the reward falls due).
  if (billing.status !== 'active') return false
  if (billing.comped === true) return false
  if (billing.cancel_at_period_end === true) return false
  return true
}
