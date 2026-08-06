# Feedback Screenshot Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a merchant attach up to three screenshots to a platform feedback submission, visible only to a superadmin.

**Architecture:** The existing `POST /api/merchants/:id/feedback` learns to read `multipart/form-data` in addition to JSON. The row is inserted first, then the files are uploaded by the backend's service-role client into a **private** `feedback-images` bucket with no storage policies, and the paths are stamped onto the row. A superadmin reads them back through an authenticated route that indexes into the row's own `image_paths` array. The auto-filed GitHub issue states the screenshot count and carries no image URL — the platform repo is public.

**Tech Stack:** Hono 4 (`c.req.parseBody({ all: true })`), Supabase Storage via the service-role client, React 19 + Vite, Vitest (`test` = unit, `test:db` = Postgres-backed), `@bitetime/shared` for rules both sides enforce.

**Spec:** `docs/superpowers/specs/2026-08-06-feedback-image-upload-design.md`

## Global Constraints

- **Up to 3 images**, **5 MiB each** (`5242880` bytes), types `image/jpeg` / `image/png` / `image/webp`. These exact numbers appear in three places on purpose: `@bitetime/shared`, the route, and the bucket config. Change one, change all three.
- **The platform repo `leongcheefai/Bitetime-Order-Platform` is PUBLIC.** No image URL — signed or unsigned — may ever reach a GitHub issue body.
- **Store paths, never URLs.** `image_paths` holds storage paths in the form `{merchant_id}/{feedback_id}/{uuid}.{ext}`.
- **Never run `db:push`** or any `supabase` command that reaches production. Apply migrations locally with `pnpm --filter @bitetime/backend db:migrate` and say plainly that production still needs the push.
- **Never mock the database** in `tests/db` / `tests/rls` / `tests/api` suites. They exist to prove properties of real Postgres.
- Every user-visible string is `t(englishString, chineseString)`. No i18n library.
- `@bitetime/shared` holds only rules that must hold **identically on both sides of the wire**. Anything only one side needs stays on that side.
- Backend relative imports keep `.js` specifiers (NodeNext). Frontend uses extensionless relative imports.
- Adding a backend **runtime dependency** requires a matching `--external:` flag in the `build` script. This plan adds none.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/feedback.ts` | **Modify.** Adds the image count/size/type rules and `validateFeedbackImage`. Existing `validateFeedback` untouched. |
| `packages/shared/src/index.ts` | **Modify.** Re-exports the new symbols. |
| `packages/shared/src/feedback.test.ts` | **Modify.** Unit tests for `validateFeedbackImage`. |
| `apps/backend/supabase/migrations/20260806120000_feedback_images.sql` | **Create.** `image_paths` column + CHECK, private bucket + limits. |
| `apps/backend/tests/rls/feedback-images-storage.test.ts` | **Create.** Proves anon/authenticated get nothing in the bucket. |
| `apps/backend/src/github.ts` | **Modify.** `buildIssueBody` gains `imageCount` + `adminUrl`. |
| `apps/backend/tests/unit/github.test.ts` | **Modify.** Screenshot line present at >0, absent at 0. |
| `apps/backend/src/feedback.ts` | **Modify.** `image_paths` on the row types; new `updateFeedbackImages`. |
| `apps/backend/src/app.ts` | **Modify.** Multipart-aware submit route; new superadmin image-read route. |
| `apps/backend/tests/api/feedback.test.ts` | **Modify.** Multipart submit, rejections, read route. |
| `apps/frontend/src/api.ts` | **Modify.** New `apiSendForm`. |
| `apps/frontend/src/types.ts` | **Modify.** `FeedbackItem.image_paths`. |
| `apps/frontend/src/store.ts` | **Modify.** `submitFeedback` takes files; new `fetchFeedbackImage`. |
| `apps/frontend/src/merchant/FeedbackFab.tsx` | **Modify.** File picker + thumbnail strip + partial-failure message. |
| `apps/frontend/src/admin/AdminFeedback.tsx` | **Modify.** Thumbnails per row. |
| `CONTEXT.md` | **Modify.** Document the bucket and its no-policy posture. |

---

### Task 1: Shared image rules

**Files:**
- Modify: `packages/shared/src/feedback.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/feedback.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FEEDBACK_MAX_IMAGES: 3`, `MAX_FEEDBACK_IMAGE_BYTES: number`, `FEEDBACK_IMAGE_TYPES: readonly string[]`, `type FeedbackImageValidation = { ok: true } | { ok: false; error: string }`, `validateFeedbackImage(file: { type: string; size: number }): FeedbackImageValidation`. Used by Task 4 (backend route) and Task 6 (`store.ts`).

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/feedback.test.ts`. Add `validateFeedbackImage`, `MAX_FEEDBACK_IMAGE_BYTES` and `FEEDBACK_MAX_IMAGES` to the existing `import { … } from './feedback.js'` at the top of that file.

```ts
describe('validateFeedbackImage', () => {
  it('accepts each type the bucket accepts', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validateFeedbackImage({ type, size: 1024 })).toEqual({ ok: true })
    }
  })

  it('refuses a type the bucket would reject, naming what is allowed', () => {
    const r = validateFeedbackImage({ type: 'application/pdf', size: 1024 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/JPEG, PNG or WebP/)
  })

  it('refuses image/gif — an image type, but not one this bucket takes', () => {
    expect(validateFeedbackImage({ type: 'image/gif', size: 1024 }).ok).toBe(false)
  })

  it('accepts a file exactly at the ceiling and refuses one byte over', () => {
    expect(validateFeedbackImage({ type: 'image/png', size: MAX_FEEDBACK_IMAGE_BYTES }))
      .toEqual({ ok: true })
    const over = validateFeedbackImage({ type: 'image/png', size: MAX_FEEDBACK_IMAGE_BYTES + 1 })
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.error).toMatch(/5MB/)
  })

  it('refuses an empty file — the route would upload zero bytes and call it a screenshot', () => {
    expect(validateFeedbackImage({ type: 'image/png', size: 0 }).ok).toBe(false)
  })

  it('pins the count and size ceilings the migration and the route also state', () => {
    expect(FEEDBACK_MAX_IMAGES).toBe(3)
    expect(MAX_FEEDBACK_IMAGE_BYTES).toBe(5 * 1024 * 1024)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @bitetime/shared test
```

Expected: FAIL — `validateFeedbackImage is not exported by './feedback.js'` (or `is not a function`).

- [ ] **Step 3: Write the implementation**

Append to `packages/shared/src/feedback.ts`:

