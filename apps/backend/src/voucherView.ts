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

/** The columns either view reads. `used_by` is read here and leaves in no response. */
export interface VoucherRow {
  id?: string
  code?: string
  kind?: string | null
  amount?: number | string | null
  max_uses?: number | null
  used_by?: unknown
}

/** Fields common to both views. Everything the pricing mapper needs, and nothing else. */
interface VoucherBase {
  id?: string
  code?: string
  kind?: string | null
  amount?: number | string | null
  max_uses?: number | null
  /** Derived. TRUE when the shop's total cap is spent and nobody can redeem it. */
  fully_used: boolean
}

export interface VoucherPublicView extends VoucherBase {
  /**
   * Whether THIS caller has already redeemed it. Absent when the caller presented no verified
   * identity — a voucher requires an account anyway (`voucher_requires_account`), so a signed-out
   * customer has nothing to ask about yet.
   */
  already_used?: boolean
}

export type VoucherMerchantView = VoucherBase & {
  /** How many redemptions the code has taken. A COUNT, never the keys behind it. */
  used_count: number
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
  return keys(row).length >= row.max_uses
}

/**
 * The customer-facing view. `callerEmail` is the caller's own VERIFIED email (from their JWT) or
 * null — never a value from the request body, which is the rule `claimVoucher`'s key already
 * follows (#72): a key the client can name is not a key, and here it would also be a way to ask
 * "has alice@example.com used this?" about a stranger.
 */
export function voucherPublicView(row: VoucherRow, callerEmail: string | null): VoucherPublicView {
  const view: VoucherPublicView = {
    id: row.id,
    code: row.code,
    kind: row.kind,
    amount: row.amount,
    max_uses: row.max_uses,
    fully_used: fullyUsed(row),
  }
  const email = (callerEmail ?? '').trim().toLowerCase()
  if (email) view.already_used = keys(row).includes(email)
  return view
}

/** The merchant's own list. A count of redemptions, and never who made them. */
export function voucherMerchantView(
  row: VoucherRow & { merchant_id?: string; active?: boolean; created_at?: string },
): VoucherMerchantView {
  return {
    id: row.id,
    merchant_id: row.merchant_id,
    code: row.code,
    kind: row.kind,
    amount: row.amount,
    max_uses: row.max_uses,
    fully_used: fullyUsed(row),
    used_count: keys(row).length,
    active: row.active,
    created_at: row.created_at,
  }
}
