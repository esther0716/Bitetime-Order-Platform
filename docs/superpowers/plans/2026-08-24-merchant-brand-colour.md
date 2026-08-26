# Merchant Brand Colour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merchant picks one colour, and their storefront and dashboard wear it without any choice of theirs being able to produce unreadable text.

**Architecture:** One nullable column, `merchants.brand_color`, holding a hex string. A pure frontend module derives a nine-value theme from it — the whole `--brand-*` ramp plus four accent roles — using WCAG maths so contrast is a property of the derivation, not of the merchant's taste. A wrapper component applies that theme as CSS custom properties over a subtree, which is what scopes it to the storefront and the dashboard and keeps it off the marketing pages.

**Tech Stack:** TypeScript (strict), React 19, Vite, Tailwind v4 with a shadcn token bridge, Vitest, Hono, Postgres/Supabase.

**Spec:** `docs/superpowers/specs/2026-08-24-merchant-brand-colour-design.md`

## Global Constraints

- **Never run `db:push` or any `supabase` command that reaches production.** Write the migration file and apply it locally with `pnpm --filter @bitetime/backend db:migrate`. Say plainly that production still needs it.
- **Write all prose in ASD-STE100 Simplified Technical English** — commit messages, PR bodies, documentation. Not code, and not code comments.
- **The whole codebase is TypeScript, `strict: true`, `noEmit: true`.**
- **Frontend imports are extensionless** (`moduleResolution: bundler`). **Backend relative imports keep `.js` specifiers** that resolve to the `.ts` source — leave them as `.js`.
- **`@bitetime/shared` ships source, no build step.** Anything added there must be exported from `packages/shared/src/index.ts` with a `.js` specifier.
- **UI is verified by running the app** (run-and-verify), not by component tests. Pure logic gets unit tests.
- **Never mock the database** in any DB-backed suite.
- **The accent's platform value is `#7A1028`** and the page canvas is `#F2EAE0` (`--cream`). Both are literals in `tokens.css`.
- **AA floor is 4.5:1** for every text pair this feature derives.

---

### Task 1: `normalizeBrandColor` in the shared package

The one rule that must hold identically on both sides of the wire: the picker runs it to decide whether Save is enabled, and the endpoint runs it to decide whether to refuse. Follows `validateShopDescription`, which lives there for the same reason.

**Files:**
- Create: `packages/shared/src/brandColor.ts`
- Create: `packages/shared/src/brandColor.test.ts`
- Modify: `packages/shared/src/index.ts` (add two export lines)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type BrandColorResult = { ok: true; value: string | null } | { ok: false; error: 'malformed_brand_color' }`
  - `function normalizeBrandColor(value: unknown): BrandColorResult`
  - `const PLATFORM_BRAND_COLOR = '#7A1028'`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/brandColor.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeBrandColor, PLATFORM_BRAND_COLOR } from './brandColor.js'

const ok = (v: unknown, value: string | null) =>
  expect(normalizeBrandColor(v)).toEqual({ ok: true, value })
const bad = (v: unknown) =>
  expect(normalizeBrandColor(v)).toEqual({ ok: false, error: 'malformed_brand_color' })

describe('normalizeBrandColor', () => {
  it('accepts a six-digit hex and stores it uppercased', () => {
    ok('#7a1028', '#7A1028')
    ok('#7A1028', '#7A1028')
  })

  // A merchant copying a colour out of a design tool gets a bare six digits as often as not.
  it('accepts a hex with no leading hash', () => {
    ok('7a1028', '#7A1028')
  })

  it('expands the three-digit form, which CSS accepts and the column should not store', () => {
    ok('#f0a', '#FF00AA')
  })

  it('trims, because a pasted value carries whitespace', () => {
    ok('  #7A1028  ', '#7A1028')
  })

  // Clearing the field is a real action: it is the only way back to the platform colour.
  it('reads every way of saying "use the default" as null', () => {
    ok(null, null)
    ok('', null)
    ok('   ', null)
  })

  it('refuses anything that is not a colour, rather than coercing it', () => {
    bad('red')
    bad('#12345')
    bad('#GGGGGG')
    bad('rgb(1,2,3)')
    bad(42)
    bad({})
    bad(['#7A1028'])
  })

  // The default is a value this package states once, so the picker and the derivation agree.
  it('names the platform accent', () => {
    expect(PLATFORM_BRAND_COLOR).toBe('#7A1028')
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @bitetime/shared exec vitest run src/brandColor.test.ts`
Expected: FAIL — `Failed to resolve import "./brandColor.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/brandColor.ts`:

```ts
/* A shop's brand colour, as it is allowed to be stored.
 *
 * Shared because the rule runs on both sides of the wire: the dashboard's picker runs it to decide
 * whether Save is enabled and what to send, and `pickMerchantConfig` runs it to decide whether to
 * refuse. One regex in the endpoint and a different one in the form is how a value that the picker
 * accepts starts coming back as a 400.
 */

/** The platform accent — `--brand-500` in tokens.css. A shop with no colour of its own gets this. */
export const PLATFORM_BRAND_COLOR = '#7A1028'

export type BrandColorError = 'malformed_brand_color'

export type BrandColorResult =
  | { ok: true; value: string | null }
  | { ok: false; error: BrandColorError }

/* Both CSS forms, with the hash optional: a merchant copying a colour out of a design tool gets a
   bare six digits as often as a `#`-prefixed one, and refusing that would be pedantry. */
const HEX = /^#?(?:([0-9a-f]{3})|([0-9a-f]{6}))$/i

/**
 * Normalise a submitted brand colour to `#RRGGBB`, or to `null` for "use the platform colour".
 *
 * `null`, `''` and whitespace all mean the same thing — take it down — and all store `null`, so
 * the column never holds a blank string. Anything else that is not a hex colour is REFUSED, never
 * coerced: a value that fails to save while the merchant sees a success toast is worse than an
 * error, and this is the same posture `tax_rate` and `payment_qr` already take next door.
 */
