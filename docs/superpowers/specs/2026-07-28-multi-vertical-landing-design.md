# Multi-vertical landing: rotating word + vertical-neutral copy

Issue: [#146 design: support multiple business](https://github.com/leongcheefai/Bitetime-Order-Platform/issues/146)
Date: 2026-07-28

## Problem

TinyOrder is no longer only for food. Home-run businesses in other lines — creative, fashion,
crafts — can use the same storefront, but the marketing landing tells a visitor the product is for
cooks. "Food", "kitchen" and "bake" are hardcoded across nine strings in `Landing.tsx` plus the
FAQ and feature copy, so a fashion seller reading the page concludes it is not for them.

The fix has two halves, and only together do they work:

1. A **rotating word** in the hero headline — `Sell your food / bakes / art / clothes / crafts
   online` — as the visible signal that the platform is not food-only.
2. **Vertical-neutral body copy** everywhere else on the page. A headline that says "clothes"
   above a section heading that says "Built for home kitchens" reads as a mistake, not a
   positioning.

## Scope

In scope: the marketing landing (`apps/frontend/src/marketing/`) — hero, section headings, value
props, feature copy, FAQ copy.

**Out of scope — deliberately:** `apps/frontend/index.html`. Its `<title>`, meta description,
`og:`/`twitter:` tags and Organization/WebSite JSON-LD stay food-led. Those carry the keyword spine
established by the recent `seo/keyword-consistency` work, and "TinyOrder" has no ranking to trade
against a generic term like "online store". Broadening them is a separate, later decision.

Also out of scope: the merchant dashboard, the storefront, and onboarding copy. None of it is
food-specific today (the dashboard already says "products", never "menu").

Positioning note that constrains the copy: multi-vertical support is **aspirational for now**. No
fashion or creative merchant has onboarded. So the rewritten body copy stays abstract — "what you
make", "small businesses" — and must **not** name fashion or creative as if those merchants exist.
The rotating word is the only place other verticals appear by name.

## The rotating word

### Data

New module `apps/frontend/src/marketing/verticals.ts`, beside the existing `faq.ts` and
`features.ts` and following their bilingual entry shape:

```ts
export const VERTICALS = [
  { id: 'food',    en: 'food',    zh: '美食' },
  { id: 'bakes',   en: 'bakes',   zh: '烘焙' },
  { id: 'art',     en: 'art',     zh: '手作' },
  { id: 'clothes', en: 'clothes', zh: '服饰' },
  { id: 'crafts',  en: 'crafts',  zh: '手工艺' },
] as const
```

Each word must read correctly after "your" in English and inside `把___搬到线上` in Chinese.

**`food` is first, and that position is load-bearing.** `scripts/prerender.tsx` renders the landing
route to static markup and writes it over `dist/index.html`; whatever word is at index 0 is the word
frozen into the file every LLM crawler reads. A test pins it.

### Component

`RotatingWord`, added to `LandingMotion.tsx` — already the home for landing motion pieces and the
only file that uses `useReducedMotion`.

- One `useState` index, one `useEffect` interval at **2600ms**, cleared on unmount.
- `useReducedMotion()` → render `words[0]` as plain text with **no timer created at all**, not a
  timer whose animation is suppressed.
- Markup: `<span className="inline-grid" style={{ minWidth: `${slotEm}em` }}>` wrapping
  `AnimatePresence mode="wait"`. `mode="wait"` means exactly one child exists at any moment, so no
  absolute positioning and no stacking are needed.
- Transition: fade + 6px rise, 0.25s out then 0.25s in, using the existing `EASE` constant. This
  matches `HeroItem` deliberately — the page's motion vocabulary is restrained, and a louder
  treatment (slot-machine roll, typewriter) would compete with the `StorefrontPreview` order ping
  animating directly below the hero.

### Sizing: no layout shift

`slotEm` is a hand-tuned constant per language — roughly **4.2em** for English (widest word:
"clothes") and **3.2em** for Chinese (widest: 手工艺). Exact values are set by eye during
run-and-verify.

`em` is the right unit because the H1 font-size is `clamp(2rem,5vw,3.5rem)`: an `em` slot scales
with it, so one constant per language holds at every breakpoint. The slot is sized to the widest
word, so the headline **never reflows and never shifts** as the word cycles.

Rejected alternative: stacking all five words in one grid cell and letting the browser size the
slot. It removes the hand-tuning but puts all five words in the DOM — which means the prerendered
`dist/index.html` H1 reads `Sell your food bakes art clothes crafts online` to every crawler that
does not execute JavaScript. That is precisely the audience the prerender exists to serve.

Also rejected: animating the slot width to each word. Tighter kerning, but a width change mid-
sentence can push a trailing word onto the next line, so the headline reflows every 2.6s.

### Accessibility and crawlers

Because only the active word is ever in the DOM, the prerendered markup keeps today's exact H1 text:
`Sell your food online — your own shop, without the DM chaos.` **Zero SEO delta on the headline.**

The `<h1>` carries an `aria-label` with that full static sentence. `aria-label` overrides descendant
content for the accessible name, so screen readers get one clean sentence instead of a word churning
every 2.6 seconds, and no `aria-hidden` or duplicated visually-hidden word is needed inside.

## Copy rewrites

### `Landing.tsx` — nine strings

| Line | Now | After |
|---|---|---|
| 186 | We know what it's like to run a **kitchen** out of your DMs. | …run a **business** out of your DMs. |
| 191 | Sell your **food** online — your own shop, without the DM chaos. | rotating slot in place of `food` |
| 214 | Made for home kitchens and small **food** businesses. | Made for home-run and small businesses. |
| 234 | pick a name, describe what you **bake**. | …describe what you **make**. |
| 259 | Built for home kitchens and **food** businesses | Built for small businesses that sell direct |
| 263 | "TinyOrder is for people who **cook**…" | rewritten: home bakers taking weekend pre-orders, makers running a weekly drop, small shops that have outgrown a spreadsheet and a chat group |
| 440 | Questions from **food shop** owners, answered | Questions from shop owners, answered |
| 472 | Become a real, professional **food** business — …more time to **bake**. | Become a real, professional business — …more time to **make**. |
| 484 | Built for **food** businesses | Built for small businesses |

Every rewrite needs its Chinese pair updated in the same edit — 美食/食品/烘焙/厨房 all carry the same
food framing in the `zh` half of each `t(en, zh)` call.

### `features.ts`

- `menu` entry body: "Add each **dish**" → "Add each **product**"; "reorder the **menu**" →
  "reorder your **products**".
- `delivery` entry body: "real road distance from your **kitchen**" → "…from your **address**".

Entry `id`s do not change. They are React keys and test fixtures, not copy.

### `faq.ts`

Three answers say "menu" where they mean the product list: `pro-features` ("your full menu"),
`chinese` ("every menu item"), `approval` ("add your menu"). All become "products" / "product",
in both languages (完整菜单 → 完整产品列表, 菜品 → 产品, 添加菜单 → 添加产品).

Independent justification for this beyond the vertical question: **the merchant dashboard has never
said "menu".** `ProductsManager.tsx` says "Your products", "+ Add product", "Search products…". The
marketing copy was the outlier, promising a UI element that does not exist under that name.

Knock-on to state plainly: the landing FAQ JSON-LD is generated from `faq.ts` via
`structuredData.ts`, so these three edits do change JSON-LD body text. The meta tags and the
Organization/WebSite identity blocks in `index.html` do not move.

## Testing

`verticals.test.ts`, mirroring `faq.test.ts` and `features.test.ts` — those suites exist because a
half-translated entry type-checks perfectly (both fields are `string`) and ships inside a Chinese
page. Same failure mode applies here:

- every entry has non-empty `en` and `zh`
- `zh !== en` (what a forgotten translation looks like)
- `zh` matches `/[一-鿿]/` (a distinct string is not proof of translation; a Han character is)
- `id`s are unique
- **`VERTICALS[0].id === 'food'`** — pins the word the prerenderer freezes into `dist/index.html`

No component test for `RotatingWord`. Per CLAUDE.md, UI is verified by running the app.

## Run-and-verify checklist

1. Rotation cycles all five words, in both `en` and `zh`.
2. **Baseline alignment** of the `inline-grid` slot against the surrounding headline text — the one
   thing most likely to sit a pixel off, and the reason `slotEm` is tuned by eye rather than
   calculated.
3. No reflow or shift across all five words at 375px and 1280px.
4. `prefers-reduced-motion` → headline frozen on "food", no timer running.
5. `pnpm build`, then confirm `dist/index.html` H1 contains `food` and none of the other four words.
6. `pnpm lint && pnpm typecheck && pnpm test`.
