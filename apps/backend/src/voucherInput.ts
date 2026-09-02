// What a merchant may say about a voucher, parsed once for both the create and the edit route.
//
// Pure, and deliberately the ONE place these rules are read off a request body. Create and edit
// used to be one route, so there was nothing to drift; the moment a second route reads the same
// six fields, the unbounded check or the expiry conversion can be forgotten on one of them, and
// "a voucher that stops on the 31st" would depend on which button the merchant pressed.
//
// No I/O and no env, so `pnpm --filter @bitetime/backend test` drives it with no Supabase.
import { expiryInstant } from './voucherExpiry.js'

/** The two discount shapes `priceOrder` knows. Anything else is a voucher that prices to nothing. */
const KINDS = new Set(['percent', 'fixed'])

/** A refused value, distinct from `null` (which means "unbounded" for the limits). */
const BAD = Symbol('invalid')

/** An optional whole-number limit: absent/blank/null is unbounded, anything below 1 is refused. */
function optionalCount(v: unknown): number | null | typeof BAD {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) return BAD
  return n
}

/** An optional money threshold: absent/blank/null is no threshold, negative is refused. */
function optionalMoney(v: unknown): number | null | typeof BAD {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return BAD
  return n
}

/** The columns a merchant may set, in the row's own spelling — ready for an insert or an update. */
export interface VoucherRules {
  kind: string
  amount: number
  max_uses: number | null
  per_customer_limit: number | null
  expires_at: string | null
  min_order: number | null
}

export type ParsedVoucherRules =
  | { ok: true; rules: VoucherRules }
  /** Every refusal is the caller's own mistake, so every one answers 400 with this string. */
  | { ok: false; error: string }

/**
 * Read the discount and its restrictions off a request body.
 *
 * `code` is NOT here. It is written once, on create, and never patched: a code is what the
 * merchant has printed on flyers and what customers are holding, and the partial unique index
 * treats it as the campaign's identity — so an edit changes what the code DOES, never what it IS.
 */
export function parseVoucherRules(b: any, tz: string | undefined): ParsedVoucherRules {
  const kind = String(b?.kind ?? '')
  const amount = Number(b?.amount)
  if (!KINDS.has(kind) || !Number.isFinite(amount) || amount < 0) return { ok: false, error: 'Invalid discount' }

  const maxUses = optionalCount(b?.maxUses)
  // ABSENT is one each; an explicit `null` is unlimited. The two are deliberately not the same
  // answer: unlimited is the value that costs the merchant money, so it has to be said out loud
  // rather than arrived at by leaving a field off. `undefined` also has to survive `optionalCount`,
  // which folds absent onto null for every other limit.
  const perCustomerLimit = b?.perCustomerLimit === undefined ? 1 : optionalCount(b.perCustomerLimit)
  if (maxUses === BAD || perCustomerLimit === BAD) return { ok: false, error: 'Invalid limit' }

  // Both unbounded is an unlimited discount for one person — #72 reached through the dashboard
  // rather than the request body. `vouchers_bounded` refuses it too; this answers with a message
  // that names the rule instead of a bare 500 out of PostgREST.
  if (maxUses === null && perCustomerLimit === null) return { ok: false, error: 'unbounded_voucher' }

  // The merchant picks a DATE; the column holds an INSTANT — 23:59:59.999 on the SHOP's clock, so
  // the code covers the whole of the day they chose. The conversion happens HERE and nowhere else,
  // which is what keeps `@bitetime/shared` ignorant of timezones. A present-but-unparseable date
  // is refused rather than dropped: a voucher silently saved with no expiry is a discount the
  // merchant believes will stop and does not.
  const expiresAt = b?.expiresOn == null || b.expiresOn === ''
    ? null
    : expiryInstant(b.expiresOn, tz)
  if (b?.expiresOn && !expiresAt) return { ok: false, error: 'Invalid expiry date' }

  const minOrder = optionalMoney(b?.minOrder)
  if (minOrder === BAD) return { ok: false, error: 'Invalid minimum order' }

  return {
    ok: true,
    rules: {
      kind,
      amount,
      max_uses: maxUses,
      per_customer_limit: perCustomerLimit,
      expires_at: expiresAt,
      min_order: minOrder,
    },
  }
}