export function normalizeBrandColor(value: unknown): BrandColorResult {
  if (value === null || value === undefined) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: 'malformed_brand_color' }
  const trimmed = value.trim()
  if (trimmed === '') return { ok: true, value: null }
  const m = HEX.exec(trimmed)
  if (!m) return { ok: false, error: 'malformed_brand_color' }
  // The three-digit form is expanded here rather than stored: the column feeds a colour parser
  // that reads six digits, and two spellings of one colour is two things to keep in step.
  const six = m[1] ? m[1].split('').map((c) => c + c).join('') : m[2]
  return { ok: true, value: `#${six.toUpperCase()}` }
}
```

- [ ] **Step 4: Export it from the package index**

In `packages/shared/src/index.ts`, directly below the `validateShopDescription` export lines, add:

```ts
export { normalizeBrandColor, PLATFORM_BRAND_COLOR } from './brandColor.js'
export type { BrandColorError, BrandColorResult } from './brandColor.js'
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `pnpm --filter @bitetime/shared exec vitest run src/brandColor.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @bitetime/shared typecheck`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/brandColor.ts packages/shared/src/brandColor.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): one rule for what a brand colour may be"
```

---

### Task 2: The column and the write path

**Files:**
- Create: `apps/backend/supabase/migrations/20260824120000_merchant_brand_colour.sql`
- Modify: `apps/backend/src/writes.ts` (add to `MERCHANT_CONFIG_FIELDS`; add a check inside `pickMerchantConfig`)
- Modify: `apps/frontend/src/types.ts` (the `Merchant` interface)
- Test: `apps/backend/tests/unit/writes.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `normalizeBrandColor` from `@bitetime/shared` (Task 1).
- Produces: `merchants.brand_color` (`text`, nullable) and `Merchant['brand_color']?: string | null`.

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/tests/unit/writes.test.ts`:

```ts
describe('pickMerchantConfig — brand colour', () => {
  it('accepts a hex and stores it uppercased', () => {
    expect(pickMerchantConfig({ brand_color: '#1f5c3d' }, SHOP))
      .toEqual({ ok: true, patch: { brand_color: '#1F5C3D' } })
  })

  it('accepts the three-digit form, expanded', () => {
    expect(pickMerchantConfig({ brand_color: '#f0a' }, SHOP))
      .toEqual({ ok: true, patch: { brand_color: '#FF00AA' } })
  })

  // The only way back to the platform colour. Both spellings store null, so the column never
  // holds a blank string that the derivation would then have to treat as a colour.
  it('reads null and empty as "use the platform colour"', () => {
    expect(pickMerchantConfig({ brand_color: null }, SHOP))
      .toEqual({ ok: true, patch: { brand_color: null } })
    expect(pickMerchantConfig({ brand_color: '' }, SHOP))
      .toEqual({ ok: true, patch: { brand_color: null } })
  })

  it('refuses a value that is not a colour rather than dropping it', () => {
    expect(pickMerchantConfig({ brand_color: 'rebeccapurple' }, SHOP))
      .toEqual({ ok: false, error: 'brand_color must be a hex colour like #7A1028' })
  })

  it('leaves the column alone when the body does not mention it', () => {
    expect(pickMerchantConfig({ timezone: 'Asia/Kuala_Lumpur' }, SHOP))
      .toEqual({ ok: true, patch: { timezone: 'Asia/Kuala_Lumpur' } })
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @bitetime/backend exec vitest run tests/unit/writes.test.ts`
Expected: FAIL — the first four cases return `{ ok: true, patch: {} }`, because the field is not in the allowlist.

- [ ] **Step 3: Add the column to the allowlist**

In `apps/backend/src/writes.ts`, add to the `MERCHANT_CONFIG_FIELDS` array, directly after the `'description', 'description_zh',` line:

```ts
  // The shop's one brand colour. The whole storefront palette derives from it in the browser
  // (frontend `brandTheme.ts`); nothing here reads it, because nothing server-side renders a
  // storefront. What this allowlist owns is the SHAPE.
  'brand_color',
```

- [ ] **Step 4: Validate it inside `pickMerchantConfig`**

In the same file, add the import at the top:

```ts
import { isTimezone, validateMenuCategories, validateShopDescription, normalizeBrandColor } from '@bitetime/shared'
```

And inside `pickMerchantConfig`, directly after the `payment_qr` block, add:

```ts
  // Refused, not dropped, for the reason the tax rate is: the merchant is standing in front of a
  // colour picker, and a silent drop hands them a success toast and the colour they already had.
  // The rule itself lives in @bitetime/shared, so the picker and this endpoint cannot disagree.
  if (out.brand_color !== undefined) {
    const brand = normalizeBrandColor(out.brand_color)
    if (!brand.ok) return { ok: false, error: 'brand_color must be a hex colour like #7A1028' }
    out.brand_color = brand.value
  }
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `pnpm --filter @bitetime/backend exec vitest run tests/unit/writes.test.ts`
Expected: PASS, including the five new cases.

- [ ] **Step 6: Write the migration**

Create `apps/backend/supabase/migrations/20260824120000_merchant_brand_colour.sql`:

```sql
-- The one colour a merchant picks for their shop. The storefront and the
-- merchant's own dashboard derive their whole accent ramp from it in the
-- browser; nothing on the server reads this column.
--
-- NULL means "use the platform accent", and NULL is what the Reset button
-- writes -- never the literal #7A1028. A shop that never chose must stay a
-- shop that never chose, so that a later change to the platform colour still
-- reaches it. A row holding #7A1028 is a shop that picked oxblood on purpose.
--
-- NO CHECK constraint on the format, deliberately, matching description above.
-- The rule is normalizeBrandColor in @bitetime/shared, enforced by
-- pickMerchantConfig on the way in. A constraint would answer a malformed
-- value with a bare 500 out of PostgREST; the allowlist answers with a 400
-- that names the rule.
alter table public.merchants
  add column if not exists brand_color text;
```

- [ ] **Step 7: Apply the migration locally**

Run: `pnpm --filter @bitetime/backend db:migrate`
Expected: the new migration is listed as applied. If it is not applied, PostgREST will answer later queries with `Could not find the 'brand_color' column ... in the schema cache`.

Do **not** run `db:push`. Production still needs this migration; a human applies it.

- [ ] **Step 8: Declare the field on the frontend type**

In `apps/frontend/src/types.ts`, inside `interface Merchant`, directly after the `description_zh?: string | null` line, add:

```ts
  /** The shop's one brand colour, `#RRGGBB` or null for the platform accent. Read it through
   *  `brandTheme()`, never directly: the storefront needs nine derived values, not this one, and a
   *  null here is a normal state (most shops), not a missing value. */
  brand_color?: string | null
```

- [ ] **Step 9: Typecheck both workspaces**

Run: `pnpm --filter @bitetime/backend typecheck && pnpm --filter @bitetime/frontend typecheck`
Expected: no output, exit 0 for both.

- [ ] **Step 10: Commit**

```bash
git add apps/backend/supabase/migrations/20260824120000_merchant_brand_colour.sql apps/backend/src/writes.ts apps/backend/tests/unit/writes.test.ts apps/frontend/src/types.ts
git commit -m "feat(merchants): a shop can hold a brand colour"
```

---

### Task 3: HSL conversion

Every derivation in the next task holds hue and moves lightness, which is a thing HSL does exactly and hex does not. This is its own task because it is its own property — a round trip that loses a hue is a bug you want to find here, not inside a contrast sweep.

**Files:**
- Create: `apps/frontend/src/hsl.ts`
- Create: `apps/frontend/src/hsl.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Hsl { h: number; s: number; l: number }` — `h` in degrees 0–360, `s` and `l` as 0–1
  - `function hexToHsl(hex: string): Hsl` — throws on a non-hex input
  - `function hslToHex(h: number, s: number, l: number): string` — returns `#RRGGBB` uppercase, clamps `s`/`l`, wraps `h`
  - `function hexToRgb(hex: string): [number, number, number]` — throws on a non-hex input

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/hsl.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hexToHsl, hslToHex, hexToRgb } from './hsl'

describe('hexToHsl', () => {
  it('reads the platform accent', () => {
    const { h, s, l } = hexToHsl('#7A1028')
    expect(h).toBeCloseTo(346.4, 0)
    expect(s).toBeCloseTo(0.768, 2)
    expect(l).toBeCloseTo(0.271, 2)
  })

  it('reads a grey as having no hue and no saturation', () => {
    const { s, l } = hexToHsl('#3F3F46')
    expect(s).toBeGreaterThan(0)   // #3F3F46 is a warm grey, not neutral
    const pure = hexToHsl('#808080')
    expect(pure.s).toBe(0)
    expect(pure.l).toBeCloseTo(0.502, 2)
    expect(l).toBeGreaterThan(0)
  })

  it('accepts the three-digit form and a missing hash', () => {
    expect(hexToHsl('#fff').l).toBe(1)
    expect(hexToHsl('000').l).toBe(0)
  })

  it('throws on anything that is not a hex colour', () => {
    expect(() => hexToHsl('red')).toThrow()
    expect(() => hexToHsl('#12345')).toThrow()
  })
})

describe('hslToHex', () => {
  it('round-trips every step of the platform ramp', () => {
    for (const hex of ['#FDF0F2', '#F5E6E8', '#EBCDD3', '#D4708A', '#7A1028', '#550A1A', '#3F0713']) {
      const { h, s, l } = hexToHsl(hex)
      expect(hslToHex(h, s, l)).toBe(hex)
    }
  })

  it('clamps saturation and lightness rather than producing junk', () => {
    expect(hslToHex(346, 1.4, 0.5)).toBe(hslToHex(346, 1, 0.5))
    expect(hslToHex(346, 0.8, 1.7)).toBe('#FFFFFF')
    expect(hslToHex(346, 0.8, -0.2)).toBe('#000000')
  })

  it('wraps hue, so arithmetic on it never needs a guard at the call site', () => {
    expect(hslToHex(370, 0.5, 0.5)).toBe(hslToHex(10, 0.5, 0.5))
    expect(hslToHex(-10, 0.5, 0.5)).toBe(hslToHex(350, 0.5, 0.5))
  })
})

describe('hexToRgb', () => {
  it('splits the channels', () => {
    expect(hexToRgb('#7A1028')).toEqual([122, 16, 40])
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @bitetime/frontend exec vitest run src/hsl.test.ts`
Expected: FAIL — `Failed to resolve import "./hsl"`.

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/hsl.ts`:

```ts
/* HSL <-> hex, for the one job in this app that needs a second colour space: deriving a shop's
   whole brand ramp from the single colour its merchant picked (`brandTheme.ts`). Pure and DOM-free,
   like `contrast.ts` next door, so both run in Vitest and in a test that reads tokens.css off disk.

   HSL and not OKLCH, which is the better space and is not worth a dependency here. Every derivation
   in brandTheme holds hue and moves lightness, and HSL holds hue exactly; OKLCH would buy
   perceptual evenness across the ramp, which nothing in this feature measures. */

export interface Hsl {
  /** Degrees, 0–360. */
  h: number
  /** 0–1. */
  s: number
  /** 0–1. */
  l: number
}

const HEX = /^#?(?:([0-9a-f]{3})|([0-9a-f]{6}))$/i

export function hexToRgb(hex: string): [number, number, number] {
  const m = HEX.exec(hex.trim())
  if (!m) throw new Error(`Not a hex colour: ${hex}`)
  const six = m[1] ? m[1].split('').map((c) => c + c).join('') : m[2]
  return [
    parseInt(six.slice(0, 2), 16),
    parseInt(six.slice(2, 4), 16),
    parseInt(six.slice(4, 6), 16),
  ]
}

export function hexToHsl(hex: string): Hsl {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r
    ? ((g - b) / d + (g < b ? 6 : 0))
    : max === g
      ? ((b - r) / d + 2)
      : ((r - g) / d + 4)
  return { h: h * 60, s, l }
}

const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const channel = (v: number): string => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase()

/**
 * Hue wraps and the other two clamp, so a caller can multiply a lightness by a ratio without
 * guarding the result — which is exactly what every step of the brand ramp does.
 */
export function hslToHex(hDeg: number, sRaw: number, lRaw: number): string {
  const h = ((hDeg % 360) + 360) % 360
  const s = clamp(sRaw)
  const l = clamp(lRaw)
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] :
    [c, 0, x]
  return `#${channel(r + m)}${channel(g + m)}${channel(b + m)}`
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @bitetime/frontend exec vitest run src/hsl.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hsl.ts apps/frontend/src/hsl.test.ts
git commit -m "feat(ui): hue-preserving colour maths for the brand ramp"
```

---

### Task 4: The derivation — `brandTheme.ts`

The heart of the feature. Nine values out of one, and a sweep that proves none of them can be illegible.

**Files:**
- Create: `apps/frontend/src/brandTheme.ts`
- Create: `apps/frontend/src/brandTheme.test.ts`

**Interfaces:**
- Consumes: `contrastRatio` from `./contrast`; `hexToHsl`, `hslToHex`, `hexToRgb` from `./hsl`; `normalizeBrandColor`, `PLATFORM_BRAND_COLOR` from `@bitetime/shared`.
- Produces:
  - `interface BrandTheme { tint50; tint100; tint200; light400; accent; accentHover; accentDeep; accentFg; accentText; ring }` — every field `string`
  - `function brandTheme(hex: string | null | undefined, canvas?: string): BrandTheme`
  - `const BRAND_CANVAS = '#F2EAE0'`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/brandTheme.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { contrastRatio } from './contrast'
import { hexToHsl, hslToHex } from './hsl'
import { brandTheme, BRAND_CANVAS } from './brandTheme'

const AA = 4.5

/* Read tokens.css rather than restating its values here: a duplicated table drifts silently, and
   this suite would then pass while the app ships a different canvas. Same reason tokens.test.ts
   reads it. */
const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8')
function token(name: string): string {
  const m = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(css)
  if (!m) throw new Error(`Token not found in tokens.css: ${name}`)
  return m[1].trim()
}

describe('the canvas the derivation measures against', () => {
  it('is the page background tokens.css actually ships', () => {
    expect(BRAND_CANVAS.toUpperCase()).toBe(token('--cream').toUpperCase())
  })
})

describe('a shop that picks the platform colour gets the platform palette', () => {
  const t = brandTheme('#7A1028')
  const near = (got: string, want: string) => {
    const g = [1, 3, 5].map((i) => parseInt(got.slice(i, i + 2), 16))
    const w = [1, 3, 5].map((i) => parseInt(want.slice(i, i + 2), 16))
    const worst = Math.max(...g.map((v, i) => Math.abs(v - w[i])))
    expect(worst, `${got} vs ${want}`).toBeLessThanOrEqual(3)
  }

  it('reproduces every step of the oxblood ramp', () => {
    near(t.tint50, token('--brand-50'))
    near(t.tint100, token('--brand-100'))
    near(t.tint200, token('--brand-200'))
    near(t.light400, token('--brand-400'))
    near(t.accentHover, token('--brand-600'))
    near(t.accentDeep, token('--brand-700'))
  })

  it('keeps the fill exactly as picked', () => {
    expect(t.accent).toBe('#7A1028')
  })

  it('leaves oxblood usable as text without darkening it', () => {
    expect(t.accentText).toBe('#7A1028')
  })

  it('labels an oxblood button white', () => {
    expect(t.accentFg).toBe('#FFFFFF')
  })
})

describe('a missing or malformed colour falls back, never throws', () => {
  const platform = brandTheme('#7A1028')
  it.each([null, undefined, '', '   ', 'rebeccapurple', '#12345', 'rgb(1,2,3)'])(
    'returns the platform theme for %s',
    (input) => {
      expect(brandTheme(input as string | null | undefined)).toEqual(platform)
    },
  )
})

describe('the derived ring quotes the picked colour', () => {
  it('is the fill at 40 percent', () => {
    expect(brandTheme('#7A1028').ring).toBe('rgba(122, 16, 40, 0.40)')
  })
})

/* The property the whole feature rests on. Every colour a merchant can pick, at every one of the
   four places the accent has to stay legible. A single failure here is a storefront somebody
   cannot read. */
describe('no colour a merchant can pick produces unreadable text', () => {
  const samples: string[] = []
  for (let h = 0; h < 360; h += 15) {
    for (let s = 0; s <= 100; s += 10) {
      for (let l = 5; l <= 98; l += 3) samples.push(hslToHex(h, s / 100, l / 100))
    }
  }

  it('sweeps a real range of colours', () => {
    expect(samples.length).toBeGreaterThan(8000)
  })

  it('keeps the label on a filled button legible', () => {
    for (const hex of samples) {
      const t = brandTheme(hex)
      expect(contrastRatio(t.accentFg, t.accent), `${hex} label`).toBeGreaterThanOrEqual(AA)
    }
  })

  it('keeps the accent legible as text on the page', () => {
    for (const hex of samples) {
      const t = brandTheme(hex)
      expect(contrastRatio(t.accentText, BRAND_CANVAS), `${hex} text on page`).toBeGreaterThanOrEqual(AA)
    }
  })

  it('keeps the accent legible as text on its own pale wash', () => {
    for (const hex of samples) {
      const t = brandTheme(hex)
      expect(contrastRatio(t.accentText, t.tint100), `${hex} text on tint`).toBeGreaterThanOrEqual(AA)
    }
  })

  it('keeps the deep step legible on the pale wash, which is its job', () => {
    for (const hex of samples) {
      const t = brandTheme(hex)
      expect(contrastRatio(t.accentDeep, t.tint100), `${hex} deep on tint`).toBeGreaterThanOrEqual(AA)
    }
  })

  it('keeps the ramp going one way, so a hover is never lighter than its fill', () => {
    for (const hex of samples) {
      const t = brandTheme(hex)
      expect(hexToHsl(t.accentHover).l, `${hex} hover`).toBeLessThanOrEqual(hexToHsl(t.accent).l + 1e-9)
      expect(hexToHsl(t.accentDeep).l, `${hex} deep`).toBeLessThanOrEqual(hexToHsl(t.accentHover).l + 1e-9)
      expect(hexToHsl(t.tint50).l).toBeGreaterThan(hexToHsl(t.tint200).l)
    }
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @bitetime/frontend exec vitest run src/brandTheme.test.ts`
Expected: FAIL — `Failed to resolve import "./brandTheme"`.

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/brandTheme.ts`:

```ts
import { contrastRatio } from './contrast'
import { hexToHsl, hslToHex, hexToRgb } from './hsl'
import { normalizeBrandColor, PLATFORM_BRAND_COLOR } from '@bitetime/shared'

/* One colour in, a whole palette out.
 *
 * A merchant picks a single hex. This module turns it into everything the app's accent has to be:
 * the ramp `--brand-*` (which is not decoration -- `bg-brand-100` is the pale wash behind forty-odd
 * elements) and the four roles the accent plays. Pure and DOM-free; `BrandTheme.tsx` is what puts
 * the result on the page.
 *
 * WHY THE ROLES ARE SEPARATE. One value cannot be both a fill and text. Auto-picking the label on a
 * pale-yellow button keeps the button readable and does nothing for a pale-yellow PRICE on a cream
 * page. So `accent` is the fill exactly as picked, and `accentText` is the same hue walked dark
 * enough to read. A shop that picks yellow gets yellow buttons and dark-amber prices, which is one
 * brand and two legible things.
 *
 * EVERY FIGURE BELOW IS MEASURED off the oxblood ramp the app already ships, so `brandTheme
 * ('#7A1028')` returns today's palette to within 3/255 per channel. Change one and that test fails,
 * which is the intent: these are not taste, they are the shape of the existing ramp.
 */

export interface BrandTheme {
  /** `--brand-50`. */
  tint50: string
  /** `--brand-100`, the pale wash. */
  tint100: string
  /** `--brand-200`. */
  tint200: string
  /** `--brand-400`, the dark-theme accent. Derived for completeness; no dark UI ships. */
  light400: string
  /** `--brand-500` and `--color-accent`: fills, exactly as the merchant picked. */
  accent: string
  /** `--brand-600` and `--color-accent-hover`. */
  accentHover: string
  /** `--brand-700`. Has a TEXT job (`text-brand-700` on `bg-brand-100`), hence the contrast walk. */
  accentDeep: string
  /** Text ON a fill. White, near-black, or black. */
  accentFg: string
  /** The accent used AS text, on the page and on the pale wash. */
  accentText: string
  /** The focus ring's colour: the fill at 40 percent. */
  ring: string
}

/** The page background, `--cream` in tokens.css. Pinned to that file by brandTheme.test.ts. */
export const BRAND_CANVAS = '#F2EAE0'

const AA = 4.5
const WHITE = '#FFFFFF'
const INK_950 = '#09090B'
const INK_900 = '#18181B'
/* Pure black is a real candidate, not a tidy third option. A band of mid-tone fills (#CB4D4D is
   one) leaves BOTH white and --ink-950 at about 4.46:1, just under the floor, because --ink-950 is
   #09090B and not black. Over all of sRGB the worst case for the better of white-or-black is
   4.58:1, so with black in the list no fill can defeat the rule. */
const BLACK = '#000000'

/* Lightness is absolute for the tints -- a wash has to land at a known lightness or it stops being
   a wash. Saturation is a RATIO of the picked colour's: the oxblood tints are about half as
   saturated as the accent, and copying that as a constant would hand a grey-picking shop saturated
   pink washes. */
const TINTS = [
  { key: 'tint50', s: 1.00, l: 0.967 },
  { key: 'tint100', s: 0.56, l: 0.931 },
  { key: 'tint200', s: 0.56, l: 0.863 },
  { key: 'light400', s: 0.70, l: 0.635 },
] as const

/* The deeper steps are ratios of the picked lightness, not absolutes: a shadow has to stay relative
   to the colour it shadows, or a dark pick would produce a 600 lighter than its own 500. */
const HOVER = { s: 1.03, l: 0.688 }
const DEEP = { s: 1.04, l: 0.507 }

/**
 * The lightest colour of this hue that clears AA on EVERY surface given, starting no lighter than
 * `startL`. Binary search, because contrast against a light surface rises monotonically as the
 * candidate darkens — so the boundary is findable and the lightest passing value is the one that
 * still looks like the brand.
 */
function darkenUntilLegible(h: number, s: number, startL: number, surfaces: string[]): string {
  const clears = (candidate: string): boolean => surfaces.every((sf) => contrastRatio(candidate, sf) >= AA)
  const start = hslToHex(h, s, startL)
  if (clears(start)) return start
  let lo = 0
  let hi = startL
  let best: string | null = null
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    const candidate = hslToHex(h, s, mid)
    if (clears(candidate)) {
      best = candidate
      lo = mid
    } else {
      hi = mid
    }
  }
  // Nothing of this hue works. Ink, rather than a colour that cannot be read.
  return best ?? INK_900
}

function derive(hex: string, canvas: string): BrandTheme {
  const picked = normalizeBrandColor(hex)
  if (!picked.ok || picked.value === null) throw new Error(`Not a brand colour: ${hex}`)
  const accent = picked.value
  const { h, s, l } = hexToHsl(accent)

  const tints = Object.fromEntries(
    TINTS.map((t) => [t.key, hslToHex(h, s * t.s, t.l)]),
  ) as Record<(typeof TINTS)[number]['key'], string>

  const accentHover = hslToHex(h, s * HOVER.s, l * HOVER.l)
  const accentDeep = darkenUntilLegible(h, s * DEEP.s, l * DEEP.l, [tints.tint100])

  const candidates = [WHITE, INK_950, BLACK]
  const accentFg = candidates.find((c) => contrastRatio(c, accent) >= AA)
    ?? candidates.reduce((a, b) => (contrastRatio(a, accent) >= contrastRatio(b, accent) ? a : b))

  /* Both surfaces, not just the page: `bg-brand-100` is LIGHTER than cream and is where the
     storefront puts most of its accent text. Searching against the canvas alone leaves a band of
     blues and violets sitting at 4.3:1 on the wash. */
  const accentText = darkenUntilLegible(h, s, l, [canvas, tints.tint100])

  const [r, g, b] = hexToRgb(accent)

  return {
    ...tints,
    accent,
    accentHover,
    accentDeep,
    accentFg,
    accentText,
    ring: `rgba(${r}, ${g}, ${b}, 0.40)`,
  }
}

/**
 * The theme for one shop's colour. A null, an absent value or anything unreadable returns the
 * platform theme — a bad column value must degrade to TinyOrder's colours, never to a throw inside
 * a render.
 */
export function brandTheme(hex: string | null | undefined, canvas: string = BRAND_CANVAS): BrandTheme {
  try {
    if (!hex) throw new Error('no brand colour')
    return derive(hex, canvas)
  } catch {
    return derive(PLATFORM_BRAND_COLOR, canvas)
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @bitetime/frontend exec vitest run src/brandTheme.test.ts`
Expected: PASS. The sweep runs about 8,400 colours per assertion; the file takes a few seconds.

If the ramp-reproduction test fails by more than 3/255, do **not** widen the tolerance — the ratios in `TINTS`/`HOVER`/`DEEP` are what reproduce the shipped ramp, and a drift means one of them was mistyped.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/brandTheme.ts apps/frontend/src/brandTheme.test.ts
git commit -m "feat(ui): derive a legible palette from one picked colour"
```

---

### Task 5: Applying the theme — the wrapper, the scoped rule, and the button fix

Three changes that only work together: the wrapper that writes the variables, the CSS rule that lets fill and text differ, and the button that must stop labelling itself with the page colour.

**Files:**
- Create: `apps/frontend/src/components/BrandTheme.tsx`
- Create: `apps/frontend/src/brandScope.test.ts`
- Modify: `apps/frontend/src/index.css` (one rule, at the end)
- Modify: `apps/frontend/src/components/ui/button.tsx:20`

**Interfaces:**
- Consumes: `brandTheme`, `BRAND_CANVAS` from `../brandTheme` (Task 4).
- Produces: `export default function BrandTheme({ color, children }: { color: string | null | undefined; children: ReactNode })`

- [ ] **Step 1: Write the failing invariant test**

Create `apps/frontend/src/brandScope.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/* The scoped brand rule in index.css redefines `text-primary` inside a branded subtree, so that the
   accent can be one colour as a FILL and a darker one as TEXT. That trick is only sound while the
   two roles never meet on one element, and while nothing reaches the accent by a route the rule
   cannot see. Both are facts about the source, so both are checked against the source. */

const root = fileURLToPath(new URL('.', import.meta.url))
const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ path: f, text: readFileSync(new URL(f, new URL('.', import.meta.url)), 'utf8') }))

/** Every string that looks like a class list: className="…" and the strings inside cn(…). */
function classStrings(text: string): string[] {
  return [...text.matchAll(/["'`]([^"'`]*?(?:bg-primary|text-primary|text-background)[^"'`]*?)["'`]/g)]
    .map((m) => m[1])
}

const has = (s: string, cls: string) => new RegExp(`(^|\\s)${cls}(\\s|$|/)`).test(s)

describe('the fill role and the text role never meet on one element', () => {
  it('finds the .tsx sources at all', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('has no element that is both filled with the accent and lettered in it', () => {
    const offenders: string[] = []
    for (const f of files) {
      for (const s of classStrings(f.text)) {
        if (has(s, 'bg-primary') && has(s, 'text-primary')) offenders.push(`${f.path}: ${s}`)
      }
    }
    expect(offenders).toEqual([])
  })

  // A fill labelled with the PAGE colour is the bug that made the computed on-fill colour
  // unreachable: cream on oxblood reads fine and cream on pale yellow does not.
  it('has no element filled with the accent and labelled with the page colour', () => {
    const offenders: string[] = []
    for (const f of files) {
      for (const s of classStrings(f.text)) {
        if (has(s, 'bg-primary') && has(s, 'text-background')) offenders.push(`${f.path}: ${s}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('nothing escapes the scoped rule through an arbitrary value', () => {
  it('reaches the accent through utilities only', () => {
    const offenders: string[] = []
    for (const f of files) {
      const m = f.text.match(/\[var\(--(?:primary|color-accent|brand-500|color-brand-500)\)\]/g)
      if (m) offenders.push(`${f.path}: ${m.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test and watch the button case fail**

Run: `pnpm --filter @bitetime/frontend exec vitest run src/brandScope.test.ts`
Expected: FAIL on "has no element filled with the accent and labelled with the page colour", naming `components/ui/button.tsx`. The other two should already pass.

- [ ] **Step 3: Fix the button**

In `apps/frontend/src/components/ui/button.tsx`, line 20, change the default variant:

```
-          "bg-primary text-background hover:bg-brand-600 disabled:bg-disabled-bg",
+          "bg-primary text-primary-foreground hover:bg-brand-600 disabled:bg-disabled-bg",
```

This is a real visual change on every primary button in the app: the label goes from cream (`--color-bg`) to white (`--primary-foreground`). It makes the token's own comment in `index.css` true — that comment says white was chosen over cream deliberately, while the button has been shipping cream. It is also what lets a shop's computed on-fill colour reach the one element it exists for.

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @bitetime/frontend exec vitest run src/brandScope.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the scoped rule to index.css**

Append to the end of `apps/frontend/src/index.css`:

```css
/* ── A shop's own accent, scoped ────────────────────────────────────────────────────────────────
   `BrandTheme.tsx` writes a shop's derived palette onto a wrapper as custom properties. That
   handles every FILL, because `bg-primary` and `bg-brand-*` resolve their var at the element.

   Text is the one role a variable cannot carry, because `--primary` backs `bg-primary` (77 uses)
   AND `text-primary` (202). Set it to the picked colour and a pale accent is invisible as text; set
   it to the darkened one and every button is dull. Retargeting one of those two sets to a new
   utility is a 200-site sweep across surfaces this feature does not even brand.

   So the roles split by SCOPE instead: inside a branded subtree, `text-primary` means the darkened
   variant. The rule is unlayered, so it beats Tailwind's layered utility regardless of order, and
   it is inert everywhere the wrapper is absent -- which is what keeps the marketing pages, /admin
   and the auth screens on the platform accent by construction rather than by an opt-out list. */
[data-brand] .text-primary {
  color: var(--color-accent-text);
}
```

- [ ] **Step 6: Write the wrapper component**

Create `apps/frontend/src/components/BrandTheme.tsx`:

```tsx
import type { CSSProperties, ReactNode } from 'react'
import { brandTheme } from '../brandTheme'

/**
 * Puts one shop's derived palette on a subtree.
 *
 * THE OVERRIDE SET IS THE WHOLE POINT, and it is longer than it looks like it should be.
 * `index.css` declares `--primary: var(--color-accent)` on `:root`, and `var()` is substituted
 * where the declaration lives — so descendants inherit an already-resolved oxblood, and overriding
 * `--color-accent` alone changes NOTHING about `--primary`, `--ring` or `--focus-ring`. The result
 * of getting this wrong is a half-branded page that looks like a caching bug. Every token that
 * carries the accent has to be restated here.
 *
 * The whole `--color-brand-*` ramp is included because `bg-brand-100` is the app's pale wash and
 * has forty-odd call sites, twelve of them on branded surfaces. Note that a test walking the CSS
 * for "what references --brand-500" would NOT find them: `--color-brand-100` derives from
 * `--brand-100`, which references nothing. They are here on the evidence of the call sites.
 *
 * `display: contents` so the wrapper adds no box and cannot disturb any layout it wraps.
 */
export default function BrandTheme({ color, children }: {
  /** `merchants.brand_color`. Null, absent or malformed all give the platform palette. */
  color: string | null | undefined
  children: ReactNode
}) {
  const t = brandTheme(color)
  const style = {
    display: 'contents',
    // Semantic accent tokens.
    '--color-accent': t.accent,
    '--color-accent-hover': t.accentHover,
    '--color-accent-fg': t.accentFg,
    '--color-accent-text': t.accentText,
    '--color-focus-ring': t.ring,
    // tokens.css builds this at :root as `0 0 0 2px var(--color-focus-ring)`, already substituted
    // by the time it inherits — so the whole box-shadow is rebuilt, not just its colour.
    '--focus-ring': `0 0 0 2px ${t.ring}`,
    // The ramp, reaching Tailwind as bg-brand-*, text-brand-*, hover:bg-brand-*.
    '--color-brand-50': t.tint50,
    '--color-brand-100': t.tint100,
    '--color-brand-200': t.tint200,
    '--color-brand-400': t.light400,
    '--color-brand-500': t.accent,
    '--color-brand-600': t.accentHover,
    '--color-brand-700': t.accentDeep,
    // The shadcn bridge, which :root already resolved.
    '--primary': t.accent,
    '--primary-foreground': t.accentFg,
    '--ring': t.accent,
  } as CSSProperties
  return <div data-brand="" style={style}>{children}</div>
}
```

- [ ] **Step 7: Pin the override set against the stylesheets**

The set is only correct until somebody adds a token that derives from the accent. Append to `apps/frontend/src/brandScope.test.ts`:

```ts
/* Whatever the wrapper does NOT restate keeps the platform colour, because `var()` substitutes at
   the declaration and `:root` has already resolved it. So a token added later that derives from the
   accent would ship half-branded and look like a caching bug. This walks the stylesheets and fails
   the build instead. */
describe('the override set covers every token that carries the accent', () => {
  const read = (name: string) =>
    readFileSync(fileURLToPath(new URL(name, new URL('.', import.meta.url))), 'utf8')
  const css = `${read('tokens.css')}\n${read('index.css')}`
  const wrapper = read('components/BrandTheme.tsx')

  /** Every custom property the stylesheets declare, and the custom properties its value reads. */
  const refs = new Map<string, Set<string>>()
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const used = [...m[2].matchAll(/var\((--[\w-]+)/g)].map((v) => v[1])
    const set = refs.get(m[1]) ?? new Set<string>()
    used.forEach((u) => set.add(u))
    refs.set(m[1], set)
  }

  /** Everything reachable from the accent by "this token's value reads that token". */
  const closure = new Set(['--brand-500', '--color-accent'])
  for (let changed = true; changed;) {
    changed = false
    for (const [name, used] of refs) {
      if (closure.has(name)) continue
      if ([...used].some((u) => closure.has(u))) { closure.add(name); changed = true }
    }
  }

  // The raw primitives are excluded: `--color-accent: var(--brand-500)` is resolved at :root, so
  // overriding `--brand-500` further down changes nothing and the wrapper rightly ignores it.
  const required = [...closure].filter((n) => !/^--brand-\d+$/.test(n)).sort()
  const declared = new Set([...wrapper.matchAll(/'(--[\w-]+)'\s*:/g)].map((m) => m[1]))

  it('finds a closure worth checking', () => {
    expect(required.length).toBeGreaterThan(2)
  })

  it('restates every one of them', () => {
    expect(required.filter((n) => !declared.has(n))).toEqual([])
  })
})
```

Run: `pnpm --filter @bitetime/frontend exec vitest run src/brandScope.test.ts`
Expected: PASS, 7 tests. If "restates every one of them" names a token, add it to the object in `BrandTheme.tsx` with the right value from the theme — do not delete the assertion.

- [ ] **Step 8: Typecheck and lint**

Run: `pnpm --filter @bitetime/frontend typecheck && pnpm --filter @bitetime/frontend lint`
Expected: no output, exit 0.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/components/BrandTheme.tsx apps/frontend/src/brandScope.test.ts apps/frontend/src/index.css apps/frontend/src/components/ui/button.tsx
git commit -m "feat(ui): a wrapper that puts one shop's palette on a subtree"
```

---

### Task 6: Mounting it on the two branded surfaces

**Files:**
- Modify: `apps/frontend/src/AppRouter.tsx` (import; wrap the `StorefrontShell` return at line ~105)
- Modify: `apps/frontend/src/merchant/Dashboard.tsx` (import; wrap `DashboardShell` at line ~96)

**Interfaces:**
- Consumes: `BrandTheme` from Task 5.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Wrap the storefront**

In `apps/frontend/src/AppRouter.tsx`, add the import beside the other component imports:

```ts
import BrandTheme from './components/BrandTheme'
```

Then wrap the final return of `StorefrontShell`. It currently returns `<ShopPixelsProvider merchant={merchant}>…</ShopPixelsProvider>`; wrap that whole element:

```tsx
  return (
    // The shop's own colour, and only below the not-found and status gates: a merchant row is in
    // hand here, and the shell renders a spinner until it is, so nothing flashes the platform
    // accent first. Everything under /s/:slug is inside this — menu, checkout, order history.
    <BrandTheme color={merchant.brand_color}>
      <ShopPixelsProvider merchant={merchant}>
        <Routes>
          <Route index element={<Storefront />} />
          {/* A destination, not a dialog: deep-linkable and shareable. Signed out it renders the
              auth panel in place — deliberately NOT behind RequireRole, which bounces to the
              merchant login: wrong framing, wrong bundle, wrong destination for a customer. */}
          <Route path="orders" element={<OrderHistory />} />
        </Routes>
      </ShopPixelsProvider>
    </BrandTheme>
  )
```

Leave the not-found and suspended branches unwrapped — a shop that cannot be resolved has no colour, and a closed shop's notice is the platform speaking.

- [ ] **Step 2: Wrap the dashboard**

In `apps/frontend/src/merchant/Dashboard.tsx`, add the import:

```ts
import BrandTheme from '../components/BrandTheme'
```

Then wrap `DashboardShell`, inside `UpgradeNavProvider`:

```tsx
    <UpgradeNavProvider navigate={goToSettingsTab}>
    <BrandTheme color={merchant!.brand_color}>
    <DashboardShell
      ...
    </DashboardShell>
    </BrandTheme>
    </UpgradeNavProvider>
```

`merchant` here is `SessionContext`'s active shop — the impersonated one where a superadmin is viewing as a shop, otherwise the user's own. That is the wanted behaviour: an admin looking at a shop should see that shop's colours.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bitetime/frontend typecheck`
Expected: no output, exit 0.

- [ ] **Step 4: Confirm nothing else picked up the theme**

Run: `grep -rn "BrandTheme" apps/frontend/src --include="*.tsx"`
Expected: exactly three files — `components/BrandTheme.tsx`, `AppRouter.tsx`, `merchant/Dashboard.tsx`. `admin/AdminHome.tsx` must NOT appear.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/AppRouter.tsx apps/frontend/src/merchant/Dashboard.tsx
git commit -m "feat(ui): the storefront and the dashboard wear the shop's colour"
```

---

### Task 7: The picker

**Files:**
- Create: `apps/frontend/src/merchant/BrandColourCard.tsx`
- Modify: `apps/frontend/src/merchant/StorefrontArranger.tsx` (import; mount in both return branches)

**Interfaces:**
- Consumes: `normalizeBrandColor` from `@bitetime/shared`; `BrandTheme` from `../components/BrandTheme`; `updateMerchantConfig` from `../store`; `useSaved` from `./useSaved`.
- Produces: `export default function BrandColourCard({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void })`

- [ ] **Step 1: Write the card**

Create `apps/frontend/src/merchant/BrandColourCard.tsx`:

```tsx
import { useState } from 'react'
import { toast } from 'sonner'
import { normalizeBrandColor, PLATFORM_BRAND_COLOR } from '@bitetime/shared'
import { useSession } from '../SessionContext'
import { updateMerchantConfig } from '../store'
import BrandTheme from '../components/BrandTheme'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { useSaved } from './useSaved'
import { cn } from '@/lib/utils'

/**
 * The one colour a merchant picks for their shop.
 *
 * ON THE STOREFRONT TAB, next to the description card, for the reason written there: Shop Settings
 * is where a merchant looks for a FACT about the shop — the address, the currency, the tax rate.
 * This is what the customer sees, so it belongs beside the menu preview.
 *
 * ITS OWN Save, and the dirty flag reported UP rather than registered with NavGuard — the guard
 * holds exactly one blocker, and this screen already has two cards that can each be dirty.
 * `onDirtyChange` must be stable across renders; `useSaved` reports through an effect listing it.
 *
 * NO CONTRAST WARNING, deliberately. `brandTheme` makes every possible choice legible, so a warning
 * would either never appear or would be scolding the merchant about a problem already solved.
 */

/* Eight starting points, each a distinct hue at a lightness that works as a fill. They exist so a
   merchant with no hex code in hand still lands somewhere deliberate; the field beside them is for
   a shop that knows its own colour. */
const SWATCHES: { hex: string; name: [string, string] }[] = [
  { hex: PLATFORM_BRAND_COLOR, name: ['Oxblood', '酒红'] },
  { hex: '#C2410C', name: ['Ember', '炭橙'] },
  { hex: '#B45309', name: ['Amber', '琥珀'] },
  { hex: '#1F5C3D', name: ['Forest', '森绿'] },
  { hex: '#0F6E6E', name: ['Teal', '青蓝'] },
  { hex: '#1E4E8C', name: ['Navy', '深蓝'] },
  { hex: '#6D28D9', name: ['Violet', '紫罗兰'] },
  { hex: '#3F3F46', name: ['Graphite', '石墨'] },
]

export default function BrandColourCard({ onDirtyChange }: {
  onDirtyChange: (dirty: boolean) => void
}) {
  const { t, merchant, refreshMerchant } = useSession()
  const merchantId = merchant!.id

  // Seeded once, like the description card: this screen calls refreshMerchant after every save,
  // and re-seeding on that would throw away whatever the merchant has been typing.
  const [text, setText] = useState<string>(merchant?.brand_color ?? '')
  const [saving, setSaving] = useState(false)

  const parsed = normalizeBrandColor(text)
  // What would be stored. Null means the platform colour, which is a valid choice, not an error.
  const pending = parsed.ok ? parsed.value : null
  const invalid = !parsed.ok

  const { dirty, commit } = useSaved(
    merchant?.brand_color ?? null,
    pending,
    (a, b) => a === b,
    onDirtyChange,
  )

  async function save() {
    if (invalid) return
    setSaving(true)
    const r = await updateMerchantConfig(merchantId, { brand_color: pending })
    setSaving(false)
    if (!r.ok) {
      toast.error(r.error.message || t('Could not save the colour', '无法保存颜色'))
      return
    }
    await refreshMerchant()
    // Committed from what the write ANSWERED with: the endpoint normalises (it uppercases, and it
    // expands the three-digit form), so committing what was typed would leave the card dirty for
    // ever, offering to save a change the shop already has.
    const applied = (r.data?.brand_color ?? null) as string | null
    setText(applied ?? '')
    commit(applied)
    toast.success(t('Colour saved', '颜色已保存'))
  }

  return (
    <div className="bg-card border-[0.5px] border-border rounded-2xl p-5 mb-8 w-full box-border">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="font-heading text-[15px] font-medium text-primary">
          {t('Brand colour', '品牌颜色')}
        </h3>
        <Button
          type="button" size="none"
          className="rounded-lg py-[6px] px-[14px] text-[13px] whitespace-nowrap"
          onClick={save}
          disabled={!dirty || saving || invalid}
        >
          {saving ? t('Saving…', '保存中…') : t('Save', '保存')}
        </Button>
      </div>

      <p className="text-[12px] text-muted-foreground leading-[1.6] mb-4 max-w-[560px]">
        {t('One colour for your storefront and this dashboard. Buttons, prices and highlights use it. Text stays readable whichever colour you pick.',
           '为您的店面和此后台设置一种颜色。按钮、价格和重点内容会使用它。无论选哪种颜色，文字都清晰可读。')}
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {SWATCHES.map(s => (
          <button
            key={s.hex}
            type="button"
            onClick={() => setText(s.hex)}
            aria-label={t(s.name[0], s.name[1])}
            aria-pressed={pending === s.hex}
            title={t(s.name[0], s.name[1])}
            className={cn(
              'size-8 rounded-full border transition-shadow',
              pending === s.hex ? 'border-foreground shadow-elev-1' : 'border-border',
            )}
            style={{ backgroundColor: s.hex }}
          />
        ))}
      </div>

      <div className="flex flex-col gap-1 max-w-[220px] mb-4">
        <Label htmlFor="brand-colour-hex">{t('Colour code', '颜色代码')}</Label>
        <Input
          id="brand-colour-hex"
          value={text}
          placeholder={PLATFORM_BRAND_COLOR}
          spellCheck={false}
          onChange={e => setText(e.target.value.toUpperCase())}
          aria-invalid={invalid}
        />
        {invalid ? (
          <p className="text-[11px] text-danger-fg leading-[1.5]">
            {t('Use a colour code like #7A1028.', '请输入类似 #7A1028 的颜色代码。')}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground leading-[1.5]">
            {pending
              ? t('Leave it empty to go back to the default colour.', '留空可恢复默认颜色。')
              : t('Empty: your shop uses the default colour.', '留空：您的店铺使用默认颜色。')}
          </p>
        )}
      </div>

      {/* The preview renders inside the SAME component the storefront mounts, fed the pending
          value — so what the merchant sees here cannot drift from what the customer gets. */}
      <BrandTheme color={pending}>
        <div className="rounded-xl border border-border bg-brand-100 p-4 flex flex-wrap items-center gap-3">
          <Button type="button" size="none" className="rounded-lg py-[6px] px-[14px] text-[13px]">
            {t('Add to cart', '加入购物车')}
          </Button>
          <span className="text-[15px] font-medium text-primary">RM 12.00</span>
          <span className="text-[11px] font-medium text-primary uppercase tracking-[0.09em]">
            {t('Menu', '菜单')}
          </span>
        </div>
      </BrandTheme>
    </div>
  )
}
```

- [ ] **Step 2: Mount it beside the description card**

In `apps/frontend/src/merchant/StorefrontArranger.tsx`, add the import beside the `ShopDescriptionCard` one:

```ts
import BrandColourCard from './BrandColourCard'
```

Add a second dirty flag. At line 60, below the existing state:

```
   const [descriptionDirty, setDescriptionDirty] = useState(false)
+  const [colourDirty, setColourDirty] = useState(false)
```

Fold it into the screen's combined dirty flag at line 85, so a half-picked colour warns on navigation exactly as a half-typed description does:

```
-  const dirty = arrangementDirty || descriptionDirty
+  const dirty = arrangementDirty || descriptionDirty || colourDirty
```

Then render the card in **both** return branches — the loading branch at line ~215 and the loaded one at line ~229 — directly after each `<ShopDescriptionCard onDirtyChange={setDescriptionDirty} />`:

```tsx
      <BrandColourCard onDirtyChange={setColourDirty} />
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter @bitetime/frontend typecheck && pnpm --filter @bitetime/frontend lint`
Expected: no output, exit 0.

- [ ] **Step 4: Run the whole frontend suite**

Run: `pnpm --filter @bitetime/frontend test`
Expected: PASS. `brandScope.test.ts` now also scans this new file; if it reports the preview strip, a class list in it combined two accent roles and must be split.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/merchant/BrandColourCard.tsx apps/frontend/src/merchant/StorefrontArranger.tsx
git commit -m "feat(merchant): a merchant picks their shop's colour"
```

---

### Task 8: Run it, then document it

**Files:**
- Modify: `CLAUDE.md` (a short subsection under Architecture)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Run the full check**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all four pass. `pnpm build` includes the prerender, which must still succeed — no branded route is prerendered, so nothing there should change.

- [ ] **Step 2: Run the app and verify it by hand**

Start the app (`pnpm dev`, plus `supabase start` from `apps/backend` if the local stack is down). Then, per CLAUDE.md, verify the UI by using it:

1. Sign in as a merchant. Go to the dashboard's **Storefront** section. The Brand colour card is under the shop description.
2. Pick **Teal**. The preview strip turns teal — the button fill, the price, and the wash behind them.
3. Save. The dashboard itself turns teal: the sidebar's active item, the card headings, every primary button.
4. Open the shop's storefront at `/s/<slug>`. Check the shop name, the `MENU` label, prices, the Add-to-cart buttons, a selected date in the fulfilment picker, and the address autocomplete's highlighted row.
5. Add an item, go through checkout to the success screen. Check the order-number panel and the totals.
6. Type `#F5D90A` (a pale yellow) in the field and save. The buttons are yellow with **dark** labels; prices are dark amber, not yellow. Nothing on either screen is hard to read.
7. Clear the field and save. Everything returns to oxblood.
8. Open `/`, `/pricing`, `/merchant/login` and `/admin/merchants`. All still oxblood.
9. Keyboard-tab through the storefront's form. The focus ring is the shop's colour, not oxblood.

If step 3 or 4 shows a mix of the shop's colour and oxblood on one screen, a token that carries the accent is missing from the override set in `BrandTheme.tsx` — find it with the browser's computed-styles panel on the element that stayed oxblood.

- [ ] **Step 3: Document the trap in CLAUDE.md**

Add to `CLAUDE.md`, at the end of the **Localisation** section (before **Deployment**):

```markdown
### Per-shop brand colour

A shop's accent is `merchants.brand_color` (a hex, null for the platform oxblood). One pure module,
`src/brandTheme.ts`, derives nine values from it — the whole `--brand-*` ramp plus the fill, its
hover, the text ON a fill and the accent AS text — walking lightness in HSL until each clears AA.
`src/brandTheme.test.ts` sweeps ~8,400 colours to prove no choice can be illegible, and pins
`#7A1028` to the ramp `tokens.css` already ships.

`components/BrandTheme.tsx` applies it, and **it must restate every token that carries the accent,
not just `--color-accent`**: `index.css` declares `--primary: var(--color-accent)` on `:root`, and
`var()` substitutes where the declaration lives, so a descendant override of `--color-accent` leaves
`--primary`, `--ring` and `--focus-ring` oxblood. The whole `--color-brand-*` ramp is in the set too
— `bg-brand-100` is the app's pale wash, with forty-odd call sites.

`--primary` backs both `bg-primary` and `text-primary`, which the fill and text roles cannot share,
so `[data-brand] .text-primary` in `index.css` redefines the text role inside a branded subtree
only. `src/brandScope.test.ts` pins the two facts that make that sound: no element carries both
classes, and nothing reaches the accent through an arbitrary `[var(--…)]`.

Mounted in exactly two places — `StorefrontShell` in `AppRouter.tsx` and `Dashboard.tsx`. Marketing,
`/admin` and the auth screens stay platform-coloured because no wrapper is above them.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: how a shop's colour reaches the page, and what breaks it"
```

- [ ] **Step 5: Say what production still needs**

The migration `20260824120000_merchant_brand_colour.sql` is applied locally only. Report that production needs `db:push` from a human before the dashboard's Brand colour card can save there — without the column, PostgREST answers `Could not find the 'brand_color' column ... in the schema cache`.
