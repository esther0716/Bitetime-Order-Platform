---
name: TinyOrder
description: Sharp, engineered product UI for a multi-merchant food-ordering platform — one vibrant accent, lots of neutral around it
colors:
  ink-50: "#FAFAFA"
  ink-100: "#F4F4F5"
  ink-200: "#E4E4E7"
  ink-300: "#D4D4D8"
  ink-400: "#A1A1AA"
  ink-500: "#71717A"
  ink-700: "#3F3F46"
  ink-900: "#18181B"
  ink-950: "#09090B"
  white: "#FFFFFF"
  brand-50: "#FDF0F2"
  brand-100: "#F5E6E8"
  brand-200: "#EBCDD3"
  brand-400: "#D4708A"
  brand-500: "#7A1028"
  brand-600: "#550A1A"
  brand-700: "#3F0713"
  success-100: "#D1FAE5"
  success-500: "#059669"
  success-fg: "#065F46"
  warning-100: "#FEF3C7"
  warning-500: "#F59E0B"
  warning-fg: "#92400E"
  danger-100: "#FEE2E2"
  danger-500: "#EF4444"
  danger-fg: "#991B1B"
  info-100: "#DBEAFE"
  info-500: "#2563EB"
  info-fg: "#1E40AF"
  neutral-100: "#F4F4F5"
  neutral-fg: "#3F3F46"
typography:
  display:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.08em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  xs: "2px"
  sm: "4px"
  md: "4px"
  lg: "8px"
  xl: "8px"
  2xl: "12px"
  pill: "9999px"
  round: "50%"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  10: "40px"
  12: "48px"
  16: "64px"
  20: "80px"
components:
  button-primary:
    backgroundColor: "{colors.brand-500}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "14px"
  button-primary-hover:
    backgroundColor: "{colors.brand-600}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "14px"
  button-ghost:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-500}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.md}"
    padding: "7px 10px"
  pill-button:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-500}"
    rounded: "{rounded.pill}"
    padding: "5px 14px"
  status-chip:
    backgroundColor: "{colors.success-100}"
    textColor: "{colors.success-fg}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
---

# Design System: TinyOrder

## 1. Overview

**Creative North Star: "Sharp by default"**

TinyOrder is engineered geometry with one vibrant accent and a lot of neutral around it. Corners are tight (4px on most surfaces), borders are half-pixel hairlines, and depth comes from a cool zinc ladder — page `#FAFAFA`, surfaces pure white, muted rails `#F4F4F5` — rather than from shadow or ornament. The signature colour is oxblood (`#7A1028`), a deep wine-red that earns attention by being rare: it is the only accent on any screen, and everything it does not touch is grey. The whole system reads as a tool that was built rather than decorated.

Two token layers, and the split is the point. **Primitives** (`--ink-*`, `--brand-*`, the four status ramps) are the raw palette and are never referenced by product code. **Semantic tokens** (`--color-bg`, `--color-text-muted`, `--color-border`, `--color-accent`) are what components consume. Changing a surface colour is one edit to the semantic layer, and the dark theme is nothing but a remapping of that same layer with the primitives untouched.

Bilingual by design: every surface holds equally in English and 中文, so layouts breathe at both string lengths.

**This supersedes "The Hand-Lettered Shopfront"** — the warm oxblood-on-cream identity with Lora signage that this file described until 2026-08-05. That system explicitly rejected cool grey neutrals and SaaS-dashboard geometry; adopting them was a deliberate reversal, recorded in `docs/adr/0012-the-warm-identity-is-retired.md`. Read the ADR before arguing from anything in this file's history.

**Key Characteristics:**
- One oxblood accent over a cool zinc ladder — operational screens included
- A single Latin family (Poppins) at three weights; hierarchy from size and weight, not from a second face
- Flat surfaces, hairline `0.5px` borders, sharp 4px corners
- Two token layers: primitives stay in the system, semantics reach product code
- Full EN / 中文 parity as a structural constraint, not a translation layer

## 2. Colors

One committed accent over a neutral zinc ladder, plus a four-state semantic set for order status.

Every pair named here is asserted by `apps/frontend/src/tokens.test.ts`, which reads `tokens.css` off disk and fails the build on a contrast regression. Pick a new colour by changing a hex and running that suite — not by eye.

### Primary

- **Brand 500** (`#7A1028`): oxblood. The single brand voice — primary buttons, headings, active nav, focus rings. Carries identity on every screen. 10.41:1 on the page background.
- **Brand 600** (`#550A1A`): hover/pressed on oxblood fills only. Never a resting fill.
- **Brand 700** (`#3F0713`): text on a brand tint (chips, active rows).
- **Brand 100 / 50** (`#F5E6E8` / `#FDF0F2`): the accent at low strength — selected-row wash, chip backgrounds.
- **Brand 400** (`#D4708A`): a light rose, used **only** as the dark-theme accent. It exists because `-500` is far too dark to read on `#09090B`.

