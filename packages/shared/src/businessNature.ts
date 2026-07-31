// What kind of business a shop runs (#161), collected at merchant signup so the platform
// can see which industries it actually serves.
//
// Shared for the reason `feedback.ts` is: both sides enforce the same closed list. The signup
// form renders a dropdown from it (mandatory, and never editable afterwards — there is no
// merchant-facing way to change it once set), the backend refuses anything else, and the
// `merchants_business_nature_check` CHECK in
// 20260729120000_merchant_business_nature.sql is the final authority. A free-text field was
// considered and rejected — the whole point is a group-by, and 'bakery' / 'Bakery' / 'cake shop'
// do not group.
//
// The CODES are stable identifiers, never shown to anyone: they are what is stored, what the
// CHECK lists, and what the admin Overview groups on. Their human labels are localised
// (`t(en, zh)`) and therefore live in the browser — `apps/frontend/src/businessNature.ts`.
//
// ADDING one: append here, add it to a new migration's CHECK, and add its EN/ZH label. Never
// rename a code in place — every shop already carrying it would silently change industry.

export const BUSINESS_NATURES = [
  'bakery', 'restaurant', 'beverages', 'grocery',
  'catering', 'snacks', 'florist', 'other',
] as const

export type BusinessNature = (typeof BUSINESS_NATURES)[number]

export function isBusinessNature(value: unknown): value is BusinessNature {
  return typeof value === 'string' && (BUSINESS_NATURES as readonly string[]).includes(value)
}
