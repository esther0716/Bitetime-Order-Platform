# Merchant brand colour — one accent, and it can never be unreadable

Date: 2026-08-24
No issue yet. Brainstormed directly; file one before implementation starts.

## Problem

Every shop on the platform is oxblood. `--brand-500: #7A1028` is TinyOrder's accent, it is fixed by
a comment in `tokens.css` that says so, and it reaches every storefront through the semantic layer:
the Add-to-cart button, the price, the shop name, the section labels, the focus ring. A bakery whose
logo is forest green and a bubble-tea shop whose logo is lilac hand their customers the same dark
red page, and the only thing on it that is theirs is the name at the top.

The tokens are already built for this. Product code consumes semantics (`text-primary`, `bg-card`,
`--color-accent`), not primitives, so the accent has exactly one meaning and one place it enters
from. What is missing is a per-shop value and a safe way to derive the rest from it.

## Goal

A merchant picks one colour. Their storefront, and their own dashboard, wear it. The result clears
WCAG AA no matter which colour they pick, without the merchant being asked to think about contrast.

## Non-goals

- **A palette.** One accent, not a background, not a surface, not a text colour, not a tinted wash.
  `--color-bg` stays cream, `--color-bg-surface` stays white, the ink ramp is untouched. See
  *One colour, four roles*.
- **Logos, banners, fonts, layout.** This feature is a colour. Nothing else about a storefront's
  appearance moves.
- **The invoice.** Neither the lookup page nor the PDF. See *Deferred: the invoice*.
- **Marketing, admin, auth screens.** `/`, `/pricing`, `/admin`, `/merchant/login`,
  `/merchant/signup`, `/reset-password` stay platform oxblood. TinyOrder keeps its own identity on
  the pages that are TinyOrder's.
- **A plan gate.** There is one plan. Every shop gets this.
- **Dark theme.** `tokens.css`'s `.dark` block is unverified and unshipped; this feature does not
  change that, and derives against the light canvas only.

## One colour, four roles

The merchant picks one hex. Four values come out of it, because the accent does four jobs and a
single value cannot do them all legibly:

| Role | Token | Rule |
|------|-------|------|
| Fill | `--color-accent` | the picked colour, unchanged |
| Fill, hover | `--color-accent-hover` | fixed step darker (HSL L × 0.82) |
| Text **on** a fill | `--color-accent-fg` | white or `--ink-950`, whichever clears 4.5:1 |
| The accent **as** text | `--color-accent-text` | picked hue, walked darker until 4.5:1 on the canvas |

`--color-accent-fg` and `--color-accent-text` are new tokens; the first two already exist.

The split between the last two is the whole design. Auto-flipping the foreground keeps a pale-yellow
button legible; it does nothing for a pale-yellow *price* on a cream page. A shop that picks yellow
gets yellow buttons with dark labels and dark-amber prices — one brand, both readable.

`--color-accent-hover` is deliberately **not** contrast-derived. Hover is a state cue, not a
legibility requirement, and deriving it against a threshold makes it jump discontinuously between
neighbouring hues: two shops with near-identical greens would get visibly different hover states.

## Data

One nullable column:

```sql
alter table merchants add column if not exists brand_color text;
```

Null means the platform default, and **null is what "reset" writes** — not oxblood's hex. A shop
that never chose must stay a shop that never chose, so that a future change to the default reaches
it. A row holding `#7A1028` is a shop that deliberately picked oxblood.

`types.ts` gains `brand_color?: string | null`, documented the way `tax_rate` and `product_categories`
are: read it through `brandTheme()`, never directly.

### Write path

`brand_color` joins `MERCHANT_CONFIG_FIELDS` in `apps/backend/src/writes.ts`, validated in
`pickMerchantConfig` alongside `tax_rate` and `payment_qr`:

- `null` and `''` both mean reset, and both store `null` — matching how `payment_qr` and
  `description` already read a cleared field.
- Anything else must match `/^#[0-9A-Fa-f]{6}$/` after normalising a three-digit form, and is
  **refused with a 400**, never coerced or silently dropped. The reason is the one already written
  into that file for the tax rate: a value that fails to save while the merchant sees a success
  toast is worse than an error. It is also why validation cannot live only in the picker — the
  route is public, and the picker is not the only possible caller.

Nothing else server-side reads the column. The storefront is not server-rendered and not
prerendered, so no derivation happens on the backend and no value is persisted that could drift
from the rule that produced it.

