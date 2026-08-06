# Voltage reskin — replacing "The Hand-Lettered Shopfront"

**Date:** 2026-08-05
**Status:** approved, not implemented
**Supersedes:** `DESIGN.md` ("The Hand-Lettered Shopfront")

## 1. What this is

Replace BiteTime's visual identity with the **Voltage Web UI Kit**'s token system, keeping
oxblood (`#7A1028`) as the accent. Cool zinc neutrals, sharp geometry, Poppins, a two-layer
token architecture, and a dark-mode token mapping.

This is a **token and geometry** change. No Voltage *component* is imported — no `StatTile`,
no `CommandPalette`, no `ProjectsTable`. The existing component tree stays; only what it
resolves to changes.

### 1.1 The conflict, stated up front

`DESIGN.md` §6 lists Don'ts that describe Voltage almost exactly:

> Don't build a generic SaaS dashboard: no cold blue/grey panels, no hero-metric template…
> Don't reach for a cool grey neutral (`#EEE`, `#F5F5F5`, slate). Every neutral lives on the
> cream→taupe ladder (The Warm-Floor Rule).

Voltage's entire neutral ladder is cool zinc; its app shell is a stat-tile row over a data
table. Keeping the accent colour does not reconcile this. **This spec retires the warm
identity deliberately**, and `DESIGN.md` is rewritten rather than left contradicting the code.

An ADR records the reversal (§6).

## 2. Palette

Two layers. Product code references the semantic layer only; primitives stay in the system.

### 2.1 Neutrals — Voltage zinc, verbatim

```
--ink-50  #FAFAFA    --ink-100 #F4F4F5    --ink-200 #E4E4E7    --ink-300 #D4D4D8
--ink-400 #A1A1AA    --ink-500 #71717A    --ink-700 #3F3F46    --ink-900 #18181B
--ink-950 #09090B    --white   #FFFFFF
```

### 2.2 Brand — oxblood ramp

Voltage's brand ramp has seven steps. BiteTime has six ad-hoc oxbloods, so three steps are
new. Derived hexes are chosen against a contrast checker **during implementation**; the table
below fixes only what is already known.

| Token | Value | Origin |
|---|---|---|
| `--brand-50`  | `#FDF0F2` | existing `oxblood-tint-soft` |
| `--brand-100` | `#F5E6E8` | existing `oxblood-tint` |
| `--brand-200` | derive | new |
| `--brand-400` | derive — a **light rose** | dark-mode accent; must be lighter than `-500` |
| `--brand-500` | `#7A1028` | oxblood, unchanged |
| `--brand-600` | `#550A1A` | existing `oxblood-deep` |
| `--brand-700` | derive, ~`#3F0713` | new; text on `brand-50` chips |

`--brand-400` is **not** the existing `oxblood-light #8B2030`. Voltage uses `-400` as the
dark-theme accent, where it sits on `#09090B`; `#8B2030` lands around 2.2:1 there and fails AA.
It must be a genuinely light rose.

Note for whoever writes the ramp: today's `--color-oxblood-deeper #5C0C1E` is **lighter** than
`--color-oxblood-deep #550A1A`. The names are inverted. Both tokens are deleted in PR2; the
new ramp must not inherit the inversion.

### 2.3 Second accent: none

- Voltage's cyan `--accent-500 #06B6D4` is **not** ported.
- `gold-*` (tracking/AWB) is **deleted**. It has 0 occurrences across all `.tsx` files.

One accent survives the reskin.

### 2.4 Semantic layer

Voltage's names, verbatim:

```
--color-bg  --color-bg-surface  --color-bg-muted  --color-bg-hover
--color-border  --color-border-strong
--color-text  --color-text-muted  --color-text-subtle
--color-accent  --color-accent-hover  --color-focus-ring
```

### 2.5 Order status: six tones to four

`ORDER_STATUSES` keeps all six members. Only the **colour** vocabulary collapses. `new` and
`preparing` share a hue and are separated by fill weight so a busy order table stays readable.

| Status | Tone | Fill |
|---|---|---|
| `pending_payment` | warning | subtle |
| `new` | info | **solid** |
| `preparing` | info | subtle |
| `ready` | success | subtle |
| `completed` | neutral | subtle |
| `cancelled` | danger | subtle |

