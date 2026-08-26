import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/* The scoped brand rule in index.css redefines `text-primary` inside a branded subtree, so that the
   accent can be one colour as a FILL and a darker one as TEXT. That trick is only sound while the
   two roles never meet on one element, and while nothing reaches the accent by a route the rule
   cannot see. Both are facts about the source, so both are checked against the source. */

const here = new URL('.', import.meta.url)
const root = fileURLToPath(here)
const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ path: f, text: readFileSync(new URL(f, here), 'utf8') }))

/** Every string literal that looks like a class list carrying one of the roles we care about. */
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

/* A Tailwind VARIANT of an accent-text utility compiles to its own class — `hover:text-primary`
   becomes `.hover\:text-primary`, which the bare `.text-primary` selector does not match. So every
   variant in use needs its own selector in the scoped rule, and a variant added later would
   otherwise resolve to the raw picked colour: a pale accent with a legible label and an illegible
   hover. Read out of the sources rather than listed here, so the join cannot rot. */
describe('the scoped rule covers every variant of the accent-text utility', () => {
  const brandRule = readFileSync(fileURLToPath(new URL('index.css', here)), 'utf8')
    .split('[data-brand]').slice(1).join('[data-brand]')

  const variants = new Set(
    files.flatMap((f) => [...f.text.matchAll(/([a-z][a-z0-9-]*):text-primary(?!-)/g)].map((m) => m[1])),
  )

  it('finds the variants in use', () => {
    expect(variants.size).toBeGreaterThan(0)
    expect([...variants]).toContain('hover')
  })

  it('names each of them in index.css', () => {
    const missing = [...variants].filter((v) => !brandRule.includes(`.${v}\\:text-primary`))
    expect(missing).toEqual([])
  })
})

describe('nothing escapes the scoped rule through an arbitrary value', () => {
  it('reaches the accent through utilities only', () => {
    const offenders: string[] = []
    for (const f of files) {
      // Any accent-carrying token, not a list of four: `text-[var(--brand-600)]` escapes the
      // scoped rule exactly as `text-[var(--primary)]` does, and a narrow list is a scan that
      // passes because it was not looking.
      const m = f.text.match(/\[var\(--(?:primary|ring|focus-ring|brand-\d+|color-(?:accent|brand-\d+|focus-ring))[^)]*\)\]/g)
      if (m) offenders.push(`${f.path}: ${m.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})

/* Whatever the wrapper does NOT restate keeps the platform colour, because `var()` substitutes at
   the declaration and `:root` has already resolved it. So a token added later that derives from the
   accent would ship half-branded and look like a caching bug. This walks the stylesheets and fails
   the build instead. */
describe('the override set covers every token that carries the accent', () => {
  const read = (name: string) => readFileSync(fileURLToPath(new URL(name, here)), 'utf8')
  const wrapper = read('components/BrandTheme.tsx')

  /* `@theme inline` is substituted at BUILD time — `bg-brand-600` compiles to `var(--brand-600)`,
     and the `--color-brand-600` bridge is never read at runtime. Its declarations are therefore not
     overridable and must not be demanded of the wrapper. Stripped by brace matching rather than by
     a regex, because the blocks are long and nested braces would defeat a lazy one. */
  function withoutInlineTheme(css: string): string {
    let out = ''
    let i = 0
    for (;;) {
      const start = css.indexOf('@theme inline', i)
      if (start === -1) return out + css.slice(i)
      out += css.slice(i, start)
      let depth = 0
      let j = css.indexOf('{', start)
      for (; j < css.length; j++) {
        if (css[j] === '{') depth++
        else if (css[j] === '}' && --depth === 0) break
      }
      i = j + 1
    }
  }

  const css = withoutInlineTheme(`${read('tokens.css')}\n${read('index.css')}`)

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

  const required = [...closure].sort()
  const declared = new Set([...wrapper.matchAll(/'(--[\w-]+)'\s*:/g)].map((m) => m[1]))

  it('finds a closure worth checking', () => {
    expect(required.length).toBeGreaterThan(2)
  })

  it('restates every one of them', () => {
    expect(required.filter((n) => !declared.has(n))).toEqual([])
  })
})
