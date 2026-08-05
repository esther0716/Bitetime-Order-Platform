# Voltage Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace BiteTime's warm "Hand-Lettered Shopfront" visual identity with the Voltage UI Kit's token system — cool zinc neutrals, sharp geometry, Poppins — keeping oxblood `#7A1028` as the single accent.

**Architecture:** Two PRs. **PR1 (Tasks 1–9)** gives Voltage *values* to the existing warm token *names* in `tokens.css`, so all 896 usages across 68 `.tsx` files reskin without a single component edit, and the whole change reverts in one commit. **PR2 (Task 10)** renames those tokens to Voltage names with zero visual change. A contrast test written in Task 1 is the arbiter for every colour value picked in Task 2.

**Tech Stack:** Vite + React 19 + TypeScript, Tailwind CSS v4 (`@theme inline`, no `tailwind.config`), shadcn primitives (Base UI), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-05-voltage-reskin-design.md`

## Global Constraints

- **Oxblood `#7A1028` is `--brand-500` and does not change.** It is the only accent. No second accent ships (Voltage's cyan `--accent-500 #06B6D4` is not ported; `gold-*` is deleted).
- **PR1 edits no `.tsx` token classes.** The warm token *names* stay; only their *values* change. Exceptions, all mechanical and named in tasks: `border-[1.5px]` (Task 5), `orderStatus.tsx` (Task 6), `GrainOverlay` call sites (Task 7).
- **`--text-sm: 1rem` (16px) stays.** It is an accessibility floor (readability + stops iOS input-focus zoom), not a style choice. Voltage's 14px body does **not** override it.
- **`--font-mono` is the system stack**, not Poppins: `ui-monospace, SFMono-Regular, Menlo, monospace`. Voltage ships no mono face; the order number (`PREFIX-YYMMDD-XXXX`) must stay character-legible.
- **Dark tokens attach to `.dark`**, never `[data-theme="dark"]` — `index.css:50` declares `@custom-variant dark (&:is(.dark *))`.
- **Dark mode ships as tokens only.** No toggle, no persistence, no dark QA pass.
- **Every colour pair must clear WCAG AA** (4.5:1 body text, 3.0:1 for ≥18.66px/bold or non-text) — enforced by `src/tokens.test.ts` from Task 1 onward.
- Run all commands from the repo root unless a task says otherwise. `pnpm --filter @bitetime/frontend <script>` targets the frontend workspace.

---

## File Structure

**Created:**
- `apps/frontend/src/contrast.ts` — WCAG relative-luminance + contrast-ratio helper. Pure, no DOM.
- `apps/frontend/src/contrast.test.ts` — unit tests for the helper itself.
- `apps/frontend/src/tokens.test.ts` — parses `tokens.css`, asserts AA on every foreground/background pair the design uses. The gate for all colour decisions.
- `apps/frontend/scripts/measure-font-metrics.ts` — Playwright script that measures Poppins against Arial via canvas `measureText` and prints the `@font-face` override numbers.
- `docs/adr/0012-the-warm-identity-is-retired.md` — the ADR.

**Modified:**
- `apps/frontend/src/tokens.css` — rewritten (Task 2)
- `apps/frontend/src/index.css` — `@theme inline` additions, `.dark`, fonts, `.grain-overlay` removal (Tasks 3, 4, 7)
- `apps/frontend/index.html` — font link (Task 4)
- `apps/frontend/src/cjkFont.ts` — drop Noto Serif SC (Task 4)
- `apps/frontend/src/orderStatus.tsx` + new `orderStatus.test.ts` (Task 6)
- `apps/frontend/src/marketing/{LandingMotion,Landing,Pricing,FaqPage,FeaturesPage,SampleShopsPage}.tsx` (Task 7)
- `DESIGN.md` — rewritten (Task 8)
- 68 `.tsx` files — token rename only (Task 10, PR2)

---

### Task 1: Contrast harness

Colour values in Task 2 are currently unproven. This task builds the thing that proves them, so Task 2 has a pass/fail gate instead of taste.

**Files:**
- Create: `apps/frontend/src/contrast.ts`
- Create: `apps/frontend/src/contrast.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `contrastRatio(hexA: string, hexB: string): number` and `relativeLuminance(hex: string): number`, both exported from `src/contrast.ts`. Task 2's `tokens.test.ts` imports `contrastRatio`.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/contrast.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { contrastRatio, relativeLuminance } from './contrast'

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5)
  })

  it('accepts shorthand and lowercase hex', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#FFF')).toBeCloseTo(1, 5)
  })
})

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2)
  })

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#7A1028', '#7A1028')).toBeCloseTo(1, 5)
  })

  it('is order-independent', () => {
    expect(contrastRatio('#7A1028', '#FAFAFA')).toBeCloseTo(
      contrastRatio('#FAFAFA', '#7A1028'),
      5,
    )
  })

  // Anchors the sRGB gamma curve against a known-good published value.
  it('matches the published ratio for #71717A on #FAFAFA', () => {
    expect(contrastRatio('#71717A', '#FAFAFA')).toBeCloseTo(4.62, 1)
  })

  it('throws on a malformed hex rather than returning a wrong number', () => {
    expect(() => contrastRatio('rebeccapurple', '#FFF')).toThrow(/hex/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @bitetime/frontend test -- contrast
```

Expected: FAIL — `Failed to resolve import "./contrast"`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/frontend/src/contrast.ts`:

```ts
/* WCAG 2.1 contrast maths. Pure and DOM-free so it runs in Vitest and in the
   token test that reads tokens.css off disk.
   Formulae: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */

function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`Not a hex colour: ${hex}`)
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/* Linearise one 8-bit channel: undo the sRGB transfer function. */
function channel(value8bit: number): number {
  const c = value8bit / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA)
  const b = relativeLuminance(hexB)
  const [lighter, darker] = a > b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @bitetime/frontend test -- contrast
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/contrast.ts apps/frontend/src/contrast.test.ts
git commit -m "test: add WCAG contrast helper