```ts
// ── Screenshot attachments ────────────────────────────────────────────────────
// Shared for the same reason the message bounds are: the browser tells the merchant before
// a 5 MiB body crosses the wire, and the backend refuses regardless of the client. The
// bucket config in 20260806120000_feedback_images.sql is the final authority — these rules
// exist so the two never disagree about what Storage will take.

export const FEEDBACK_MAX_IMAGES = 3
export const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024
export const FEEDBACK_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type FeedbackImageValidation = { ok: true } | { ok: false; error: string }

/**
 * Type and size of ONE file. The caller counts files against FEEDBACK_MAX_IMAGES itself,
 * and the caller names the offending file: this takes `{ type, size }` rather than a `File`
 * so the backend can call it on a multipart part without constructing one, and so nothing
 * here assumes how either side displays an error.
 */
export function validateFeedbackImage(file: { type: string; size: number }): FeedbackImageValidation {
  if (!(FEEDBACK_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, error: 'Screenshots must be JPEG, PNG or WebP' }
  }
  // Zero bytes passes a size ceiling but is not a screenshot. Caught here rather than at the
  // route so the merchant is told, matching the byteLength === 0 check the payment-proof
  // upload already makes.
  if (file.size === 0) {
    return { ok: false, error: 'Screenshot is empty' }
  }
  if (file.size > MAX_FEEDBACK_IMAGE_BYTES) {
    return { ok: false, error: 'Each screenshot must be 5MB or smaller' }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Re-export from the package index**

In `packages/shared/src/index.ts`, replace the existing feedback export block with:

```ts
export {
  validateFeedback, isFeedbackCategory, isFeedbackStatus, validateFeedbackImage,
  FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, FEEDBACK_MAX_LENGTH,
  FEEDBACK_MAX_IMAGES, MAX_FEEDBACK_IMAGE_BYTES, FEEDBACK_IMAGE_TYPES,
} from './feedback.js'
export type {
  FeedbackCategory, FeedbackStatus, FeedbackDraft, FeedbackValidation, FeedbackImageValidation,
} from './feedback.js'
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @bitetime/shared test
```

Expected: PASS, including the pre-existing `validateFeedback` tests.

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/feedback.ts packages/shared/src/feedback.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): rules for feedback screenshot attachments

Three files, 5 MiB each, jpeg/png/webp. Shared for the same reason the
message bounds are: the browser has to tell the merchant before the bytes
cross the wire, and the server has to refuse regardless of the client."
```

---

### Task 2: Migration — column, private bucket, and the proof it is shut

**Files:**
- Create: `apps/backend/supabase/migrations/20260806120000_feedback_images.sql`
- Create: `apps/backend/tests/rls/feedback-images-storage.test.ts`

**Interfaces:**
- Consumes: `FEEDBACK_MAX_IMAGES` / `MAX_FEEDBACK_IMAGE_BYTES` / `FEEDBACK_IMAGE_TYPES` from Task 1 — as **restated literal values**, not imports. SQL cannot import TypeScript; the numbers are duplicated deliberately and the comments say so.
- Produces: `merchant_feedback.image_paths text[] not null default '{}'` (max 3, CHECK-enforced) and a private `feedback-images` bucket with zero `storage.objects` policies. Task 4 and Task 5 read and write both.

**Prerequisite:** a running local Supabase. From `apps/backend/`, `supabase start` if `supabase status` reports nothing.

- [ ] **Step 1: Write the failing RLS test**

Create `apps/backend/tests/rls/feedback-images-storage.test.ts`:

```ts
// tests/rls/feedback-images-storage.test.ts
// The `feedback-images` bucket is deliberately given NO storage.objects policies
// (20260806120000) — a merchant's screenshot goes in through the backend's service-role
// client (POST /api/merchants/:id/feedback) and comes out through a superadmin-only route
// (GET /api/admin/feedback/:feedbackId/images/:index). The bucket is PRIVATE because the
// platform repo is public and a bug screenshot is usually the merchant's own dashboard —
// customer names, phone numbers, addresses.
//
// This is the proof that "no policy" really does mean "no access" for the browser's own
// Supabase client. Nothing in the app exercises this bucket from the browser, so a future
// migration that flips it public or adds a permissive policy is only ever caught here.
import { describe, it, expect } from 'vitest'
import { anonClient, makeUser, seedMerchant, serviceClient } from './helpers.js'

const BUCKET = 'feedback-images'

// Smallest valid PNG (1x1) — the bucket enforces allowed_mime_types, so the upload has to be
// a real image/png or Storage would refuse it for a reason unrelated to the policy under test.
const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)
function png() {
  return new Blob([PNG_1X1], { type: 'image/png' })
}

describe('feedback-images storage: no browser access either way', () => {
  it('denies an anonymous upload', async () => {
    const { error } = await anonClient()
      .storage.from(BUCKET)
      .upload('anon/anon.png', png(), { contentType: 'image/png' })
    expect(error).not.toBeNull()
  })

  it('denies a merchant owner uploading, even into what would be their own folder', async () => {
    const owner = await makeUser('feedback-images-owner@example.com', 'password123')
    const { data: session } = await owner.auth.getSession()
    const merchantId = await seedMerchant({
      slug: 'feedback-images-shop',
      owner_id: session.session!.user.id,
    })

    const { error } = await owner.storage
      .from(BUCKET)
      .upload(`${merchantId}/own.png`, png(), { contentType: 'image/png' })
    expect(error).not.toBeNull()
  })

  it('denies an anonymous read of an object the service role wrote', async () => {
    const path = 'seed/read-check.png'
    await serviceClient().storage.from(BUCKET)
      .upload(path, png(), { contentType: 'image/png', upsert: true })

    const { error } = await anonClient().storage.from(BUCKET).download(path)
    expect(error).not.toBeNull()

    await serviceClient().storage.from(BUCKET).remove([path])
  })

  it("denies a signed-in merchant reading another shop's screenshot", async () => {
    const path = 'seed/cross-tenant.png'
    await serviceClient().storage.from(BUCKET)
      .upload(path, png(), { contentType: 'image/png', upsert: true })

    const snooper = await makeUser('feedback-images-snooper@example.com', 'password123')
    const { error } = await snooper.storage.from(BUCKET).download(path)
    expect(error).not.toBeNull()

    await serviceClient().storage.from(BUCKET).remove([path])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @bitetime/backend test:db tests/rls/feedback-images-storage.test.ts
```

Expected: FAIL. The bucket does not exist, so `error` is non-null for the wrong reason ("Bucket not found") and the third and fourth tests fail at the service-role seed upload. That failure is the signal to write the migration — the tests must pass **after** the bucket exists, which is what proves the policy posture rather than the bucket's absence.

- [ ] **Step 3: Write the migration**

Create `apps/backend/supabase/migrations/20260806120000_feedback_images.sql`:

```sql
-- Screenshots attached to merchant platform feedback (#89 follow-up). See
-- docs/superpowers/specs/2026-08-06-feedback-image-upload-design.md.
--
-- Up to three per submission, uploaded by the backend's service-role client inside
-- POST /api/merchants/:id/feedback, read back only by a superadmin through
-- GET /api/admin/feedback/:feedbackId/images/:index.

-- Storage PATHS, never URLs — the rule merchants.payment_qr and orders.payment_proof already
-- follow. `not null default '{}'` so every pre-existing row reads as "no screenshots" without
-- a backfill, and no consumer has to treat null and [] as two spellings of empty.
alter table public.merchant_feedback
  add column if not exists image_paths text[] not null default '{}';

comment on column public.merchant_feedback.image_paths is
  'Storage paths in the PRIVATE `feedback-images` bucket ({merchant_id}/{feedback_id}/{uuid}.{ext}).
   Never URLs. Written only by the feedback submit route (service role); read only through
   GET /api/admin/feedback/:feedbackId/images/:index, which indexes into THIS array rather than
   accepting a path from the caller.';

-- The database's own copy of FEEDBACK_MAX_IMAGES in @bitetime/shared, for the same reason the
-- message CHECK duplicates FEEDBACK_MAX_LENGTH: the shared rule tells the merchant before they
-- lose anything, and this is what makes the limit true regardless of the caller.
-- `add constraint if not exists` does not exist in Postgres, hence the guard.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'merchant_feedback_image_count') then
    alter table public.merchant_feedback
      add constraint merchant_feedback_image_count check (cardinality(image_paths) <= 3);
  end if;
end $$;

-- PRIVATE, unlike product-images and payment-qr. The platform repo is PUBLIC, and a merchant's
-- bug screenshot is usually their own dashboard: customer names, phone numbers, delivery
-- addresses. Nothing about this bucket may become world-readable.
insert into storage.buckets (id, name, public)
values ('feedback-images', 'feedback-images', false)
on conflict (id) do nothing;

update storage.buckets
set
  file_size_limit = 5242880, -- 5 MiB — MAX_FEEDBACK_IMAGE_BYTES in @bitetime/shared
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] -- FEEDBACK_IMAGE_TYPES
where id = 'feedback-images';

-- Deliberately NO storage.objects policies, mirroring payment-proof (20260804160000) and
-- sample-shop-screenshots (20260804180000). With `public: false` and zero policies,
-- anon/authenticated get nothing in either direction; every read and write goes through the
-- service-role client, which bypasses RLS entirely. tests/rls/feedback-images-storage.test.ts
-- is the proof.

-- No grant change on merchant_feedback: the table already holds no browser grants
-- (20260718130000) and RLS is enabled with no policies. Adding a column changes neither.
```

