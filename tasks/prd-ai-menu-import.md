# PRD: AI Menu Import

## Introduction

A new shop must type its whole menu by hand before it can sell anything. Each product needs an English name, a Chinese name, an English description, a Chinese description, a price, a unit and a category (`ProductsManager.tsx`). A forty-item menu takes hours. The trial lasts seven days, so the shops that stall here never reach a first order.

This feature lets a merchant photograph their existing menu, and turns the photo into **draft products** that appear in the normal product editor. The merchant reviews and corrects the drafts, then saves. Nothing reaches the database until the merchant saves.

The AI reads. The merchant decides. That split is the whole design.

## Goals

- Cut the time from signup to a complete menu from hours to minutes.
- Produce drafts for every field the editor already holds: `name`, `name_zh`, `description`, `price`, `unit`, `unit_quantity`, plus a category label.
- Never write a product row the merchant has not seen.
- Never let a Claude outage, a missing API key or a bad photo produce a silent or empty result.
- Bound what one shop can spend of the platform's Claude budget in a day.

## User Stories

### US-001: Menu extraction adapter

**Description:** As a developer, I need a pure module that turns a menu image into draft products, so the extraction can be unit-tested with no env vars and no database.

**Acceptance Criteria:**
- [ ] New file `apps/backend/src/menuImport.ts`, shaped exactly like `releases.ts` and `github.ts`: the API key is a **parameter**, never read from `env.ts`, and the file imports nothing from `supabase.ts` or `db.ts`
- [ ] Exports `extractMenu(apiKey, input: { imageBase64: string; mediaType: 'image/jpeg' | 'image/png'; currency: string })` returning `MenuDraft | null`
- [ ] Returns `null` and logs when `apiKey` is empty — same guard as `humanizeRelease`
- [ ] Returns `null` and logs on `stop_reason === 'refusal'` and on `stop_reason === 'max_tokens'`
- [ ] Uses `model: 'claude-opus-5'` with `thinking: { type: 'adaptive' }` and `output_config: { format: { type: 'json_schema', schema: MENU_SCHEMA } }`
- [ ] `max_tokens: 16000`
- [ ] Uses no assistant prefill (it returns a 400 on this model)
- [ ] Unit tests in `apps/backend/tests/unit/` cover: empty key, refusal, truncation, malformed JSON, and a happy path against a fixture response
- [ ] Typecheck and lint pass

### US-002: Import endpoint

**Description:** As a merchant, I want to upload a menu photo and get draft products back, so I do not have to type them.

**Acceptance Criteria:**
- [ ] `POST /api/merchants/:id/menu-import` accepts a base64 image plus its media type
- [ ] Caller must own the merchant (same ownership check the other `/api/merchants/:id/*` routes use), else 403
- [ ] Merchant `status` must be `active`, else 403
- [ ] Rejects any media type other than `image/jpeg` and `image/png` with 400
- [ ] Rejects images over 5 MB with 413
- [ ] Returns 503 with a clear message when `env.anthropicApiKey` is empty — a refusal, never an empty draft list
- [ ] Returns 502 when `extractMenu` returns `null`
- [ ] **Writes nothing to any table**. The response body is the only output
- [ ] Route lives in `app.ts` and calls `menuImport.ts` through an injectable dep object, mirroring `releaseDeps`
- [ ] API test in `apps/backend/tests/api/` drives the real route via `app.request()` with a stubbed extractor
- [ ] Typecheck and lint pass

### US-003: Per-shop spend ceiling

**Description:** As the platform, I need a daily cap on imports per shop, so one merchant cannot run up a four-figure Claude bill.

