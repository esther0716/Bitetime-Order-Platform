// Redemption counts, over the direct `db.ts` connection.
//
// Split from `voucherView.ts` the same way `aiUsageDb.ts` is split from `aiUsage.ts`: the shaping
// rule stays pure and reachable from `pnpm test`, and the two statements that need a database live
// here. The counts the CHECKOUT path needs are not here at all — those run inside the order
// transaction, under the voucher's row lock, in `orders.ts`. A count taken outside that lock is a
// display figure, and these two are exactly that.
//
// `db.ts` is RLS-exempt. Neither function is a tenancy boundary: both take voucher ids the caller
// has already been proved to own (`requireMerchantOwns`) or a single id already filtered by
// `merchant_id` in the query that produced it.
import { sql } from './db.js'

/** voucher id → how many redemptions it has taken. Ids absent from the result took none. */
export async function redemptionCounts(voucherIds: string[]): Promise<Record<string, number>> {
  if (voucherIds.length === 0) return {}
  const rows = await sql<{ voucher_id: string; n: number }[]>`
    select voucher_id, count(*)::int as n
    from voucher_redemptions
    where voucher_id = any(${voucherIds}::uuid[])
    group by voucher_id
  `
  const out: Record<string, number> = {}
  for (const r of rows) out[r.voucher_id] = r.n
  return out
}

/**
 * How many redemptions ONE customer holds on ONE voucher.
 *
 * `customerKey` must be the lowercased email off a VERIFIED JWT and never a request-body value —
 * the rule `claimVoucher`'s key already follows (#72). Passed anything a client can name, this
 * becomes a way to ask whether a stranger has redeemed a code.
 */
export async function myRedemptionCount(voucherId: string, customerKey: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from voucher_redemptions
    where voucher_id = ${voucherId} and customer_key = ${customerKey}
  `
  return row?.n ?? 0
}
