# PRD: Shop Analytics Assistant

## Introduction

The merchant Overview already draws revenue, order counts, a product breakdown and a status breakdown, all from `computeMerchantStats` in `@bitetime/shared`. Pro merchants can export the same numbers as an XLSX workbook. The numbers are there. Reading them is the problem: a shop owner who wants to know "was last month better than the month before, and what sold worst" has to pick a range, read a chart, switch to the donut, and do the comparison in their head.

This feature adds a question box to the dashboard. The merchant types a question in plain English or Chinese. Claude answers it from that shop's own order statistics.

**The model is given no query tool, and never sees a merchant id.** It gets one tool that returns statistics for "this shop", where "this shop" is resolved on the server from the caller's session before the model runs. A cross-tenant question is not blocked — it is unexpressible.

## Goals

- Let a merchant get an answer about their own orders in one sentence instead of four clicks.
- Reuse `computeMerchantStats` so the assistant's answer can never disagree with the chart beside it.
- Make cross-tenant data access structurally impossible, not merely checked.
- Answer in the merchant's chosen language, honouring the shop's currency and timezone.
- Bound what one shop can spend of the platform's Claude budget in a day.

## User Stories

### US-001: Stats tool bound to the caller's shop

**Description:** As a developer, I need a tool the model can call that is incapable of naming a shop, so tenancy cannot depend on the model behaving.

**Acceptance Criteria:**
- [ ] New file `apps/backend/src/shopAssistant.ts`
- [ ] The tool schema exposes exactly two parameters: `days` (one of `REVENUE_RANGES`) and `granularity` (`'day' | 'week'`, optional)
- [ ] The schema contains **no** merchant id, shop id, slug or any other tenant selector
- [ ] The tool handler is a closure created per request over the already-resolved merchant id — the id is not a function argument the model can supply
- [ ] The handler composes its inputs exactly as `GET /api/merchants/:id/stats` already does — `statsOrders(m.id)`, `distinctCustomerCount(m.id)` and the shop's vouchers — then returns:
      `computeMerchantStats(orders, customerCount, vouchers, new Date(), { days, granularity, timeZone })`
- [ ] `orders` must be the shop's **complete** history via `statsOrders`, never a page. `totalOrders`, `revenue` and both deltas are all-time, so a truncated read does not make a smaller chart — it makes a wrong revenue figure with nothing saying so (#144)
- [ ] `timeZone` is `isTimezone(m.timezone) ? m.timezone : DEFAULT_TIMEZONE`, the same validation the stats route and the XLSX export both apply
- [ ] A unit test asserts the serialized tool schema has no property whose name matches `/merchant|shop|tenant|slug|id/i`
- [ ] Typecheck and lint pass

### US-002: Assistant adapter

**Description:** As a developer, I need the Claude tool-calling loop in a module I can test with no database and no env vars.

**Acceptance Criteria:**
- [ ] `askShopAssistant(apiKey, { question, lang, currency, getStats })` — the API key is a **parameter**, and `getStats` is injected, so the module imports nothing from `supabase.ts` or `db.ts` (same shape as `releases.ts` and `github.ts`)
- [ ] Returns `null` and logs when `apiKey` is empty
- [ ] Returns `null` and logs on `stop_reason === 'refusal'` and on `stop_reason === 'max_tokens'`
- [ ] Uses `model: 'claude-opus-5'`, `thinking: { type: 'adaptive' }`, `max_tokens: 8000`
- [ ] Uses the SDK tool runner, capped at 6 iterations
- [ ] The system prompt states the shop's currency, timezone and today's date, and instructs the model to answer only from tool results and to say plainly when the data does not contain the answer
- [ ] Unit tests cover: empty key, refusal, truncation, a question answered from one tool call, and a question the stats cannot answer
- [ ] Typecheck and lint pass

### US-003: Ask endpoint

**Description:** As a merchant, I want to send a question and get an answer about my shop.

