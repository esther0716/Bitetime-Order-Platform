// What a voucher row is allowed to look like on the wire. Pure, and separate from the routes
// precisely so it can be tested without a database — the property it holds is an ABSENCE, and an
// absence is exactly what a route test stubbing a success would not notice.
//
// `vouchers.used_by` is a list of the ACCOUNT EMAIL ADDRESSES of everyone who has redeemed the
// code. Two handlers used to `select('*')` and return the row verbatim:
//
//   GET /api/merchants/:id/vouchers/:code  — UNAUTHENTICATED. A voucher code is printed on
//     flyers and posters, so this served every redeemer's email to anyone who read one.
//   GET /api/merchants/:id/vouchers        — the merchant's own dashboard. Owner-scoped, and
//     still wrong: CONTEXT.md → Shop customer states that what a shop may see is "shop-scoped
//     facts plus the has-an-account flag — and no account email, no saved address, nothing from
//     the global profile". A WhatsApp number was volunteered to a shop; an email was volunteered
//     to the PLATFORM.
//
// So neither view carries `used_by`, and neither carries anything derived from it that could
// name a person. The customer's own "have I used this?" is answered from the CALLER'S OWN
// verified email, which they already know, and only when they present one.

import { expiryDate } from './voucherExpiry.js'

/** The columns either view reads. `used_by` is read here and leaves in no response. */
export interface VoucherRow {
  id?: string
  code?: string
  kind?: string | null
  amount?: number | string | null
  max_uses?: number | null
  per_customer_limit?: number | null
  expires_at?: string | null
  min_order?: number | string | null
  used_by?: unknown
}

/** Fields common to both views. Everything the pricing mapper needs, and nothing else. */
interface VoucherBase {
  id?: string
  code?: string
  kind?: string | null
  amount?: number | string | null
  max_uses?: number | null
  /** null = unlimited per customer. The column defaults to 1. */
  per_customer_limit?: number | null
  /** An ISO instant — the last millisecond of the merchant's chosen day, on the shop's clock. */
  expires_at?: string | null
  min_order?: number | string | null
  /** Derived. TRUE when the shop's total cap is spent and nobody can redeem it. */
  fully_used: boolean
}

export interface VoucherPublicView extends VoucherBase {
  /**
   * Whether THIS caller has spent their own allowance. Absent when the caller presented no
   * verified identity — a voucher requires an account anyway (`voucher_requires_account`), so a
   * signed-out customer has nothing to ask about yet.
   *
   * A COUNT against `per_customer_limit`, not a membership test: since #241 one customer may hold
   * several redemptions, so "is your key in the list" is the wrong question.
   */
  customer_limit_reached?: boolean
}

export type VoucherMerchantView = VoucherBase & {
  /** How many redemptions the code has taken. A COUNT, never the keys behind it. */
  used_count: number
  /**
   * The shop-local DATE `expires_at` ends, for the form to show back. Derived here because the
   * merchant must see the date they typed: east of UTC the stored instant sits on the PREVIOUS
   * calendar day, so a browser slicing the ISO string shows an expiry a day early.
   */
  expires_on?: string | null
  /**
   * The owning shop. Not a disclosure — the caller named it in the route and `requireMerchantOwns`
   * proved they own it. It is here because the create response is where the tenancy invariant is
   * OBSERVABLE: `POST` forces `merchant_id` from `:id` and never reads it from the body, and
   * `tests/api/writes-vouchers.test.ts` asserts the returned row to prove a crafted body did not
   * plant a voucher under a stranger's shop. Drop this field and that assertion silently passes
   * on `undefined`.
   */
  merchant_id?: string
  active?: boolean
  created_at?: string
}

/** The redeemer keys, defensively — a jsonb column can hold anything the DB was ever given. */
function keys(row: VoucherRow): string[] {
  return Array.isArray(row.used_by) ? (row.used_by as unknown[]).filter((k): k is string => typeof k === 'string') : []
}

/**
 * TRUE when the shop's total cap is spent. A null/absent `max_uses` is UNLIMITED, so it is never
 * fully used — the same reading `voucherUsesLeft` has always had, and the reason this is a test
 * for `== null` rather than a truthiness check: `max_uses = 0` is a voucher nobody may redeem.
 */
function fullyUsed(row: VoucherRow): boolean {
  if (row.max_uses == null) return false
  return redemptionCount(row) >= row.max_uses
}

/**
 * How many redemptions the code has taken.
 *
 * `redemptions` — a count read from `voucher_redemptions` — is the authority when the caller has
 * one. The `used_by` length is the fallback for a caller that has not been given one yet, and it
 * is why the column is still selected: the two agree, because the migration backfilled the array
 * verbatim. When `used_by` finally goes, so does the fallback.
 */
function redemptionCount(row: VoucherRow, redemptions?: number): number {
  return redemptions ?? keys(row).length
}

/**
 * The customer-facing view. `callerEmail` is the caller's own VERIFIED email (from their JWT) or
 * null — never a value from the request body, which is the rule `claimVoucher`'s key already
 * follows (#72): a key the client can name is not a key, and here it would also be a way to ask
 * "has alice@example.com used this?" about a stranger.
 */
export function voucherPublicView(
  row: VoucherRow,
  callerEmail: string | null,
  /**
   * This caller's own redemption count, when the caller looked it up. Absent falls back to the
   * one-per-customer reading of `used_by`, which is the only rule a caller without the count
   * could have meant.
   */
  mine?: number,
): VoucherPublicView {
  const view: VoucherPublicView = {
    id: row.id,
    code: row.code,
    kind: row.kind,
    amount: row.amount,
    max_uses: row.max_uses,
    per_customer_limit: row.per_customer_limit,
    expires_at: row.expires_at,
    min_order: row.min_order,
    fully_used: fullyUsed(row),
  }
  const email = (callerEmail ?? '').trim().toLowerCase()
  if (email) {
    const taken = mine ?? (keys(row).includes(email) ? 1 : 0)
    // A null limit is unlimited, so it is never reached — the same reading `max_uses` gets, and
    // the reason this tests for `== null` rather than truthiness.
    view.customer_limit_reached = row.per_customer_limit == null ? false : taken >= row.per_customer_limit
  }
  return view
}

/** The merchant's own list. A count of redemptions, and never who made them. */
export function voucherMerchantView(
  row: VoucherRow & { merchant_id?: string; active?: boolean; created_at?: string },
  /** The shop's timezone, to render `expires_on`. */
  tz?: string,
  /** This code's redemption count, when the caller looked it up. */
  redemptions?: number,
): VoucherMerchantView {
  return {
    id: row.id,
    merchant_id: row.merchant_id,
    code: row.code,
    kind: row.kind,
    amount: row.amount,
    max_uses: row.max_uses,
    per_customer_limit: row.per_customer_limit,
    expires_at: row.expires_at,
    expires_on: expiryDate(row.expires_at, tz),
    min_order: row.min_order,
    fully_used: fullyUsed(row),
    used_count: redemptionCount(row, redemptions),
    active: row.active,
    created_at: row.created_at,
  }
}
