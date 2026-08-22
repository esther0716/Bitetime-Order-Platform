// Shared, pure helpers for a product's unit quantity (display-only feature).
// The frontend stores the value as the raw DB column `unit_quantity` (numeric).

// Coerce a form/DB value to a valid positive quantity; fall back to 1 so a
// product never displays or persists 0, a negative, or NaN.
export function coerceQuantity(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 1
}

// Display: "<quantity> <unit>", always a single space. Legacy rows without a
// quantity render as "1 <unit>". `unit` is the raw string the caller resolves;
// display does not localize the unit today.
export function formatUnit(quantity: unknown, unit: string): string {
  return `${coerceQuantity(quantity)} ${unit}`
}

// The canonical unit options the product form and the menu import offer. The VALUE is stored
// as-is on `products.unit`; the label is bilingual and display-only. A unit not on this list
// still round-trips — both pickers keep an unknown stored value selectable, so adding or
// removing an entry here never rewrites a merchant's existing rows.
export const UNITS: { value: string; en: string; zh: string }[] = [
  { value: 'pcs', en: 'pcs', zh: '件' },
  { value: 'box', en: 'box', zh: '盒' },
  { value: 'set', en: 'set', zh: '套' },
  { value: 'pack', en: 'pack', zh: '包' },
  { value: 'dozen', en: 'dozen', zh: '打' },
  { value: 'bottle', en: 'bottle', zh: '瓶' },
  { value: 'cup', en: 'cup', zh: '杯' },
  { value: 'jar', en: 'jar', zh: '罐' },
  { value: 'tray', en: 'tray', zh: '盘' },
  { value: 'slice', en: 'slice', zh: '片' },
  { value: 'kg', en: 'kg', zh: '公斤' },
  { value: 'g', en: 'g', zh: '克' },
]
