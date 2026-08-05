import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Mirrors the `@` alias in vite.config.ts. Without it, any test that imports a module
  // which itself imports `@/…` fails to collect — which is how orderStatus.tsx went
  // untested despite being pure data.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