### Secondary

**None.** There is no second accent. Voltage's cyan is not ported and the old tracking gold is deleted.

### Neutral

- **Ink 50** (`#FAFAFA`): the page background.
- **White** (`#FFFFFF`): panels, cards, popovers — the raised step.
- **Ink 100** (`#F4F4F5`): muted rails, hover fills, sunken surfaces.
- **Ink 200** (`#E4E4E7`): the default `0.5px` border. The system's edge.
- **Ink 300** (`#D4D4D8`): a stronger border where one rule must read above another.
- **Ink 900** (`#18181B`): primary text. 16.97:1 on the page.
- **Ink 500** (`#71717A`): secondary text, field labels, captions, table meta. 4.63:1 on the page — the lightest text that clears AA.
- **Ink 400** (`#A1A1AA`): borders and decorative icons **only** — 2.46:1 as text, which fails AA outright.

### Semantic (order status — the four-tone set)

Six order statuses, four colour families. `new` and `preparing` share the info hue and are separated by fill weight rather than by a fifth colour.

| Status | Tone | Treatment |
|---|---|---|
| Pending payment | warning `#92400E` on `#FEF3C7` | subtle |
| New | info — white on `#1E40AF` | **solid** |
| Preparing | info `#1E40AF` on `#DBEAFE` | **subtle** |
| Ready | success `#065F46` on `#D1FAE5` | subtle |
| Completed | neutral `#3F3F46` on `#F4F4F5` | subtle |
| Cancelled | danger `#991B1B` on `#FEE2E2` | subtle |

`info` is blue and deliberately **not** the brand: a status colour equal to the accent would make "new" indistinguishable from every primary button on the screen.

### Named Rules

**The One Voice Rule.** Oxblood is the only brand accent. It does not compete with a second saturated colour — the semantic set is reserved for status and nothing else. If a screen has two accents fighting, one of them is wrong.

**The Subtle-Is-Not-Text Rule.** `--ink-400` (`#A1A1AA`) is a border and icon colour. It fails AA as body text on every surface in this system. Tertiary text goes on `--color-text-muted` (`--ink-500`). `tokens.test.ts` asserts `--ink-400` stays *below* the text threshold, so a future edit cannot quietly promote it.

## 3. Typography

**One family: Poppins** (with `Poppins Fallback` → `Noto Sans SC` → `system-ui`), at weights 400 / 500 / 600.

**Mono:** the system stack — `ui-monospace, SFMono-Regular, Menlo, monospace`. Deliberately not a webfont: it costs no bytes and no request, and the order number is the only thing that needs it.

**CJK:** Noto Sans SC, **requested only when the visitor is reading Chinese** (`src/cjkFont.ts`). An English page that downloads a CJK webfont pays for it twice, once in bytes and once in a re-layout when it lands. There is one CJK face now, not two — with no Latin serif, Noto Serif SC had nothing to pair with.

**Metric fallback:** `Poppins Fallback` (`src/index.css`) is not a new face and is never chosen for its own sake. It is Arial stretched by `size-adjust` and `ascent-override` to occupy exactly the space Poppins will occupy, sitting directly behind it in the stack, so the `display=swap` handover changes the shape of the glyphs without changing the line boxes. It is a guard against reflow on connections slow enough that the page paints before the font lands. **The numbers come from `measureText`, not from taste** — `scripts/measure-font-metrics.ts` produced the current `110.03% / 95.43% / 31.81%`. Re-measure if the family or its weights change; a stale number is a silent return of the shift.

### Hierarchy

- **Display** (Poppins 600, 48px, lh 1.05, −0.03em): the landing hero.
- **Headline** (Poppins 600, 36px, −0.025em): section heads.
- **Title** (Poppins 500, 20px, −0.01em): panel titles, card headings.
- **Body** (Poppins 400, 16px, lh 1.5): all running copy, form values, inputs, buttons, table cells. This is the `text-sm` utility, redefined to 16px in `index.css`. Dense compact variants (product rows, admin fields) may drop to 14px.
- **Field Label** (Poppins 400, 14px): input/field labels above controls (`label.tsx`).
- **Eyebrow/Tag** (Poppins 500, 11px, +0.08em, uppercase): section eyebrows, role tags. Stays small via `text-xs` / `text-[11px]`, unaffected by the body floor.
- **Mono** (system mono, 13px): order numbers (`PREFIX-YYMMDD-XXXX`), voucher codes, AWB only.

### Named Rules

**The 16px Body Floor.** `--text-sm` is 1rem, raised from Tailwind's 14px default. This is an accessibility decision — readability, plus it stops iOS zooming the viewport on input focus — and it is **not** a style choice a future reskin may overturn for visual density. Eyebrows and tags stay small through their own utilities.

