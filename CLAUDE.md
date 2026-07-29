# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo

pnpm + Turborepo. Three workspaces: `@bitetime/frontend` (`apps/frontend`, Vite+React, **TypeScript**), `@bitetime/backend` (`apps/backend`, Hono+Stripe billing, **TypeScript** — also holds `supabase/`, `tests/`, `scripts/`), and `@bitetime/shared` (`packages/shared`). `docs/` stays at the repo root. Paths below are relative to `apps/frontend/` unless prefixed.

The whole codebase is TypeScript (`.ts`/`.tsx`). Each workspace has its own `tsconfig.json` extending the root `tsconfig.base.json` (both `strict: true`, `noEmit: true` — Vite/esbuild do the emitting). Vite, esbuild, and Vitest compile TS natively. Frontend uses `moduleResolution: bundler` (extensionless relative imports); backend uses `NodeNext` (relative imports keep `.js` specifiers that resolve to the `.ts` source — leave them as `.js`).

`@bitetime/shared` holds **rules that must hold identically on both sides of the wire** — today: order pricing and its row → domain mappers (`pricing.ts`, the biggest and the reason the rest followed), the fulfilment window (`fulfilment.ts`), the cart-size caps (`cart.ts`), feedback validation (`feedback.ts`) and the customer password floor (`password.ts`). It ships **TypeScript source, no build step** (`exports: "./src/index.ts"`): both consumers compile TS themselves, so there is no `dist` to keep in sync and no build ordering to get wrong. The one thing this costs: the backend's esbuild bundle can no longer say `--packages=external` (that would leave a bare `@bitetime/shared` import resolving to `.ts` at runtime), so its four real runtime deps are listed with explicit `--external:` flags — **add a new backend runtime dependency and you must add its `--external:` flag too**, or it gets bundled. Anything that is not a shared rule does not belong here; a duplicate with a comment (see `notify.ts`'s currency twin) is the cheaper answer when only one side is authoritative.

## Commands

Run from the repo root; turbo fans out to workspaces. `--filter` targets one.

```bash
pnpm dev           # all dev servers (frontend :5173, backend :8787)
pnpm build         # production build → apps/frontend/dist/
pnpm lint          # ESLint check (typescript-eslint)
pnpm typecheck     # tsc --noEmit across workspaces
pnpm deploy        # frontend production build (deploy via Vercel)
pnpm test          # Vitest unit tests across workspaces
pnpm --filter @bitetime/frontend preview   # serve built dist/ locally
pnpm --filter @bitetime/backend dev         # billing server only
pnpm --filter @bitetime/backend test        # backend unit tests (notify, etc.) — no Supabase needed
pnpm --filter @bitetime/backend test:db     # DB-backed tests: RLS + API (needs a running local Supabase; reads its keys itself)
pnpm --filter @bitetime/backend db:migrate   # apply pending SQL migrations to the LOCAL Supabase DB
pnpm --filter @bitetime/backend db:push      # HUMAN ONLY — writes to PRODUCTION. Never run this yourself.

stripe listen --forward-to http://localhost:8787/api/stripe/webhook   # REQUIRED for any local billing work
```