The reskin moves every foreground/background pair at once. This is the
thing that decides whether a chosen hex is allowed, so the palette is
argued with a number instead of an eye."
```

---

### Task 2: Token contract test, then the new palette

The test comes first and names every pair the design depends on. It fails against today's warm tokens, and Task 2's rewrite is what makes it pass.

**Files:**
- Create: `apps/frontend/src/tokens.test.ts`
- Modify: `apps/frontend/src/tokens.css` (full rewrite)

**Interfaces:**
- Consumes: `contrastRatio` from `src/contrast.ts` (Task 1).
- Produces: `tokens.css` exporting these CSS custom properties, relied on by every later task —
  primitives `--ink-50|100|200|300|400|500|700|900|950`, `--white`,
  `--brand-50|100|200|400|500|600|700`,
  `--success-100|500|fg`, `--warning-100|500|fg`, `--danger-100|500|fg`, `--info-100|500|fg`, `--neutral-100|fg`;
  semantics `--color-bg`, `--color-bg-surface`, `--color-bg-muted`, `--color-bg-hover`, `--color-border`, `--color-border-strong`, `--color-text`, `--color-text-muted`, `--color-text-subtle`, `--color-accent`, `--color-accent-hover`, `--color-focus-ring`;
  scales `--space-0..20`, `--elev-0..3`, `--focus-ring`, `--ease-out|in-out|in`, `--dur-fast|base|slow|slower`, `--icon-sm|md|lg|xl`;
  and the retained alias names (`--color-cream`, `--color-oxblood`, `--radius-*`, `--z-*`, …) that Task 10 later renames.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { contrastRatio } from './contrast'

/* Read the stylesheet rather than a duplicated TS copy of it: a token table that
   mirrors the CSS can drift from it silently, and then this suite passes while the
   app ships the wrong colour. */
const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8')

function token(name: string): string {
  const m = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(css)
  if (!m) throw new Error(`Token not found in tokens.css: ${name}`)
  const value = m[1].trim()
  if (!value.startsWith('#')) throw new Error(`${name} is not a literal hex: ${value}`)
  return value
}

const AA_TEXT = 4.5
const AA_LARGE = 3.0

describe('primitives are present and literal', () => {
  const required = [
    '--ink-50', '--ink-100', '--ink-200', '--ink-300', '--ink-400',
    '--ink-500', '--ink-700', '--ink-900', '--ink-950', '--white',
    '--brand-50', '--brand-100', '--brand-200',
    '--brand-400', '--brand-500', '--brand-600', '--brand-700',
  ]
  it.each(required)('%s is a hex literal', (name) => {
    expect(token(name)).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('keeps oxblood as the accent', () => {
    expect(token('--brand-500').toUpperCase()).toBe('#7A1028')
  })

  it('ships no second accent', () => {
    expect(css).not.toMatch(/--accent-500/)
    expect(css).not.toMatch(/--color-gold/)
  })
})

describe('the brand ramp is monotonic', () => {
  // A ramp whose "deeper" step is lighter than its "deep" step is the bug the old
  // oxblood-deep/-deeper pair shipped. This is what stops it recurring.
  it('darkens from 50 to 700', () => {
    const steps = ['--brand-50', '--brand-100', '--brand-200', '--brand-500', '--brand-600', '--brand-700']
    const whiteContrast = steps.map((s) => contrastRatio(token(s), '#FFFFFF'))
    for (let i = 1; i < whiteContrast.length; i++) {
      expect(whiteContrast[i]).toBeGreaterThan(whiteContrast[i - 1])
    }
  })

  it('makes brand-400 lighter than brand-500, for use on dark surfaces', () => {
    expect(contrastRatio(token('--brand-400'), '#FFFFFF'))
      .toBeLessThan(contrastRatio(token('--brand-500'), '#FFFFFF'))
  })
})

describe('light-theme text clears AA', () => {
  it('body text on the page background', () => {
    expect(contrastRatio(token('--ink-900'), token('--ink-50'))).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('muted text on the page background', () => {
    expect(contrastRatio(token('--ink-500'), token('--ink-50'))).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('muted text on a raised surface', () => {
    expect(contrastRatio(token('--ink-500'), token('--white'))).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('the accent on the page background', () => {
    expect(contrastRatio(token('--brand-500'), token('--ink-50'))).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('accent text on its own tint (chips, active rows)', () => {
    expect(contrastRatio(token('--brand-700'), token('--brand-50'))).toBeGreaterThanOrEqual(AA_TEXT)
  })

  // --ink-400 is Voltage's --color-text-subtle. It does NOT clear AA as body text on
  // #FAFAFA (~2.46:1), which is the same trap the old clay-muted token documented. It is
  // permitted for borders and decorative icons only; this asserts the weaker floor it must
  // still meet, so nobody later promotes it to text.
  it('subtle is held to the non-text floor only', () => {
    const ratio = contrastRatio(token('--ink-400'), token('--ink-50'))
    expect(ratio).toBeLessThan(AA_TEXT)
    expect(ratio).toBeGreaterThanOrEqual(1.5)
  })
})

describe('dark-theme accent clears AA', () => {
  it('brand-400 on the darkest surface', () => {
    expect(contrastRatio(token('--brand-400'), token('--ink-950'))).toBeGreaterThanOrEqual(AA_TEXT)
  })
})

describe('status chips clear AA', () => {
  const pairs: Array<[string, string, string]> = [
    ['success', '--success-fg', '--success-100'],
    ['warning', '--warning-fg', '--warning-100'],
    ['danger', '--danger-fg', '--danger-100'],
    ['info', '--info-fg', '--info-100'],
    ['neutral', '--neutral-fg', '--neutral-100'],
  ]
  it.each(pairs)('%s chip text on its own tint', (_name, fg, bg) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it.each(pairs)('%s tint is distinguishable from the page background', (_name, _fg, bg) => {
    expect(contrastRatio(token(bg), token('--ink-50'))).toBeGreaterThanOrEqual(1.05)
  })

  it('info does not collide with the brand accent', () => {
    expect(token('--info-500').toUpperCase()).not.toBe(token('--brand-500').toUpperCase())
  })
})

describe('solid status fills carry legible white text', () => {
  /* --warning-500 is deliberately absent: white on amber is 2.15:1 and no amber fill in
     this design carries white text (the warning chip is warn-fg on warn-100). Adding it
     here would force the amber darker to satisfy a pairing nothing uses. */
  it.each(['--success-500', '--danger-500', '--info-500'])('%s', (name) => {
    expect(contrastRatio('#FFFFFF', token(name))).toBeGreaterThanOrEqual(AA_LARGE)
  })
})

describe('non-colour scales exist', () => {
  it.each([
    '--space-1', '--space-4', '--space-20',
    '--elev-1', '--elev-3', '--focus-ring',
    '--ease-out', '--dur-base',
    '--icon-sm', '--icon-xl',
  ])('%s is defined', (name) => {
    expect(css).toMatch(new RegExp(`^\\s*${name}:`, 'm'))
  })
})

describe('radii are the Voltage sharp scale', () => {
  it.each([
    ['--radius-xs', '2px'],
    ['--radius-sm', '4px'],
    ['--radius-md', '4px'],
    ['--radius-lg', '8px'],
    ['--radius-xl', '8px'],
    ['--radius-2xl', '12px'],
    ['--radius-pill', '9999px'],
  ])('%s is %s', (name, expected) => {
    expect(new RegExp(`${name}:\\s*${expected};`).test(css)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @bitetime/frontend test -- tokens
```