## The derivation module

`apps/frontend/src/brandTheme.ts` — pure, DOM-free, next to `contrast.ts` and importing it, so it
runs in Vitest the same way the token test does.

```ts
export interface BrandTheme {
  accent: string       // fills
  accentHover: string  // fills, hover/pressed
  accentFg: string     // text on a fill
  accentText: string   // the accent used as text
  ring: string         // rgba(picked, .40)
}

export function brandTheme(hex: string | null | undefined, canvas: string): BrandTheme
```

Rules, each one a test:

**Null or malformed returns the platform set verbatim.** `contrast.ts`'s `parseHex` throws on a bad
input; `brandTheme` catches at its own boundary. A junk column value degrades to TinyOrder's
colours, never to a blank screen.

**`accentFg` is a choice between two candidates.** White and `--ink-950`; take the first that clears
4.5:1 against the fill. Where a mid-tone leaves both below the floor, take the higher ratio. At that
point nothing clears AA and best-available is the honest answer — refusing would hand the merchant a
problem with no action attached to it.

**`accentText` is a search.** Hold hue and saturation, binary-search lightness downward in HSL until
`contrastRatio(candidate, canvas) >= 4.5`. If black itself fails the canvas, return `--ink-900` and
stop. HSL rather than OKLCH: no new dependency, and hue is preserved exactly, which is the property
that makes the darkened text still read as the same brand.

**`canvas` is a parameter, not a constant.** The module measures against the surface it is told
about, the way `priceOrder` takes rates rather than reading them. The storefront passes cream; a
caller on a different surface passes that.

### Test

`brandTheme.test.ts` sweeps hues across the full lightness range and asserts, for every input, that
`accentFg` clears 4.5:1 on `accent` and `accentText` clears 4.5:1 on the canvas. That sweep is what
makes "a merchant cannot ship an unreadable storefront" a checked property rather than a claim.

## Applying it

### The trap

`index.css` declares `--primary: var(--color-accent)` **on `:root`**. `var()` substitutes where the
declaration lives, so descendants inherit an already-resolved oxblood. Overriding `--color-accent`
on a wrapper element changes nothing about `--primary`, `--ring` or `--focus-ring`, and the result
is a half-branded storefront that looks like a caching bug.

So the wrapper sets the whole **override set**, not one variable:

```
--color-accent, --color-accent-hover, --color-accent-fg, --color-accent-text,
--color-focus-ring, --focus-ring,
--color-brand-400, --color-brand-500, --color-brand-600,
--primary, --primary-foreground, --ring
```

`--focus-ring` is in the set because `tokens.css` builds it at `:root` as
`0 0 0 2px var(--color-focus-ring)` — already substituted by the time it inherits, so the wrapper
rebuilds the whole box-shadow, not just its colour. `--primary-foreground` takes `accentFg`; it is
hard-coded to white today, which is exactly the value a pale accent must not keep.

`--color-brand-*` are in the set because `@theme` generates `bg-brand-500`-style utilities that
resolve their var at the element — twenty-five of those literals exist in `store/` and
`components/ui/`, and leaving them out would leave buttons and table headers oxblood.

`--brand-50/100/200` and `--brand-700` stay platform values. A shop's pale wash is where one accent
starts becoming a palette.

### Splitting fill from text without touching 279 call sites

One variable cannot carry both roles. `--primary` backs `bg-primary` (77 uses) **and** `text-primary`
(202 uses), so setting it to the fill leaves branded text unreadable and setting it to the darkened
text colour dulls every button. Retargeting one of those two sets to a new utility is a 200-site
sweep across storefront, dashboard and shared `components/ui` — far more code than the feature, and
most of it on surfaces this feature does not brand.

Split by scope instead. The wrapper carries a `data-brand` attribute, and one rule in `index.css`
redefines the text role inside it:

```css
[data-brand] .text-primary { color: var(--color-accent-text); }
```

Specificity (0,2,0) beats Tailwind's `.text-primary` (0,1,0), so the rule wins without `!important`,
and it is inert everywhere the wrapper is absent — the marketing pages keep the platform behaviour
by construction. `bg-primary`, `border-primary` and `ring-primary` continue to read `--primary` and
get the picked fill unchanged.

This is only sound because the two roles never meet on one element. Two facts hold today and both
are pinned by tests reading the `.tsx` sources off disk, the way `sitemap.test.ts` and
`llmsTxt.test.ts` already check joins that would otherwise break in silence:

