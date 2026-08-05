// Currency registry + money formatter — the single seam every money-display site
// flows through. Pure, no I/O. Currency is a DISPLAY + pricing-unit concern only:
// there is no FX conversion — a price the merchant types is the price the customer
// pays, in the chosen currency's symbol and formatting. See issue #18.
//
// The CODES themselves — and the rule that nothing else is storable — live in
// `@bitetime/shared`, because the backend enforces them too (see currency.ts there).
// Only symbol/decimals/label are here: a display concern, not a wire concern.
//
// Adding a currency = one entry in the shared CODES list, then one entry below.
// `CURRENCIES` is total over `CurrencyCode` — a new code fails to typecheck here
// until it has a display def. `decimals` drives fraction digits (MYR=2, JPY/IDR/VND=0);
// `symbol` is placed before the amount (after when symbolAfter).

import { CURRENCY_CODES, DEFAULT_CURRENCY, isCurrencyCode, type CurrencyCode } from '@bitetime/shared'

export { CURRENCY_CODES, DEFAULT_CURRENCY }
export type { CurrencyCode }

export interface CurrencyDef {
  code: string
  symbol: string
  decimals: number
  symbolAfter?: boolean
  /** English label for the settings dropdown. */
  label: string
}

// MYR first so it reads as the platform default.
export const CURRENCIES: Record<CurrencyCode, CurrencyDef> = {
  MYR: { code: 'MYR', symbol: 'RM', decimals: 2, label: 'Malaysian Ringgit' },
  SGD: { code: 'SGD', symbol: 'S$', decimals: 2, label: 'Singapore Dollar' },
  USD: { code: 'USD', symbol: '$', decimals: 2, label: 'US Dollar' },
  THB: { code: 'THB', symbol: '฿', decimals: 2, label: 'Thai Baht' },
  PHP: { code: 'PHP', symbol: '₱', decimals: 2, label: 'Philippine Peso' },
  IDR: { code: 'IDR', symbol: 'Rp', decimals: 0, label: 'Indonesian Rupiah' },
  VND: { code: 'VND', symbol: '₫', decimals: 0, label: 'Vietnamese Đồng' },
  JPY: { code: 'JPY', symbol: '¥', decimals: 0, label: 'Japanese Yen' },
}

/** Resolve a code to its definition, falling back to the default for unknown/missing codes. */
export function currencyDef(code?: string | null): CurrencyDef {
  return isCurrencyCode(code) ? CURRENCIES[code] : CURRENCIES[DEFAULT_CURRENCY]
}

// One fixed locale for the numeric part keeps grouping/decimals deterministic
// across environments; the symbol comes from the registry, not the locale, so
// MYR renders `RM 8.00` exactly as the old `RM ${n.toFixed(2)}` did.
function formatNumber(value: number, decimals: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

/**
 * The one function every money-display site calls. Renders `amount` in the given
 * currency's symbol, decimals, and grouping. Non-finite amounts render as 0.
 */
export function formatMoney(amount: number | null | undefined, code?: string | null): string {
  const def = currencyDef(code)
  const n = Number(amount)
  const value = Number.isFinite(n) ? n : 0
  const num = formatNumber(value, def.decimals)
  return def.symbolAfter ? `${num} ${def.symbol}` : `${def.symbol} ${num}`
}