- [ ] **Step 4: Apply it locally**

```bash
cd apps/backend && pnpm db:migrate
```

Expected: the new version is applied. If it refuses because local history holds a version whose file is gone (one local Supabase shared across branches), the lossless fix is `supabase migration repair --status reverted <version> --db-url "postgresql://postgres:postgres@127.0.0.1:55322/postgres"` — read the port off `supabase status -o env`. **Never** run `repair` without `--db-url`: it targets production silently. Never run `db:reset` without asking.

- [ ] **Step 5: Run the RLS test to verify it passes**

```bash
pnpm --filter @bitetime/backend test:db tests/rls/feedback-images-storage.test.ts
```

Expected: PASS, all four. The third and fourth now reach a real service-role upload before asserting the browser cannot read it.

- [ ] **Step 6: Verify the column is real and the CHECK bites**

```bash
cd apps/backend && supabase status -o env
```

Take the `DB_URL` value, then:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -c "insert into public.merchant_feedback (merchant_id, user_id, category, message, image_paths) select id, owner_id, 'other', 'check test', array['a','b','c','d'] from public.merchants limit 1;"
```

Expected: `ERROR: new row for relation "merchant_feedback" violates check constraint "merchant_feedback_image_count"`. (Adjust the port if `supabase status` reports a different one.)

- [ ] **Step 7: Commit**

```bash
git add apps/backend/supabase/migrations/20260806120000_feedback_images.sql apps/backend/tests/rls/feedback-images-storage.test.ts
git commit -m "feat(db): private feedback-images bucket and image_paths column

The bucket gets no storage.objects policies at all, the payment-proof
posture: the platform repo is public and a bug screenshot is usually the
merchant's own dashboard, so nothing here may become world-readable. The
RLS suite is the proof that no policy really does mean no access, since
no app surface exercises this bucket from the browser."
```

> **Production note for the final report:** this migration still needs a human to run `db:push`.

---

### Task 3: GitHub issue body states the screenshot count

**Files:**
- Modify: `apps/backend/src/github.ts`
- Test: `apps/backend/tests/unit/github.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `buildIssueBody({ message, shopName, shopSlug, feedbackId, createdAt, imageCount, adminUrl })`. `imageCount: number` and `adminUrl: string` are **required** — Task 4 passes both. Making them required means a caller cannot forget the count and silently file an issue that hides the screenshots.

- [ ] **Step 1: Write the failing tests**

Replace the existing `describe('buildIssueBody', …)` block in `apps/backend/tests/unit/github.test.ts` with:

```ts
describe('buildIssueBody', () => {
  const base = {
    message: 'App crashes when I add a voucher at checkout',
    shopName: 'Golden Wok',
    shopSlug: 'golden-wok',
    feedbackId: 'abc-123',
    createdAt: '2026-08-04T00:00:00Z',
    adminUrl: 'https://tinyorder.vercel.app',
  }

  it('includes the message, shop, feedback id and timestamp', () => {
    const body = buildIssueBody({ ...base, imageCount: 0 })
    expect(body).toContain('App crashes when I add a voucher at checkout')
    expect(body).toContain('Golden Wok')
    expect(body).toContain('/s/golden-wok')
    expect(body).toContain('abc-123')
    expect(body).toContain('2026-08-04T00:00:00Z')
  })

  it('says nothing about screenshots when there are none', () => {
    expect(buildIssueBody({ ...base, imageCount: 0 })).not.toContain('Screenshot')
  })

  it('states the count and where to look when there are some', () => {
    const body = buildIssueBody({ ...base, imageCount: 2 })
    expect(body).toContain('Screenshots: 2')
    expect(body).toContain('https://tinyorder.vercel.app/admin#feedback')
  })

  it('never puts an image URL in a public issue', () => {
    const body = buildIssueBody({ ...base, imageCount: 3 })
    expect(body).not.toMatch(/feedback-images/)
    expect(body).not.toMatch(/storage\/v1/)
    expect(body).not.toMatch(/\.(png|jpe?g|webp)\b/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @bitetime/backend test tests/unit/github.test.ts
```

Expected: FAIL — TypeScript rejects `imageCount` / `adminUrl` as unknown properties, and the count assertions fail.

- [ ] **Step 3: Write the implementation**

In `apps/backend/src/github.ts`, replace `buildIssueBody` with:

```ts
export function buildIssueBody(input: {
  message: string
  shopName: string
  shopSlug: string
  feedbackId: string
  createdAt: string
  imageCount: number
  adminUrl: string
}): string {
  const lines = [
    input.message,
    '',
    '---',
    `Shop: ${input.shopName} (/s/${input.shopSlug})`,
    `Feedback ID: ${input.feedbackId}`,
    `Submitted: ${input.createdAt}`,
  ]
  // COUNT AND A DASHBOARD LINK ONLY — never an image URL, signed or otherwise. This repo is
  // public (GITHUB_REPO above), and a merchant's bug screenshot is usually their own dashboard:
  // customer names, phone numbers, delivery addresses. The bucket is private and the bytes come
  // out through a superadmin-only route; this line exists so whoever triages the issue knows
  // there is something to go and look at. Omitted entirely at zero, so every issue body filed
  // before this shipped stays byte-identical.
  if (input.imageCount > 0) {
    lines.push(`Screenshots: ${input.imageCount} — view at ${input.adminUrl}/admin#feedback`)
  }
  return lines.join('\n')
}
```

`adminUrl` is a **parameter**, never read from `env.ts` here — the same adapter discipline the rest of this module follows, and what keeps it importable by `tests/unit` with zero env vars set.

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter @bitetime/backend test tests/unit/github.test.ts
```

Expected: PASS. `pnpm typecheck` will still fail at `app.ts`'s call site — that is Task 4's job.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/github.ts apps/backend/tests/unit/github.test.ts
git commit -m "feat(github): state the screenshot count in the issue body

