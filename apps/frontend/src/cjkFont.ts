// The Chinese webfaces, fetched only when someone is reading Chinese.
//
// Noto Serif SC and Noto Sans SC are the ZH half of the type system (DESIGN.md → Typography), and
// on an English page they are pure cost. Requested unconditionally from index.html, an English
// visitor paid for a Chinese webfont they will never read a character of — a stylesheet on a third
// origin plus whatever glyph slices their Latin faces happened to miss. They now issue no request
// at all: with no face declared, the family name in the stack is simply skipped.
//
// A Chinese visitor still swaps, and that is accepted rather than solved. The metric-fallback
// trick index.css uses for Lora and DM Sans does not carry: a CJK face has no near-universal
// system twin whose advance widths can be adjusted to match, and the honest alternative — shipping
// megabytes of Chinese webfont before first paint — is worse than one reflow.

import type { Lang } from './types'

const ID = 'cjk-font'
const HREF =
  'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;700' +
  '&family=Noto+Sans+SC:wght@400;500;700&display=swap'

/**
 * Ensures the CJK stylesheet is in `<head>` once the visitor is reading Chinese.
 *
 * One-way on purpose. Switching back to English does NOT remove it: the fonts are already
 * downloaded by then, so removing the tag buys no bytes back and only restyles the page a second
 * time — a layout shift in exchange for nothing.
 */
export function ensureCjkFont(lang: Lang): void {
  if (lang !== 'zh') return
  if (typeof document === 'undefined' || document.getElementById(ID)) return
  const link = document.createElement('link')
  link.id = ID
  link.rel = 'stylesheet'
  link.href = HREF
  document.head.appendChild(link)
}
