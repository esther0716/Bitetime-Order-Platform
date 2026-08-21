// The font engine `pdf-lib` embeds and subsets with — and the reason it is NOT the one pdf-lib
// documents.
//
// pdf-lib's own README says to register `@pdf-lib/fontkit`. That package is a 2020 fork of
// fontkit, and its TrueType subsetter is **silently wrong on Noto Sans SC**: it emits a subset
// whose glyf entries are EMPTY for most glyphs. There is no error and no warning. The PDF opens,
// the layout is right, the text is selectable and copies correctly — and roughly two thirds of
// the letters are simply not drawn. "Sunny Bakes INVOICE" prints as "Su INV I".
//
// Upstream `fontkit@2` subsets the same font correctly (verified in Chrome and Preview: full
// Latin, full Chinese, ~6KB emitted). Its API moved on, though — the subset returns bytes from
// `encode()` where fontkit@1 exposed `encodeStream()`, which is the one call pdf-lib 1.17 makes.
// This module bridges exactly that, and nothing else.
//
// Do not "simplify" this back to `@pdf-lib/fontkit`. The failure it causes is invisible to every
// test that only checks bytes were produced, and reaches the merchant as a half-printed invoice.
// `tests/unit/invoice.test.ts` parses the embedded subset and asserts the glyphs have outlines —
// that test is what stands between this decision and a silent regression.
import * as fontkitNs from 'fontkit'
import { Readable } from 'node:stream'
import type { PDFDocument } from 'pdf-lib'

// pdf-lib does not export the shape it wants, so take it from the method that consumes it.
type Fontkit = Parameters<PDFDocument['registerFontkit']>[0]

const fontkit = (fontkitNs as unknown as { default?: typeof fontkitNs }).default ?? fontkitNs

export const pdfFontkit: Fontkit = {
  create(bytes: Uint8Array, postscriptName?: string) {
    const font = (fontkit as unknown as {
      create: (b: Uint8Array, n?: string) => Record<string, any>
    }).create(bytes, postscriptName)

    const createSubset = font.createSubset.bind(font)
    font.createSubset = () => {
      const subset = createSubset()
      subset.encodeStream = () => Readable.from([Buffer.from(subset.encode())])
      return subset
    }
    return font as never
  },
} as Fontkit
