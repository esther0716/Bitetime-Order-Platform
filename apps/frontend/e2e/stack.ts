// Where the e2e run gets its Supabase credentials.
//
// Deliberately the same contract as apps/backend/vitest.db.config.ts: read them out of the
// running local stack, let an explicit env var win so CI can inject its own, and FAIL LOUDLY
// when neither is available. Never skip. A browser suite that quietly does nothing when the
// database is missing is the same lie as a DB suite that does — worse here, because this one is
// the only automated check that the storefront can take an order at all.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend')

/** env var → the key `supabase status -o env` publishes it under. */
const FROM_CLI: Record<string, string> = {
  SUPABASE_URL: 'API_URL',
  SUPABASE_ANON_KEY: 'ANON_KEY',
  SUPABASE_SERVICE_ROLE_KEY: 'SERVICE_ROLE_KEY',
  DATABASE_URL: 'DB_URL',
}

// env.ts fails fast on a missing Stripe key, so the backend cannot boot without these — and a
// real key in a test process is a liability, not an asset. Nothing in this flow reaches Stripe.
// Distinct values for the four prices, matching vitest.db.config.ts's reasoning: identical stubs
// would make every price resolve to the same tier.
const STRIPE_STUBS: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_test_stub',
  STRIPE_WEBHOOK_SECRET: 'whsec_stub',
  STRIPE_PRICE_BASIC_MONTHLY: 'price_stub_basic_monthly',
  STRIPE_PRICE_BASIC_YEARLY: 'price_stub_basic_yearly',
  STRIPE_PRICE_PRO_MONTHLY: 'price_stub_pro_monthly',
  STRIPE_PRICE_PRO_YEARLY: 'price_stub_pro_yearly',
}

function supabaseStatusEnv(): Map<string, string> {
  // `supabase` resolves its project from apps/backend/supabase, so this must run with that as
  // cwd — unlike vitest.db.config.ts, which already runs there.
  const raw = execFileSync('supabase', ['status', '-o', 'env'], {
    cwd: BACKEND_DIR,
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

let cached: Record<string, string> | null = null

/** The Supabase credentials this run needs, resolved once. Throws when they cannot be found. */
export function stackEnv(): Record<string, string> {
  if (cached) return cached

  const resolved: Record<string, string> = {}
  const missing: string[] = []
  for (const name of Object.keys(FROM_CLI)) {
    const fromEnv = process.env[name]
    if (fromEnv) resolved[name] = fromEnv
    else missing.push(name)
  }

  if (missing.length > 0) {
    let status: Map<string, string>
    try {
      status = supabaseStatusEnv()
    } catch {
      throw new Error(
        `The e2e suite needs a local Supabase. Could not read one from \`supabase status\`, and ` +
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
      resolved[name] = value
    }
  }

  cached = resolved
  return resolved
}

/**
 * The origin the browser loads the storefront from.
 *
 * Stated once and used for BOTH the Playwright baseURL and the backend's FRONTEND_URL, because
 * `/api/*` is pinned to that value by CORS and the two must match EXACTLY — `localhost` and
 * `127.0.0.1` are different origins to a browser. Splitting them is how every API call in the
 * suite starts failing CORS while the page itself loads perfectly.
 */
// PORTS OF THEIR OWN, not the dev server's 5173/8787. A `pnpm dev` backend left running would
// otherwise be adopted by Playwright's `reuseExistingServer`, and that process carries
// FRONTEND_URL from apps/backend/.env — so `/api/*` answers every request from this suite
// without an `access-control-allow-origin` header, the browser drops the response, and the
// storefront renders "Shop not found" while curl against the same URL returns the shop happily.
// Separate ports mean the suite always talks to a server it configured itself.
export const FRONTEND_ORIGIN = 'http://127.0.0.1:4174'
export const BACKEND_ORIGIN = 'http://127.0.0.1:8788'

/** Everything the backend process needs to boot against the local stack. */
export function backendEnv(): Record<string, string> {
  return {
    ...STRIPE_STUBS,
    ...stackEnv(),
    // FORCED EMPTY, like the DB suites: a developer with a real key in their shell would
    // otherwise turn this into a billable Google call. Nothing in the pickup flow needs it.
    GOOGLE_MAPS_API_KEY: '',
    FRONTEND_URL: FRONTEND_ORIGIN,
    PORT: '8788',
  }
}
