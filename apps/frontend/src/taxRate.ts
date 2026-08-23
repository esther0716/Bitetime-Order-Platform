/**
 * A tax rate as it is printed: `6`, `6.5`, never `6.00`.
 *
 * `tax_rate` is `numeric(5,2)`, so PostgREST can hand back `6` and postgres.js `'6.00'` for the
 * same shop — the label must not depend on which one arrived.
 *
 * The backend keeps its own twin in `invoice.ts`, for the same reason `orderNotice.ts` keeps a
 * `formatMoney`: the two workspaces cannot import each other, and what a document prints is not a
 * rule that must hold identically on both sides of the wire.
 *
 * This file was `receipt.ts` and held the invoice's arithmetic too. That arithmetic now lives on
 * the backend, where the document itself is built (ADR 0017) — and the name went with it, because
 * "receipt" means the slip the CUSTOMER uploads after paying (`payment-proof`), not the document
 * the shop issues.
 */
export function formatTaxRate(rate: number | string | null | undefined): string {
  const n = typeof rate === 'string' ? Number(rate) : rate
  if (n === null || n === undefined || !Number.isFinite(n)) return '0'
  return String(parseFloat(n.toFixed(2)))
}
