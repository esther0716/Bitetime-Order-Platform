// Currency codes a shop can price in (#186). Chosen once at signup and never editable
// afterwards — same shape as businessNature.ts, and for the same reason: the backend enforces
// this list too, and `merchants_currency_check` in
// 20260805120000_merchant_currency_check.sql is the final authority.
//
// The CODES are what both sides validate against and what is stored. Symbols, decimals and
// localised labels are a browser-only display concern — see apps/frontend/src/currency.ts.
//
// ADDING one: append here and to the CHECK in a new migration. Never rename a code in place —
// every shop already carrying it would silently change currency.

export const CURRENCY_CODES = ['MYR', 'SGD', 'USD', 'THB', 'PHP', 'IDR', 'VND', 'JPY'] as const

export type CurrencyCode = (typeof CURRENCY_CODES)[number]

export const DEFAULT_CURRENCY: CurrencyCode = 'MYR'

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (CURRENCY_CODES as readonly string[]).includes(value)
}
