# 17. The invoice is a PDF, and the only invoice

Date: 2026-08-20
Status: Accepted and implemented in #242.

## Context

A customer document already existed and was withdrawn. `ReceiptDialog.tsx` rendered one order as a
printable page, `receipt.ts` did its arithmetic, and `index.css` still carries the `@media print`
block that made it print correctly. Commit `d940791` removed the "View receipt" trigger from
`store/OrderHistory.tsx` and closed [#83](https://github.com/leongcheefai/Bitetime-Order-Platform/issues/83)
— *"due to business logic, we need to hide the function that allow customer to view invoice"*. The
files were left in place so that re-enabling would be a revert.

What followed is the reason to revisit it: customers now ask the **merchant** for the document, and
they keep asking. The withdrawal moved the work from a button to a person.

Two facts decide the shape of the answer.

**A guest cannot be reached.** A guest order carries `user_id = null` for ever (see *Checkout gate*),
the confirmation email skips such orders structurally, and there is no `/track` route any more. After
the tab closes the platform has no way to hand a guest anything. Whatever the document is, the guest
must be able to fetch it.

**The document must be a file, not a screen.** Merchants forward these on WhatsApp, and customers
attach them to expense claims. A modal cannot be forwarded, and a print dialog is not a file — it is
an instruction to the reader to make one.

That leaves the question of whether the on-screen document survives beside the file.

## Decision

**The invoice is a PDF, generated on the backend, and it is the only invoice.** Every surface — the
order-placed screen, the guest lookup page, the signed-in customer's order history, and the
merchant's order sheet — requests the same endpoint and receives the same bytes.

`store/ReceiptDialog.tsx` is deleted, and with it the `@media print` block in `index.css`: that whole
`body:has([data-receipt])` `!important` sequence exists to serve that one dialog.

**The page IS a ticket**: 226pt wide — 80mm, a till roll — and as tall as the order needs, with a
perforation rule and notched edges. The shape is chosen for where the document is actually read: a
phone, in a chat, where an A4 sheet arrives as a postage stamp to pinch open. It prints scaled-to-fit
on A4 and feeds a thermal printer natively. The cost is that there is no pagination — a forty-line
order makes a very long page rather than a second one, exactly as a till roll does.

A **QR code** stands where a shop receipt puts its barcode, carrying
`/invoice?shop=<slug>&order=<number>` — this order's own lookup, with the number filled in. It stops
at the number deliberately: a ticket is forwarded, photographed and left on counters, and a link
that fetched the document by itself would make the paper the credential. Scanning gets the reader to
the right form; proving the order is still theirs (ADR 0018). It is drawn as vector rectangles, one
per module, so it stays sharp at any zoom and costs a few hundred bytes rather than a raster.

The generator is `pdf-lib` with **Noto Sans SC**, one weight, embedded unconditionally — the font
is not conditional on language, because `merchants.name` and `products.name` routinely hold Chinese
characters whatever language the reader chose, and a latin-only face renders tofu for exactly the
shops most likely to want invoices.

The face that ships is **not the upstream release**: it is a static instance at weight 400, trimmed
to the ranges an invoice can print — 17MB down to **7.0MB**. `pdf-lib` cannot synthesise weight, so
the variable font's `gvar` deltas are 7MB no invoice can reach; Kana, Hangul, Bopomofo, CJK
Extension A/B, Cyrillic, Greek and the layout tables are 3MB more of the same. What is kept is
Latin, punctuation, currency symbols and the whole CJK Unified Ideographs block. Extension A was
measured and rejected at +2.3MB for characters a Malaysian shop name does not use. The provenance,
the exact commands and the ranges are in `apps/backend/src/assets/README.md`, beside the OFL licence
the font ships under.

Two details of that were decided during the build, against what this ADR first said, and both were
decided by evidence rather than preference:

**The font engine is upstream `fontkit@2`, NOT `@pdf-lib/fontkit`** — the package pdf-lib's own
README tells you to register. That fork subsets Noto Sans SC into a font whose glyf entries are
EMPTY for most glyphs. There is no error: the PDF opens, the layout is right, the text selects and
copies correctly, and roughly two thirds of the letters are not drawn — "Sunny Bakes INVOICE"
printed as "Su INV I", verified identically in Chrome and Preview. `fontkit@2` subsets the same
font correctly; its API moved `encodeStream()` to `encode()`, which `pdfFontkit.ts` bridges in
four lines. `tests/unit/invoice.test.ts` reads the subset back out of a rendered PDF and asserts
the glyphs have outlines, because every byte-count assertion in that file passed while this was
broken.

**The font travels beside the bundle, not inside it.** `--loader:.ttf=binary` is the
single-artifact answer and works in the build — but the dev server runs the TypeScript through
jiti and the tests run it through Vitest, and neither can import a `.ttf`. One mechanism has to
serve all three, so `package.json`'s build script copies the file into `dist/assets/` and
`invoiceFont.ts` reads it relative to `import.meta.url`. The failure that mechanism risks is
production-only, so `tests/unit/invoiceFont.test.ts` pins the copy step — the same device the
frontend's `fonts.test.ts` and `vercelRewrites.test.ts` use on their own build config.

Rejected:

- **Keeping the HTML dialog for signed-in customers and giving guests a PDF.** Two layouts, two
  definitions of the document, and they drift. The same human is a guest today and an account
  holder next month; they must not hold two different papers for two orders from one shop.
- **HTML plus `window.print()` for everyone.** Free — the code and the print CSS already exist — but
  it produces no file, which is the thing merchants actually forward.
- **Chromium (`playwright`) rendering the existing HTML.** One document definition, and the print
  CSS is reused verbatim. Costs a browser in the production image and seconds of cold start, for a
  document a shop issues a handful of times a day. `playwright` stays a devDependency.
- **Client-side generation** (`jsPDF`, `html2canvas`). The browser already has both fonts, but
  `html2canvas` output is a raster image — unsearchable text, soft in print — and real text needs the
  same CJK face embedded in the *frontend* bundle, where megabytes are far more expensive.
- **Inlining the font with `--loader:.ttf=binary`.** The tidiest answer on paper; jiti and Vitest
  cannot import a `.ttf`, so it would have split dev and test from production. Kept the file
  beside the bundle instead, with the copy step pinned by a test.

## Consequences

- **"View" becomes "download".** On desktop the signed-in customer gets a file and a PDF reader
  instead of a modal. This is a heavier gesture, accepted for the single-definition rule.
- **Guest and account holder hold byte-identical paper**, which is the point.
- **The PDF reads `order` and `merchant` and nothing else.** `orders.items[].name` is the snapshot of
  `products.name`, so no menu lookup is needed. This also *fixes* a latent bug in the old dialog,
  which resolved Chinese names against **today's** menu — a merchant renaming a product silently
  rewrote the Chinese on last month's paper.
- **A 7.0MB font file lives in git** (roughly 4.2MB once git packs it) and is copied into
  `dist/assets/` on every build. Emitted PDFs stay ~10KB, because fontkit subsets on embed.
- **A character outside the kept ranges prints as an empty box.** The answer is to widen the ranges
  and regenerate, never to add a second font.
- **`@pdf-lib/fontkit` must never be reinstated.** Its failure is invisible to any test that only
  checks bytes were produced, and reaches the merchant as a half-printed invoice.
- **No bold.** `pdf-lib` does not synthesise weight, and a second face is a second 7MB. Hierarchy
  comes from size, spacing and uppercase.
- **Two new `--external:` flags** on the backend esbuild command (`pdf-lib`, `fontkit`). Forgetting
  one bundles the dependency (see CLAUDE.md).
- **Reversal is cheap in one direction only.** Deleting the dialog is easy to undo from git; undoing
  the font and the generator is not. That asymmetry is why this is an ADR.
