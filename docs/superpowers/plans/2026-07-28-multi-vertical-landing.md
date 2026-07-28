# Multi-vertical Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rotate a vertical word through the landing hero headline (`Sell your food / bakes / art / clothes / crafts online`) and rewrite the rest of the landing's food-specific copy to be vertical-neutral.

**Architecture:** A new bilingual data module (`verticals.ts`) holds the five words. A `RotatingWord` component in `LandingMotion.tsx` cycles them with the page's existing Motion vocabulary, keeping **only the active word in the DOM** so the prerendered `dist/index.html` stays clean for non-JS crawlers, and sizing its slot in `em` so the headline never reflows. Everything else is copy edits across four files.

**Tech Stack:** React 19, TypeScript (strict), Vite, `motion` v12 (`AnimatePresence`, `useReducedMotion`), Tailwind v4, Vitest.

Spec: [`docs/superpowers/specs/2026-07-28-multi-vertical-landing-design.md`](../specs/2026-07-28-multi-vertical-landing-design.md). Branch: `design/multi-vertical-landing` (already created; the spec is committed on it).

## Global Constraints

- **Every user-facing string is `t(englishString, chineseString)`.** No i18n library. `t` and `lang` come from `useSession()`. A rewrite that changes the English half and leaves a food word in the Chinese half is an incomplete edit.
- **`VERTICALS[0]` must stay `food`.** `apps/frontend/package.json`'s `build` script runs `scripts/prerender.tsx` after `vite build`, rendering the landing to static markup over `dist/index.html`. Index 0 is the only word non-JS crawlers ever see, and it must match the keyword spine in `index.html`'s `<title>` and meta description.
- **Do not touch `apps/frontend/index.html`.** Its `<title>`, meta description, `og:`/`twitter:` tags and Organization/WebSite JSON-LD stay food-led. Out of scope per the spec.
- **Multi-vertical support is aspirational.** No fashion or craft merchant has onboarded. Rewritten body copy stays abstract ("what you make", "small businesses") and must never name fashion or creative as if those merchants already exist. The rotating word is the only place other verticals appear by name.
- **All motion honours `prefers-reduced-motion`** via `useReducedMotion()`, matching every other piece in `LandingMotion.tsx`.
- **Existing `EASE` constant** (`[0.16, 1, 0.3, 1]`) is the only easing used in `LandingMotion.tsx`. Reuse it; do not introduce another.
- Entry `id` fields in `features.ts` and `faq.ts` are React keys, not copy. **Never rename an `id`**, even when the copy it labels changes (the `features.ts` entry keyed `menu` keeps that id).
- UI is verified by **running the app** (CLAUDE.md), not by component tests. Only the data module gets a unit test.

## File Structure

| File | Responsibility |
|---|---|
| Create `apps/frontend/src/marketing/verticals.ts` | The five bilingual vertical words, as data. Sits beside `faq.ts`/`features.ts` and follows their shape. |
| Create `apps/frontend/src/marketing/verticals.test.ts` | Translation-completeness guard + the `food`-first pin. Mirrors `faq.test.ts`. |
| Modify `apps/frontend/src/marketing/LandingMotion.tsx` | Gains `RotatingWord`. Already the home for landing motion pieces and the only file using `useReducedMotion`. |
| Modify `apps/frontend/src/marketing/Landing.tsx` | Hero H1 wiring + eight copy rewrites. |
| Modify `apps/frontend/src/marketing/features.ts` | Two body-copy rewrites (`dish` → `product`, `kitchen` → `address`). |
| Modify `apps/frontend/src/marketing/faq.ts` | Three answers: `menu` → `products`. |

---

### Task 1: The `verticals` data module

