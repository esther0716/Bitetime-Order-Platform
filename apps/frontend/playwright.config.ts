// The browser suite: the storefront driven as a customer drives it.
//
// CLAUDE.md says UI is verified by running the app, not by component tests. That stays true —
// this does not replace run-and-verify, it pins the ONE path whose silent regression costs
// money: a guest placing an order. Everything else about the UI is still checked by a human
// running it.
//
// It serves the PRODUCTION BUNDLE (`vite build` then `vite preview`), not the dev server. The
// bundle is what ships, and the two differ in the ways that bite — env inlining, minification,
// and the Suspense/motion behaviour behind the blank-first-load bug this repo has already been
// caught by once.
import { defineConfig, devices } from '@playwright/test'
import { backendEnv, stackEnv, FRONTEND_ORIGIN, BACKEND_ORIGIN } from './e2e/stack'

const supabase = stackEnv()

export default defineConfig({
  testDir: './e2e',
  // One worker, one shop. The fixture is a single seeded merchant with a per-day order counter;
  // parallel workers ordering from it would race the counter and each other's cleanup.
  workers: 1,
  fullyParallel: false,
  // NO RETRIES, deliberately. A retry turns a flake into a pass and the flake into something
  // nobody learns about — the same argument this repo makes against a DB suite that skips.
  // A flaky e2e test is a bug in the test or the app; both are worth seeing.
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: FRONTEND_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // The real routes, run the way `pnpm dev` runs them — jiti resolves the backend's `.js`
      // specifiers back to its TypeScript source.
      command: 'node --import jiti/register src/index.ts',
      cwd: '../backend',
      url: `${BACKEND_ORIGIN}/health`,
      env: backendEnv(),
      // NEVER REUSED, even locally. Adopting a server this suite did not configure means
      // inheriting its env — and the one that matters is the backend's FRONTEND_URL, which
      // pins CORS. A mismatch there fails as "Shop not found" in the browser while the same
      // URL answers perfectly from curl. Own ports plus own processes, or the failure is a
      // port clash that says so out loud.
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // VITE_* values are INLINED AT BUILD TIME, so the build has to happen here, under this
      // env — pointing `vite preview` at a dist built against someone's .env.local would test
      // the wrong backend entirely.
      command: 'pnpm vite build && pnpm vite preview --port 4174 --strictPort --host 127.0.0.1',
      url: FRONTEND_ORIGIN,
      env: {
        VITE_SUPABASE_URL: supabase.SUPABASE_URL,
        VITE_SUPABASE_KEY: supabase.SUPABASE_ANON_KEY,
        VITE_API_URL: BACKEND_ORIGIN,
      },
      // NEVER REUSED, even locally. Adopting a server this suite did not configure means
      // inheriting its env — and the one that matters is the backend's FRONTEND_URL, which
      // pins CORS. A mismatch there fails as "Shop not found" in the browser while the same
      // URL answers perfectly from curl. Own ports plus own processes, or the failure is a
      // port clash that says so out loud.
      reuseExistingServer: false,
      timeout: 180_000, // a cold production build
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