**Acceptance Criteria:**
- [ ] A `menuImportMerchantWindow` sliding window added to `quotaWindows.ts` using `createSlidingWindow`, keyed by merchant id
- [ ] Limit 20 imports per 24 hours
- [ ] Over the limit returns 429 with a message naming the daily cap
- [ ] The comment block states the same inherited weakness the neighbouring windows do: in-memory, resets on redeploy, one instance only (#101)
- [ ] Unit test rolls the injected clock to prove the window slides
- [ ] Typecheck and lint pass

### US-004: Upload and review screen

**Description:** As a merchant, I want to see what the AI read before it becomes my menu, so a misread price never reaches a customer.

**Acceptance Criteria:**
- [ ] An "Import from a photo" action in `ProductsManager.tsx`
- [ ] Picking a file shows the photo, an explicit "Read this menu" button, and a progress state while the call runs
- [ ] Results render as an editable list: every field is a normal input, pre-filled with the draft
- [ ] Every row has a checkbox, checked by default; unchecking excludes that row from the save
- [ ] A single "Add N products" button performs the save through the existing product-create path
- [ ] Cancelling or navigating away discards every draft
- [ ] Both `t(en, zh)` strings supplied for all new copy
- [ ] Verified by running the app per the repo's `verify` skill — upload a real menu photo, correct a price, save, and confirm the products appear on the storefront
- [ ] Typecheck and lint pass

### US-005: Category labels, not category ids

**Description:** As a merchant, I want imported items grouped the way the menu groups them, without the AI inventing ids my shop does not hold.

**Acceptance Criteria:**
- [ ] The schema returns a plain `category_label` string, never a `category_id`
- [ ] The review screen maps each label to an existing entry in `merchants.product_categories` by case-insensitive name match
- [ ] Unmatched labels render a "create this category" toggle, defaulted **off**
- [ ] Items whose label matches nothing and whose toggle is off save as uncategorized (`category_id: null`), which `menuGroups.ts` already handles
- [ ] Verified by running the app per the `verify` skill
- [ ] Typecheck and lint pass

### US-006: Onboarding entry point

**Description:** As a new merchant, I want the import offered at the moment I am staring at an empty menu.

**Acceptance Criteria:**
- [ ] `OnboardingChecklist.tsx` "add your products" step links to the import action
- [ ] The step still completes by adding a product by hand — import is an accelerator, not a requirement
- [ ] Verified by running the app per the `verify` skill
- [ ] Typecheck and lint pass

## Functional Requirements

- **FR-1:** The system must accept a single JPG or PNG image per import request, up to 5 MB.
- **FR-2:** The system must send that image to the Claude API and request a JSON response matching a fixed schema.
- **FR-3:** The schema must contain, per item: `name` (string, required), `name_zh` (string, optional), `description` (string, optional), `price_text` (string, required, **as printed on the menu**), `unit` (optional, constrained to the product form's own unit list), `unit_quantity` (integer, optional), `category_label` (string, optional).
- **FR-3a:** There must be **no** Chinese description field. `descr_zh` exists on the table but is excluded from the product write allowlist (`writes.ts`), and the product form has no input for it — a value read into it could be neither reviewed, corrected nor saved. `name_zh` carries none of those problems and is read.
- **FR-3b:** `unit` must be one of the values the product form's unit `Select` offers. A unit outside that list must be dropped rather than passed through: it would disappear from the form without telling the merchant.
- **FR-4:** The backend must parse `price_text` into a number. When it cannot, the draft row must carry the raw text and the review screen must show an empty, required price field.
- **FR-5:** The system must not persist the uploaded image.
- **FR-6:** The system must not create, update or delete any `products` row during an import request.
- **FR-7:** The merchant must be able to edit every field of every draft before saving.
- **FR-8:** The merchant must be able to exclude any draft from the save.
- **FR-9:** Saving must go through the existing product-create path, so every existing validation and RLS rule applies unchanged.
- **FR-10:** When `ANTHROPIC_API_KEY` is unset, the endpoint must refuse with 503 and the UI must say the feature is unavailable.
- **FR-11:** Imports must be capped at 20 per shop per 24 hours.
- **FR-12:** The feature must be available to any merchant whose shop `status` is `active`.

## Non-Goals (Out of Scope)

- **Option groups.** No extraction of sizes, add-ons or variants. The merchant builds those in `OptionGroupsEditor.tsx` afterwards.
- **PDF and plain-text input.** Photo only in v1.
- **Product images.** The import creates no `image_urls`; the menu photo is not reused as product art.
- **Multi-page or multi-image imports.** One photo per request. A two-page menu is two imports.
- **Automatic saving.** There is no "trust the AI" path.
- **Editing existing products.** Import only creates drafts; it never matches against or updates a product the shop already holds.
- **Translation of an existing menu.** Filling `name_zh` on products already in the database is a separate feature.
- **Any plan gate.** Every active shop gets this.

## Design Considerations

- Reuse `ProductsManager.tsx` inputs for the review rows so the corrected draft looks exactly like the product it becomes.
- Show the source photo beside the draft list. Checking a price against the photo is the merchant's main job on this screen, and making them switch windows to do it is how wrong prices get saved.
- Price is the highest-risk field. Give it visual weight and never pre-fill it with a guess when parsing failed.
- Follow `merchants.currency` for display. Pricing is display-only with no FX, as everywhere else.

## Technical Considerations

- `@anthropic-ai/sdk` is already a backend dependency and **already carries its `--external:` flag** in the esbuild command (`apps/backend/package.json`). No packaging change is needed.
- `menuImport.ts` must stay free of `supabase.ts` and `db.ts` imports. That is what lets `pnpm --filter @bitetime/backend test` run it with no Supabase and no env.
- `app.ts` must stay free of import-time I/O. The route registers; the adapter is called inside the handler.
- The `products` table has a `description` column. `types.ts` also carries a legacy `desc` field — write `description`.
- `category_id` has no foreign key behind it (ADR 0013). An id the shop no longer holds and `null` are one state: uncategorized. This is exactly why the model returns a label instead.
- Claude reads images natively as base64 content blocks. Do not send a URL — the image never leaves the backend's memory.
- Model choice is `claude-opus-5`, not the `claude-haiku-4-5` used in `releases.ts`. That call rewrites text that already exists; this one reads prices off a photograph, and a misread price is money.

## Success Metrics

- A merchant with a printed menu reaches a complete product list in under ten minutes.
- Over 90% of extracted names need no correction on a legible photo.
- 100% of prices are confirmed by a human before any product is saved — by construction, not by policy.
- Share of trials that reach at least ten products rises.

## Open Questions

- `merchants.plan` still permits `'basic'` in its check constraint even though only Pro is sold. If a basic tier returns, does import stay ungated?
- Should a failed parse of `price_text` block the whole import or only that row? This PRD says only that row.
- Do we keep any record of imports for cost attribution, or is the sliding window enough?
- Handwritten and chalkboard menus are common for small shops. Do we measure accuracy on those separately before promising the feature in marketing copy?