Count and an admin-dashboard link, never an image URL. The repo is public
and issue history does not forget. Both new fields are required so a
caller cannot quietly file an issue that hides the screenshots."
```

> Typecheck is red between this commit and Task 4's. That is expected and is why these two tasks land back to back.

---

### Task 4: Multipart submit — upload, stamp, report

**Files:**
- Modify: `apps/backend/src/feedback.ts`
- Modify: `apps/backend/src/app.ts:1473-1504` (the submit route)
- Test: `apps/backend/tests/api/feedback.test.ts`

**Interfaces:**
- Consumes: `validateFeedbackImage`, `FEEDBACK_MAX_IMAGES` (Task 1); `image_paths` column and `feedback-images` bucket (Task 2); `buildIssueBody({ …, imageCount, adminUrl })` (Task 3).
- Produces: `FeedbackRow.image_paths: string[]`, `updateFeedbackImages(id: string, paths: string[]): Promise<void>` in `apps/backend/src/feedback.ts`, and a `201` response body of `{ ...FeedbackRow, images_failed: number }`. Task 5 reads `image_paths`; Task 6 reads `images_failed`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/backend/tests/api/feedback.test.ts`. First extend the local `FeedbackRow` type at the top of the file to include `image_paths: string[]`, then add this helper next to the existing `post` helper:

```ts
// Smallest valid PNG (1x1). The bucket enforces allowed_mime_types, so a fake body would be
// refused by Storage for a reason that has nothing to do with the route under test.
const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)
function pngFile(name: string) {
  return new File([PNG_1X1], name, { type: 'image/png' })
}

// Multipart submit. No Content-Type header: fetch/Request writes the boundary itself, and
// setting the header by hand produces a body the server cannot parse.
function postForm(path: string, fields: Record<string, string>, files: File[], token?: string) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  for (const f of files) form.append('images', f)
  return app.request(path, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
}
```

Then add these tests inside the existing `describe('merchant feedback', …)`:

```ts
it('stores a multipart submission and stamps one storage path per screenshot', async () => {
  const res = await postForm(
    `/api/merchants/${ownShopId}/feedback`,
    { category: 'bug', message: 'the orders tab is blank on mobile' },
    [pngFile('a.png'), pngFile('b.png')],
    ownerToken,
  )

  expect(res.status).toBe(201)
  const row = (await res.json()) as FeedbackRow & { images_failed: number }
  expect(row.merchant_id).toBe(ownShopId)
  expect(row.message).toBe('the orders tab is blank on mobile')
  expect(row.images_failed).toBe(0)
  expect(row.image_paths).toHaveLength(2)
  // Merchant-first, feedback-id second — a prefix delete removes a merchant's screenshots,
  // and one report's images are one folder.
  for (const p of row.image_paths) {
    expect(p.startsWith(`${ownShopId}/${row.id}/`)).toBe(true)
    expect(p.endsWith('.png')).toBe(true)
  }

  // The bytes are really in the bucket, not just the paths in the row.
  const { data, error } = await serviceClient().storage
    .from('feedback-images').download(row.image_paths[0])
  expect(error).toBeNull()
  expect(data).not.toBeNull()
})

it('accepts a JSON submission with no screenshots, and stores an empty array', async () => {
  const res = await post(`/api/merchants/${ownShopId}/feedback`, {
    category: 'other', message: 'no screenshots here',
  }, ownerToken)

  expect(res.status).toBe(201)
  const row = (await res.json()) as FeedbackRow & { images_failed: number }
  expect(row.image_paths).toEqual([])
  expect(row.images_failed).toBe(0)
})

it('refuses a fourth screenshot, and writes no row at all', async () => {
  const before = await serviceClient()
    .from('merchant_feedback').select('id').eq('merchant_id', ownShopId)

  const res = await postForm(
    `/api/merchants/${ownShopId}/feedback`,
    { category: 'bug', message: 'four is too many' },
    [pngFile('a.png'), pngFile('b.png'), pngFile('c.png'), pngFile('d.png')],
    ownerToken,
  )
  expect(res.status).toBe(400)

  const after = await serviceClient()
    .from('merchant_feedback').select('id').eq('merchant_id', ownShopId)
  expect(after.data!.length).toBe(before.data!.length)
})

it('refuses a file type the bucket would not take, and writes no row at all', async () => {
  const before = await serviceClient()
    .from('merchant_feedback').select('id').eq('merchant_id', ownShopId)

  const res = await postForm(
    `/api/merchants/${ownShopId}/feedback`,
    { category: 'bug', message: 'wrong type' },
    [new File([new Uint8Array([1, 2, 3])], 'notes.pdf', { type: 'application/pdf' })],
    ownerToken,
  )
  expect(res.status).toBe(400)

  const after = await serviceClient()
    .from('merchant_feedback').select('id').eq('merchant_id', ownShopId)
  expect(after.data!.length).toBe(before.data!.length)
})

it('still refuses a multipart submission against a shop the caller does not own', async () => {
  const res = await postForm(
    `/api/merchants/${strangerShopId}/feedback`,
    { category: 'other', message: 'not my shop' },
    [pngFile('a.png')],
    ownerToken,
  )
  expect(res.status).toBe(403)
})

it('tells the GitHub issue how many screenshots landed', async () => {
  let seenBody = ''
  githubDeps.createIssue = async (_token, input) => {
    seenBody = input.body
    return { number: 1, html_url: 'https://example.test/issues/1' }
  }

  await postForm(
    `/api/merchants/${ownShopId}/feedback`,
    { category: 'bug', message: 'count check' },
    [pngFile('a.png')],
    ownerToken,
  )

  expect(seenBody).toContain('Screenshots: 1')
  expect(seenBody).not.toMatch(/feedback-images/)
  githubDeps.createIssue = origCreateIssue
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @bitetime/backend test:db tests/api/feedback.test.ts
```

Expected: FAIL — the multipart submissions come back `400` (`validateFeedback` sees an empty body because the route only reads JSON), and `image_paths` is missing from the response type.

- [ ] **Step 3: Add the data-layer piece**

In `apps/backend/src/feedback.ts`, add `image_paths: string[]` to the `FeedbackRow` interface (after `message`), and append:

```ts
// Best-effort in the same sense as updateFeedbackGithubIssue: by the time this runs, the
// feedback row is committed and the bytes are already in the bucket. A failure here means the
// admin dashboard does not show screenshots that exist — recoverable by hand, and not worth
// failing a submission the merchant has already been told succeeded.
export async function updateFeedbackImages(id: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const { error } = await admin
    .from('merchant_feedback')
    .update({ image_paths: paths })
    .eq('id', id)
  if (error) console.error(`feedback ${id}: failed to record ${paths.length} image path(s):`, error.message)
}
```

- [ ] **Step 4: Teach the route to read multipart**

In `apps/backend/src/app.ts`, add `updateFeedbackImages` to the existing `./feedback.js` import (line 47), and add `validateFeedbackImage` + `FEEDBACK_MAX_IMAGES` to the existing `@bitetime/shared` import.

Immediately **above** `export const feedbackWindow`, add:

```ts
const FEEDBACK_IMAGE_BUCKET = 'feedback-images'
// MIME -> extension. Deliberately NOT in @bitetime/shared: the browser never derives an
// extension, so this is not a rule both sides enforce — the same reason PAYMENT_PROOF_EXT
// lives here. Its keys are the same three types FEEDBACK_IMAGE_TYPES lists, and the route
// checks membership so the lookup is total and no `undefined` can reach a storage path.
const FEEDBACK_IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * Reads the submit body ONCE, in whichever of the two spellings arrived, and normalizes to a
 * shape validateFeedback can judge. The browser always sends multipart (even with no files);
 * JSON stays accepted because it costs eight lines and is the honest no-image case that
 * tests/api/feedback.test.ts already covers.
 *
 * parseBody({ all: true }) is what returns an ARRAY for a repeated `images` field rather than
 * only the last one — without it, three attached screenshots silently become one.
 */
async function readFeedbackSubmission(c: Context): Promise<{ body: unknown; files: File[] }> {
  const contentType = c.req.header('Content-Type') ?? ''
  if (!contentType.startsWith('multipart/form-data')) {
    return { body: await c.req.json().catch(() => ({})), files: [] }
  }
  const form = await c.req.parseBody({ all: true }).catch(() => ({} as Record<string, unknown>))
  const images = form['images']
  const files = (Array.isArray(images) ? images : [images]).filter((f): f is File => f instanceof File)
  return { body: { category: form['category'], message: form['message'] }, files }
}
```

