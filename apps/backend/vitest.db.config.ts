import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vitest/config'

// The suites under tests/rls and tests/api talk to a real local Supabase, so they need
// that stack's URL, keys and Postgres connection string. They used to read them from env
// vars and `describe.skipIf` themselves away when those were absent — which meant the one
// suite proving an order cannot be spoofed onto a stranger's account reported success
// while asserting nothing.
//
// So: resolve the credentials here, from the running stack, and let the suites fail
// loudly if they cannot be found. Explicit env vars still win, so CI can inject its own.
// This config is separate from vitest.config.ts precisely so the unit run never pays for
// (or depends on) a Supabase.
//
// DATABASE_URL is here for the same reason as the keys, and it matters more: the order
// rules are moving out of PL/pgSQL into TypeScript, and the properties they must hold —
// a voucher redeemed once under concurrent checkout, two orders never sharing a number —
// are properties of real Postgres row locks. A mocked database would report green while
// proving nothing, which is worse than no suite at all.
const FROM_CLI: Record<string, string> = {
  SUPABASE_URL: 'API_URL',
  SUPABASE_ANON_KEY: 'ANON_KEY',
  SUPABASE_SERVICE_ROLE_KEY: 'SERVICE_ROLE_KEY',
  DATABASE_URL: 'DB_URL',
}

// tests/api imports the Hono app, which imports env.ts, which fails fast on a missing
// Stripe key. These suites never reach Stripe — nothing they touch calls it, and a real key
// in a test process is a liability rather than an asset. Stub the keys so importing the app
// is possible; anything that genuinely exercises Stripe belongs in a suite that says so.
// The two price ids must be DISTINCT: the webhook reconciles a shop's billing cycle by looking a
// subscription's price id back up in this map, so two identical stubs would resolve every price
// to monthly and the reconciliation suite would assert nothing.
const STRIPE_STUBS: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_test_stub',
  STRIPE_WEBHOOK_SECRET: 'whsec_stub',
  STRIPE_PRICE_PRO_MONTHLY: 'price_stub_pro_monthly',
  STRIPE_PRICE_PRO_YEARLY: 'price_stub_pro_yearly',
}

// The merchant address-check link (emailVerifyToken.ts). Unlike the stubs above this is not a
// stand-in for a credential we refuse to use — it is the real mechanism, and setting it is what
// turns the feature ON for these suites. Its value is the key: tests/api/verify-email.test.ts
// mints tokens with this exact string, so it must be a shared constant and not a per-run secret.
//
// No mail leaves the process regardless: RESEND_API_KEY is unset here, and resendSend logs and
// returns rather than calling Resend.
export const EMAIL_VERIFY_TEST_SECRET = 'email-verify-secret-for-tests'

function supabaseStatusEnv(): Map<string, string> {
  // `supabase` resolves the project from the config in ./supabase, so this must run
  // with apps/backend as cwd — which it does, being the workspace vitest runs in.
  const raw = execFileSync('supabase', ['status', '-o', 'env'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const vars = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim())
    if (match) vars.set(match[1], match[2])
  }
  return vars
}