Expected: FAIL — `Token not found in tokens.css: --ink-50` (today's file has no primitives).

- [ ] **Step 3: Write the new tokens.css**

Replace `apps/frontend/src/tokens.css` entirely.

Every value below was **run against the Step 1 test's thresholds before this plan was written** — all 22 assertions pass. Two are not Voltage's own values, and the reasons are inline: `--brand-400` (Voltage's `-400` is the dark-theme accent, so it must be lighter than `-500`, which `oxblood-light #8B2030` is not) and `--success-500` (Voltage's `#10B981` fails white-text contrast). If you change a hex, re-run the test — do not weaken a threshold.

```css
/* ──────────────────────────────────────────────────────────────────────────
   TinyOrder design tokens — Voltage UI Kit
   Canonical source: DESIGN.md. Edit there first, mirror here.
   Contract enforced by src/tokens.test.ts — every colour pair below clears AA.

   NAMING, READ THIS FIRST: the `--color-cream` / `--color-oxblood` / `--color-clay-*`
   names in the ALIAS block at the bottom are historical. They no longer describe their
   values (`--color-cream` is zinc `#FAFAFA`, not cream). They exist only so this reskin
   could land without editing 896 call sites, and they are deleted in the follow-up rename.
   Do NOT add a new alias. New code uses the primitives and semantics above.
   ────────────────────────────────────────────────────────────────────────── */
:root {
  color-scheme: light;

  /* ── Colour primitives — never referenced by product code ──────────────── */
  --ink-50:  #FAFAFA;
  --ink-100: #F4F4F5;
  --ink-200: #E4E4E7;
  --ink-300: #D4D4D8;
  --ink-400: #A1A1AA;  /* borders + decorative icons ONLY — fails AA as text */
  --ink-500: #71717A;
  --ink-700: #3F3F46;
  --ink-900: #18181B;
  --ink-950: #09090B;
  --white:   #FFFFFF;

  /* Oxblood, in Voltage's seven-step shape. -500 is the brand and is fixed. */
  --brand-50:  #FDF0F2;
  --brand-100: #F5E6E8;
  --brand-200: #EBCDD3;
  --brand-400: #D4708A;  /* dark-theme accent — must stay LIGHTER than -500 */
  --brand-500: #7A1028;  /* the accent. Does not change. */
  --brand-600: #550A1A;
  --brand-700: #3F0713;

  /* ── Status — four tones. `info` is blue, deliberately not the brand: a
     status colour that equals the accent makes "new" indistinguishable from
     every primary button on the screen. ─────────────────────────────────── */
  /* success-500 is emerald-600, NOT Voltage's #10B981: white on #10B981 is 2.54:1
     and fails even the large-text floor. */
  --success-100: #D1FAE5;  --success-500: #059669;  --success-fg: #065F46;
  --warning-100: #FEF3C7;  --warning-500: #F59E0B;  --warning-fg: #92400E;
  --danger-100:  #FEE2E2;  --danger-500:  #EF4444;  --danger-fg:  #991B1B;
  --info-100:    #DBEAFE;  --info-500:    #2563EB;  --info-fg:    #1E40AF;
  --neutral-100: #F4F4F5;                           --neutral-fg: #3F3F46;

  /* ── Semantic colour ───────────────────────────────────────────────────── */
  --color-bg:            var(--ink-50);
  --color-bg-surface:    var(--white);
  --color-bg-muted:      var(--ink-100);
  --color-bg-hover:      var(--ink-100);
  --color-border:        var(--ink-200);
  --color-border-strong: var(--ink-300);
  --color-text:          var(--ink-900);
  --color-text-muted:    var(--ink-500);
  --color-text-subtle:   var(--ink-400);
  --color-accent:        var(--brand-500);
  --color-accent-hover:  var(--brand-600);
  --color-focus-ring:    rgba(122, 16, 40, 0.40);

  /* ── Spacing (4px base) ────────────────────────────────────────────────── */
  --space-0: 0;
  --space-1: 4px;   --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
  --space-5: 20px;  --space-6: 24px;  --space-8: 32px;  --space-10: 40px;
  --space-12: 48px; --space-16: 64px; --space-20: 80px;

  /* ── Radii — sharp. Names kept from the warm system; values are Voltage's. */
  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 4px;
  --radius-lg: 8px;
  --radius-xl: 8px;
  --radius-2xl: 12px;
  --radius-pill: 9999px;
  --radius-round: 50%;

  /* ── Elevation ─────────────────────────────────────────────────────────── */
  --elev-0: none;
  --elev-1: 0 1px 2px rgba(24, 24, 27, 0.05);
  --elev-2: 0 4px 12px rgba(24, 24, 27, 0.08);
  --elev-3: 0 12px 32px rgba(24, 24, 27, 0.12);
  --focus-ring: 0 0 0 2px rgba(122, 16, 40, 0.40);

  /* ── Motion ────────────────────────────────────────────────────────────── */
  --ease-out:    cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-in:     cubic-bezier(0.4, 0, 1, 1);
  --dur-fast:   120ms;
  --dur-base:   200ms;
  --dur-slow:   320ms;
  --dur-slower: 480ms;

  /* ── Icon sizes ────────────────────────────────────────────────────────── */
  --icon-sm: 14px; --icon-md: 16px; --icon-lg: 20px; --icon-xl: 24px;

  /* ── Z-index (unchanged — ordering, not appearance) ────────────────────── */
  --z-notif-panel: 50;
  --z-sticky: 90;
  --z-dropdown: 100;
  --z-overlay: 199;
  --z-drawer: 200;
  --z-modal: 300;
  --z-modal-popover: 400;
  --z-toast: 500;

  /* ══ ALIAS BLOCK — deleted by the follow-up rename. See the header note. ══
     These names are what 896 call sites already say. Pointing them at Voltage
     values is what reskins the app without touching a component. */
  --color-cream:              var(--ink-50);
  --color-white:              var(--white);
  --color-surface-raised:     var(--white);
  --color-surface-high:       var(--white);
  --color-surface-sunken:     var(--ink-100);
  --color-surface-sunken-hover: var(--ink-200);
  --color-surface-warm:       var(--ink-100);
  --color-surface-warm-alt:   var(--ink-100);
  --color-surface-cream-soft: var(--ink-50);
  --color-divider:            var(--ink-200);

  --color-ink:            var(--ink-900);
  --color-ink-soft:       var(--ink-700);
  --color-ink-faint:      var(--ink-500);
  --color-text-tertiary:  var(--ink-500);

  --color-oxblood:         var(--brand-500);
  --color-oxblood-deep:    var(--brand-600);
  --color-oxblood-deeper:  var(--brand-700);
  --color-oxblood-light:   var(--brand-400);
  --color-oxblood-tint:    var(--brand-100);
  --color-oxblood-tint-soft: var(--brand-50);

  --color-rose-muted:  var(--ink-500);
  --color-rose-deep:   var(--ink-700);
  --color-rose-border: var(--ink-200);
  --color-rose-tint:   var(--ink-100);
  --color-rose-pale:   var(--danger-100);
  --color-rose-hover:  var(--ink-200);
  --color-clay-muted:  var(--ink-400);
  --color-clay-border: var(--ink-200);
  --color-clay-rose:   var(--ink-400);
  --color-clay-faint:  var(--ink-300);
  --color-clay-warm:   var(--ink-300);
  --color-clay-pale:   var(--ink-200);

  --color-success-fg:       var(--success-fg);
  --color-success-bg:       var(--success-100);
  --color-success-strong:   var(--success-fg);
  --color-success-deep:     var(--success-fg);
  --color-success-border:   var(--success-500);
  --color-success-bg-soft:  var(--success-100);
  --color-success-bg-alt:   var(--success-100);
  --color-info-fg:          var(--info-fg);
  --color-info-bg:          var(--info-100);
  --color-info-blue-fg:     var(--info-fg);
  --color-info-blue-bg:     var(--info-100);
  --color-prep-fg:          var(--info-fg);
  --color-prep-bg:          var(--info-100);
  --color-prep-fg-alt:      var(--info-fg);
  --color-prep-bg-alt:      var(--info-100);
  --color-warn-fg:          var(--warning-fg);
  --color-warn-bg:          var(--warning-100);
  --color-warn-fg-alt:      var(--warning-fg);
  --color-warn-bg-alt:      var(--warning-100);
  --color-status-done-fg:   var(--neutral-fg);
  --color-danger-fg:        var(--danger-fg);
  --color-danger-bg:        var(--danger-100);
  --color-danger:           var(--danger-500);
  --color-danger-border:    var(--danger-500);
}

/* ── Dark theme: semantic remap only, primitives untouched.
   Attached to `.dark` because index.css declares
   `@custom-variant dark (&:is(.dark *))`. Voltage's [data-theme] selector
   would be dead CSS here.
   THESE VALUES ARE UNVERIFIED — no dark UI ships, and no dark QA pass ran.
   Treat them as a starting point, not as tested output. ─────────────────── */
.dark {
  color-scheme: dark;

  --color-bg:            var(--ink-950);
  --color-bg-surface:    #111114;
  --color-bg-muted:      #1C1C20;
  --color-bg-hover:      #27272A;
  --color-border:        #2A2A2E;
  --color-border-strong: var(--ink-700);
  --color-text:          var(--ink-50);
  --color-text-muted:    var(--ink-400);
  --color-text-subtle:   var(--ink-500);
  --color-accent:        var(--brand-400);
  --color-accent-hover:  var(--brand-500);
  --color-focus-ring:    rgba(212, 112, 138, 0.50);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @bitetime/frontend test -- tokens
```

Expected: PASS. If a contrast assertion fails, **change the hex, not the threshold** — nudge the offending step darker (for text) or lighter (for a tint) and re-run.

- [ ] **Step 5: Verify the app still compiles and nothing references a deleted token**

```bash
pnpm --filter @bitetime/frontend build
grep -rn "gold-" apps/frontend/src --include="*.tsx" --include="*.css"
```

Expected: build succeeds; grep prints nothing (gold had 0 `.tsx` usages and its aliases are gone).

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/tokens.css apps/frontend/src/tokens.test.ts
git commit -m "feat(design): give the warm token names Voltage values

The whole app changes appearance from this one file. The old names are
kept as an alias block so no component is touched yet; the follow-up
rename removes them.

tokens.test.ts reads the stylesheet and asserts AA on every pair, so the
palette is a contract rather than a set of hexes someone liked."
```

---

### Task 3: Wire the new scales into Tailwind

`tokens.css` defines the variables; `@theme inline` is what turns them into utilities. Without this the new scales exist but no class reaches them.

**Files:**
- Modify: `apps/frontend/src/index.css:54-147` (brand `@theme inline` block) and `:149-184` (shadcn bridge)

**Interfaces:**
- Consumes: every token from Task 2.
- Produces: Tailwind utilities `p-1..p-20` / `gap-*` (spacing), `shadow-elev-1..3`, `ease-out`/`duration-base`, `size-icon-*`, and the shadcn `--primary`/`--background` bridge now resolving to Voltage values.

- [ ] **Step 1: Add the new scales to the brand `@theme inline` block**

In `apps/frontend/src/index.css`, immediately after the `--radius-round: var(--radius-round);` line (currently line 136), insert:

```css

  /* Spacing scale → p-*, m-*, gap-* utilities */
  --spacing-1: var(--space-1);   --spacing-2: var(--space-2);
  --spacing-3: var(--space-3);   --spacing-4: var(--space-4);
  --spacing-5: var(--space-5);   --spacing-6: var(--space-6);
  --spacing-8: var(--space-8);   --spacing-10: var(--space-10);
  --spacing-12: var(--space-12); --spacing-16: var(--space-16);
  --spacing-20: var(--space-20);

  /* Elevation → shadow-elev-* utilities */
  --shadow-elev-1: var(--elev-1);
  --shadow-elev-2: var(--elev-2);
  --shadow-elev-3: var(--elev-3);

  /* Motion → ease-* / duration-* utilities */
  --ease-out: var(--ease-out);
  --ease-in-out: var(--ease-in-out);
  --ease-in: var(--ease-in);
  --animate-duration-fast: var(--dur-fast);
  --animate-duration-base: var(--dur-base);

  /* Primitives exposed for new code (the alias colour entries below are legacy) */
  --color-ink-50: var(--ink-50);
  --color-ink-100: var(--ink-100);
  --color-ink-200: var(--ink-200);
  --color-ink-300: var(--ink-300);
  --color-ink-400: var(--ink-400);
  --color-ink-500: var(--ink-500);
  --color-ink-700: var(--ink-700);
  --color-ink-900: var(--ink-900);
  --color-ink-950: var(--ink-950);
  --color-brand-50: var(--brand-50);
  --color-brand-100: var(--brand-100);
  --color-brand-200: var(--brand-200);
  --color-brand-400: var(--brand-400);
  --color-brand-500: var(--brand-500);
  --color-brand-600: var(--brand-600);
  --color-brand-700: var(--brand-700);
```

- [ ] **Step 2: Point the shadcn bridge at the semantic layer**

Replace lines 150–170 of `apps/frontend/src/index.css` (the `:root { --background: … --radius: 10px; }` run, stopping *before* `--chart-1`) with:

```css
:root {
  --background: var(--color-bg);
  --foreground: var(--color-text);
  --card: var(--color-bg-surface);
  --card-foreground: var(--color-text);
  --popover: var(--color-bg-surface);
  --popover-foreground: var(--color-text);
  --primary: var(--color-accent);
  --primary-foreground: var(--white);
  --secondary: var(--color-bg-muted);
  --secondary-foreground: var(--color-text-muted);
  --muted: var(--color-bg-muted);
  --muted-foreground: var(--color-text-muted);
  --accent: var(--color-bg-muted);
  --accent-foreground: var(--color-text);
  --destructive: var(--danger-500);
  --destructive-foreground: var(--white);
  --border: var(--color-border);
  --input: var(--color-border);
  --ring: var(--color-accent);
  --radius: 4px;
```

Note `--primary-foreground` moves from `--color-cream` to `--white`: primary buttons are oxblood-filled, and cream-on-oxblood was a warm-system pairing.

`--radius: 10px` → `4px` also resizes the `--radius-3xl` / `--radius-4xl` calcs at lines 309–310, which is intended.

- [ ] **Step 3: Verify the build and check a utility actually emits**

```bash
pnpm --filter @bitetime/frontend build
grep -o "radius:4px\|radius: 4px" apps/frontend/dist/assets/*.css | head -1
```

Expected: build succeeds and the grep finds a match.

- [ ] **Step 4: Run the full unit suite for regressions**

```bash
pnpm --filter @bitetime/frontend test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/index.css
git commit -m "feat(design): expose the Voltage scales as Tailwind utilities

Spacing, elevation, motion and the brand/ink primitives get @theme
entries, and the shadcn bridge now resolves through the semantic layer
instead of naming warm tokens directly."
```

---

### Task 4: Poppins

**Files:**
- Create: `apps/frontend/scripts/measure-font-metrics.ts`
- Modify: `apps/frontend/index.html:17-20`
- Modify: `apps/frontend/src/index.css:29-45` (fallback faces), `:233` (body font), `:269-270` (`@theme` font vars)
- Modify: `apps/frontend/src/cjkFont.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `--font-sans` = Poppins stack, `--font-mono` = system mono stack, `--font-heading` removed.

- [ ] **Step 1: Swap the webfont request**

In `apps/frontend/index.html`, replace lines 17–20 with:

```html
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap"
    />
```

Three weights, not the 18 the Voltage bundle carried. Leave the surrounding comment and both `preconnect` lines untouched — the reasoning in that comment is still correct.

- [ ] **Step 2: Write the metric-measurement script**

Create `apps/frontend/scripts/measure-font-metrics.ts`:

```ts
/* Measures Poppins against Arial so the metric-fallback @font-face in index.css can
   hold the same line boxes before and after the webfont swap.

   The numbers in index.css MUST come from here, not from taste — a stale size-adjust
   silently reintroduces the layout shift the fallback exists to prevent.

   Run: pnpm --filter @bitetime/frontend exec tsx scripts/measure-font-metrics.ts */
import { chromium } from '@playwright/test'

const SAMPLE = 'Handgloves — the quick brown fox jumps over the lazy dog 0123456789'

const page = await (await (await chromium.launch()).newContext()).newPage()

await page.setContent(`
  <link rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=block">
  <body></body>
`)
await page.waitForFunction(() => document.fonts.check('400 16px Poppins'))

const result = await page.evaluate((sample) => {
  const ctx = document.createElement('canvas').getContext('2d')!
  const widthOf = (font: string) => {
    ctx.font = font
    return ctx.measureText(sample).width
  }
  const metricsOf = (font: string) => {
    ctx.font = font
    const m = ctx.measureText(sample)
    return {
      ascent: m.fontBoundingBoxAscent,
      descent: m.fontBoundingBoxDescent,
    }
  }
  const real = widthOf('400 1000px Poppins')
  const fallback = widthOf('400 1000px Arial')
  const sizeAdjust = real / fallback
  const { ascent, descent } = metricsOf('400 1000px Poppins')
  return {
    sizeAdjust: +(sizeAdjust * 100).toFixed(2),
    ascentOverride: +((ascent / 1000 / sizeAdjust) * 100).toFixed(2),
    descentOverride: +((descent / 1000 / sizeAdjust) * 100).toFixed(2),
  }
}, SAMPLE)

console.log(`size-adjust: ${result.sizeAdjust}%;`)
console.log(`ascent-override: ${result.ascentOverride}%;`)
console.log(`descent-override: ${result.descentOverride}%;`)

process.exit(0)
```

- [ ] **Step 3: Run it and capture the three numbers**

```bash
pnpm --filter @bitetime/frontend exec tsx scripts/measure-font-metrics.ts
```

Expected: three CSS declarations printed. **Write them down — the next step uses the printed values, not the placeholders.**

- [ ] **Step 4: Replace the fallback faces**

In `apps/frontend/src/index.css`, replace both `@font-face` blocks (lines 29–45, `'Lora Fallback'` and `'DM Sans Fallback'`) with one, substituting the numbers printed in Step 3:

```css
@font-face {
  font-family: 'Poppins Fallback';
  src: local('Arial');
  size-adjust: <printed size-adjust>;
  ascent-override: <printed ascent-override>;
  descent-override: <printed descent-override>;
  line-gap-override: 0%;
}
```

Update the comment block above it: the family measured is now Poppins against Arial, and there is no serif face left to match.

- [ ] **Step 5: Point the font variables at Poppins**

In `apps/frontend/src/index.css`, in the second `@theme inline` block, replace lines 269–270:

```css
  /* No serif face: the reskin retired the serif/sans signage axis, so there is one
     Latin family. --font-mono is the SYSTEM stack — Voltage ships no mono, and the
     order number has to stay readable character by character. */
  --font-sans: 'Poppins', 'Poppins Fallback', 'Noto Sans SC', system-ui, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
```

Delete the `--font-heading` line entirely.

Then update the `body` rule at line 233 — replace `font-family: 'DM Sans', 'DM Sans Fallback', 'Noto Sans SC', sans-serif;` with:

```css
font-family: 'Poppins', 'Poppins Fallback', 'Noto Sans SC', system-ui, sans-serif;
```

- [ ] **Step 6: Confirm nothing still asks for the retired faces**

```bash
grep -rn "Lora\|DM Sans\|DM Mono\|font-heading" apps/frontend/src apps/frontend/index.html
```

Expected: no matches outside comments. Any live match is a missed edit — fix it before continuing.

- [ ] **Step 7: Drop the CJK serif**

In `apps/frontend/src/cjkFont.ts`, remove `Noto Serif SC` from the Google Fonts URL, leaving `Noto Sans SC` at weights 400;500;700. Update the file's comment: with the serif gone, the bilingual pairing is one face, not two.

- [ ] **Step 8: Verify**

```bash
pnpm --filter @bitetime/frontend build
pnpm --filter @bitetime/frontend test
```

Expected: both PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/index.html apps/frontend/src/index.css apps/frontend/src/cjkFont.ts apps/frontend/scripts/measure-font-metrics.ts
git commit -m "feat(design): Poppins replaces Lora + DM Sans

One Latin family; the serif/sans signage axis is gone, so the CJK pair
collapses to Noto Sans SC. --font-mono is the system stack rather than
Voltage's (which is Poppins, i.e. no mono at all) because the order
number has to read character by character.

The fallback face is re-measured against Arial by the new script; the
numbers are measured, never guessed."
```

---

### Task 5: Sharpen the borders

`border-[1.5px]` is a hardcoded arbitrary value, so it does not ride the token change. Left alone, clay-weight edges sit on zinc surfaces and the reskin reads as broken rather than partial.

**Files:**
- Modify: 45+ `.tsx` files under `apps/frontend/src` (81 occurrences)

**Interfaces:**
- Consumes: nothing. Produces: nothing. Purely a value sweep.

- [ ] **Step 1: Record the before-count**

```bash
grep -rc "border-\[1\.5px\]" apps/frontend/src --include="*.tsx" | grep -v ':0' | awk -F: '{s+=$2} END {print s" occurrences in "NR" files"}'
```

Expected: `81 occurrences in 45 files`. If the count differs, the codebase moved since the plan was written — re-check before sweeping.

- [ ] **Step 2: Sweep**

```bash
grep -rl "border-\[1\.5px\]" apps/frontend/src --include="*.tsx" \
  | xargs sed -i '' 's/border-\[1\.5px\]/border-[0.5px]/g'
```

(`sed -i ''` is the macOS form; on Linux use `sed -i`.)

- [ ] **Step 3: Verify the sweep was total**

```bash
grep -rn "border-\[1\.5px\]" apps/frontend/src --include="*.tsx"
grep -rc "border-\[0\.5px\]" apps/frontend/src --include="*.tsx" | grep -v ':0' | awk -F: '{s+=$2} END {print s}'
```

Expected: first command prints nothing; second prints `81`.

- [ ] **Step 4: Build and lint**

```bash
pnpm --filter @bitetime/frontend build
pnpm --filter @bitetime/frontend lint
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/frontend/src
git commit -m "style: hairline borders, 1.5px to 0.5px

Border width is a hardcoded arbitrary value, so it could not ride the
token change with everything else. 81 occurrences, mechanical."
```

---

### Task 6: Four status tones

Six order statuses stay; the colour vocabulary collapses to four. `new` and `preparing` share the info hue and are told apart by fill weight, so a busy order table does not lose the distinction entirely.

**Files:**
- Create: `apps/frontend/src/orderStatus.test.ts`
- Modify: `apps/frontend/src/orderStatus.tsx`

**Interfaces:**
- Consumes: the status tokens from Task 2 (`--color-info-bg`, `--color-warn-bg`, …, still reachable through the alias block).
- Produces: `STATUS_BADGE: Record<string, { variant?: 'infoBlue' | 'warn' | 'danger'; className?: string }>` — same exported shape as today, so no caller changes. `ORDER_STATUSES` and `STATUS_LABELS` are unchanged.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/orderStatus.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ORDER_STATUSES, STATUS_LABELS, STATUS_BADGE } from './orderStatus'

describe('order statuses', () => {
  it('still has all six members', () => {
    expect(ORDER_STATUSES).toEqual([
      'pending_payment', 'new', 'preparing', 'ready', 'completed', 'cancelled',
    ])
  })

  it('labels every status in both languages', () => {
    for (const s of ORDER_STATUSES) {
      expect(STATUS_LABELS[s]?.en).toBeTruthy()
      expect(STATUS_LABELS[s]?.zh).toBeTruthy()
    }
  })

  it('styles every status', () => {
    for (const s of ORDER_STATUSES) {
      expect(STATUS_BADGE[s]).toBeDefined()
    }
  })
})

/* The reskin collapsed six colour families to four. These assertions pin the
   mapping so a later edit cannot quietly reintroduce a fifth hue. */
describe('the four-tone vocabulary', () => {
  const classOf = (s: string) => STATUS_BADGE[s].className ?? ''

  it('uses only the four sanctioned tone families', () => {
    const allowed = /^(bg-(info|warn|success|danger|neutral)-|text-(info|warn|success|danger|neutral)-|border-)/
    for (const s of ORDER_STATUSES) {
      for (const cls of classOf(s).split(/\s+/).filter(Boolean)) {
        expect(cls, `${s} → ${cls}`).toMatch(allowed)
      }
    }
  })

  it('has no purple/plum family left', () => {
    for (const s of ORDER_STATUSES) {
      expect(classOf(s)).not.toMatch(/prep/)
    }
  })

  it('gives new and preparing the same hue but different weight', () => {
    expect(classOf('new')).toMatch(/info/)
    expect(classOf('preparing')).toMatch(/info/)
    expect(classOf('new')).not.toBe(classOf('preparing'))
  })

  it('maps the remaining statuses to their own tones', () => {
    expect(classOf('pending_payment')).toMatch(/warn/)
    expect(classOf('ready')).toMatch(/success/)
    expect(classOf('completed')).toMatch(/neutral/)
    expect(classOf('cancelled')).toMatch(/danger/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @bitetime/frontend test -- orderStatus
```

Expected: FAIL — `new` uses the `infoBlue` *variant* with no `className`, so `classOf('new')` is `''` and the hue assertions fail; `completed` still matches `/prep/`.

- [ ] **Step 3: Rewrite the badge map**

Replace lines 14–25 of `apps/frontend/src/orderStatus.tsx` with:

```tsx
type BadgeConfig = { variant?: 'infoBlue' | 'warn' | 'danger'; className?: string }

/* Four tone families, six statuses. `new` and `preparing` share the info hue and are
   separated by FILL WEIGHT — solid vs subtle — rather than by a fifth colour. A merchant
   scanning a busy table still sees two different things; the palette still has four
   entries. Every pair here is asserted AA by tokens.test.ts. */
export const STATUS_BADGE: Record<string, BadgeConfig> = {
  pending_payment: { className: 'bg-warn-bg text-warn-fg border-transparent' },
  new:             { className: 'bg-info-fg text-white border-transparent' },
  preparing:       { className: 'bg-info-bg text-info-fg border-transparent' },
  ready:           { className: 'bg-success-bg text-success-fg border-transparent' },
  completed:       { className: 'bg-neutral-100 text-neutral-fg border-transparent' },
  cancelled:       { className: 'bg-danger-bg text-danger-fg border-transparent' },
}
```

Then update the fallback on line 28 — `{ variant: 'infoBlue' as const }` becomes:

```tsx
  const badge = STATUS_BADGE[status] ?? { className: 'bg-neutral-100 text-neutral-fg border-transparent' }
```

- [ ] **Step 4: Add the two `@theme` entries the new classes need**

`bg-neutral-100` and `text-neutral-fg` have no utility yet. In `apps/frontend/src/index.css`, inside the brand `@theme inline` block next to the other status entries (near line 122), add:

```css
  --color-neutral-100: var(--neutral-100);
  --color-neutral-fg: var(--neutral-fg);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @bitetime/frontend test -- orderStatus
```

Expected: PASS.

- [ ] **Step 6: Confirm the retired tone names are unused**

```bash
grep -rn "prep-fg\|prep-bg\|status-done-fg\|info-blue" apps/frontend/src --include="*.tsx"
```

Expected: no matches. Any hit is another component still reaching for a retired tone — convert it to the nearest of the four before continuing.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/orderStatus.tsx apps/frontend/src/orderStatus.test.ts apps/frontend/src/index.css
git commit -m "feat(design): collapse order status to four tones

Six statuses, four colour families. new and preparing share the info hue
and differ by fill weight, so the merge does not cost a merchant the
distinction in a busy table.

The test pins the mapping: a fifth hue now fails CI."
```

---

### Task 7: Remove the paper grain

`GrainOverlay` paints an SVG noise tile with `mix-blend-multiply` — the most literal piece of the hand-lettered metaphor. It has no place over zinc.

**Files:**
- Modify: `apps/frontend/src/marketing/LandingMotion.tsx:15-26` (delete the export)
- Modify: `apps/frontend/src/marketing/{Landing,Pricing,FaqPage,FeaturesPage,SampleShopsPage}.tsx` (5 call sites + 5 imports)
- Modify: `apps/frontend/src/index.css:198-205` (delete `.grain-overlay`)

**Interfaces:**
- Consumes: nothing.
- Produces: `LandingMotion.tsx` no longer exports `GrainOverlay`. Its other exports — `Reveal`, `heroContainer`, `useHeroItem`, `HeroStagger`, `HeroItem`, `MagneticButton`, `StorefrontPreview`, `RotatingWord` — are untouched. **Do not delete the file.**

- [ ] **Step 1: Delete the component**

In `apps/frontend/src/marketing/LandingMotion.tsx`, delete lines 15–26 — the `── Paper grain ──` comment block and the entire `export function GrainOverlay() { … }`.

- [ ] **Step 2: Delete the five call sites**

Remove the `<GrainOverlay />` element and drop `GrainOverlay` from the import in each of:
- `src/marketing/Landing.tsx` (import line 15, usage line 39)
- `src/marketing/Pricing.tsx` (import line 22, usage line 54)
- `src/marketing/SampleShopsPage.tsx` (import line 13, usage line 24)
- `src/marketing/FeaturesPage.tsx` (import line 14, usage line 25)
- `src/marketing/FaqPage.tsx` (import line 17, usage line 31)

Four of these import `{ GrainOverlay, Reveal }` — keep `Reveal`, it is still used. `Landing.tsx` imports a multi-line list; remove only the `GrainOverlay,` entry.

- [ ] **Step 3: Delete the stylesheet rule**

In `apps/frontend/src/index.css`, delete lines 198–205 — the comment block explaining the noise tile and the `.grain-overlay { background-image: url("data:image/svg+xml,…"); }` rule.

- [ ] **Step 4: Verify nothing references it**

```bash
grep -rn "GrainOverlay\|grain-overlay" apps/frontend/src
pnpm --filter @bitetime/frontend lint
pnpm --filter @bitetime/frontend build
```

Expected: grep prints nothing; lint and build PASS. Lint failing on an unused `Reveal` import means Step 2 removed one entry too many in that file.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/marketing apps/frontend/src/index.css
git commit -m "refactor(marketing): drop the paper-grain overlay

An SVG noise tile multiplied over the page was the most literal piece of
the hand-lettered metaphor. The rest of LandingMotion is motion, not warm
identity, and stays."
```

---

### Task 8: Rewrite DESIGN.md and record the ADR

`DESIGN.md` is canonical and every one of its §6 Don'ts now describes what just shipped. A stale canonical doc is worse than none — the next reader trusts it.

**Files:**
- Modify: `DESIGN.md` (full rewrite)
- Create: `docs/adr/0012-the-warm-identity-is-retired.md`

**Interfaces:**
- Consumes: the final token values from Task 2 — read them out of `tokens.css`, do not retype from memory.
- Produces: documentation only.

- [ ] **Step 1: Rewrite `DESIGN.md`**

Keep the existing structure (YAML frontmatter, then §1 Overview, §2 Colors, §3 Typography, §4 Elevation, §5 Components, §6 Do's and Don'ts) so the file stays diffable against its history. Replace the content:

- **Frontmatter:** `description` becomes a Voltage-derived line. Colours listed as the Voltage primitives + the oxblood ramp. `typography` collapses to one `fontFamily: "Poppins, system-ui, sans-serif"` across display/headline/title/body/label, and `mono: "ui-monospace, SFMono-Regular, Menlo, monospace"`. `rounded` takes the sharp values from Task 2. Add a `spacing` block from `--space-*`.
- **§1:** north star is **"Sharp by default"** — engineered geometry, one vibrant accent surrounded by neutral, two token layers with no platform drift. State plainly that this **supersedes "The Hand-Lettered Shopfront"** and point at the ADR.
- **§2:** the ramp and the four status tones. Carry across the one rule that survives the reskin verbatim in spirit — **The One Voice Rule** (oxblood is the only accent; there is no second). Add the new **subtle-is-not-text** rule: `--ink-400` is borders and decorative icons only, it fails AA as body text on `--ink-50`, use `--color-text-muted` instead. That is the same trap the old `clay-muted` documented; it must not be lost.
- **§3:** one Latin family. Record the 16px `text-sm` floor and *why* (readability + iOS focus zoom). Record why `--font-mono` is the system stack.
- **§4:** Voltage's `--elev-0..3` + `--focus-ring`. The old **Flat-Rest Rule** is retired — say so explicitly rather than deleting it silently.
- **§5:** map the shadcn primitives to the semantic tokens.
- **§6:** rewrite the Don'ts. The warm-floor and serif-signage rules are gone. Keep: one accent only, EN/中文 parity at both string lengths, `prefers-reduced-motion` fallbacks, and never set text in `--ink-400`.

- [ ] **Step 2: Write the ADR**

Create `docs/adr/0012-the-warm-identity-is-retired.md`, following the format of the existing ADRs in that directory (read `0011-trial-feedback-is-a-cron-sweep-not-a-webhook.md` first for house style). It must state:

- **Context:** BiteTime shipped "The Hand-Lettered Shopfront" — oxblood on cream, Lora signage, soft geometry — and its §6 explicitly rejected cool grey neutrals and SaaS-dashboard layouts.
- **Decision:** adopt the Voltage token system wholesale, keeping oxblood as the accent. The rejection in the old §6 was a real position; it was overridden deliberately, not overlooked.
- **Consequences**, each stated plainly:
  1. Token names lie between this PR and the rename — `--color-cream` resolves to `#FAFAFA`. Bounded, and the alias block carries a header saying so.
  2. Dark-theme values ship **unverified**. No dark UI, no dark QA pass. They are a starting point.
  3. `--ink-400` (Voltage's `--color-text-subtle`) fails AA as body text on `--ink-50` at ~2.46:1. It is borders and icons only — the same constraint the retired `clay-muted` carried.
  4. The bilingual type pairing collapses from two faces to one; there is no serif left for 中文 headings.

- [ ] **Step 3: Verify the docs match the code**

```bash
grep -c "cream\|oxblood\|Lora\|DM Sans\|clay\|Hand-Lettered" DESIGN.md
```

Expected: only matches inside the "supersedes" sentence and the historical note. A `DESIGN.md` still describing cream surfaces as current is the failure this task exists to prevent.

- [ ] **Step 4: Commit**

```bash
git add DESIGN.md docs/adr/0012-the-warm-identity-is-retired.md
git commit -m "docs: retire the Hand-Lettered Shopfront

DESIGN.md is canonical, and every Don't in its old section 6 described
what this branch just shipped. Rewritten against the Voltage system, with
an ADR recording that the old position was overridden on purpose.

The subtle-is-not-text rule survives the rewrite: --ink-400 fails AA as
body text, exactly as clay-muted did."
```

---

### Task 9: Verify PR1 end to end

Per `CLAUDE.md`, UI is verified by running the app. This is that step, and it is the gate on PR1.

**Files:** none modified. Findings become fixes in whichever earlier task owns them.

- [ ] **Step 1: Full static check**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all PASS.

- [ ] **Step 2: Check the prerendered marketing HTML, not just the dev server**

```bash
grep -o "Poppins" apps/frontend/dist/index.html | head -1
grep -o "grain-overlay" apps/frontend/dist/index.html
grep -o "#F2EAE0\|#7A4F55\|#C9A090" apps/frontend/dist/assets/*.css
```

Expected: `Poppins` found; `grain-overlay` absent; **no warm hex found** in the built CSS. A warm hex surviving here means a token was hardcoded somewhere the alias block does not reach — track it down before shipping.

- [ ] **Step 3: Run the guest-order e2e suite**

```bash
pnpm --filter @bitetime/backend test:db 2>/dev/null || true   # ensure Supabase is up first
pnpm --filter @bitetime/frontend test:e2e
```

Expected: the guest-order spec PASSES. It serves the production bundle, so it exercises the real CSS.

- [ ] **Step 4: Drive the app by hand**

Use the `verify` skill (`/verify`). Cover, in both EN and 中文:

1. **Storefront** (`/s/:slug`) — menu, add to cart, checkout, order confirmation. `Storefront.tsx` is 1568 lines and the densest token consumer; this is the screen that matters most.
2. **Merchant dashboard** — the order table with **all six statuses rendered at once**, so the four-tone collapse can be judged in situ. Confirm `new` and `preparing` are still tellable apart.
3. **Admin merchants** table.
4. **Marketing** — `/` and `/pricing`, checking no grain and no cream.

Look for: text that lost contrast, borders that vanished into their background, oxblood used where a status colour belongs, and any surface that stayed warm.

- [ ] **Step 5: Fix findings in their owning task, then re-verify**

Any regression belongs to the task that introduced it — a contrast problem is a Task 2 fix (adjust the hex, re-run `tokens.test.ts`), not a patch at the call site.

- [ ] **Step 6: Open PR1**

```bash
git push -u origin worktree-design-system
gh pr create --base dev --title "feat(design): Voltage reskin" --body "$(cat <<'EOF'
Replaces the warm "Hand-Lettered Shopfront" identity with the Voltage UI
Kit token system, keeping oxblood #7A1028 as the single accent.

The whole app changes appearance from `tokens.css`: the existing warm
token NAMES were given Voltage values, so no component's classes were
touched and this reverts in one commit. The names lie for now
(`--color-cream` is #FAFAFA); a follow-up PR renames them with no visual
change.

- four status tones instead of six (new/preparing share a hue, differ by fill)
- Poppins replaces Lora + DM Sans; system mono keeps the order number legible
- borders 1.5px → 0.5px, radii sharpened
- dark-theme tokens ship UNVERIFIED — no dark UI, no dark QA

Spec: docs/superpowers/specs/2026-08-05-voltage-reskin-design.md
ADR: docs/adr/0012-the-warm-identity-is-retired.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_013k7zcmGas681PH6epwnQX3
EOF
)"
```

---

### Task 10: The rename (PR2)

Separate PR. The visual change already shipped and was verified; this one must change **nothing** visible, which is what makes an empty computed-style diff a valid gate.

**Files:**
- Create: `apps/frontend/scripts/capture-computed-styles.ts`
- Modify: 68 `.tsx` files (896 occurrences), `apps/frontend/src/tokens.css`, `apps/frontend/src/index.css`

**Interfaces:**
- Consumes: the token names produced by Task 2.
- Produces: the alias block deleted; product code referencing Voltage names only.

- [ ] **Step 1: Branch from the merged PR1**

```bash
git checkout dev && git pull
git checkout -b voltage-rename
```

- [ ] **Step 2: Write the computed-style capture script**

Create `apps/frontend/scripts/capture-computed-styles.ts`:

```ts
/* Snapshots the resolved colour/geometry of every element on a set of routes.
   Run before the rename and after it: an identical pair of files is the proof that
   a 896-occurrence sweep changed no pixel. Compare with `diff`. */
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const ORIGIN = process.env.ORIGIN ?? 'http://localhost:4173'
const ROUTES = ['/', '/pricing', '/features', '/faq', '/sample-shops']
const OUT = process.argv[2]
if (!OUT) throw new Error('usage: capture-computed-styles.ts <output-file>')

const PROPS = [
  'color', 'backgroundColor', 'borderColor', 'borderWidth',
  'borderRadius', 'boxShadow', 'fontFamily', 'fontSize',
] as const

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
const lines: string[] = []

for (const route of ROUTES) {
  await page.goto(`${ORIGIN}${route}`, { waitUntil: 'networkidle' })
  const rows = await page.evaluate((props) => {
    const out: string[] = []
    document.querySelectorAll('*').forEach((el, i) => {
      const cs = getComputedStyle(el)
      out.push(`${i}\t${el.tagName}\t` + props.map((p) => cs[p as never]).join('\t'))
    })
    return out
  }, PROPS as unknown as string[])
  lines.push(`### ${route}`, ...rows)
}

writeFileSync(OUT, lines.join('\n'))
await browser.close()
console.log(`wrote ${lines.length} lines to ${OUT}`)
```

- [ ] **Step 3: Capture the "before" snapshot**

```bash
pnpm --filter @bitetime/frontend build
pnpm --filter @bitetime/frontend preview &
sleep 3
pnpm --filter @bitetime/frontend exec tsx scripts/capture-computed-styles.ts /tmp/styles-before.txt
```

- [ ] **Step 4: Rename, one token family per commit**

Do **not** sweep all 896 at once — a single bad regex is then unattributable. One family, one commit, in this order (longest names first within a family, so `--color-oxblood-tint-soft` is not clipped by the `--color-oxblood` pattern):

| Old | New |
|---|---|
| `oxblood-tint-soft` | `brand-50` |
| `oxblood-tint` | `brand-100` |
| `oxblood-light` | `brand-400` |
| `oxblood-deeper` | `brand-700` |
| `oxblood-deep` | `brand-600` |
| `oxblood` | `brand-500` |
| `surface-raised`, `surface-high` | `bg-surface` |
| `surface-sunken-hover` | `bg-hover` |
| `surface-sunken`, `surface-warm`, `surface-warm-alt` | `bg-muted` |
| `surface-cream-soft`, `cream` | `bg` |
| `clay-border`, `rose-border`, `divider` | `border` |
| `clay-faint`, `clay-warm`, `clay-pale` | `border-strong` |
| `clay-muted`, `clay-rose` | `text-subtle` |
| `rose-muted`, `rose-deep`, `text-tertiary`, `ink-faint` | `text-muted` |
| `ink-soft` | `ink-700` |
| `ink` | `text` |

For each row:

```bash
# Example: the oxblood-tint-soft family
grep -rl "oxblood-tint-soft" apps/frontend/src \
  | xargs sed -i '' 's/oxblood-tint-soft/brand-50/g'
pnpm --filter @bitetime/frontend build && pnpm --filter @bitetime/frontend lint
git add -A apps/frontend/src && git commit -m "refactor(design): rename oxblood-tint-soft to brand-50"
```

Watch `--color-ink` → `--color-text`: `ink` is a substring of nothing else here, but `text-ink` becomes `text-text`, which is wrong. For that family match the full utility (`text-ink` → `text-text` is the literal outcome of a naive sweep) — use `s/\btext-ink\b/text-color-text/g` style targeted patterns and check the emitted CSS after.

- [ ] **Step 5: Delete the alias block**

Remove the entire `══ ALIAS BLOCK ══` section from `apps/frontend/src/tokens.css`, and its header note. Update the `@theme inline` colour entries in `index.css` that named alias tokens so they name primitives/semantics instead.

- [ ] **Step 6: Verify no alias survives**

```bash
grep -rn "cream\|oxblood\|clay-\|rose-muted\|surface-raised\|surface-sunken" apps/frontend/src
```

Expected: nothing. A single hit means a call site still names a token that no longer exists — the build would fail, but the grep localises it faster.

- [ ] **Step 7: Capture "after" and prove the diff is empty**

```bash
pnpm --filter @bitetime/frontend build
pnpm --filter @bitetime/frontend preview &
sleep 3
pnpm --filter @bitetime/frontend exec tsx scripts/capture-computed-styles.ts /tmp/styles-after.txt
diff /tmp/styles-before.txt /tmp/styles-after.txt && echo "IDENTICAL — rename is visually inert"
```

Expected: `diff` exits 0 and prints `IDENTICAL`. **Any** difference is a rename bug — find it before shipping; this is the whole gate for this PR.

- [ ] **Step 8: Full check and PR**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @bitetime/frontend test:e2e
```

Then open PR2 against `dev`, noting in the body that the computed-style diff was empty.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §2.1 neutrals | 2 |
| §2.2 brand ramp + monotonic-ramp bug | 1, 2 |
| §2.3 no second accent, gold deleted | 2 (asserted by test) |
| §2.4 semantic layer | 2 |
| §2.5 six statuses → four tones | 6 |
| §3.1 radii | 2 (asserted by test) |
| §3.2 borders 1.5px → 0.5px | 5 |
| §4.1 mono deviation | 4 |
| §4.2 three font files | 4 |
| §4.3 type scale + 16px floor | 3 (utilities), 8 (documented) |
| §5 new token groups | 2, 3 |
| §5.1 dark on `.dark`, unverified | 2, 8 (ADR) |
| §6 PR1 contents | 2–8 |
| §6 PR2 rename | 10 |
| §7 verification | 9 |
| §8 risks | 9 (Storefront, contrast), 8 (ADR: dark, subtle) |

Gap found and closed while reviewing: the spec's §4.3 type *scale* (`--fs-*`/`--lh-*`/`.t-*` classes) is ported as design guidance in Task 8 but **not** as CSS. That is deliberate — 896 call sites already size type with Tailwind utilities, and adding a parallel `.t-*` system nothing consumes would be dead code. Task 8 documents the scale in `DESIGN.md`; if `.t-*` classes are wanted later they are additive and need no migration.

**Placeholder scan:** clean. The three `<printed …>` values in Task 4 Step 4 are outputs of Step 3, which is a run command, not a TBD. The brand hexes in Task 2 are concrete candidates with a test as arbiter.

**Type consistency:** `contrastRatio(hexA, hexB): number` and `relativeLuminance(hex): number` are defined in Task 1 and used with those signatures in Task 2. `BadgeConfig` keeps the same shape in Task 6 as it has today, so `StatusBadge`'s callers are unaffected. Token names in Task 10's rename table all exist in Task 2's alias block.