**Anything that involves paying must have `stripe listen` running before the payment.** Stripe cannot reach `localhost`, and every post-payment effect is webhook-driven — `merchant_billing` (subscription id, status), `merchants.plan` reconciliation (#112) and the pending→active flip all happen in `POST /api/stripe/webhook` and nowhere else. Without the forwarder, Checkout completes, Stripe charges the card, and the app changes **nothing**: the merchant stays basic, and the only trace is the `stripe_customer_id` that `/api/checkout` wrote before redirecting. It looks exactly like a broken feature.

The CLI prints its own signing secret on startup; it must equal `STRIPE_WEBHOOK_SECRET` in `apps/backend/.env` or every event is rejected as an invalid signature (a `<-- [400]` in the listener's own output). Started late? `stripe events resend <evt_id>` replays one — the handlers upsert, so a replay is safe. And check the listener is actually still up (`ps -eo command | grep stripe`) before concluding the code is at fault: a dead forwarder and a broken handler look identical from the app.

Migrations live in `apps/backend/supabase/migrations/`. Adding a migration file does **not** apply it — run `db:migrate` (local) so the running app (and PostgREST's schema cache) sees the new columns; otherwise queries fail with `Could not find the 'X' column … in the schema cache`.

**Never run `db:push`, or any other `supabase` command that reaches production. Writing a migration file and applying it locally is the whole job; a human runs the push.** Say plainly that production still needs it, and stop there.

`apps/backend/supabase` is **linked** (`supabase/.temp/project-ref` → the live project), and that makes the CLI's default target the trap:

| Command | Targets |
|---------|---------|
| `supabase migration up` / `db:migrate` | LOCAL stack |
| `supabase db push` | **PRODUCTION** |
| `supabase migration repair` / `list` | **PRODUCTION**, silently, unless given `--db-url` |

`repair` is the one that bites: it names no database, prompts for nothing, and reports success either way. To repair a LOCAL history row you must point it there explicitly:

```bash
supabase migration repair --status reverted <version> --db-url "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
```

That URL comes from `supabase status` (`-o env` prints it as `DB_URL="…"`, quotes included — read the port off it rather than pasting the line into a flag). The port is **55321/55322 here, not the 54321/54322 default**. All of these run from `apps/backend/` only; from the repo root they fail with "Cannot find project ref".

This is not hypothetical. On 2026-07-29 a bare `repair --status applied <version>` intended to fix local drift instead marked a migration **applied on production that had only ever run locally** — which would have made the next `db:push` skip it and ship code reading a column production did not have. Nothing broke (repair touches history rows, never tables), and it was undone with `repair --status reverted <version>`, but the honest lesson is: **establish what a `supabase` subcommand targets before running it, and treat anything remote as the human's call.**

Local history drifts for an ordinary reason — one local Supabase shared across branches. Migrate on a feature branch, switch back to `dev`, and `db:migrate` refuses: the local history holds a version whose FILE is gone. The lossless fix is `repair --status reverted <version> --db-url <local>`, which costs nothing when that branch's migration is idempotent (`add column if not exists`). `supabase db reset` also fixes it and wipes every local shop, order and user — a last resort, and the user's decision, not yours.

Tests use Vitest (added during the multi-merchant build). Pure logic and `store.ts` functions have unit tests (`apps/frontend/src/*.test.ts`); the backend has pure unit tests in `apps/backend/tests/unit/` (run by `test`, no Supabase).

Everything that needs a database is run by `test:db` and needs a running local Supabase (`supabase start` from `apps/backend`): tenant isolation and order attribution in `apps/backend/tests/rls/`, and the API endpoints in `apps/backend/tests/api/`. The API suites drive the real routes **in-process** via Hono's `app.request()` — which is why `src/app.ts` exports the app and `src/index.ts` is a separate entry that only calls `serve()`. Keep `app.ts` free of import-time side effects or the seam closes.

`test:db` uses its own `vitest.db.config.ts`, which reads the stack's URL, keys and `DATABASE_URL` from `supabase status` (and stubs the Stripe keys, which these suites never call) — set them yourself only to point it elsewhere (CI). Missing credentials are a startup **error**, never a skip. **Never mock the database in these suites**: they exist to prove properties of real Postgres — that an order cannot be spoofed onto a stranger's account, that a transaction really rolls back — and a mocked run reports green while asserting nothing, which is worse than no suite at all.

UI is verified by running the app (run-and-verify), not component tests.

**All of it runs on every pull request** (`.github/workflows/ci.yml`): one job for lint, typecheck, `test` and both builds, and a second that stands up its own Supabase and runs `test:db` — so the suites that need a database are checked by the thing least likely to forget. It needs **no secrets**: the DB job reads its stack's keys out of `supabase status`, and the Stripe and Google keys are stubbed or forced empty by `vitest.db.config.ts`. Node is pinned once, in `.github/actions/setup`.

## Architecture

Multi-merchant ordering SaaS. React 19 + Vite + React Router (`react-router-dom` v7). Many independent shops, isolated per tenant by Postgres RLS. No global state library — auth/role/lang live in React context.

`main.tsx` mounts `AppRouter`. The legacy single-tenant single-page app (`src/App.tsx` and its components) has been **deleted**; all work goes through the router tree below.

### Routing (`src/AppRouter.tsx`)

| Path | Screen | Guard |
|------|--------|-------|
| `/` | marketing landing (`marketing/Landing.tsx`) | — |
| `/reset-password` | set a new password after a recovery link (`ResetPasswordPage.tsx`) | none — **deliberately top-level**: nested under `/s/:slug` the shell's status gate would swallow it, and a suspended shop must never lock a customer out of their own account. Role-blind; `?shop=<slug>` decides where they land afterwards |
| `/s/:slug/*` | merchant storefront (`store/Storefront.tsx`) | `MerchantProvider` resolves shop by slug; gated on `status === 'active'` |
| `/merchant/signup`, `/merchant/login` | shop signup / login | — |
| `/merchant` | merchant dashboard (`merchant/MerchantHome.tsx`) | role `merchant` |
| `/admin`, `/admin/merchants` | manage merchants (`admin/AdminMerchants.tsx`) | role `superadmin` |

`RequireRole` is the route guard; `superadmin` passes any guard.

### Auth & roles

- Supabase Auth handles login/registration (`src/supabase.ts`, `src/store.ts`)
- `SessionContext` derives `role`: `superadmin` if `profiles.app_role === 'superadmin'` (transitional email fallback to `bitetime@praxor.dev`), else `merchant` if the user owns a `merchants` row, else `customer`
- `MerchantContext` resolves the active shop for `/s/:slug` storefronts

### Merchant onboarding & slugs (`src/slug.ts`)

Sign up with a shop name → auto slug: pinyin transliteration for Chinese names, `shop-<id>` fallback, uniqueness suffix (`-2`), reserved platform segments blocked (`RESERVED_SLUGS`: `s`, `admin`, `api`, `merchant`, …). New shops start `pending` until a superadmin approves.

### Data layer (`src/store.ts`)

All Supabase calls go through `store.ts`. Shared domain types (Merchant, Profile, Product, Order, Voucher, SessionValue, …) live in `src/types.ts`. Postgres tables (`apps/backend/supabase/migrations/`), tenant-scoped by RLS **on the browser's path** — see the caveat under Backend below:

| Table | Purpose |
|-------|---------|
| `merchants` | shop record — slug, status (`pending`/`active`/suspended), prefix |
| `merchant_secrets` | per-merchant secrets (Telegram token etc.), restricted grants |
| `profiles` | user profile + `app_role` + saved delivery address |
| `products` | per-merchant menu items (EN/ZH name + description) |
| `orders` | per-merchant orders |
| `order_counters` | per-merchant daily order counter |
| `vouchers` | per-merchant promotions |
| `settings` | **not per-merchant, and not read by anything** — see below |

A shop's config lives in **columns on `merchants`** (shipping rates and mode, tax, fulfilment methods, currency, timezone, pickup address) and in its `products` rows. There is no per-merchant settings table.

`settings` is what the single-tenant app used before the pivot: a global key/value table keyed on `key`, holding one `main` row whose JSON still describes the deleted `src/store.js` — EmailJS template ids, a `sameday` block that became distance pricing, a hardcoded cookie menu. **It has no `merchant_id` column**, nothing in `apps/backend/src` or `apps/frontend/src` reads it, and the browser roles hold no grants on it (`20260718130000_revoke_all_browser_grants.sql`), so its permissive `using (true)` policies are unreachable. Do not write tenant code against it — a `.eq('merchant_id', …)` on this table is an error, not a filter, which is exactly how it sat in `resetMerchant` as a silent no-op.

### Order flow

`Storefront` collects items, delivery mode, voucher → `priceOrder()` for the total → `placeOrder()` → `notifyOrderPlacedRemote()` triggers the backend Telegram send → confirms order number.

`placeOrder()` is **one call to `POST /api/orders`**, which bumps the daily counter, inserts the order and claims the voucher **in a single transaction** (`apps/backend/src/orders.ts`). It commits whole or not at all: a failed voucher claim rolls the order back, and the storefront drops the voucher and asks the customer to retry without it. It used to be three separate browser-to-Postgres calls with the redemption's error swallowed — which handed the customer a discount on a voucher that was never marked used. **The browser holds no `INSERT` on `orders`**; attribution comes from the request's JWT, never from the body (see the `orders_set_user_id` carve-out in `20260714100000_orders_backend_intake.sql`).

The Telegram notify stays a **separate call after the order lands** — folding it into the transaction would let a Telegram outage roll back paid orders.

Order numbers: `<PREFIX>-YYMMDD-XXXX` — six-digit day, and the daily counter starts at **50**, not 1. Prefix = first two alphanumerics of the slug, uppercased (`src/orderPrefix.ts`). Both are customer-visible and pinned by `apps/backend/src/orderNumber.ts`.

### Backend (`apps/backend/src/`)

Hono. `app.ts` defines the routes and **exports the app without serving it**; `index.ts` is the entry that calls `serve()`. That split is what lets `tests/api` drive the real routes in-process via `app.request()` — keep `app.ts` free of I/O at import (it does read `env.ts`, which fails fast on a missing var; that is deliberate and is why the test config stubs the Stripe keys).

`GOOGLE_MAPS_API_KEY` is optional: unset, distance lookups fail closed (a refusal, never a fee) and region-priced shops are unaffected.

Two ways to reach Postgres, and the difference matters:

- **`supabase.ts`** — the REST clients. `admin` (service role, RLS-exempt) and an anon client used only to verify caller JWTs.
- **`db.ts`** — a direct `postgres.js` connection, and the only thing here that can open a **transaction**. `supabase-js` cannot, which is the sole reason the order rules were ever PL/pgSQL: the daily counter needs an atomic upsert and the voucher needs a row lock. Every multi-statement rule goes through `withTransaction()`.

**`db.ts` is RLS-exempt.** It connects as the database owner, so no policy runs on it: on the backend's path, which merchant a row belongs to is a **TypeScript invariant, not a Postgres one**, and any code using it must check tenancy itself. RLS remains in force for the browser's anon/authenticated path and is the backstop — `tests/rls` is the proof it is still shut. Do not read "RLS protects it" as true of anything the backend writes.

Migrating the remaining SQL functions into this layer is #61. Order intake (`orders.ts`), guest tracking (`orderTracking.ts`) and referrals (`referrals.ts`) have moved; `next_order_number`, `redeem_voucher`, `track_order` and `my_referred_shops` are dropped.

The **intake gate** (shop exists and is active; the order is born `status = 'new'`) is enforced in **`orders.ts`, inside the transaction** — not by RLS, which does not run on this connection. The `orders_insert_guest_or_customer` policy is kept as the backstop for a client path that no longer has the grant. Not to be confused with the **Checkout gate** (`CONTEXT.md`), which is the sign-in / guest step in the browser.

### Shipping / pricing

All order totals come from one pure module, `packages/shared/src/pricing.ts` — `priceOrder()` (shipping region, promo, voucher, tax, rounding) and `voucherError()`. It lives in `@bitetime/shared` because it runs on **both** sides of the wire: the browser prices to quote, the backend prices to commit, and the backend refuses a quote it disagrees with (`price_changed`). The row → domain mappers (`shopRates`, `shopTax`, `productFromRow`, `voucherFromRow`) are shared for the same reason — mapping one side and not the other is a refused checkout, not a rounding gap. There is no order-level referral discount; it was removed in #70. Shipping rates are per-merchant: `WM` (West Malaysia) and `EM` (East Malaysia), with `EM_STATES` selecting the region; a storefront that collects no state passes `resolvedShipping` (flat fee). See `CONTEXT.md → Order pricing`.

A shop's **shipping policy** is `merchants.shipping_mode` (`region` | `distance`). Distance pricing is `base + rate × routed km`, with the km rounded to one decimal **before** the rate multiplies it; the road distance comes from `distance_quotes`, a 30-day cache keyed by `(origin place id, destination place id)` that the quote endpoint and order intake share — both read it first and write it on a miss. The routing call happens **outside** the order transaction. See `CONTEXT.md → Shipping policy` and `docs/adr/0001-distance-fees-from-a-cached-google-route.md`.

### Localisation

No i18n library. Every string is passed as `t(englishString, chineseString)` where `t = (en, zh) => lang === 'zh' ? zh : en`. `t` and the `lang` (`'en'` | `'zh'`) state live in `SessionContext`.

### Deployment

Deployed via Vercel; set the project **Root Directory** to `apps/frontend`. `pnpm deploy` runs the frontend `vite build`. Vite `base` is `/`.

The build emits **two HTML files, and which one serves a route matters**. `vite build` produces the usual empty SPA shell, then `scripts/prerender.tsx` (an SSR build, run by the same `build` script) renders the landing route to static markup and writes it over `dist/index.html`, keeping the untouched shell as `dist/app.html`. `vercel.json` rewrites everything to **`/app.html`**, not `index.html` — Vercel checks the filesystem before rewrites, so `/` is served by the prerendered `index.html` and never reaches the rule. Point that rewrite back at `index.html` and every storefront starts life with the marketing page's markup inside it.

The prerender exists because most LLM crawlers do not execute JavaScript; Google does, so this is a GEO fix, not a ranking one. It runs offline — `renderToStaticMarkup` never fires effects, so no provider reaches Supabase or the billing backend — and it throws if `<div id="root"></div>` is missing from the built HTML rather than silently shipping a blank page.

Head tags follow the same split. Anything true of **every** route is static in `index.html` (the og: tags, the Organization/WebSite identity JSON-LD). Anything true of **one** route is written at runtime by that route — the canonical URL (`src/canonical.ts`) and the landing FAQ JSON-LD (`src/marketing/structuredData.ts`, which adopts the prerendered block rather than appending a second). `og:url` stays absent either way: link-preview scrapers do not run JavaScript, so a runtime one would be invisible to them.

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues (`leongcheefai/Bitetime-Order-Platform`), via the `gh` CLI. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