**Acceptance Criteria:**
- [ ] `POST /api/merchants/:id/ask`, body `{ question: string, lang: 'en' | 'zh' }`
- [ ] Caller must own the merchant, else 403
- [ ] Merchant `status` must be `active`, else 403
- [ ] Question longer than 500 characters returns 400
- [ ] Returns 503 when `env.anthropicApiKey` is empty
- [ ] Returns 502 when `askShopAssistant` returns `null`
- [ ] The route resolves the merchant **before** building the tool closure, and passes no caller-supplied id into it
- [ ] API test in `apps/backend/tests/api/` drives the real route via `app.request()` and asserts a caller cannot reach another shop's numbers by any body field
- [ ] Typecheck and lint pass

### US-004: Per-shop spend ceiling

**Description:** As the platform, I need a daily cap on questions per shop.

**Acceptance Criteria:**
- [ ] An `assistantMerchantWindow` added to `quotaWindows.ts` via `createSlidingWindow`, keyed by merchant id
- [ ] Limit 50 questions per 24 hours
- [ ] Over the limit returns 429 naming the daily cap
- [ ] Comment states the same inherited in-memory weakness as its neighbours (#101)
- [ ] Unit test rolls the injected clock
- [ ] Typecheck and lint pass

### US-005: Question box on Overview

**Description:** As a merchant, I want to ask my question where the numbers already are.

**Acceptance Criteria:**
- [ ] A question input on `Overview.tsx`, below the existing KPI and chart blocks
- [ ] Three example questions shown as one-tap prompts when the box is empty
- [ ] Answer renders as markdown below the box, with a visible loading state while the call runs
- [ ] Errors render as plain text; a 429 says the daily limit is reached and a 503 says the feature is unavailable
- [ ] Asking a new question replaces the previous answer; no history is kept
- [ ] All new copy passes through `t(en, zh)`
- [ ] Verified by running the app per the repo's `verify` skill, against a shop with real seeded orders
- [ ] Typecheck and lint pass

### US-006: Answer disclaimer

**Description:** As a merchant, I want to know what the answer is based on, so I do not act on a number that excludes cancelled orders without realising it.

**Acceptance Criteria:**
- [ ] Every answer is followed by a fixed line naming the window the model actually queried and stating that cancelled orders are excluded (matching `isBooked`)
- [ ] The line is generated from the tool call's own arguments, not written by the model
- [ ] Verified by running the app per the `verify` skill
- [ ] Typecheck and lint pass

## Functional Requirements

- **FR-1:** The system must accept a free-text question of up to 500 characters from an authenticated merchant about their own shop.
- **FR-2:** The system must expose exactly one tool to the model, returning `MerchantStats` for the caller's shop.
- **FR-3:** The tool's parameters must be limited to `days` and `granularity`. No tenant selector may appear in the schema.
- **FR-4:** The merchant id used to fetch orders must come from the request's resolved session, never from the model or the request body.
- **FR-5:** The model must never be given a raw SQL tool, a table name, or a free-form filter.
- **FR-6:** All aggregation must run through `computeMerchantStats`, so the assistant and the Overview chart derive from one implementation.
- **FR-7:** Day bucketing must use `merchants.timezone`.
- **FR-8:** Money in the answer must be formatted in `merchants.currency`.
- **FR-9:** The answer must be produced in the language the merchant is currently reading the dashboard in.
- **FR-10:** Every answer must carry a system-generated line stating the queried window and the cancelled-order exclusion.
- **FR-11:** Questions must be capped at 50 per shop per 24 hours.
- **FR-12:** When `ANTHROPIC_API_KEY` is unset, the endpoint must refuse with 503.
- **FR-13:** The feature must be available to any merchant whose shop `status` is `active`.

## Non-Goals (Out of Scope)

- **Generated SQL, in any form.** `db.ts` connects as the database owner and no RLS policy runs on it, so on the backend's path tenancy is a TypeScript invariant. A model-authored query against that connection is a cross-tenant leak waiting for one bad prompt.
- **Shop customer data.** No CRM rows, no names, no phone numbers, no per-customer spend. Orders statistics only.
- **Product, voucher and promo analysis beyond what `MerchantStats` already returns.** `productRevenue` slices are in scope because they are already computed; nothing new is.
- **Charts drawn by the assistant.** Text answers only. The chart is already on the page.
- **Conversation history.** Each question is independent. No follow-ups, no context carried between questions.
- **Writes of any kind.** The assistant cannot change an order, a product, a price or a setting.
- **Cross-shop comparison or platform benchmarks.** A merchant cannot ask how they compare to other shops.
- **Superadmin or platform-wide analytics.** Merchant-facing only.
- **Any plan gate.** Every active shop gets this.

## Design Considerations

- Place the box under the existing numbers, not above them. The chart is the primary surface; this is a shortcut through it, not a replacement.
- Example prompts matter more than the input. Merchants do not know what they are allowed to ask. Seed with three concrete, answerable questions such as "How did last month compare to the month before?", "Which product made the least money in the last 30 days?", "How many orders did I cancel this month?".
- Keep the answer short. A shop owner on a phone between orders will not read a report.
- The disclaimer line is not decoration. `isBooked` excludes cancelled orders from revenue, and a merchant who does not know that will read a wrong number confidently.

## Technical Considerations

- `@anthropic-ai/sdk` is already a backend dependency and **already has its `--external:` flag** in the esbuild command. No packaging change.
- `computeMerchantStats` is pure and already runs on both sides of the wire — the browser draws the chart with it, the backend builds the XLSX with it. Adding the assistant as a third consumer keeps the one-implementation property that `report.ts` was written to preserve.
- Its signature is `computeMerchantStats(orders, customerCount, vouchers, now, window)`. The clock is injected, so a test pins a date rather than waiting for one.
- **`GET /api/merchants/:id/stats` already assembles every one of those arguments.** The tool handler should reuse that composition rather than build a second one; two assemblies of the same inputs is how the assistant and the chart start to disagree, which is the exact failure this design is shaped to prevent.
- The call declares `fallbacks: 'default'` (beta `server-side-fallback-2026-07-01`), so a safety-classifier decline is re-run on another model inside the same request rather than reaching the merchant as a 502. `'default'` routes by refusal category and owes no migration when a pinned model is deprecated. The tool runner accepts it — its params extend the beta message params.
- `MerchantStats` is small and fully serializable. The whole object fits comfortably in one tool result, so most questions need exactly one tool call.
- `SeriesWindow.timeZone` must be set explicitly. Omitted, buckets fall in the runtime's zone — right for a browser standing in for its merchant, wrong for a UTC server.
- `app.ts` must stay free of import-time I/O; the adapter is called inside the handler.
- The current branch (`feat/praxor-analytics`) replaced Vercel Analytics with first-party **product** measurement. That is a different concern — visitor telemetry for the platform, not shop statistics for a merchant. This feature touches none of it.

## Success Metrics

- A merchant gets a correct answer to a month-over-month question in under 15 seconds.
- Zero cross-tenant disclosures — enforced by the schema, and asserted by a test that no tenant selector exists.
- Assistant answers agree with the on-screen chart for the same window, every time, by construction.
- Merchants who use the assistant open the Overview tab more often.

## Open Questions

- Should a question that the stats cannot answer suggest the nearest question they *can* answer, or just decline?
- `MerchantStats` KPIs are all-time while `series`, `productRevenue` and `statusBreakdown` cover the selected window. That split is deliberate and documented in `merchantStats.ts` — on screen the range pills sit between the two groups and show which is which. **The model gets no pills.** Handed the bare object it will read `revenue` as the window's revenue and answer a range question with an all-time number. Assume the tool result needs explicit per-field window labels, and treat "the model works it out" as the thing to disprove, not assume.
- Do we log questions? They are the best signal we will ever get about what merchants want from the dashboard — but they are merchant text, and storing them needs a stated retention position.
- Is 50 questions per day per shop generous or tight? No usage data exists yet to set it from.
- `merchants.plan` still permits `'basic'`. If a basic tier returns, does this stay ungated?
