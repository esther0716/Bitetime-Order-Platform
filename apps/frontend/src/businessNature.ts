// Human labels for the business-nature codes (#161). The CODES themselves — and the rule that
// nothing else is storable — live in `@bitetime/shared`, because the backend enforces them too.
// Only the labels are here: they are localised through `t(en, zh)`, which is a browser concern.
//
// A label is free to be reworded; a code is not (see businessNature.ts in the shared package).

import { BUSINESS_NATURES, type BusinessNature } from '@bitetime/shared'

/** `[english, chinese]`, ready to spread into `t()`. TOTAL over the shared list — a new code
 *  fails to typecheck here until it has a label, rather than rendering as a bare slug. */
export const BUSINESS_NATURE_LABELS: Record<BusinessNature, [string, string]> = {
  bakery: ['Bakery & desserts', '烘焙甜点'],
  restaurant: ['Restaurant & café', '餐厅咖啡'],
  beverages: ['Beverages & drinks', '饮品'],
  grocery: ['Grocery & fresh produce', '杂货生鲜'],
  catering: ['Catering & meal prep', '餐饮外烩'],
  snacks: ['Packaged snacks', '包装零食'],
  florist: ['Florist & gifts', '花艺礼品'],
  other: ['Other', '其他'],
}

/** The dropdown's options, in the order the list declares them ('other' last). Rendered by
 *  `BusinessNaturePicker`, which both the signup form and Shop Settings use. */
export const BUSINESS_NATURE_OPTIONS: { value: BusinessNature; label: [string, string] }[] =
  BUSINESS_NATURES.map(value => ({ value, label: BUSINESS_NATURE_LABELS[value] }))

/**
 * Label for a stored value, for `t(...businessNatureLabel(m.business_nature))`.
 *
 * A shop that predates the field carries NULL, and one carrying a code this build has never
 * heard of is possible too (an older bundle against a newer database). Both are named, not
 * hidden: the admin chart counts every merchant or it is not a count.
 */
export function businessNatureLabel(value?: string | null): [string, string] {
  if (!value) return ['Unspecified', '未填写']
  return BUSINESS_NATURE_LABELS[value as BusinessNature] ?? [value, value]
}
