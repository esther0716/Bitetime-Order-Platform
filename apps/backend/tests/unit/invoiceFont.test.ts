import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { INVOICE_FONT_FILE, invoiceFont } from '../../src/invoiceFont.js'

/**
 * The invoice's font travels beside the bundle, not inside it — jiti and Vitest cannot import a
 * `.ttf`, so `--loader:.ttf=binary` would have split dev and test from production (see
 * `invoiceFont.ts`). What that costs is a copy step in the build script, and a copy step is
 * exactly the kind of thing that gets dropped during an unrelated edit to a long esbuild command.
 *
 * The failure it would cause is silent everywhere but production: every test passes, `pnpm dev`
 * serves invoices happily, and the deployed backend throws ENOENT on the first download. So the
 * build script is pinned here, in the same spirit as the frontend's `fonts.test.ts` and
 * `vercelRewrites.test.ts` — a build-config join that no other test would notice breaking.
 */
describe('the invoice font ships with the bundle', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const build: string = pkg.scripts.build

  it('is copied into dist by the build script', () => {
    expect(build).toContain(`src/assets/${INVOICE_FONT_FILE}`)
    expect(build).toContain('dist/assets')
  })

  it('is in the repo where the build script and the reader both look', () => {
    expect(existsSync(new URL(`../../src/assets/${INVOICE_FONT_FILE}`, import.meta.url))).toBe(true)
  })

  it('reads as a TrueType face', () => {
    const bytes = invoiceFont()
    // 0x00010000 — the sfnt version every TrueType outline font starts with.
    expect([...bytes.slice(0, 4)]).toEqual([0, 1, 0, 0])
    expect(bytes.length).toBeGreaterThan(1_000_000)
  })
})