**Files:**
- Create: `apps/frontend/src/marketing/verticals.ts`
- Test: `apps/frontend/src/marketing/verticals.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export interface VerticalEntry { id: string; en: string; zh: string }` and `export const VERTICALS: VerticalEntry[]`. Note the flat shape — `en`/`zh` are top-level string fields, **not** nested under `q`/`a` or `title`/`body` like `faq.ts` and `features.ts`. Task 2 consumes `VERTICALS` by mapping it to a `string[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/marketing/verticals.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { VERTICALS } from './verticals'

// Same reason as faq.test.ts and features.test.ts: both language fields are strings, so an entry
// carrying English in its Chinese slot type-checks perfectly and ships inside a Chinese page.
// Nothing here tests rendering.

describe('VERTICALS content', () => {
  it('has entries', () => {
    expect(VERTICALS.length).toBeGreaterThan(0)
  })

  it('gives every entry a word in both languages', () => {
    for (const [i, entry] of VERTICALS.entries()) {
      for (const field of ['en', 'zh'] as const) {
        expect(entry[field].trim(), `entry ${i} ${field}`).not.toBe('')
      }
    }
  })

  it('never repeats the English as the Chinese — what a forgotten translation looks like', () => {
    for (const [i, entry] of VERTICALS.entries()) {
      expect(entry.zh, `entry ${i} is untranslated`).not.toBe(entry.en)
    }
  })

  it('gives every entry Chinese that actually contains Chinese', () => {
    // A distinct string is not proof of translation; a Han character is.
    for (const [i, entry] of VERTICALS.entries()) {
      expect(entry.zh, `entry ${i}`).toMatch(/[一-鿿]/)
    }
  })

  it('keys every entry uniquely, so the rotation has stable keys', () => {
    const ids = VERTICALS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // The prerender pin. scripts/prerender.tsx writes static landing markup over dist/index.html,
  // so index 0 is the only word a crawler that does not run JS ever sees. It has to be the word
  // index.html's <title> and meta description are built around.
  it('leads with food, the word the prerenderer freezes into dist/index.html', () => {
    expect(VERTICALS[0].id).toBe('food')
    expect(VERTICALS[0].en).toBe('food')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @bitetime/frontend exec vitest run src/marketing/verticals.test.ts
```

Expected: FAIL — `Failed to resolve import "./verticals"`.

- [ ] **Step 3: Write the module**

Create `apps/frontend/src/marketing/verticals.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @bitetime/frontend exec vitest run src/marketing/verticals.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/marketing/verticals.ts apps/frontend/src/marketing/verticals.test.ts
git commit -m "feat(landing): add the bilingual vertical word list (#146)"
```

---

### Task 2: `RotatingWord` and the hero headline

