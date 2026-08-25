import { contrastRatio } from './contrast'
import { hexToHsl, hslToHex, hexToRgb } from './hsl'
import { hexToOklab, oklabToHex } from './oklab'
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
 * EVERY FIGURE BELOW IS MEASURED off the oxblood ramp the app already ships, so
 * `brandTheme('#7A1028')` returns today's palette to within 3/255 per channel. Change one and that
 * test fails, which is the intent: these are not taste, they are the shape of the existing ramp.
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

/* The lighter steps are a FRACTION OF THE DISTANCE TO WHITE, `L + (1 - L) * k`, not an absolute
   lightness. Absolute targets read fine off the oxblood ramp and then invert it: a shop picking a
   pale yellow (L 0.80) would get a `--brand-400` at 0.635, DARKER than its own accent, breaking
   what tokens.css states as a rule ("--brand-400 ... must stay LIGHTER than -500") and handing the
   dark theme an accent darker than the light one. Measuring toward white keeps every tint above the
   fill for any pick, and the `k` values below are exactly what reproduce the oxblood ramp.

   Saturation is a ratio of the picked colour's for a related reason: the oxblood tints are about
   half as saturated as the accent, and copying that as a constant would hand a grey-picking shop
   saturated pink washes. */
const TINTS = [
  { key: 'tint50', s: 1.00, k: 0.9548, warm: true },
  { key: 'tint100', s: 0.56, k: 0.9054, warm: true },
  { key: 'tint200', s: 0.56, k: 0.8122, warm: true },
  /* NOT warmed. --brand-400 is the dark-theme accent, not a wash on the cream page, so it has
     none of the problem the pull below exists to fix -- and warming it moved it a visible step off
     the oxblood ramp to buy nothing. */
  { key: 'light400', s: 0.70, k: 0.4996, warm: false },
] as const

/* THE WASHES ARE WARMED TOWARD THE PAGE, and this is the one part of the ramp that is not a pure
   HSL walk.

   The tints above measure toward WHITE, and the page is CREAM. Oxblood is warm, so the two agreed
   by luck and the mismatch never showed. A cool pick is where it does: a blue wash bled to white
   lands on a warm page as a second, colder ground -- measurably so, at 3.1 OKLab units from the
   canvas against oxblood's own 1.9.

   Two obvious fixes are both wrong, and were measured before this one was written. See
   docs/adr/0021-the-washes-are-warmed-toward-the-page.md:
     - Mixing the tint toward the canvas instead of toward white BLEACHES it. At k = 0.9054 the
       destination is nearly neutral, so a 90 percent mix arrives nearly neutral: blue fell from 44
       percent saturation to 6, and landed FURTHER from the cream (5.0) because the mix darkens as
       it desaturates.
     - Pulling the finished tint toward the canvas by a fixed fraction destroys the exact hues this
       exists for. Cream sits at the warm end of the a/b plane, so a fixed pull moves a blue tint
       straight THROUGH neutral -- blue is the hue furthest from the destination, and the pull is
       longer than the chroma it acts on. Blue went to 3 percent saturation, and a shop picking grey
       got beige washes it never asked for.

   So the pull is CAPPED at a fraction of the tint's own chroma. That bounds how much of the brand
   any pick can lose, whichever side of neutral it starts on: cool picks warm up and stay cool-hued
   (blue 3.1 -> 2.6 from the canvas, still visibly blue at 19 percent), a grey pick stays grey
   because half of nearly-zero chroma is nearly zero, and a warm pick is barely touched because the
   pull is short to begin with. */
const WARM_PULL = 0.35
const CHROMA_CAP = 0.5

function warmTowardCanvas(tint: string, canvas: string): string {
  const [L, a, b] = hexToOklab(tint)
  const [, ca, cb] = hexToOklab(canvas)
  let da = (ca - a) * WARM_PULL
  let db = (cb - b) * WARM_PULL
  const step = Math.hypot(da, db)
  const limit = Math.hypot(a, b) * CHROMA_CAP
  if (step > limit && step > 0) {
    da *= limit / step
    db *= limit / step
  }
  /* Lightness is untouched: the k values above are the ramp's shape, and the warmth is a hue
     correction, not a second lightness rule. It is also what keeps the ramp monotonic, which the
     sweep in brandTheme.test.ts checks. */
  return oklabToHex([L, a + da, b + db])
}

/* The deeper steps are ratios of the picked lightness, not absolutes: a shadow has to stay relative
   to the colour it shadows, or a dark pick would produce a 600 lighter than its own 500. */
const HOVER = { s: 1.03, l: 0.688 }
const DEEP = { s: 1.04, l: 0.507 }

/**
 * The lightest colour of this hue that clears AA on EVERY surface given, starting no lighter than
 * `startL`. Binary search, because contrast against a light surface rises monotonically as the
 * candidate darkens — so the boundary is findable, and the lightest passing value is the one that
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
    TINTS.map((t) => {
      const step = hslToHex(h, s * t.s, l + (1 - l) * t.k)
      return [t.key, t.warm ? warmTowardCanvas(step, canvas) : step]
    }),
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
