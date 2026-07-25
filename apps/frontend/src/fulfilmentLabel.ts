// The ONE mapping from a `mode` value to what the customer and the merchant read.
//
// It exists because there were three hand-rolled `mode === 'delivery' ? … : …` ternaries — the
// receipt, the customer's order history and the dashboard — and a fourth is exactly how one
// surface ends up calling a method something the other three do not. A customer comparing their
// receipt against their history must not find two names for one order.
import { isDistancePriced } from '@bitetime/shared'
import type { FulfilmentMethod } from '@bitetime/shared'
import type { Translate } from './types'

const LABELS: Record<string, { en: string; zh: string }> = {
  pickup:   { en: 'Pickup',           zh: '自取' },
  delivery: { en: 'Delivery',         zh: '送货' },
  express:  { en: 'Express delivery', zh: '快速配送' },
}

/** The method's name. An unknown mode is capitalised rather than blanked — an old row still
 *  has to say something. */
export function fulfilmentLabel(mode: string | null | undefined, t: Translate): string {
  if (!mode) return '—'
  const l = LABELS[mode]
  return l ? t(l.en, l.zh) : mode.charAt(0).toUpperCase() + mode.slice(1)
}

/**
 * The money line for the shipping charge, named after the method that produced it.
 *
 * `km` is appended only when the fee was actually priced BY it. The distance is what makes the
 * fee reconcilable on a calculator (`base + rate × km`), and it is already the rounded km the fee
 * was derived from — see `routedKm`. A region-priced order has no distance, and printing one
 * would be a lie about what produced the money.
 *
 * The METHOD is what decides that, not the presence of a `km` argument — which is why this
 * function drops the distance for a region order rather than trusting its caller to pass null.
 * The storefront could not be trusted with it: a quote belongs to the ADDRESS and deliberately
 * survives a fulfilment-method switch (#101 review, Finding 2), so a customer who quoted an
 * express fee and then chose flat `delivery` still held one, and the summary printed
 * `Delivery fee (13.9 km)` beside an RM 8.00 flat rate the kilometres played no part in
 * producing (#128). The receipt and order history were never wrong here — they read the STORED
 * `delivery_distance_km`, which intake writes as null for a region order — so putting the guard
 * in the shared function costs them nothing and closes the case for any future caller.
 */
export function feeLineLabel(mode: string | null | undefined, km: number | null, t: Translate): string {
  // An unknown mode — an old row from before a method was renamed — is not distance-priced, and
  // the cast is safe for exactly that reason: the rule is an equality test, so anything that is
  // not a known distance method falls out as `false`.
  const distancePriced = mode != null && isDistancePriced(mode as FulfilmentMethod)
  const base = distancePriced
    ? t('Express delivery fee', '快速配送费')
    : t('Delivery fee', '送货费')
  if (km === null || !distancePriced) return base
  return t(`${base} (${km.toFixed(1)} km)`, `${base}（${km.toFixed(1)} 公里）`)
}