function loadSupabaseEnv() {
  for (const [name, value] of Object.entries(STRIPE_STUBS)) {
    if (!process.env[name]) process.env[name] = value
  }
  if (!process.env.EMAIL_VERIFY_SECRET) process.env.EMAIL_VERIFY_SECRET = EMAIL_VERIFY_TEST_SECRET

  // FORCED EMPTY, not merely defaulted: these suites must never reach Google. A developer with
  // a real key in their shell would otherwise turn the cache-miss cases below into live,
  // billable, flaky network calls. Same argument as the Stripe stubs above — a real credential
  // in a test process is a liability, not an asset — but stronger, because this one spends money
  // per call. Everything distance-related in tests/api is exercised through SEEDED CACHE ROWS.
  process.env.GOOGLE_MAPS_API_KEY = ''

  // Same argument, and arguably sharper: most of tests/api/feedback.test.ts posts real feedback
  // without swapping githubDeps, so a real GITHUB_TOKEN in a developer's shell (common for gh
  // CLI users) would silently file real, public issues on leongcheefai/Bitetime-Order-Platform
  // on every `test:db` run. The tests that DO want to exercise the create/close/reopen path
  // swap `githubDeps` directly (see feedback.test.ts) — that path never touches env.githubToken.
  process.env.GITHUB_TOKEN = ''

  // Same argument, stronger still: a real key here is billed per call. tests/api/releases.test.ts
  // swaps releaseDeps.humanize directly for the cases that exercise the pull/regenerate path
  // (see feedback.test.ts's githubDeps swap for the precedent) — that path never touches
  // env.anthropicApiKey.
  process.env.ANTHROPIC_API_KEY = ''

  // Same reasoning as the Stripe stubs: importing the app must be possible without a real
  // secret, and this one carries no live-network risk (it only gates an internal endpoint),
  // so a plain default — not a forced-empty like GOOGLE_MAPS_API_KEY — is enough.
  if (!process.env.TRIAL_FEEDBACK_SWEEP_SECRET) process.env.TRIAL_FEEDBACK_SWEEP_SECRET = 'test-sweep-secret-stub'

  // Same reasoning again. The sweep's one Stripe call goes through `billingSweepDeps`, which the
  // suite swaps — the secret only gates the door.
  if (!process.env.BILLING_SWEEP_SECRET) process.env.BILLING_SWEEP_SECRET = 'test-billing-sweep-secret-stub'

  // Same reasoning as the TRIAL_FEEDBACK_SWEEP_SECRET stub just above: it only gates an
  // internal endpoint, no live-network risk, so a plain default is enough.
  if (!process.env.SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET) {
    process.env.SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET = 'test-screenshot-sweep-secret-stub'
  }

  const missing = Object.keys(FROM_CLI).filter(name => !process.env[name])
  if (missing.length === 0) return

  let status: Map<string, string>
  try {
    status = supabaseStatusEnv()
  } catch {
    throw new Error(
      `The DB-backed suites need a local Supabase. Could not read one from \`supabase status\`, and ` +
        `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set.\n` +
        `Start the stack with \`supabase start\` (from apps/backend), or set those vars yourself.`,
    )
  }

  for (const name of missing) {
    const value = status.get(FROM_CLI[name])
    if (!value) {
      throw new Error(
        `Local Supabase is running but reported no ${FROM_CLI[name]}, so ${name} cannot be set. ` +
          `Check \`supabase status\`.`,
      )
    }
    process.env[name] = value
  }
}

// Runs in the main process, before workers fork — they inherit the env we set here.
loadSupabaseEnv()

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rls/**/*.test.ts', 'tests/api/**/*.test.ts'],
    // Files run in parallel (vitest's default). That is safe only because each suite owns a
    // disjoint set of merchant slugs and user emails — its fixtures are keyed on them and it
    // clears them on the way in. A new suite that reuses another's slug will flake here.
    //
    // THE TIMEOUT IS 30s, NOT VITEST'S 5s, and the reason is arithmetic rather than caution.
    // Almost every test here begins with `makeUser`, and one `makeUser` is a delete, a create and
    // a sign-in against GoTrue — TWO bcrypt hashes and three round trips before the test has
    // asserted anything. Warm, on an idle machine, that is about 300ms. On a developer laptop
    // running several Supabase stacks it was measured at 5.4 SECONDS for a single signup, which
    // put every one of these suites on the wrong side of a 5s limit at once: 170 failures in a
    // run, every one of them a timeout inside a fixture, none of them a defect. A timeout is
    // meant to catch a test that has hung, and 5s cannot tell hung from busy here.
    //
    // This hides nothing: a genuinely stuck test still fails, thirty seconds later, and the suites
    // that pass do so in well under a second each.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
