/* OKLab <-> hex, for the one job in this app that HSL cannot do: mixing two colours.
   Pure and DOM-free, like `hsl.ts` and `contrast.ts` next door.

   HSL is the right space for holding a hue while walking lightness, which is what most of
   `brandTheme.ts` does. It is a poor space to MIX in: a channel mix between a saturated colour and
   a near-neutral one dips through a muddy middle, because HSL's lightness is not perceptual. The
   brand ramp needs exactly one mix -- pulling a wash toward the cream page it sits on -- and doing
   that in a perceptual space is the difference between a warmed tint and a grey one.

   Ottosson's matrices (https://bottosson.github.io/posts/oklab/). Nine multiplies each way and no
   dependency, which is why this is worth having as a file rather than a package. */
import { hexToRgb } from './hsl'

export type Oklab = [L: number, a: number, b: number]

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const toSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const channel = (v: number): string => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0').toUpperCase()

export function hexToOklab(hex: string): Oklab {
  const [r8, g8, b8] = hexToRgb(hex)
  const r = toLinear(r8 / 255)
  const g = toLinear(g8 / 255)
  const b = toLinear(b8 / 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ]
}

/** Out-of-gamut results clamp per channel, which is what every step of the brand ramp wants. */
export function oklabToHex([L, A, B]: Oklab): string {
  const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3)
  const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3)
  const s = Math.pow(L - 0.0894841775 * A - 1.2914855480 * B, 3)
  return '#'
    + channel(toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s))
    + channel(toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s))
    + channel(toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s))
}