**Amended during implementation.** This table originally marked `pending_payment`, `ready`
and `cancelled` solid as well. Solid fills exist here for exactly one reason — to separate
`new` from `preparing`, which share a hue — and spending them on three statuses that
already own a hue made the table read as four shouting chips rather than one. Verified in
the running dashboard with all six rendered at once. `DESIGN.md` §2 carries the shipped
table.

Single seam: `apps/frontend/src/orderStatus.tsx` (34 lines).

## 3. Geometry

### 3.1 Radii

Names are kept; values are remapped, so every usage flips with its token and no `.tsx` is
touched. `rounded-full` (38 usages) is Tailwind's own utility, not a brand token, and is
unaffected.

| Token | Today | New | Usages |
|---|---|---|---|
| `--radius-xs` | 4px | **2px** | 3 |
| `--radius-sm` | 8px | **4px** | 17 |
| `--radius-md` | 10px | **4px** | 46 |
| `--radius-lg` | 12px | **8px** | 38 |
| `--radius-xl` | 14px | **8px** | 16 |
| `--radius-2xl` | 16px | **12px** | 31 |
| `--radius-pill` | 20px | **9999px** | 25 |
| `--radius-round` | 50% | 50% | 5 |

### 3.2 Borders

Border **width is not tokenized**: `border-[1.5px]` is hardcoded 81 times in `.tsx`. A
find/replace to `border-[0.5px]` runs in PR1 alongside the token flip. Skipping it leaves
heavy clay-weight edges on zinc surfaces, which reads as a broken reskin rather than a
deferred one.

Border **colour** rides the alias: `--color-clay-border #C9A090` → `#E4E4E7`.

## 4. Typography

```
--font-sans: 'Poppins', system-ui, -apple-system, sans-serif
--font-mono: ui-monospace, SFMono-Regular, Menlo, monospace
```

### 4.1 The one deviation from Voltage

Voltage sets `--font-mono: 'Poppins'` — it ships no monospace face. Taken literally that
breaks the order number (`PREFIX-YYMMDD-XXXX`, 12 `font-mono` usages), which exists to be read
character by character. The system mono stack costs **zero bytes and zero requests** and keeps
that legibility. `DM Mono` is dropped.

### 4.2 Files that carry the swap

`font-serif` appears **0 times** in `.tsx`; Lora is applied through theme vars only. Three
files:

1. **`apps/frontend/index.html`** — Google Fonts link `Lora + DM Sans` → `Poppins:wght@400;500;600`.
   Three weights, not the 18 Voltage bundles.
2. **`apps/frontend/src/index.css`** — set `--font-sans`/`--font-mono`; delete
   `@font-face 'Lora Fallback'`; rename `'DM Sans Fallback'` → `'Poppins Fallback'` and
   **re-measure** its `size-adjust` / `ascent-override` / `descent-override` with canvas
   `measureText` against Arial. The file's own comment requires re-measuring on a family
   change; a stale number silently reintroduces layout shift.
3. **`apps/frontend/src/cjkFont.ts`** — drop `Noto Serif SC`, keep `Noto Sans SC`. With the
   serif gone the bilingual pairing collapses to one face.

### 4.3 Type scale

Voltage's `--fs-*` / `--lh-*` / `--tr-*` / `--fw-*` variables and the `.t-display-xl` …
`.t-mono-sm` classes are ported whole. BiteTime has no type tokens today.

**Carve-out:** Voltage's body size is 14px. `index.css` currently redefines `text-sm` to
**16px** as a readability floor. The floor stays. It is an accessibility decision, and a
visual reskin is not grounds to overturn it.

## 5. New token groups

All new to BiteTime, ported from Voltage: `--space-0..20` (4px base), `--elev-0..3`,
`--focus-ring`, `--ease-out` / `--ease-in-out` / `--ease-in`, `--dur-fast|base|slow|slower`,
`--icon-sm..xl`, and the `prefers-reduced-motion` guard.

### 5.1 Dark mode: tokens only

Every semantic token gets a dark value. **No toggle, no persistence, no dark QA pass ships.**

The dark block attaches to **`.dark`**, not Voltage's `[data-theme="dark"]`: `index.css:50`
already declares `@custom-variant dark (&:is(.dark *))` and a `.dark` block exists at line 313.
Voltage's selector would be dead CSS.

These values are **unverified**. They are a starting point, not tested output.

## 6. Delivery

### PR 1 — the reskin

The whole app changes appearance; the diff stays small and revertible.

- `tokens.css` — rewritten: primitives, semantic layer, new space/elevation/motion/icon groups.
  **The warm token names are kept as the alias surface** and given Voltage values.