`Context` is a type import from `hono` — add it to the existing hono import if it is not already there.

Then replace the body of the submit route with:

```ts
app.post('/api/merchants/:id/feedback', requireMerchantOwns, async (c) => {
  const user = c.get('user')
  const merchant = c.get('merchant')

  if (!feedbackWindow.allow(user.id)) {
    return c.json({ error: 'Too many feedback submissions. Please try again later.' }, 429)
  }

  const { body, files } = await readFeedbackSubmission(c)

  const parsed = validateFeedback(body)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  // Every file check runs BEFORE the insert, so a rejected submission leaves nothing behind —
  // no row, no orphan object.
  if (files.length > FEEDBACK_MAX_IMAGES) {
    return c.json({ error: `Attach at most ${FEEDBACK_MAX_IMAGES} screenshots` }, 400)
  }
  for (const file of files) {
    const check = validateFeedbackImage({ type: file.type, size: file.size })
    if (!check.ok) return c.json({ error: `${check.error}: ${file.name}` }, 400)
    // Redundant with the type check above (same three types) and kept anyway: it is what makes
    // the extension lookup below total instead of producing "undefined" in a storage path.
    if (!FEEDBACK_IMAGE_EXT[file.type]) return c.json({ error: `Unsupported image type: ${file.name}` }, 400)
  }

  // merchant.id comes from the route the middleware already verified; user.id from the
  // JWT. Neither is ever read from the body — see tests/api/feedback.test.ts.
  const row = await insertFeedback({ merchantId: merchant.id, userId: user.id, draft: parsed.value })

  // Upload AFTER the row is committed, on purpose. The reverse order trades an orphan object
  // for an orphan row claiming images it does not have, and risks losing a message the merchant
  // typed to a storage hiccup — the exact outcome FeedbackFab's error path exists to avoid.
  const paths: string[] = []
  let imagesFailed = 0
  for (const file of files) {
    const path = `${merchant.id}/${row.id}/${crypto.randomUUID()}.${FEEDBACK_IMAGE_EXT[file.type]}`
    const { error } = await admin.storage
      .from(FEEDBACK_IMAGE_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: true })
    if (error) {
      console.error(`feedback ${row.id}: screenshot upload failed:`, error.message)
      imagesFailed++
      continue
    }
    paths.push(path)
  }
  await updateFeedbackImages(row.id, paths)

  // Best-effort (github.ts). Never changes what the merchant gets back — the row below is
  // the same whether or not this succeeds. The count is what ACTUALLY LANDED, so the issue
  // never claims a screenshot that is not there.
  const issue = await githubDeps.createIssue(env.githubToken, {
    title: buildIssueTitle(parsed.value.category, merchant.name),
    body: buildIssueBody({
      message: parsed.value.message,
      shopName: merchant.name,
      shopSlug: merchant.slug,
      feedbackId: row.id,
      createdAt: row.created_at,
      imageCount: paths.length,
      adminUrl: env.frontendUrl,
    }),
    labels: ['needs-triage', categoryToLabel(parsed.value.category)],
  })
  if (issue) await updateFeedbackGithubIssue(row.id, issue)

  return c.json({ ...row, image_paths: paths, images_failed: imagesFailed }, 201)
})
```

The response spreads `row` and then overrides `image_paths` with what landed: `row` was selected at insert time, before the update, so it still says `[]`.

- [ ] **Step 5: Run the API tests to verify they pass**

```bash
pnpm --filter @bitetime/backend test:db tests/api/feedback.test.ts
```

Expected: PASS — the new tests **and** every pre-existing one, including "refuses feedback filed against a shop the caller does not own" and "ignores merchant_id, user_id and status supplied in the body".

- [ ] **Step 6: Typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: clean. Task 3's red call site is now green.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/app.ts apps/backend/src/feedback.ts apps/backend/tests/api/feedback.test.ts
git commit -m "feat(api): accept screenshots on a feedback submission

The route now reads multipart as well as JSON, normalizing both to one
shape before validateFeedback judges it. File checks run before the
insert so a rejected submission leaves no row and no orphan object; the
upload runs after it, so a storage hiccup can never cost a merchant the
message they typed. What actually landed is what the GitHub issue counts."
```

---

### Task 5: Superadmin reads the bytes

**Files:**
- Modify: `apps/backend/src/app.ts` (new route beside `GET /api/admin/feedback`)
- Test: `apps/backend/tests/api/feedback.test.ts`

**Interfaces:**
- Consumes: `image_paths` on the row (Task 2, Task 4).
- Produces: `GET /api/admin/feedback/:feedbackId/images/:index` → the image bytes with the object's `Content-Type`. Task 6's `fetchFeedbackImage` calls it.

- [ ] **Step 1: Write the failing tests**

Add to `apps/backend/tests/api/feedback.test.ts`, inside the existing describe:

```ts
describe('reading a feedback screenshot', () => {
  let feedbackId: string

  beforeAll(async () => {
    const res = await postForm(
      `/api/merchants/${ownShopId}/feedback`,
      { category: 'bug', message: 'screenshot read fixture' },
      [pngFile('read-me.png')],
      ownerToken,
    )
    feedbackId = ((await res.json()) as FeedbackRow).id
  })

  it('hands a superadmin the bytes, typed as the image it is', async () => {
    const res = await get(`/api/admin/feedback/${feedbackId}/images/0`, superToken)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('image/png')
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0)
  })

  it('404s an index past the end rather than reaching for a neighbouring path', async () => {
    expect((await get(`/api/admin/feedback/${feedbackId}/images/1`, superToken)).status).toBe(404)
    expect((await get(`/api/admin/feedback/${feedbackId}/images/-1`, superToken)).status).toBe(404)
    expect((await get(`/api/admin/feedback/${feedbackId}/images/abc`, superToken)).status).toBe(404)
  })

  it('404s an unknown feedback id — a guess and a real id with no images look identical', async () => {
    const res = await get('/api/admin/feedback/00000000-0000-0000-0000-000000000000/images/0', superToken)
    expect(res.status).toBe(404)
  })

  it('refuses the merchant who sent it — this is a superadmin surface', async () => {
    expect((await get(`/api/admin/feedback/${feedbackId}/images/0`, ownerToken)).status).toBe(403)
  })

  it('refuses an anonymous caller with 401', async () => {
    expect((await get(`/api/admin/feedback/${feedbackId}/images/0`)).status).toBe(401)
  })
})
```

Add `beforeAll` to the file's `vitest` import if it is not already there (it is — the outer describe uses it).

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @bitetime/backend test:db tests/api/feedback.test.ts
```

Expected: FAIL — the route does not exist, so every case comes back `404` including the two that expect `200` / `403` / `401`.

- [ ] **Step 3: Write the route**

In `apps/backend/src/app.ts`, directly after `app.get('/api/admin/feedback', …)`, add:

