// The verticals the landing hero rotates through, as data rather than markup — same reason as
// faq.ts: a copy change never touches layout, and a test can see every entry is translated.
//
// ASPIRATIONAL. No fashion or craft merchant has onboarded; these words are positioning, not a
// claim about who already sells here. That is why the rest of the landing copy stays abstract
// ("what you make") and never names these verticals as existing customers.
//
// Each word has to read correctly after "your" in English (`Sell your ___ online`) and inside
// `把___搬到线上` in Chinese.

export interface VerticalEntry {
  /** Stable key for the rotation, and for the prerender pin in verticals.test.ts. */
  id: string
  en: string
  zh: string
}

// ORDER IS LOAD-BEARING. scripts/prerender.tsx renders this route to static markup and writes it
// over dist/index.html, so index 0 is the only word every non-JS crawler ever sees — and most LLM
// crawlers are exactly that. It must stay `food`: that is the keyword index.html's <title> and
// meta description are built around. verticals.test.ts pins it.
export const VERTICALS: VerticalEntry[] = [
  { id: 'food',    en: 'food',    zh: '美食' },
  { id: 'bakes',   en: 'bakes',   zh: '烘焙' },
  { id: 'art',     en: 'art',     zh: '手作' },
  { id: 'clothes', en: 'clothes', zh: '服饰' },
  { id: 'crafts',  en: 'crafts',  zh: '手工艺' },
]
