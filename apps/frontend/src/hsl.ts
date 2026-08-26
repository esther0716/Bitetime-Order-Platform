/* HSL <-> hex, for the one job in this app that needs a second colour space: deriving a shop's
   whole brand ramp from the single colour its merchant picked (`brandTheme.ts`). Pure and DOM-free,
   like `contrast.ts` next door, so both run in Vitest and in a test that reads tokens.css off disk.

   HSL because every LIGHTNESS derivation in brandTheme holds a hue and moves lightness, and HSL
   holds hue exactly. It is the wrong space for the one MIX in that module -- warming a wash toward
   the cream page -- which is why `oklab.ts` sits next door rather than this file growing a second
   job. Neither costs a dependency. */

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
