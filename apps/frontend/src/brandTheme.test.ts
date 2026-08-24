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

/* The module names three ink literals of its own. They are duplicates of tokens.css, and a
   duplicate that nothing checks is one that drifts the day somebody retunes the ink ladder. */
describe('the ink the derivation falls back to', () => {
  it('matches tokens.css', () => {
    const source = readFileSync(fileURLToPath(new URL('./brandTheme.ts', import.meta.url)), 'utf8')
    const literal = (name: string) => {
      const m = new RegExp(`const ${name} = '(#[0-9A-Fa-f]{6})'`).exec(source)
      if (!m) throw new Error(`Literal not found in brandTheme.ts: ${name}`)
      return m[1].toUpperCase()
    }
    expect(literal('INK_950')).toBe(token('--ink-950').toUpperCase())
    expect(literal('INK_900')).toBe(token('--ink-900').toUpperCase())
    expect(literal('WHITE')).toBe(token('--white').toUpperCase())
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

  /* The WHOLE ramp, in order, not just the two neighbours either side of the fill. An earlier
     version checked only hover-vs-fill and tint50-vs-tint200, and could not see `light400`: with a
     fixed lightness of 0.635 a pale pick put the 400 step BELOW its own 500, breaking what
     tokens.css states as a rule and inverting the dark theme's accent. */
  it('keeps the whole ramp going one way, lightest step to darkest', () => {
    for (const hex of samples) {
      const t = brandTheme(hex)
      const ladder = [t.tint50, t.tint100, t.tint200, t.light400, t.accent, t.accentHover, t.accentDeep]
      const names = ['tint50', 'tint100', 'tint200', 'light400', 'accent', 'accentHover', 'accentDeep']
      for (let i = 1; i < ladder.length; i++) {
        expect(hexToHsl(ladder[i]).l, `${hex}: ${names[i]} vs ${names[i - 1]}`)
          .toBeLessThanOrEqual(hexToHsl(ladder[i - 1]).l + 1e-9)
      }
    }
  })

  // The specific inversion the ladder above exists to catch, named so a regression reads clearly.
  it('keeps the dark-theme step lighter than the fill even for a pale pick', () => {
    for (const hex of ['#FFEE99', '#F5D90A', '#FFFFFF', '#E8F4FF']) {
      const t = brandTheme(hex)
      expect(hexToHsl(t.light400).l, `${hex} light400`)
        .toBeGreaterThanOrEqual(hexToHsl(t.accent).l - 1e-9)
    }
  })
})