```ts
/**
 * One screenshot from one feedback row, for the superadmin inbox. Same shape as the
 * payment-proof download: the backend reads the private bucket with the service-role client
 * and streams the bytes, because the browser has no access to that bucket in either direction
 * (20260806120000 gives it no policies at all).
 *
 * The caller names an INDEX, never a path. The path comes out of the row's own image_paths
 * array, so there is no path for a caller to point somewhere else — which is the whole
 * security property of this route, not a convenience.
 *
 * Missing feedback, an out-of-range index and a non-numeric index all return the same 404:
 * a distinguishable error here would be an oracle for which feedback ids exist.
 */
app.get('/api/admin/feedback/:feedbackId/images/:index', requireSuperadmin, async (c) => {
  const { data: row, error } = await admin
    .from('merchant_feedback')
    .select('image_paths')
    .eq('id', c.req.param('feedbackId'))
    .maybeSingle()
  if (error) return c.json({ error: 'lookup_failed' }, 500)

  const paths = (row?.image_paths ?? []) as string[]
  const index = Number(c.req.param('index'))
  if (!Number.isInteger(index) || index < 0 || index >= paths.length) {
    return c.json({ error: 'not_found' }, 404)
  }

  const { data, error: downloadError } = await admin.storage
    .from(FEEDBACK_IMAGE_BUCKET)
    .download(paths[index])
  if (downloadError || !data) return c.json({ error: 'download_failed' }, 500)

  return new Response(await data.arrayBuffer(), {
    status: 200,
    headers: { 'Content-Type': data.type || 'application/octet-stream' },
  })
})
```

A `:feedbackId` that is not a UUID makes PostgREST error rather than return no row; that lands on the `500` above. Acceptable — it leaks nothing, and only a hand-written request can produce it.

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm --filter @bitetime/backend test:db tests/api/feedback.test.ts
```

Expected: PASS, all of them.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/app.ts apps/backend/tests/api/feedback.test.ts
git commit -m "feat(api): superadmin route to read a feedback screenshot

The caller names an index, never a path — the path comes out of the row's
own image_paths array, so there is nothing to point at someone else's
screenshot. Missing feedback and an out-of-range index return the same
404 so neither becomes an oracle."
```

---

### Task 6: Frontend data layer

**Files:**
- Modify: `apps/frontend/src/api.ts` (beside `apiSendFile`, ~line 140)
- Modify: `apps/frontend/src/types.ts:268-281`
- Modify: `apps/frontend/src/store.ts:993-1003`

**Interfaces:**
- Consumes: `POST /api/merchants/:id/feedback` multipart (Task 4), `GET /api/admin/feedback/:feedbackId/images/:index` (Task 5), `validateFeedbackImage` / `FEEDBACK_MAX_IMAGES` (Task 1).
- Produces:
  - `apiSendForm<T>(path: string, form: FormData, opts?: Opts): Promise<Result<T>>`
  - `submitFeedback(merchantId: string, draft: FeedbackDraft, files: File[]): Promise<Result<{ images_failed: number }>>`
  - `fetchFeedbackImage(feedbackId: string, index: number): Promise<Result<Blob>>`
  - `FeedbackItem.image_paths: string[]`

  Task 7 calls `submitFeedback`; Task 8 calls `fetchFeedbackImage` and reads `image_paths`.

- [ ] **Step 1: Add `apiSendForm`**

In `apps/frontend/src/api.ts`, directly after `apiSendFile`:

```ts
/**
 * A POST whose body is a FORM — text fields and files in one request, the multipart twin of
 * `apiSendFile`'s single raw file. Used by the feedback submit, where the message and its
 * screenshots have to arrive together or the GitHub issue cannot state an accurate count.
 *
 * Sets NO Content-Type: `fetch` writes the multipart boundary itself, and supplying the header
 * by hand suppresses that and produces a body the server cannot parse. Same Result convention
 * and the same `auth` option as every other call here.
 */
export async function apiSendForm<T>(path: string, form: FormData, opts?: Opts): Promise<Result<T>> {
  const h = await resolveHeaders({}, opts?.auth)
  if ('fail' in h) return { ok: false, error: h.fail }
  try {
    const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: h.headers, body: form })
    if (!res.ok) return { ok: false, error: await errorFromResponse(res) }
    const text = await res.text()
    return { ok: true, data: (text ? JSON.parse(text) : null) as T }
  } catch {
    return { ok: false, error: NETWORK_ERROR }
  }
}
```

- [ ] **Step 2: Widen `FeedbackItem`**

In `apps/frontend/src/types.ts`, add to the `FeedbackItem` interface after `message`:

```ts
  // Storage paths in the private `feedback-images` bucket. NOT URLs and not resolvable to one:
  // the bucket has no public read, so the bytes come from fetchFeedbackImage(id, index).
  image_paths: string[]
```

- [ ] **Step 3: Rewrite `submitFeedback` and add the read helper**

In `apps/frontend/src/store.ts`, replace `submitFeedback` with:

```ts
/**
 * Sends the merchant's feedback and up to FEEDBACK_MAX_IMAGES screenshots as one multipart
 * request, so the row and its images arrive together.
 *
 * Validates every file against the shared rules FIRST — the same "readable error before the
 * bytes cross the wire" role uploadPaymentProof plays. The shared validator judges type and
 * size only, so the filename is prefixed here, where there is a merchant to show it to.
 *
 * Returns `images_failed`, not the row: the POST responds with a bare merchant_feedback row,
 * which is NOT a FeedbackItem (no shop_name / shop_slug — only the admin list joins those in),
 * so claiming the richer type would be a cast the compiler cannot check.
 */
export async function submitFeedback(
  merchantId: string,
  draft: FeedbackDraft,
  files: File[] = [],
): Promise<Result<{ images_failed: number }>> {
  if (files.length > FEEDBACK_MAX_IMAGES) {
    return { ok: false, error: { message: `Attach at most ${FEEDBACK_MAX_IMAGES} screenshots` } }
  }
  for (const file of files) {
    const check = validateFeedbackImage({ type: file.type, size: file.size })
    if (!check.ok) return { ok: false, error: { message: `${check.error}: ${file.name}` } }
  }

  const form = new FormData()
  form.append('category', draft.category)
  form.append('message', draft.message)
  for (const file of files) form.append('images', file)

  const r = await apiSendForm<{ images_failed?: number }>(
    `/api/merchants/${merchantId}/feedback`, form, { auth: true },
  )
  return mapOk(r, d => ({ images_failed: d?.images_failed ?? 0 }))
}

/**
 * One screenshot's bytes, for the superadmin inbox. `auth: 'required'` — a signed-out caller
 * has no feedback to view. Same shape as fetchPaymentProof; the bucket is private, so this
 * route is the only way to these bytes.
 */
export async function fetchFeedbackImage(feedbackId: string, index: number): Promise<Result<Blob>> {
  const r = await apiGetFile(`/api/admin/feedback/${feedbackId}/images/${index}`, { auth: 'required' })
  return mapOk(r, d => d.blob)
}
```

Add `apiSendForm` to the existing `./api` import, and `FEEDBACK_MAX_IMAGES` + `validateFeedbackImage` to the existing `@bitetime/shared` import. `mapOk` and `apiGetFile` are already imported (used by `fetchPaymentProof`); confirm before adding.

`files` defaults to `[]` so any caller that has not been updated yet still compiles and behaves exactly as before.

