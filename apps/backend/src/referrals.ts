import { canShareReferral } from '@bitetime/shared'
import { sql } from './db.js'

export interface ReferredShop {
  name: string
  created_at: string
  status: string
}

/**
 * A member's referral code: the first 8 hex characters of their user id, uppercased.
 *
 * This must stay byte-identical to the frontend's `referralCodeOf()` and to what signup
 * stamps onto `merchants.referred_by_code`, or a referrer's shops quietly stop matching
 * their own code. The old SQL derived it the same way, from `auth.uid()`.
 */
export function referralCodeOf(userId: string): string {
  return userId.replace(/-/g, '').slice(0, 8).toUpperCase()
}

/**
 * The shops that signed up under this user's referral code, newest first.
 *
 * The code is derived from the caller's id — never accepted from the request. That is the
 * whole security property of the function this replaces: `my_referred_shops` was SECURITY
 * DEFINER precisely so it could read across tenants, and it was safe only because it
 * filtered on a code the caller could not choose. Take the code as an argument from an
 * untrusted source and this becomes a cross-tenant read of any referrer's shops.
 *
 * Only the three non-sensitive columns the referral tab renders are selected.
 */
export async function listReferredShops(userId: string): Promise<ReferredShop[]> {
  const code = referralCodeOf(userId)

  // `${code}` is a bound parameter, not string interpolation — postgres.js's tagged template
  // sends it out of band. Building this query by concatenation would hand any caller who can
  // influence the code a read of the whole merchants table.
  const rows = await sql<{ name: string; created_at: Date; status: string }[]>`
    select m.name, m.created_at, m.status::text
    from merchants m
    where m.referred_by_code = ${code}
    order by m.created_at desc
  `

  // Two conversions, both deliberate. `created_at` arrives as a Date and the wire contract is
  // an ISO string, so say so here rather than leaning on c.json() to stringify it. And the
  // rows come back as postgres.js's Result, an Array subclass carrying `count`/`columns`/
  // `statement`; mapping to plain objects keeps those off the response.
  return rows.map(r => ({
    name: r.name,
    created_at: r.created_at.toISOString(),
    status: r.status,
  }))
}

export interface EarnedReward {
  referred_shop_name: string
  amount: number // smallest currency unit (cents)
  currency: string
  created_at: string
}

/**
 * The referral rewards this user has EARNED — one free month per shop they brought in that
 * converted to a paying plan. PRD: docs/prd-referral-reward.md (#70).
 *
 * Same security shape as listReferredShops: the caller's merchant is resolved from their
 * verified id (`owner_id = ${userId}`), never from the request. This runs on the RLS-exempt
 * `sql` connection, so scoping to the caller's own merchant here is the ONLY thing keeping
 * one member from reading another's rewards — do not add a merchant/code parameter.
 */
export async function listEarnedRewards(userId: string): Promise<EarnedReward[]> {
  const rows = await sql<{ referred_shop_name: string; amount: number; currency: string; created_at: Date }[]>`
    select referred.name as referred_shop_name, rr.amount, rr.currency, rr.created_at
    from public.referral_rewards rr
    join public.merchants me       on me.id = rr.referrer_merchant_id
    join public.merchants referred on referred.id = rr.referred_merchant_id
    where me.owner_id = ${userId}
    order by rr.created_at desc
  `

  return rows.map(r => ({
    referred_shop_name: r.referred_shop_name,
    amount: r.amount,
    currency: r.currency,
    created_at: r.created_at.toISOString(),
  }))
}

/**
 * May the shop behind this referral code hand it out?
 *
 * Answers the signup form's typo check, which now asks a second question beyond "does this code
 * name a shop": can that shop still earn anything for the referral? A code whose owner stopped
 * paying is worse than a code that names nothing — it validates, gets stamped onto the new shop,
 * and pays out nothing when the invoice clears months later.
 *
 * The rule itself is NOT in this SQL. `canShareReferral` decides, so this and the dashboard's own
 * "should I show a code?" answer the question the same way; a WHERE clause spelling out the same
 * three columns is the copy that drifts. The query's only job is to fetch the candidates.
 *
 * `left join` deliberately: a shop with no billing row at all must reach the rule (which refuses
 * it), not be dropped by the join and mistaken for a code that names nothing.
 *
 * The 8-hex code can collide across owners, so this reads every match and asks whether ANY of
 * them could share. That is the honest answer to "is this code usable" — which of them earns is
 * `decideReferralReward`'s problem, and it refuses an ambiguous match outright.
 */
export async function referralCodeIsShareable(code: string): Promise<boolean> {
  const rows = await sql<{ status: string | null; comped: boolean | null; cancel_at_period_end: boolean | null }[]>`
    select b.status, b.comped, b.cancel_at_period_end
    from public.merchants m
    left join public.merchant_billing b on b.merchant_id = m.id
    where m.referral_code = ${code}
      and m.status = 'active'
  `

  return rows.some(row => canShareReferral(row))
}