**Files:**
- Modify: `apps/frontend/src/marketing/LandingMotion.tsx` (add `RotatingWord`; the file's existing imports at line 5–9 already cover everything needed)
- Modify: `apps/frontend/src/marketing/Landing.tsx:189-193` (the `<HeroItem>` holding the `<h1>`), plus its imports at lines 1 and 16–23

**Interfaces:**
- Consumes: `VERTICALS` from Task 1.
- Produces: `RotatingWord({ words: readonly string[], slotEm: number, intervalMs?: number })`, exported from `LandingMotion.tsx`. No later task depends on it.

- [ ] **Step 1: Add `RotatingWord` to `LandingMotion.tsx`**

Append to the end of `apps/frontend/src/marketing/LandingMotion.tsx`. Every import it needs (`memo`, `useEffect`, `useState`, `motion`, `AnimatePresence`, `useReducedMotion`) is already at the top of that file — add nothing to the import block.

```tsx
// ── Rotating vertical word: the hero's "we are not food-only" signal ─────────
// Only the ACTIVE word is ever in the DOM, and that is the whole design constraint.
// scripts/prerender.tsx freezes this markup into dist/index.html for crawlers that do not run JS;
// stacking all five words in one grid cell to let the browser size the slot would hand them
// `Sell your food bakes art clothes crafts online`. So the slot is sized by hand instead:
// `slotEm` fits the widest word, in em so it tracks the h1's clamp() font-size at every
// breakpoint, and the headline never reflows as the word cycles.
export const RotatingWord = memo(function RotatingWord({
  words,
  slotEm,
  intervalMs = 2600,
}: {
  words: readonly string[]
  slotEm: number
  intervalMs?: number
}) {
  const reduced = useReducedMotion()
  const [i, setI] = useState(0)

  useEffect(() => {
    if (reduced) return
    const loop = setInterval(() => setI((n) => (n + 1) % words.length), intervalMs)
    return () => clearInterval(loop)
  }, [reduced, words.length, intervalMs])

  // Reduced motion gets the first word and no timer at all — not a timer whose animation is
  // suppressed. Also what the prerenderer emits, since it never runs effects.
  if (reduced) return <>{words[0]}</>

  return (
    <span className="inline-grid text-left align-baseline" style={{ minWidth: `${slotEm}em` }}>
      {/* mode="wait" keeps exactly one child mounted, so the words need no absolute positioning
          and no stacking — the slot's min-width is what holds the line steady. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={words[i]}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25, ease: EASE }}
        >
          {words[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  )
})
```

- [ ] **Step 2: Wire it into the hero H1**

In `apps/frontend/src/marketing/Landing.tsx`:

1. Line 1 — add `useMemo`: `import { useMemo, useState } from 'react'`
2. Lines 16–23 — add `RotatingWord` to the `./LandingMotion` import list (alphabetical position does not matter; the list is grouped by role, so put it after `MagneticButton`).
3. Line 12–14 area — add `import { VERTICALS } from './verticals'` beside the `FAQ` and `FEATURES` imports.
4. After line 59 (`const [billing, setBilling] = ...`), add the memoised word list. It must be memoised: a fresh array每 render would defeat `RotatingWord`'s `memo`.

```tsx
  // The hero's rotating word, resolved to the showing language. Memoised so a new array identity
  // does not defeat RotatingWord's memo on every Landing re-render (billing toggle, menu open…).
  const verticalWords = useMemo(
    () => VERTICALS.map((v) => (lang === 'zh' ? v.zh : v.en)),
    [lang]
  )
```

5. Replace lines 189–193 (the whole `<HeroItem>` wrapping the `<h1>`) with:

```tsx
          <HeroItem>
            {/* aria-label carries the sentence as one static string: the visible word changes every
                2.6s, and a screen reader re-announcing the h1 that often is noise. It also
                overrides descendant content for the accessible name, so nothing inside needs
                aria-hidden. Keep it in sync with the visible halves below. */}
            <h1
              aria-label={t(
                'Sell your food online — your own shop, without the DM chaos.',
                '把美食搬到线上——你的专属店铺，告别聊天接单的混乱。'
              )}
              className="font-heading text-[clamp(2rem,5vw,3.5rem)] font-medium text-ink leading-[1.18] tracking-[-0.01em] mb-5"
            >
              {t('Sell your ', '把')}
              <RotatingWord words={verticalWords} slotEm={lang === 'zh' ? 3.2 : 4.2} />
              {t(' online — your own shop, without the DM chaos.', '搬到线上——你的专属店铺，告别聊天接单的混乱。')}
            </h1>
          </HeroItem>
```

The trailing space in `'Sell your '` and the leading space in `' online…'` are load-bearing — JSX will not add them back.

- [ ] **Step 3: Typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: both clean. If `react-hooks` complains about the `useEffect` deps, do **not** silence it — the listed deps (`reduced`, `words.length`, `intervalMs`) are correct and complete; a complaint means the code drifted from what is written above.

- [ ] **Step 4: Verify in the browser**

Start the dev server with the Browser pane (never with Bash): `preview_start` with `{name: "bitetime-dev"}`, which serves `http://localhost:5173`. Then check, in order:

1. Headline cycles food → bakes → art → clothes → crafts → food, ~2.6s apart.
2. **Baseline alignment** — the rotating word must sit on the same baseline as "Sell your" and "online". This is the single most likely visual defect. If it rides high or low, adjust the wrapper's vertical alignment (`align-baseline` → `align-bottom`, or `items-baseline` on the grid); do not fix it with a margin.
3. **No reflow.** Watch " online — your own shop" through a full cycle: it must not move a pixel. If a long word pushes it, raise `slotEm` (EN) until it does not. Check at 375px (`resize_window` mobile) and 1280px (desktop) — the H1 wraps to multiple lines on mobile, which is where a too-narrow slot shows up as a word hopping between lines.
4. Switch the language selector to 中文: rotation becomes 美食 → 烘焙 → 手作 → 服饰 → 手工艺, and the ZH slot (`3.2em`) holds "搬到线上——" steady. Tune `3.2` if not.
5. `read_console_messages` — no errors or React warnings.
6. Reduced motion: **skip it here.** Neither `resize_window` nor `javascript_tool` can set `prefers-reduced-motion` (it is an OS/browser setting, not page state), so do not fake a check. It is verified for real in Task 5 Step 3 — `renderToStaticMarkup` never runs effects, so the prerendered output *is* the reduced-motion first paint, and asserting `Sell your food online` there proves the static branch.
7. `computer {action: "screenshot"}` on two different words, to show the slot holding.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/marketing/LandingMotion.tsx apps/frontend/src/marketing/Landing.tsx
git commit -m "feat(landing): rotate the vertical word in the hero headline (#146)"
```

---

### Task 3: `Landing.tsx` copy rewrites

**Files:**
- Modify: `apps/frontend/src/marketing/Landing.tsx` — lines 186, 214, 234, 259, 263, 440, 472, 484 (line numbers are pre-Task-2; the H1 edit shifts everything below 193 by a few lines, so match on the string, not the number)

**Interfaces:**
- Consumes: nothing. Pure copy.
- Produces: nothing.

Eight edits. Each is a `t(en, zh)` call; where the Chinese half already carries no food framing it is listed as *unchanged* — do not rewrite it for symmetry.

- [ ] **Step 1: Hero eyebrow (line 186)**

`'We know what it\'s like to run a kitchen out of your DMs.'` → `'We know what it\'s like to run a business out of your DMs.'`
ZH `'我们懂，用聊天窗口接单有多累。'` — **unchanged** (says "taking orders in a chat window"; no food framing).

- [ ] **Step 2: Hero footnote (line 214)**

`'Made for home kitchens and small food businesses.'` → `'Made for home-run and small businesses.'`
ZH `'专为家厨与小型食品业者打造。'` → `'专为家庭与小型生意打造。'`

- [ ] **Step 3: Step 01 (line 234)**

`' — pick a name, describe what you bake.'` → `' — pick a name, describe what you make.'`
ZH `'——取个名字，介绍你的产品。'` — **unchanged** (already says 产品 / "products").

- [ ] **Step 4: Value-props heading (line 259)**

`'Built for home kitchens and food businesses'` → `'Built for small businesses that sell direct'`
ZH `'专为家厨与食品业者打造'` → `'专为直接面向顾客的小生意打造'`

- [ ] **Step 5: Value-props paragraph (line 263)**

EN → `'TinyOrder is for people who make and sell their own things: home bakers taking weekend pre-orders, makers running a weekly drop, small shops that have outgrown a spreadsheet and a chat group. You do not need a website, a designer or a developer — if you can share a link, you can take orders online.'`

ZH → `'TinyOrder 是为自己做、自己卖的人打造的：接周末预订的家庭烘焙师、每周上新的手作卖家，以及已经用不下去表格和聊天群的小店。你不需要网站、设计师或工程师——只要会分享链接，就能在线接单。'`

- [ ] **Step 6: FAQ heading (line 440)**

`'Questions from food shop owners, answered'` → `'Questions from shop owners, answered'`
ZH `'食品店主常见问题'` → `'店主常见问题'`

- [ ] **Step 7: Final CTA (line 472)** — two food words in one string

`'Become a real, professional food business — orders in one place, more time to bake.'` → `'Become a real, professional business — orders in one place, more time to make.'`
ZH `'成为真正专业的美食生意——订单集中一处，专注烘焙。'` → `'成为真正专业的生意——订单集中一处，专注做好产品。'`

- [ ] **Step 8: Footer badge (line 484)**

`'Built for food businesses'` → `'Built for small businesses'`
ZH `'专为食品业者打造'` → `'专为小生意打造'`

- [ ] **Step 9: Confirm no food wording survives in `Landing.tsx`**

```bash
grep -in "food\|kitchen\|bake\|dish\|cook\|美食\|食品\|家厨\|厨房" apps/frontend/src/marketing/Landing.tsx
```

Expected hits, and **only** these: the `aria-label` and the `VERTICALS`-backed `food`/`美食` in the hero H1 (Task 2), and "home bakers" / "家庭烘焙师" in the value-props paragraph — a named example of one vertical inside otherwise abstract copy, which is intended. Anything else is a missed edit.

- [ ] **Step 10: Verify in the browser**

With the dev server from Task 2 still running, reload and read the page in both languages:

```
read_page  →  confirm each rewritten string renders, in EN and after switching to 中文
```

- [ ] **Step 11: Commit**

```bash
git add apps/frontend/src/marketing/Landing.tsx
git commit -m "copy(landing): drop food-only framing from the page body (#146)"
```

---

### Task 4: `features.ts` and `faq.ts` copy

**Files:**
- Modify: `apps/frontend/src/marketing/features.ts:24` (`menu` entry body) and `:35` (`delivery` entry body)
- Modify: `apps/frontend/src/marketing/faq.ts` — the `pro-features`, `chinese` and `approval` answers

**Interfaces:**
- Consumes: nothing. Pure copy.
- Produces: nothing. Note the knock-on: the landing FAQ JSON-LD is generated from `FAQ` via `structuredData.ts`, so these edits change JSON-LD body text. That is expected and in scope; `index.html`'s meta tags and identity blocks are not touched.

Independent justification, worth knowing while editing: **the merchant dashboard has never said "menu."** `apps/frontend/src/merchant/ProductsManager.tsx` says "Your products", "+ Add product", "Search products…". The marketing copy was promising a UI element that does not exist under that name.

- [ ] **Step 1: `features.ts` — the `menu` entry body (line 24)**

Keep `id: 'menu'` (it is a React key, not copy).

EN → `'Add each product with photos, a price and the unit you actually sell in — per box, per kilo, per tray — plus a name and description in English, Chinese or both. Change a price, reorder your products or add tomorrow\'s special yourself, in seconds, without waiting on anyone.'`

ZH → `'每件产品都可上传照片、设定价格，并选择你真正的销售单位——每盒、每公斤、每盘——再加上中英文名称与说明。改价格、调整产品顺序、加上明天的特选，几秒钟自己就能完成，不必等任何人。'`

- [ ] **Step 2: `features.ts` — the `delivery` entry body (line 35)**

EN: `'…a fee that follows the real road distance from your kitchen — a base fee plus a rate per kilometre…'` → `'…a fee that follows the real road distance from your address — a base fee plus a rate per kilometre…'` (rest of the string unchanged).

ZH: `'…或依据从你厨房出发的实际路程计费…'` → `'…或依据从你所在地址出发的实际路程计费…'` (rest unchanged).

- [ ] **Step 3: `faq.ts` — the `pro-features` answer**

EN: `'… — your order page, your full menu, delivery fees, order emails — is on Basic.'` → `'… — your order page, your full product list, delivery fees, order emails — is on Basic.'`
ZH: `'…其余功能——订单页面、完整菜单、配送费、订单电邮——基础版都有。'` → `'…其余功能——订单页面、完整产品列表、配送费、订单电邮——基础版都有。'`

- [ ] **Step 4: `faq.ts` — the `chinese` answer**

EN: `'…and you can give every menu item a name and description in both.'` → `'…and you can give every product a name and description in both.'`
ZH: `'…每道菜品也能同时设定中英文名称与说明。'` → `'…每件产品也能同时设定中英文名称与说明。'`

- [ ] **Step 5: `faq.ts` — the `approval` answer**

EN: `'Sign up, add your menu, and we review your shop before it goes live…'` → `'Sign up, add your products, and we review your shop before it goes live…'`
ZH: `'注册、添加菜单，我们会先审核你的店铺再让它上线…'` → `'注册、添加产品，我们会先审核你的店铺再让它上线…'`

- [ ] **Step 6: Run the content suites**

```bash
pnpm --filter @bitetime/frontend exec vitest run src/marketing/
```

Expected: PASS. `faq.test.ts` and `features.test.ts` are shape-and-translation guards, so they catch the most likely slip here — editing an English half and leaving its Chinese twin behind, or pasting English into a `zh` field.

- [ ] **Step 7: Confirm no stale food wording survives**

```bash
grep -in "menu\|dish\|kitchen\|菜单\|菜品\|厨房" apps/frontend/src/marketing/features.ts apps/frontend/src/marketing/faq.ts
```

Expected: exactly one hit — `id: 'menu'` in `features.ts`. Anything else is a missed edit.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/marketing/features.ts apps/frontend/src/marketing/faq.ts
git commit -m "copy(landing): say products, not menu, in features and FAQ (#146)"
```

---

### Task 5: Full verification

**Files:** none modified unless a check fails.

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: nothing.

- [ ] **Step 1: Lint, typecheck, unit tests across the monorepo**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all clean. `pnpm test` covers `verticals.test.ts` plus the existing `faq`/`features`/`structuredData` suites.

- [ ] **Step 2: Build, including the prerender**

```bash
pnpm --filter @bitetime/frontend build
```

Expected: succeeds. It runs `vite build`, then the SSR build of `scripts/prerender.tsx`, then `node dist-ssr/prerender.js`. The prerender **throws** if `<div id="root"></div>` is missing rather than shipping a blank page, so a hard failure here is informative, not mysterious.

- [ ] **Step 3: Confirm the prerendered H1 says `food` and nothing else**

This is the check that protects the SEO/GEO spine, and the reason `VERTICALS[0]` is pinned.

```bash
grep -o "Sell your [a-z]* online" apps/frontend/dist/index.html
```

Expected: `Sell your food online` — exactly once, and no line mentioning `bakes`, `art`, `clothes` or `crafts`. Confirm the absence too:

```bash
grep -c "bakes\|clothes\|crafts" apps/frontend/dist/index.html
```

Expected: `0`. A non-zero count means the DOM is carrying inactive words — the stacked-slot failure mode the design exists to avoid.

Passing this step also confirms the reduced-motion branch: `renderToStaticMarkup` never runs effects, so the static output is precisely what a reduced-motion visitor's first paint shows.

- [ ] **Step 4: Check the built output in the browser**

`preview_start` with `{name: "bitetime-preview"}` (serves `dist/` on `http://localhost:4173`). Confirm on the built bundle: `/` still renders the landing (prerendered `index.html`, not the `app.html` shell), the rotation runs after hydration, and `read_console_messages` shows no hydration mismatch warning. A mismatch here is the one failure the dev server cannot show you.

- [ ] **Step 5: Confirm `index.html` was not touched**

```bash
git diff --stat main -- apps/frontend/index.html
```

Expected: empty output. The spec puts the meta tags and identity JSON-LD out of scope; a diff here means scope creep.

- [ ] **Step 6: Commit anything the checks forced, then push**

```bash
git status --short
```

If clean, push the branch and open a PR against `main` referencing #146. If a check forced a fix (a `slotEm` tune, a baseline nudge), commit it first:

```bash
git add -A && git commit -m "fix(landing): tune the rotating word slot after verification (#146)"
```

---

## Notes for the reviewer

Three things worth a close look, because they are where this change can silently regress:

1. **`dist/index.html` H1 text.** Task 5 Step 3. If inactive words leak into the DOM, every non-JS crawler reads a broken headline — and nothing on screen looks wrong.
2. **Headline reflow.** A `slotEm` a hair too small shows up only on the longest word, at one breakpoint. Watch a full cycle at 375px.
3. **Half-translated copy.** Nine strings changed across four files. The `t(en, zh)` pattern makes an English-only edit invisible to the compiler; `faq.test.ts`/`features.test.ts` catch it in those two files, but `Landing.tsx`'s inline `t()` calls have no such guard — that is what Task 3 Step 9's grep stands in for.