- **No element carries both `bg-primary` and `text-primary`.** One that did would want accent text on
  an accent fill, and would get the darkened text instead of `--color-accent-fg`. Nothing does;
  such an element uses `text-primary-foreground`.
- **Nothing reaches the accent through an arbitrary value** (`text-[var(--primary)]` and friends).
  An arbitrary value skips the utility class and so escapes the scoped rule.

### Pinning the set

`brandTheme.test.ts` reads `tokens.css` and `index.css` off disk, walks every custom property, and
collects the transitive closure of everything referencing `--brand-500` or `--color-accent`. It
asserts the override set **contains** that closure. Containment rather than equality, because the
set also holds two tokens the CSS never derives — `--color-accent-fg` and `--color-accent-text` are
introduced by this feature and written only by the wrapper. A token added later that derives from
the accent then fails the build instead of shipping half-branded — the same technique
`tokens.test.ts` and `fonts.test.ts` use for joins that otherwise degrade in silence.

### The component

`<BrandTheme merchant>` renders a single `<div style={…}>` with `display: contents`, so it adds no
box and cannot disturb any layout it wraps.

Three mount points:

- **`StorefrontShell`** (`AppRouter.tsx:67`), inside the status gate, wrapping `ShopPixelsProvider`.
  The merchant row is already resolved and the shell renders a spinner until it is, so there is no
  flash of oxblood. Everything under `/s/:slug` — menu, cart, checkout, success screen, order
  history — is inside it.
- **The dashboard shell**, from `ownMerchant` in `SessionContext`. Under admin impersonation it
  follows the impersonated shop, which is correct: an admin looking at a shop should see that shop.
- Nothing else. Absence of the wrapper is what keeps marketing, admin and the auth screens
  on the platform accent; no opt-out list is needed.

## The picker

`merchant/BrandColourCard.tsx`, following `ShopDescriptionCard.tsx` exactly: its own Save, `useSaved`
for the saved snapshot and dirty flag, `onDirtyChange` reported up rather than registered with
`NavGuard` (which holds one blocker), then `updateMerchantConfig` and `refreshMerchant`.

It sits on the **Storefront tab**, beside the description card — not in Shop Settings. The reasoning
is already written into `ShopDescriptionCard`: Settings is where a merchant looks for a *fact* about
the shop (address, currency, tax rate); Storefront is where they look at what the customer sees.

Contents:

- **Eight swatches**, oxblood first and labelled as the default, each a distinct hue at a usable
  lightness. They exist so a merchant with no hex code in hand still lands somewhere deliberate.
- **A hex field** for an exact brand match. Uppercased, accepts `#RGB` or `#RRGGBB`, normalised to
  six digits on blur. Invalid input disables Save with an inline reason and leaves what they typed
  alone.
- **A live preview strip** — a filled button, a price in accent-as-text, a badge — rendered inside a
  local `<BrandTheme>` fed the *pending* value. Reusing the storefront's own component is what stops
  the preview from drifting from the result.
- **Reset to default**, writing null.

No contrast warning anywhere in the UI. The derivation makes every input legible, so a warning would
either never appear or would scold a merchant about a problem the system has already solved.

## Deferred: the invoice

`InvoicePage` holds only `?shop=<slug>` and posts a lookup form; it never resolves a merchant row,
and the invoice itself is a server-rendered PDF from `renderInvoicePdf`. Branding either one is a
separate piece of work — the page needs a shop fetch for chrome alone, and the PDF needs the colour
plumbed into the renderer, on the backend, where nothing reads `brand_color` today. Both are
reasonable follow-ups. Neither is in this feature.

## Verification

- `brandTheme.test.ts` — the hue and lightness sweep, null and malformed falling back to the
  platform set, and the override-set closure read off the CSS.
- Two source-scanning tests for the scoped text rule: no element carries both `bg-primary` and
  `text-primary`, and nothing reaches the accent through an arbitrary `[var(--…)]` value.
- Backend unit tests for `pickMerchantConfig` — a malformed hex is a 400; `null` and `''` both store
  `null`.
- Run-and-verify per CLAUDE.md, not component tests. Pick a loud non-oxblood colour, save, then walk
  the storefront: menu, cart, checkout, success screen, order history. Confirm the dashboard follows
  it and that `/`, `/admin` and the login screens did not.
- The migration is applied locally with `db:migrate` only. Production stays a human's push.
