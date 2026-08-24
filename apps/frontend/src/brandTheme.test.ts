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
