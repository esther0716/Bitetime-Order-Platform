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

/**
 * voucher id → how many redemptions it has taken. Ids absent from the result took none.
 *
 * Voided redemptions do not count — a cancelled order returns its use (ADR 0023). This figure is
 * what the merchant's dashboard shows as "used", so it has to agree with the count `claimVoucher`
 * takes under the row lock; a filter here and not there is a shop told a code is spent that
 * checkout will happily take.
 */
export async function redemptionCounts(voucherIds: string[]): Promise<Record<string, number>> {
  if (voucherIds.length === 0) return {}
  const rows = await sql<{ voucher_id: string; n: number }[]>`
    select voucher_id, count(*)::int as n
    from voucher_redemptions
    where voucher_id = any(${voucherIds}::uuid[]) and voided_at is null
    group by voucher_id
  `
  const out: Record<string, number> = {}
  for (const r of rows) out[r.voucher_id] = r.n
  return out
}

/**
 * How many redemptions ONE customer holds on ONE voucher. Voided ones do not count (ADR 0023).
 *
 * `customerKey` must be the lowercased email off a VERIFIED JWT and never a request-body value —
 * the rule `claimVoucher`'s key already follows (#72). Passed anything a client can name, this
 * becomes a way to ask whether a stranger has redeemed a code.
 */
export async function myRedemptionCount(voucherId: string, customerKey: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from voucher_redemptions
    where voucher_id = ${voucherId} and customer_key = ${customerKey} and voided_at is null
  `
  return row?.n ?? 0
}

/**
 * Hold one order's redemptions in step with its status: void while the order is `cancelled`,
 * live otherwise.
 *
 * STATE-DRIVEN, not transition-driven, and that is the whole design. The caller passes what the
 * order's status now IS, never what it changed from — so the statement is idempotent, needs no
 * read of the previous status, and a void that failed is repaired by the next patch of the same
 * order rather than lost. It is also why this is safe to run outside the order patch's own write:
 * the two are not atomic, and the failure direction is the old behaviour (the use stays spent).
 *
 * `coalesce` keeps the FIRST void's timestamp across repeats — the record of when a slot was
 * released must not move because a merchant pressed Cancel twice.
 *
 * The un-void is unconditional: no cap is re-checked. A merchant correcting their own mis-click
 * must not be blocked because another customer took the freed slot meanwhile, so a restore can
 * put a voucher one over `max_uses`. That is the accepted cost of a symmetric cancel — see
 * ADR 0023.
 *
 * `db.ts` is RLS-exempt, and this takes no merchant id: the order id has already been proved to
 * belong to the caller's shop by `requireOwnsChild`. Do not call it with an id from a body.
 */
export async function syncOrderRedemptionVoid(orderId: string, cancelled: boolean): Promise<void> {
  await sql`
    update voucher_redemptions
    set voided_at = ${cancelled ? sql`coalesce(voided_at, now())` : sql`null`}
    where order_id = ${orderId}
  `
}
