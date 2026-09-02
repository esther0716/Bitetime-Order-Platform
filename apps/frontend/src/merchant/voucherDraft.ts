// The voucher form's draft: what the sheet holds, how a row seeds it, and what it sends.
//
// Pure, so the seeding rule — which of the four "limit" boxes is ticked for a given row — is a
// thing `pnpm test` can pin. It is the one part of the form that is easy to get quietly wrong:
// `per_customer_limit = 1` is the UNTICKED state, not a ticked box holding "1", and a merchant
// opening a plain voucher to change its amount must not be shown four limits they never set.
import type { Voucher } from '../types'

export interface VoucherForm {
  code: string
  kind: 'percent' | 'fixed'
  amount: string
  /**
   * The four DISCLOSURE states, not the values. Stripe's coupon screen is the shape: three
   * fields visible, everything else behind a checkbox that reveals its input, so the common
   * voucher — a percent off, unlimited, one each — stays a 30-second job.
   *
   * Read the two "off" meanings carefully, because they are OPPOSITE and the labels have to say
   * so: total uses unchecked means UNLIMITED, per-customer unchecked means ONE EACH.
   */
  limitTotal: boolean
  maxUses: string
  limitPerCustomer: boolean
  perCustomerLimit: string
  limitExpiry: boolean
  expiresOn: string
  limitMinOrder: boolean
  minOrder: string
}

export const BLANK_VOUCHER: VoucherForm = {
  code: '', kind: 'percent', amount: '',
  limitTotal: false, maxUses: '',
  limitPerCustomer: false, perCustomerLimit: '2',
  limitExpiry: false, expiresOn: '',
  limitMinOrder: false, minOrder: '',
}

/** The row as the form shows it back. A box is ticked exactly when the row holds that rule. */
export function voucherToForm(v: Voucher): VoucherForm {
  const kind = v.type === 'fixed' ? 'fixed' : 'percent'
  const reusable = v.perCustomerLimit !== 1
  return {
    code: v.code ?? '',
    kind,
    amount: v.value == null ? '' : String(v.value),
    limitTotal: v.maxUses != null,
    maxUses: v.maxUses == null ? '' : String(v.maxUses),
    limitPerCustomer: reusable,
    // Unticked keeps the blank form's suggestion, so ticking the box later offers "2" rather than
    // the "1" that would mean the same as leaving it off.
    perCustomerLimit: reusable ? (v.perCustomerLimit == null ? '' : String(v.perCustomerLimit)) : BLANK_VOUCHER.perCustomerLimit,
    limitExpiry: !!v.expiresOn,
    // `expiresOn` is the SHOP-LOCAL date the server derived. Never slice `expiresAt` here: east
    // of UTC the instant sits on the previous calendar day and would read a day early.
    expiresOn: v.expiresOn ?? '',
    limitMinOrder: v.minOrder != null,
    minOrder: v.minOrder == null ? '' : String(v.minOrder),
  }
}

/** What the store sends. An unticked box sends its "off" value, never what sits behind it. */
export interface VoucherRules {
  kind: 'percent' | 'fixed'
  amount: number
  maxUses: number | null
  perCustomerLimit: number | null
  expiresOn: string | null
  minOrder: number | null
}

export function formToRules(f: VoucherForm): VoucherRules {
  return {
    kind: f.kind,
    amount: Number(f.amount) || 0,
    // An unchecked box sends null, never the value still sitting in the input behind it — a
    // merchant who types an expiry, changes their mind and unticks it must not get that expiry.
    maxUses: f.limitTotal && f.maxUses !== '' ? Number(f.maxUses) : null,
    // Unchecked is ONE each — the rule every voucher predating this form was created under.
    // Checked with a blank input is unlimited, which is the whole of what #241 asked for.
    perCustomerLimit: !f.limitPerCustomer ? 1 : f.perCustomerLimit === '' ? null : Number(f.perCustomerLimit),
    expiresOn: f.limitExpiry && f.expiresOn !== '' ? f.expiresOn : null,
    minOrder: f.limitMinOrder && f.minOrder !== '' ? Number(f.minOrder) : null,
  }
}

/**
 * Has the merchant changed anything worth a "discard?" prompt.
 *
 * Compared on what would be SENT, not on the raw fields: typing in a box and then unticking it
 * leaves the input holding text the server will never see, and warning about that is warning
 * about a change nobody made. The code is compared raw because it is sent raw.
 */
export function voucherDraftChanged(current: VoucherForm, seeded: VoucherForm): boolean {
  if (current.code !== seeded.code) return true
  return JSON.stringify(formToRules(current)) !== JSON.stringify(formToRules(seeded))
}
