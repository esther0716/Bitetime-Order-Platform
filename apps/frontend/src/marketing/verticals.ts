// The verticals the landing hero rotates through, as data rather than markup — same reason as
// faq.ts: a copy change never touches layout, and a test can see every entry is translated.
//
// ASPIRATIONAL. No fashion or craft merchant has onboarded; these words are positioning, not a
// claim about who already sells here. That is why the rest of the landing copy stays abstract
// ("what you make") and never names these verticals as existing customers.
//
// Each word has to read correctly after "your" in English (`Sell your ___`) and inside
// `把___搬到线上` in Chinese.

export interface VerticalWord {
  /** The word as shown. */
  text: string
  /**
   * Rendered width of `text` in the hero heading font, in em — the width the rotating slot
   * animates to when this word takes its turn.
   *
   * It is a measured constant rather than a DOM measurement because the hero is prerendered:
   * measuring would need a layout pass that `renderToStaticMarkup` never performs. Measured in the
   * browser against the h1's computed font at 56px, letter-spacing included. In em, so one number
   * holds at every breakpoint under `clamp(2rem,5vw,3.5rem)`.
   *
   * A value that is slightly too SMALL is the safe direction: the word overflows the slot for a
   * fraction of a second while it is faded out. Too large just leaves a gap. Re-measure the whole
   * column if the heading font changes.
   */
  em: number
}

export interface VerticalEntry {
  /** Stable key for the rotation, and for the prerender pin in verticals.test.ts. */
  id: string
  en: VerticalWord
  zh: VerticalWord
}

// ORDER IS LOAD-BEARING. scripts/prerender.tsx renders this route to static markup and writes it
// over dist/index.html, so index 0 is the only word every non-JS crawler ever sees — and most LLM
// crawlers are exactly that. It must stay `food`: that is the keyword index.html's <title> and
// meta description are built around. verticals.test.ts pins it.
export const VERTICALS: VerticalEntry[] = [
  { id: 'food',    en: { text: 'food',    em: 2.06 }, zh: { text: '美食',   em: 1.98 } },
  { id: 'bakes',   en: { text: 'bakes',   em: 2.60 }, zh: { text: '烘焙',   em: 1.98 } },
  { id: 'art',     en: { text: 'art',     em: 1.34 }, zh: { text: '手作',   em: 1.98 } },
  { id: 'clothes', en: { text: 'clothes', em: 3.34 }, zh: { text: '服饰',   em: 1.98 } },
  { id: 'crafts',  en: { text: 'crafts',  em: 2.65 }, zh: { text: '手工艺', em: 2.97 } },
]
