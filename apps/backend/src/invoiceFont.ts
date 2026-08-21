// The one face the invoice is drawn in.
//
// Noto Sans SC, and it is embedded UNCONDITIONALLY rather than only for Chinese readers. The
// invoice's own labels are English, but `merchants.name` and `products.name` hold Chinese for a
// great many shops — the base column, not the `_zh` twin — so a latin-only face renders tofu for
// exactly the shops most likely to want an invoice.
//
// ONE weight. `pdf-lib` does not synthesise bold, so a second weight is a second 17MB file; the
// document carries its hierarchy in size, spacing and uppercase instead.
//
// Read from disk rather than imported, and that is a deliberate retreat from what ADR 0017
// specified. `--loader:.ttf=binary` makes esbuild inline the font, which is the single-artifact
// answer and works in the BUILD — but the dev server runs the TypeScript through jiti and the
// tests run it through Vitest, and neither can import a `.ttf` ("ParseError: Unexpected
// character"). One mechanism has to serve all three, so the file travels beside the bundle and
// `package.json`'s build script copies it into `dist/assets/`. `tests/unit/invoiceFont.test.ts`
// pins that copy step, because a missing font is otherwise a PRODUCTION-ONLY failure — the
// class of bug the loader was chosen to avoid.
import { readFileSync } from 'node:fs'

export const INVOICE_FONT_FILE = 'NotoSansSC.ttf'

let cached: Uint8Array | null = null

/** The font bytes, read once per process. */
export function invoiceFont(): Uint8Array {
  if (!cached) {
    cached = new Uint8Array(readFileSync(new URL(`./assets/${INVOICE_FONT_FILE}`, import.meta.url)))
  }
  return cached
}