- [ ] **Step 4: Typecheck, lint, and run the existing frontend tests**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @bitetime/frontend test
```

Expected: clean and green. `store.test.ts` mocks `storage` but never exercised feedback; nothing there should move.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/api.ts apps/frontend/src/types.ts apps/frontend/src/store.ts
git commit -m "feat(frontend): send feedback screenshots, read them back as an admin

apiSendForm sets no Content-Type on purpose — fetch has to write the
multipart boundary itself. submitFeedback returns images_failed rather
than the row, because the POST's bare row is not a FeedbackItem and
saying otherwise would be an unverifiable cast."
```

---

### Task 7: The picker in the feedback dialog

**Files:**
- Modify: `apps/frontend/src/merchant/FeedbackFab.tsx`

**Interfaces:**
- Consumes: `submitFeedback(merchantId, draft, files)` returning `Result<{ images_failed: number }>` (Task 6); `FEEDBACK_MAX_IMAGES`, `FEEDBACK_IMAGE_TYPES`, `validateFeedbackImage` (Task 1).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the state and the object-URL lifecycle**

Extend the imports:

```ts
import { MessageSquarePlus, ImagePlus, X } from 'lucide-react'
import {
  FEEDBACK_CATEGORIES, FEEDBACK_MAX_LENGTH, FEEDBACK_MAX_IMAGES, FEEDBACK_IMAGE_TYPES,
  validateFeedbackImage, type FeedbackCategory,
} from '@bitetime/shared'
```

Add state beside `message`:

```ts
const [files, setFiles] = useState<File[]>([])
const [imageError, setImageError] = useState('')
// Previews are object URLs, which the browser holds until they are revoked explicitly. Derived
// from `files` in an effect rather than at pick time so there is exactly ONE place that creates
// them and one that revokes them — removing a file, resetting the dialog and unmounting all
// flow through the same cleanup, which is what keeps this from leaking a blob per screenshot
// per dialog session.
const [previews, setPreviews] = useState<string[]>([])

useEffect(() => {
  const urls = files.map(f => URL.createObjectURL(f))
  setPreviews(urls)
  return () => { for (const u of urls) URL.revokeObjectURL(u) }
}, [files])
```

Place this effect immediately after the existing `autoCloseTimer` cleanup effect, **above** the `if (!merchant) return null` early return — hooks must not sit below a conditional return.

- [ ] **Step 2: Reset the new state in `change()`**

Add to the body of `change`, beside the existing resets:

```ts
    setFiles([])
    setImageError('')
```

No revoke call here: the effect above owns every object URL and revokes on the `files` change this triggers.

- [ ] **Step 3: Add the pick and remove handlers**

Below `change`:

```ts
// A bad file in the selection must not cost the merchant the good ones — the rejected file is
// named, the rest are kept. Same reasoning as keeping the typed message on a failed send.
const pick = (chosen: FileList | null) => {
  if (!chosen) return
  const room = FEEDBACK_MAX_IMAGES - files.length
  const accepted: File[] = []
  const rejected: string[] = []

  for (const file of Array.from(chosen)) {
    if (accepted.length >= room) {
      rejected.push(t(`${file.name} (limit ${FEEDBACK_MAX_IMAGES})`, `${file.name}（最多 ${FEEDBACK_MAX_IMAGES} 张）`))
      continue
    }
    const check = validateFeedbackImage({ type: file.type, size: file.size })
    if (!check.ok) { rejected.push(`${file.name}: ${check.error}`); continue }
    accepted.push(file)
  }

  // `room` was computed from the render's `files`, which is one commit behind if two picks land
  // back to back. The functional update re-slices against the CURRENT list, so the cap holds
  // regardless — the count is the one rule the DB CHECK would otherwise have to catch as a 400.
  if (accepted.length) setFiles(prev => [...prev, ...accepted].slice(0, FEEDBACK_MAX_IMAGES))
  setImageError(rejected.join(' · '))
}

const removeFile = (index: number) => {
  setFiles(prev => prev.filter((_, i) => i !== index))
  setImageError('')
}
```

- [ ] **Step 4: Pass the files to `submitFeedback` and report a partial failure**

In `send`, replace the `submitFeedback` call and the success branch:

```ts
  const r = await submitFeedback(merchant.id, { category: category as FeedbackCategory, message: trimmed }, files)
  // The dialog may have been closed and reopened while that await was pending — a fresh
  // session the user is now typing into. This request's result belongs to the session
  // that started it, which no longer exists on screen; touching state here would stomp
  // the new one. The row is already written, so nothing is lost by staying quiet.
  if (session.current !== startedIn) return
  if (r.ok) {
    setFailedCount(r.data.images_failed)
    setSent(true)
    // Let the thank-you land before the dialog goes away. Longer when there is a caveat to
    // read — a merchant who lost a screenshot needs time to notice they should re-send it.
    autoCloseTimer.current = setTimeout(() => change(false), r.data.images_failed > 0 ? 3200 : 1600)
  } else {
```

Add `const [failedCount, setFailedCount] = useState(0)` beside the other state, and `setFailedCount(0)` to `change()`.

`canSubmit` is **unchanged** — screenshots are optional, a message is not.

- [ ] **Step 5: Render the picker and the amended thank-you**

Replace the `sent ? (…)` thank-you block with:

```tsx
          {sent ? (
            <div className="py-6 text-center text-[14px] text-ink">
              <p>{t('Thanks — we got it.', '谢谢，我们已收到。')}</p>
              {failedCount > 0 && (
                <p className="mt-2 text-[13px] text-danger-fg">
                  {t(
                    `${failedCount} screenshot${failedCount === 1 ? '' : 's'} could not be attached.`,
                    `有 ${failedCount} 张截图未能上传。`,
                  )}
                </p>
              )}
            </div>
          ) : (
```

Then, between the textarea block and the `{error && …}` line, add:

```tsx
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label
                    className={cn(
                      'inline-flex items-center gap-2 text-[13px] font-sans cursor-pointer',
                      'text-oxblood hover:text-oxblood-deep',
                      files.length >= FEEDBACK_MAX_IMAGES && 'pointer-events-none opacity-50',
                    )}
                  >
                    <ImagePlus size={16} strokeWidth={1.75} />
                    {t('Attach screenshots', '添加截图')}
                    <input
                      type="file"
                      className="sr-only"
                      accept={FEEDBACK_IMAGE_TYPES.join(',')}
                      multiple
                      disabled={files.length >= FEEDBACK_MAX_IMAGES}
                      // Cleared so re-picking the same file after removing it still fires onChange.
                      onChange={e => { pick(e.target.files); e.target.value = '' }}
                    />
                  </label>
                  <span className="text-[11px] text-text-tertiary">
                    {files.length} / {FEEDBACK_MAX_IMAGES}
                  </span>
                </div>

                {files.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {files.map((file, i) => (
                      <li key={`${file.name}-${i}`} className="relative">
                        <img
                          src={previews[i]}
                          alt={file.name}
                          className="h-16 w-16 rounded object-cover border border-border"
                        />
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          aria-label={t(`Remove ${file.name}`, `移除 ${file.name}`)}
                          className={cn(
                            'absolute -top-1.5 -right-1.5 rounded-full bg-ink text-cream',
                            'flex items-center justify-center h-5 w-5 cursor-pointer',
                          )}
                        >
                          <X size={12} strokeWidth={2} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {imageError && <p className="text-[12px] text-danger-fg">{imageError}</p>}
              </div>
```

`previews[i]` can be momentarily `undefined` on the render between a `setFiles` and the effect that follows it; React renders `<img src={undefined}>` as an image with no source and the next commit fills it in. Harmless, and the alternative (creating URLs inside the handler) is what leaks them.

