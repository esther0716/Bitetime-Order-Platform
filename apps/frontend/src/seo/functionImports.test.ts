import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

// What the two Vercel functions in api/ are allowed to import, and why a compiler cannot see it.
//
// @vercel/node does NOT bundle: it transpiles each .ts file on its own and keeps the import
// strings, so what Node resolves inside the lambda is exactly what is written here. The package
// is `"type": "module"`, so Node ESM applies and every relative specifier needs its extension —
// and it must be `.js`, the extension of the EMITTED file, never `.ts`.
//
// The bare `@bitetime/shared` specifier fails for a second reason: the lambda carries no
// node_modules, so the workspace symlink is gone, and the package's `exports` names
// `./src/index.ts`, which the build never emits. The traced source lands at packages/shared/src/
// as compiled .js, so a function must reach it by path.
//
// Both faults are invisible until a request arrives: the build succeeds, `pnpm build` succeeds,
// typecheck succeeds, and the function answers 500 FUNCTION_INVOCATION_FAILED with
// ERR_MODULE_NOT_FOUND in the runtime log. That is how both shipped at once.

const apiDir = path.resolve(__dirname, '../../api')
const seoDir = __dirname

const sourceFiles = [
  ...readdirSync(apiDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => path.join(apiDir, f)),
  ...readdirSync(seoDir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map(f => path.join(seoDir, f)),
]

const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)].map(m => m[1])

describe('function module graph', () => {
  it('finds the files it is meant to guard', () => {
    expect(sourceFiles.length).toBeGreaterThanOrEqual(4)
  })

  for (const file of sourceFiles) {
    const name = path.relative(path.resolve(__dirname, '../..'), file)

    it(`${name} gives every relative import a .js extension`, () => {
      for (const spec of importsOf(file)) {
        if (!spec.startsWith('.')) continue
        expect(spec.endsWith('.js'), `${spec} does not resolve in the lambda — Node ESM needs the emitted extension`)
          .toBe(true)
      }
    })

    it(`${name} imports no bare package that the lambda cannot resolve`, () => {
      for (const spec of importsOf(file)) {
        if (spec.startsWith('.') || spec.startsWith('node:')) continue
        expect(spec, 'the lambda has no node_modules; reach shared code by path')
          .not.toMatch(/^@bitetime\//)
      }
    })
  }
})