**The Mono-Is-For-Codes Rule.** Monospace appears only where a string must be read character by character: the order number, voucher codes, AWB. It is never a stylistic choice.

## 4. Elevation

Flat by default. Depth comes from the surface ladder (`--ink-100` muted → `--ink-50` page → `#FFFFFF` raised) separated by `0.5px` `--ink-200` hairlines. Shadows are reserved for elements that genuinely float.

### Shadow Vocabulary

- **`--elev-1`** (`0 1px 2px rgba(24,24,27,0.05)`): the faintest lift.
- **`--elev-2`** (`0 4px 12px rgba(24,24,27,0.08)`): popovers, dropdowns, notification panel.
- **`--elev-3`** (`0 12px 32px rgba(24,24,27,0.12)`): modals, drawers.
- **`--focus-ring`** (`0 0 0 2px rgba(122,16,40,0.40)`): every focused control. The oxblood ring is the standard focus affordance and is always on — never removed for aesthetics.

The old **Flat-Rest Rule** — which forbade any shadow on a resting card — is **retired**. `--elev-1` is permitted on a resting surface where the surface ladder alone does not separate it. The ladder is still the first tool; the shadow is the second, not a substitute.

## 5. Components

The shadcn primitives in `src/components/ui/` resolve through the semantic layer via `index.css`: `--primary` → `--color-accent`, `--background` → `--color-bg`, `--card` → `--color-bg-surface`, `--border` → `--color-border`, `--radius` → `4px`.

### Buttons
- **Shape:** 4px radius (`rounded.md`); pill (`9999px`) for toggles and filters.
- **Primary:** brand-500 fill, **white** text, Poppins 500.
- **Hover / Active:** background → brand-600; `:active` `transform: scale(0.99)`.
- **Ghost:** white surface, ink-500 text, hairline border; hover shifts to the accent with a brand-50 wash.

### Chips (status)
Pill (`9999px`), 3px×10px padding, no border at rest. Background + text from the four-tone set. As a *filter* control the chip gains a matching-colour border to read as selected.

### Cards / Containers
- **Corners:** 8–12px for panels; form wraps cap at 600/900px by context.
- **Background:** white, stepped above the `#FAFAFA` page.
- **Border:** `0.5px` `--ink-200`.
- **Internal padding:** `--space-5` (20px) typical; `--space-8` for primary content columns.

### Inputs / Fields
`0.5px` ink-200 border, white fill, 4px radius, ink-900 text. Focus → border becomes the accent, plus the oxblood focus ring. No native outline.

### Charts
`src/components/charts/DashCharts.tsx` feeds Recharts colours as **props, not classes**, so its hexes cannot ride the token indirection. They are literals by necessity and must be updated by hand whenever this file's palette moves. Each one carries a comment naming the token it mirrors.

### Signature: Order Number
The mono order number (`PREFIX-YYMMDD-XXXX`) is the brand's receipt stamp — the one place monospace appears in customer-facing UI, signalling "this is your real, trackable order."

## 6. Do's and Don'ts

### Do:
- **Do** keep oxblood (`#7A1028`) as the single brand voice; hover to `#550A1A`, never a second resting accent (The One Voice Rule).
- **Do** consume the **semantic** tokens (`--color-bg`, `--color-text-muted`, `--color-border`) in product code. Primitives (`--ink-*`, `--brand-*`) belong to the system.
- **Do** build depth from the zinc ladder (`--ink-100` → `--ink-50` → `#FFFFFF`) plus `0.5px` hairlines before reaching for a shadow.
- **Do** keep body copy on `--color-text` and secondary copy on `--color-text-muted` — both clear AA. `--ink-400` is borders and icons only (The Subtle-Is-Not-Text Rule).
- **Do** run `pnpm --filter @bitetime/frontend test -- tokens` after touching a colour. The contrast contract is executable.
- **Do** hold every layout at both EN and 中文 string lengths; provide a `prefers-reduced-motion` fallback for any entrance.

### Don't:
- **Don't** set any text in `--ink-400` (`#A1A1AA`) — 2.46:1 on the page background, a straight AA failure. Tertiary text goes on `--color-text-muted`.
- **Don't** introduce a second accent colour. The status set is for status; nothing else gets a hue.
- **Don't** lower the 16px body floor for density (The 16px Body Floor).
- **Don't** hardcode a hex in a component. The one sanctioned exception is `DashCharts.tsx`, where Recharts takes colours as props — and every literal there names its token in a comment.
- **Don't** use a webfont for monospace, or set monospace anywhere but order numbers, voucher codes and AWB.
- **Don't** remove a focus ring for aesthetics.
