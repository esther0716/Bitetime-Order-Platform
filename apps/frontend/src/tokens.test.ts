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