- [ ] **Step 6: Typecheck, lint, build**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @bitetime/frontend build
```

Expected: clean. The build also runs the prerender, which must still succeed.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/merchant/FeedbackFab.tsx
git commit -m "feat(merchant): attach screenshots to platform feedback

Object URLs are derived from the file list in an effect, so there is one
place that creates them and one that revokes them — removing a file,
resetting the dialog and unmounting all run the same cleanup. A bad file
in a selection names itself and the good ones are kept."
```

---

### Task 8: Thumbnails in the superadmin inbox

**Files:**
- Modify: `apps/frontend/src/admin/AdminFeedback.tsx`

**Interfaces:**
- Consumes: `fetchFeedbackImage(feedbackId, index)` and `FeedbackItem.image_paths` (Task 6).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add a component that owns one row's images**

At the bottom of `apps/frontend/src/admin/AdminFeedback.tsx`, below the default export:

```tsx
/**
 * The screenshots on one feedback row. Its own component so the object-URL lifecycle belongs
 * to something that unmounts when the row leaves the list — filtering to open-only removes
 * rows, and a leaked blob per removed row adds up across a triage session.
 *
 * The bucket is private, so these are authenticated fetches, not <img src="…"> against a URL.
 */
function FeedbackImages({ item }: { item: FeedbackItem }) {
  const { t } = useSession()
  const [urls, setUrls] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    const created: string[] = []

    Promise.all(item.image_paths.map((_, i) => fetchFeedbackImage(item.id, i)))
      .then(results => {
        if (cancelled) return
        for (const r of results) if (r.ok) created.push(URL.createObjectURL(r.data))
        setUrls(created)
      })

    return () => {
      cancelled = true
      for (const u of created) URL.revokeObjectURL(u)
    }
  }, [item.id, item.image_paths])

  if (item.image_paths.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((url, i) => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer">
          <img
            src={url}
            alt={t(`Screenshot ${i + 1}`, `截图 ${i + 1}`)}
            className="h-20 w-20 rounded object-cover border border-border"
          />
        </a>
      ))}
      {urls.length < item.image_paths.length && (
        <span className="self-center text-[12px] text-text-tertiary">
          {t('Loading screenshots…', '正在加载截图…')}
        </span>
      )}
    </div>
  )
}
```

Add `fetchFeedbackImage` to the existing `../store` import.

- [ ] **Step 2: Render it in the row**

In the `items.map` block, directly after the `<p className="text-[14px] text-ink whitespace-pre-wrap">{item.message}</p>` line:

```tsx
          <FeedbackImages item={item} />
```

- [ ] **Step 3: Typecheck, lint, build**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @bitetime/frontend build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/admin/AdminFeedback.tsx
git commit -m "feat(admin): show feedback screenshots in the inbox

Its own component so the object-URL lifecycle unmounts with the row —
filtering to open-only drops rows, and a leaked blob each adds up over a
triage session. Authenticated fetches, not img src: the bucket is private."
```

---

### Task 9: Run-and-verify, and document the bucket

**Files:**
- Modify: `CONTEXT.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

UI is verified by running the app, not by component tests (CLAUDE.md).

- [ ] **Step 1: Run the whole suite**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all clean. Then:

```bash
pnpm --filter @bitetime/backend test:db
```

Expected: green, including `tests/rls/feedback-images-storage.test.ts` and `tests/api/feedback.test.ts`.

- [ ] **Step 2: Drive the real flow**

Use the `verify` skill, or by hand: `pnpm dev`, sign in as a merchant, open the dashboard, click the feedback button.

Check each of these:

1. Pick a category, type a message, attach two screenshots → thumbnails appear, the counter reads `2 / 3`
2. Remove one with the `×` → the thumbnail goes, the counter reads `1 / 3`
3. Attach two more → the counter reads `3 / 3` and the attach control is disabled
4. Try to attach a PDF → it is named and refused; the existing thumbnails survive
5. Send → the thank-you appears and the dialog closes
6. Sign in as the superadmin, open `/admin#feedback` → the row shows the thumbnails; clicking one opens it full size
7. Sign out entirely and request `GET /api/admin/feedback/<id>/images/0` directly → `401`

- [ ] **Step 3: Confirm nothing leaked into the issue body**

If `GITHUB_TOKEN` is set locally, open the issue the submission filed and confirm the body reads `Screenshots: 3 — view at …/admin#feedback` and contains no image URL. If it is unset, `createIssue` returns `null` without a request — say so in the report rather than claiming it was checked.

- [ ] **Step 4: Document the bucket**

`CONTEXT.md` has **no** storage section today — the five buckets are documented only in their own migrations, and the one property that actually matters (which of them the browser can reach) is not written down anywhere a reader would look. Add one, at the end of the file:

```markdown
## Storage buckets

Five, and the split that matters is **which of them the browser can reach**. Every column that
points at one holds a **path**, never a URL.

| Bucket | Public? | Who writes | Who reads |
|---|---|---|---|
| `product-images` | yes | browser, direct, RLS-scoped to the merchant's own folder | anyone (the storefront needs it) |
| `payment-qr` | yes | browser, direct, same folder policy | anyone (a guest sees it on the order-placed screen) |
| `payment-proof` | **no** | backend, service role | backend, service role |
| `sample-shop-screenshots` | yes | backend, service role (the weekly sweep) | anyone |
| `feedback-images` | **no** | backend, service role | backend, service role |

The two private buckets have **no `storage.objects` policies at all**. That is not an omission:
with `public: false` and zero policies, `anon` and `authenticated` get nothing in either
direction, and `tests/rls/payment-proof-storage.test.ts` and
`tests/rls/feedback-images-storage.test.ts` are the proof — no app surface exercises either
bucket from the browser, so a migration that flips one public is caught only there.

`feedback-images` holds up to three screenshots per merchant feedback submission, at
`{merchant_id}/{feedback_id}/{uuid}.{ext}`. Written by `POST /api/merchants/:id/feedback` after
the row commits; read only by a superadmin through
`GET /api/admin/feedback/:feedbackId/images/:index`, which indexes into the row's own
`image_paths` array rather than accepting a path from the caller — that is what makes one
feedback row's screenshots unreachable from another's.

It is private for a reason worth stating plainly: **the platform repo is public**, feedback is
auto-filed there as an issue, and a merchant's bug screenshot is usually their own dashboard —
customer names, phone numbers, delivery addresses. The issue body states the screenshot count
and links the admin dashboard. It carries no image URL, signed or otherwise, and must not grow
one.
```

- [ ] **Step 5: Commit**

```bash
git add CONTEXT.md
git commit -m "docs: record the feedback-images bucket and its no-policy posture"
```

- [ ] **Step 6: Report**

State plainly:
- What was verified by running the app, and what was not
- That `20260806120000_feedback_images.sql` is applied **locally only** and **production still needs a human to run `db:push`**
- Whether the GitHub issue body was checked against a live token or skipped because none was set

---

## Notes for the implementer

**No CORS change is needed.** `app.ts`'s `cors()` sets no `allowHeaders`, and Hono reflects `Access-Control-Request-Headers` when that option is empty — so a multipart `Content-Type` is allowed exactly as `application/json` already is.

**No new dependency.** Nothing here adds a backend runtime dependency, so the `build` script's `--external:` list is unchanged.

**If the backend dev server appears to run pre-edit code**, the jiti cache is stale. Restarting does not clear it — delete the cache directory.

**`stripe listen` is not needed** for any of this. Nothing in this feature touches billing.
