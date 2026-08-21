# The invoice font

`NotoSansSC.ttf` is the one face the PDF invoice is drawn in (`../invoice.ts`). It is embedded
**unconditionally**, not only for Chinese readers: the invoice's labels are English, but
`merchants.name` and `products.name` hold Chinese for a great many shops, and a latin-only face
renders tofu for exactly the shops most likely to want an invoice.

It is licensed under the SIL Open Font License 1.1 — see `OFL.txt`, which travels with it.

## What this file is, exactly

Not the upstream release. Upstream ships **Noto Sans SC as a variable font** (`NotoSansSC[wght].ttf`,
17MB), and this is a **static instance at weight 400, trimmed to the ranges an invoice can print**:
7.0MB, 21,552 glyphs.

Both steps are deliberate:

- **Static, not variable.** `pdf-lib` does not synthesise weight, so only one instance is ever used,
  and the variable font's `gvar` deltas are 7MB of data no invoice can reach.
- **Trimmed.** Kana, Hangul, Bopomofo, CJK Extension A/B, Cyrillic and Greek are dropped, as are
  `GSUB`/`GPOS` — the invoice draws plain runs and never shapes. What is kept is Basic Latin,
  Latin-1, Latin Extended-A, general punctuation, currency symbols, CJK punctuation, the full
  **CJK Unified Ideographs** block (U+4E00–9FFF) and the fullwidth forms.

The cost, stated plainly: a character outside those ranges prints as an empty box. Extension A
(U+3400–4DBF) was measured and rejected at **+2.3MB** for characters a Malaysian shop name does not
use. If a merchant ever reports a missing character, widen the ranges below and regenerate — do not
reach for a second font.

## Regenerating it

Needs `fonttools` (a build-time tool only; the backend has no Python dependency).

```bash
pip install fonttools brotli

curl -L -o /tmp/NotoSansSC-VF.ttf \
  'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf'

fonttools varLib.instancer /tmp/NotoSansSC-VF.ttf wght=400 -o /tmp/NotoSansSC-400.ttf

pyftsubset /tmp/NotoSansSC-400.ttf --output-file=NotoSansSC.ttf \
  --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2212,U+3000-303F,U+4E00-9FFF,U+FF00-FFEF,U+FE10-FE1F" \
  --layout-features='' --no-hinting \
  --drop-tables+=BASE,STAT,vhea,vmtx,gasp,GPOS,GSUB
```

Then run `pnpm --filter @bitetime/backend test`. `tests/unit/invoice.test.ts` reads the embedded
subset back out of a rendered PDF and fails if the glyphs arrive without outlines — which is how a
bad font, or a bad subsetter, is caught. It has caught one already: see
`../pdfFontkit.ts`.

## How it reaches production

`package.json`'s build script copies this file into `dist/assets/`, and `../invoiceFont.ts` reads it
relative to `import.meta.url`. `tests/unit/invoiceFont.test.ts` pins that copy step, because a
missing font is otherwise a production-only failure.