- `index.css` — `@theme inline` extended for the new groups; `.dark` block filled;
  `Lora Fallback` deleted; `Poppins Fallback` re-measured; `.grain-overlay` deleted
- `index.html` — font link swap
- `cjkFont.ts` — `Noto Serif SC` dropped
- mechanical: `border-[1.5px]` → `border-[0.5px]`, 81 occurrences
- `marketing/LandingMotion.tsx` — the `GrainOverlay` export deleted, plus its 5 call sites
  (`Landing`, `Pricing`, `FaqPage`, `FeaturesPage`, `SampleShopsPage`) and the `.grain-overlay`
  rule. The rest of the file (`Reveal`, `HeroStagger`, `MagneticButton`, `StorefrontPreview`,
  `RotatingWord`) is motion, not warm identity, and stays.
- `orderStatus.tsx` — four tones, solid/subtle split
- **`DESIGN.md` rewritten** — it is canonical, and every §6 Don't now describes what shipped
- **New ADR** under `docs/adr/` — why the warm identity was retired, that token names lie
  during the PR1→PR2 window, and that dark values are untested

Zero `.tsx` token edits. Names lie for the duration (`--color-cream` resolves to `#FAFAFA`);
this is bounded by PR2 and recorded in the ADR.

### PR 2 — the rename

1,236 occurrences across 88 files, **zero visual change**. Aliases deleted.

**Amended during implementation.** This section originally said "warm names → Voltage
names". Voltage's *CSS variable* names do not survive contact with Tailwind, which prefixes
the token: `--color-bg-surface` would be written `bg-bg-surface`, `--color-text-muted` as
`text-text-muted`. The primitives keep their own names (`bg-brand-500`, `text-ink-600`) and
the semantic layer lands on **shadcn's** vocabulary instead — `bg-background`, `bg-card`,
`bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary` —
which `index.css` already wires and which is not invented here.

Every mapping preserves the **resolved value**, not the intent. `text-cream` became
`text-background`, not `text-primary-foreground`: the latter is the shadcn idiom for a
label on a primary fill, but it resolves to white where the pixels were cream, and would
have repainted every primary button's label.

Pass condition: a computed-style diff before and after is **empty**. It was.

Scope note: the snapshot covers the seven public routes. The dashboard, settings,
storefront and admin are auth-gated and were verified by hand instead.

## 7. Verification

Per `CLAUDE.md`, UI is verified by running the app, not by component tests.

- `/verify` against local Supabase: storefront order placement, merchant dashboard order table
  with all six statuses rendered, admin merchants
- `pnpm test` — `vercelRewrites`, `routeMeta`, and the rest of the unit suites
- **Prerender check**: `marketing/` is SSR'd by `scripts/prerender.tsx`. `/` and `/pricing`
  must be inspected as *built HTML*, not only in the dev server
- **AA re-check** — every foreground/background pair moves at once. The four status tones on
  zinc, and `brand-700` on `brand-50`, are unverified until checked

## 8. Risks

1. **`store/Storefront.tsx` is 1568 lines** and owns customer order intake — the highest-traffic
   surface, one file, the densest token usage. Its verification matters most.
2. **Contrast regressions.** See §7. Not an assumption to carry into implementation.
3. **Dark values ship untested** (§5.1), by choice. The ADR must say so, or a later reader will
   assume dark mode works.
4. **Font metrics are guesswork if the re-measure is skipped** (§4.2).

## 9. Out of scope

- Wiring shadcn primitives (`button/card/badge/input.tsx`) to `--primary`/`--background`.
  They hardcode brand tokens today and will continue to, under Voltage names.
- Any dark-mode UI: toggle, persistence, QA.
- Any Voltage component. Tokens and geometry only.

## 10. Measurements this spec rests on

Taken 2026-08-05 against the `worktree-design-system` branch.

| Fact | Value |
|---|---|
| `.tsx` files under `apps/frontend/src` | 103 |
| Warm-token occurrences | 896 |
| `oxblood*` | 288 occurrences / 68 files |
| `rose-muted` | 196 / 61 |
| `clay-border` | 125 / 45 |
| `surface-raised` | 72 / 39 |
| `gold-*` | **0** |
| `font-serif` | **0** |
| `border-[1.5px]` | 81 |
| files using `rounded-*` | 72 |
| shadcn primitives using semantic `--*` vars | **0** — all four hardcode brand tokens |
