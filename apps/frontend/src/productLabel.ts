// Which of a row's two names, and which of its two descriptions, the reader in front of us sees.
//
// Shared because TWO surfaces now draw the same menu: the storefront a customer reads, and the
// merchant's Storefront tab, whose whole claim is that it previews the first one (CONTEXT.md →
// Menu arrangement). The arranger held its own copy of this rule and got the description half
// wrong — it never read `descr_zh`, so a Chinese-reading merchant previewed English descriptions
// their customers would never see. One function is what stops the preview drifting again.
//
// A plain `lang` parameter rather than `t(en, zh)`: these are the MERCHANT's own strings, stored
// per row, not interface copy with a translation. `t` picks between two things we wrote; this
// picks between two things they wrote, and falls back when the second is absent.

import type { Lang, Merchant, Product } from './types'
import type { MenuCategory } from '@bitetime/shared'

export const productName = (p: Product, lang: Lang): string =>
  (lang === 'zh' && p.name_zh) ? p.name_zh : p.name

/** `''` when the row carries no description — the callers all render it conditionally. */
export const productDescr = (p: Product, lang: Lang): string =>
  (lang === 'zh' && p.descr_zh) ? p.descr_zh : (p.descr || '')

export const categoryName = (c: MenuCategory, lang: Lang): string =>
  (lang === 'zh' && c.name_zh) ? c.name_zh : c.name

/**
 * The shop's own blurb, in the language in front of us. `''` when it has none — the storefront
 * renders it conditionally, because a shop that wrote no description must draw no line at all
 * rather than an empty one holding space under its name.
 */
export const shopDescr = (m: Merchant, lang: Lang): string =>
  (lang === 'zh' && m.description_zh) ? m.description_zh : (m.description || '')
