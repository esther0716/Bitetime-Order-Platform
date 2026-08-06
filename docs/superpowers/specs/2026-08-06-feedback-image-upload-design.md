# Screenshots on merchant platform feedback

## Where this starts

A merchant sends platform feedback from the floating button on their dashboard (`apps/frontend/src/merchant/FeedbackFab.tsx`): a category (`bug` / `feature` / `billing` / `other`) and a message capped at 2000 chars, nothing else. `POST /api/merchants/:id/feedback` rate-limits per user, runs `validateFeedback` from `@bitetime/shared`, writes a `merchant_feedback` row, and files a GitHub issue best-effort (`docs/superpowers/specs/2026-08-04-feedback-github-issues-design.md`). A superadmin triages it in `AdminFeedback.tsx`.

The gap this closes: a merchant reporting "the order sheet renders wrong" has no way to show it. They describe a visual bug in words, and the maintainer guesses.

This spec lets a merchant attach up to three screenshots to a feedback submission.

## The constraint that shapes everything

**`leongcheefai/Bitetime-Order-Platform` is a public repo.** A merchant's bug screenshot is usually their own dashboard — customer names, phone numbers, delivery addresses, order totals. Any image URL that reaches an issue body is world-readable forever, and issue history does not forget.

So the screenshots never leave the platform: a private bucket, read only through an authenticated superadmin route, and an issue body that mentions the count but carries no image URL.

## Decisions taken during design

| Question | Decision |
|---|---|
| Where the bytes live | New **private** `feedback-images` bucket, zero `storage.objects` policies — the `payment-proof` shape (`20260804160000`) |
| Who can see them | Superadmin only, through an authenticated backend route. Never the merchant who sent them, never a public URL |
| Upload path | Browser → backend → service-role client. Not browser-direct-to-Storage: a private bucket with no policies has nothing for a merchant token to write against, and that is the point |
| How many, how big | Up to **3** files, **5 MiB** each, `image/jpeg` / `image/png` / `image/webp`. 5 MiB matches `MAX_PRODUCT_IMAGE_BYTES` — a raw phone screenshot fits |
| Request shape | The existing `POST /api/merchants/:id/feedback` accepts `multipart/form-data` as well as JSON. One round trip, one failure to report |
| Row before upload | Insert the feedback row first, then upload. A storage hiccup must never cost the merchant the message they typed |
| Partial upload failure | Keep the report, tell them: `201` with `images_failed: <n>`, and the dialog says so |
| GitHub issue body | Gains `Screenshots: <n> — view at <frontendUrl>/admin#feedback`. Count only, no image URLs. Omitted when there are none |
| Editing after submit | Out of scope. Feedback is a one-shot message today and stays one |

## Data model

New migration, `apps/backend/supabase/migrations/20260806120000_feedback_images.sql`.

### Column

```sql
alter table public.merchant_feedback
  add column if not exists image_paths text[] not null default '{}';

alter table public.merchant_feedback
  add constraint merchant_feedback_image_count
  check (cardinality(image_paths) <= 3);
```

Storage **paths**, never URLs — the house rule `merchants.payment_qr` and `orders.payment_proof` already follow. `not null default '{}'` so every existing row reads as "no screenshots" without a backfill, and no consumer has to handle `null` and `[]` as two spellings of empty.

The `cardinality` CHECK is the database's own copy of `FEEDBACK_MAX_IMAGES`, for the same reason the message length is checked in three places: the shared rule tells the merchant before they lose anything, the route refuses, and this is what makes it true regardless of the caller.

### Bucket

```sql
insert into storage.buckets (id, name, public)
values ('feedback-images', 'feedback-images', false)
on conflict (id) do nothing;

update storage.buckets
set
  file_size_limit = 5242880, -- 5 MiB — MAX_FEEDBACK_IMAGE_BYTES in @bitetime/shared
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] -- FEEDBACK_IMAGE_TYPES
where id = 'feedback-images';
```

Deliberately **no `storage.objects` policies**, mirroring `payment-proof` and `sample-shop-screenshots`. With `public: false` and zero policies, `anon` and `authenticated` get nothing in either direction by default; every read and write goes through the backend's service-role client, which bypasses RLS entirely.

### Path layout

```
{merchant_id}/{feedback_id}/{uuid}.{ext}
```

Merchant-first so removing a merchant's screenshots is a prefix delete; feedback-id second so one report's images are one folder. The filename is a fresh `uuid` — the merchant's original filename is never used, so there is nothing to sanitise and no collision to lose an image to.

## Shared rules — `packages/shared/src/feedback.ts`

```ts
export const FEEDBACK_MAX_IMAGES = 3
export const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024
export const FEEDBACK_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type FeedbackImageValidation = { ok: true } | { ok: false; error: string }

/** Type and size only. The caller counts files — this validates one. */
export function validateFeedbackImage(file: { type: string; size: number }): FeedbackImageValidation
```

Shared for the reason `validateFeedback` is shared: the browser shows the merchant a readable message before a 5 MiB body crosses the wire, and the server refuses regardless of the client. Both sides call the same function, so they cannot disagree about what the bucket will accept.

The signature takes `{ type, size }`, not a `File`, so the backend can call it on a multipart part without constructing one — and so the returned `error` is about the file's *properties* only. Naming the offending file is the caller's job: `store.ts` prefixes the filename for the merchant, the route logs it. Same division `uploadProductImages` already uses, and it keeps the shared module free of any assumption about how either side displays an error.

The MIME → extension map is **not** here. It is one line in the backend, next to the upload that needs it (exactly where `PAYMENT_PROOF_EXT` sits in `app.ts`): the browser never derives an extension, so it is not a rule both sides enforce, and CLAUDE.md is explicit that `@bitetime/shared` holds only what must hold identically on both sides of the wire.

`FeedbackDraft` and `validateFeedback` are **unchanged**. Files are not part of the draft: `validateFeedback` is the write allowlist that builds its result field by field so a caller cannot smuggle `status` / `merchant_id` / `user_id`, and adding a file array to it would put binary handling inside the one function whose job is to be a text allowlist. The route validates files separately, next to where it uploads them.

Tests in `packages/shared/src/feedback.test.ts`: each accepted type passes, a `application/pdf` and a `image/gif` fail, exactly-at-limit passes, one byte over fails.

## Backend

### Reading the body — `POST /api/merchants/:id/feedback`

The route reads its body once and normalizes before anything else touches it:

```ts
type Submission = { body: unknown; files: File[] }

async function readSubmission(c): Promise<Submission> {
  const ct = c.req.header('Content-Type') ?? ''
  if (!ct.startsWith('multipart/form-data')) {
    return { body: await c.req.json().catch(() => ({})), files: [] }
  }
  const form = await c.req.parseBody({ all: true }).catch(() => ({}))
  const images = form['images']
  const files = (Array.isArray(images) ? images : [images]).filter(f => f instanceof File)
  return { body: { category: form['category'], message: form['message'] }, files }
}
```

Both spellings survive: the browser always sends multipart (even with zero files), and JSON stays accepted because it costs eight lines and keeps `tests/api/feedback.test.ts`'s existing bodies meaningful as the no-image case. `validateFeedback` runs on the normalized `body` either way, so the text rules are enforced in exactly one place.

`parseBody({ all: true })` is what returns an array for a repeated `images` field rather than only the last one.

### Route order

The prefix is unchanged — the new work slots in after the row is safe.

1. `feedbackWindow.allow(user.id)` — unchanged, still before validation, still per-user
2. `validateFeedback(body)` — unchanged
3. **New:** `files.length > FEEDBACK_MAX_IMAGES` → `400`; any file failing `validateFeedbackImage` → `400`, and a file whose type is not a key of the backend's own MIME → extension map → `400` (the two lists are the same three types; the second check is what makes the extension lookup total rather than producing an `undefined` in a storage path). All of this runs **before any write**, so a rejected submission leaves nothing behind
4. `insertFeedback(...)` — unchanged. From here the merchant's message is safe
5. **New:** upload each file to `admin.storage.from('feedback-images')`, path `{merchantId}/{row.id}/{uuid}.{ext}`, `contentType` from the file. Collect the paths that landed, count the ones that did not, `console.error` each failure. If any landed, `updateFeedbackImages(row.id, paths)`
6. `githubDeps.createIssue(...)` — body gains the screenshot line (below). The count is **what actually landed**, so the issue never claims a screenshot that is not there
7. `201` with the row, plus `images_failed: <n>`

Step 5 sits after step 4 on purpose. The alternative — upload first, insert second — trades an orphan storage object for an orphan row that claims images it does not have, and risks losing a typed message to a storage hiccup. `FeedbackFab`'s existing error path is written specifically to never lose a long message; this keeps that promise.

The `images_failed` field rides on the response body next to the row. `submitFeedback` in `store.ts` already discards the row (see its comment: the POST returns a bare `merchant_feedback` row, not a `FeedbackItem`), so widening the response breaks nothing.

### `apps/backend/src/feedback.ts`

`FeedbackRow` and `FeedbackWithShop` gain `image_paths: string[]`. One new function, matching `updateFeedbackGithubIssue`'s shape:

```ts
export async function updateFeedbackImages(id: string, paths: string[]): Promise<void>
```

Best-effort in the same sense: it logs and returns rather than throwing, because by the time it runs the feedback row is already committed and the bytes are already in the bucket. A failure here means the admin dashboard does not show images that exist — recoverable by hand, not worth failing a submission over.

### `apps/backend/src/github.ts`

`buildIssueBody` takes two more fields:

```ts
buildIssueBody({ message, shopName, shopSlug, feedbackId, createdAt, imageCount, adminUrl })
```

When `imageCount > 0` the body gains one line under the existing footer:

```
Screenshots: 2 — view at https://tinyorder.vercel.app/admin#feedback
```

At zero the line is omitted entirely, so every existing issue body stays byte-identical to what it is today. `adminUrl` is passed in by `app.ts` from `env.frontendUrl` — `github.ts` reads no env itself, which is what keeps it importable by `tests/unit` with zero vars set.

### Read route

```
GET /api/admin/feedback/:feedbackId/images/:index    requireSuperadmin
```

Loads the row, bounds-checks `index` against `image_paths.length`, downloads through `admin.storage`, streams the bytes back with the object's `Content-Type` — the `GET /api/merchants/:id/orders/:orderId/payment-proof` pattern, including its `404` for both "no such feedback" and "no such index".

Indexing into the row's own array rather than accepting a path is the whole security property: a caller cannot name a path, so a caller cannot read one that is not on this row.

## Frontend

### `apps/frontend/src/api.ts`

New `apiSendForm<T>(path, form: FormData, opts?)`, alongside `apiSendFile`. Same `resolveHeaders` / `Result` shape, one difference: it sets **no** `Content-Type` — `fetch` must write its own multipart boundary, and supplying the header suppresses that and produces a body the server cannot parse.

### `apps/frontend/src/store.ts`

```ts
export async function submitFeedback(
  merchantId: string,
  draft: FeedbackDraft,
  files: File[],
): Promise<Result<{ images_failed: number }>>
```

Validates each file with the shared `validateFeedbackImage` and the count against `FEEDBACK_MAX_IMAGES` before building the `FormData` — the same "readable error before the bytes cross the wire" role `uploadPaymentProof` plays. Then `apiSendForm` to the existing feedback path.

Returns `Result<{ images_failed }>` instead of `Result<void>`. Still not `FeedbackItem` — the POST response is a bare row without `shop_name` / `shop_slug`, and claiming otherwise would be an uncheckable cast.

New read helper for the admin side:

```ts
export async function fetchFeedbackImage(feedbackId: string, index: number): Promise<Result<Blob>>
```

`auth: 'required'` — a signed-out caller has no feedback to view. Same shape as `fetchPaymentProof`.

### `apps/frontend/src/merchant/FeedbackFab.tsx`

New state `files: File[]`, reset by the existing `change()`. That function already resets on **both** open and close, so the abandoned-mid-request case is already covered and needs no new handling.

The picker, under the textarea:

- An **Attach screenshots** button (hidden `<input type="file" accept="image/jpeg,image/png,image/webp" multiple>`), disabled at 3 files
- A thumbnail strip: each picked file rendered from an object URL, with an `×` to remove it, and a `2 / 3` counter beside the label
- Object URLs held in a ref keyed by file, `revokeObjectURL` on removal, on `change()`, and on unmount — the same discipline the existing `autoCloseTimer` cleanup follows
- A pick that includes a bad file keeps the good ones and shows the rejection against the offending filename, rather than dropping the whole selection

`canSubmit` is **unchanged**: screenshots are optional, a message is not. A merchant can still send text alone, exactly as today.

On success with `images_failed > 0`, the thank-you reads:

> Thanks — we got it. 1 screenshot could not be attached.
> 谢谢，我们已收到。有 1 张截图未能上传。

Bilingual via `t(en, zh)`, like every other string in the file. At zero the existing thank-you is untouched.

The `session` ref guard around the in-flight request stays exactly as it is — a late resolve still returns without touching state, and it now also means a late resolve cannot write an `images_failed` message into a fresh dialog.

### `apps/frontend/src/admin/AdminFeedback.tsx`

Each row with a non-empty `image_paths` renders that many thumbnails, fetched as blobs through `fetchFeedbackImage`. Click opens the full-size image. Object URLs revoked on unmount.

`FeedbackItem` in `apps/frontend/src/types.ts` gains `image_paths: string[]`.

## Testing

| Where | What |
|---|---|
| `packages/shared/src/feedback.test.ts` | `validateFeedbackImage`: each accepted type, two rejected types, at-limit and one-over sizes |
| `apps/backend/tests/api/feedback.test.ts` | A multipart submit lands the row **and** the paths; four files → `400` with no row written; an oversized file → `400` with no row written; a JSON submit still works and stores `image_paths: []`; a submit by a merchant who does not own `:id` is still refused (the existing load-bearing assertion, now through the multipart path too) |
| `apps/backend/tests/api/feedback.test.ts` | The admin read route: a superadmin gets the bytes; an out-of-range index is `404`; a non-superadmin is refused |
| `apps/backend/tests/rls/feedback-images-storage.test.ts` (new) | `anon` and `authenticated` can neither list, read, nor write in `feedback-images` — mirrors `payment-proof-storage.test.ts` |
| `apps/backend/tests/unit/github.test.ts` | `buildIssueBody` includes the screenshot line at `imageCount > 0` and omits it at `0` |
| Run-and-verify | The dialog end to end against local Supabase, per CLAUDE.md — UI is verified by running the app |

## Deliberately not in scope

- **Editing or deleting images after submit.** Feedback is a one-shot message today; adding mutation means an ownership question (can a merchant delete evidence of a bug they reported?) that this feature does not need to answer.
- **Browser-side compression.** 5 MiB covers a phone screenshot; compression is a size optimisation to reach for if the ceiling turns out to bite.
- **Screenshots on the trial-experience survey** (`TrialFeedbackPrompt.tsx`). Different surface, different table, different question — a survey about the trial does not want a bug screenshot.
- **Any storefront-side upload.** This is the merchant dashboard's feedback form only.
- **Image URLs in the GitHub issue**, in any form, signed or not. The repo is public; see the constraint above.

## What changed during implementation

Three corrections to the design above, all made while building it. Recorded here rather than
edited silently into the sections above, so the reasoning survives.

**The admin link is `/admin#feedback`, not `/admin/feedback`.** There is no `/admin/feedback`
route: the admin dashboard is a single `/admin` route whose sections live in the URL hash
(`useDashboardSection`). The path form matches nothing and renders a blank page — which is
exactly what it did until a run-and-verify pass opened the link. The tables above now say
`#feedback`; `github.test.ts` pins the hash and rejects the path form.

**`validateFeedbackImage` returns a CODE, not only a sentence.** The design had it return
`{ ok: false, error: string }` and had the browser render that string. But `@bitetime/shared`
cannot translate — `t(en, zh)` lives in `SessionContext` — so an English sentence from a shared
module lands untranslated inside a Chinese merchant's dialog, against CLAUDE.md's rule that every
user-facing string is `t(en, zh)`. The result now carries
`code: 'unsupported_type' | 'empty' | 'too_large'`; `FeedbackFab` renders its own bilingual words
and the English `error` remains the server's copy, for 400 bodies and log lines where there is no
reader to translate for.

**The count rule moved into the shared module too, as `validateFeedbackImages`.** The design left
the caller to count files, which meant `store.ts` and the submit route each carried the same
three lines and the same `3` — two chances to drift from the database's own
`cardinality(image_paths) <= 3`. One call now judges a whole selection and returns the offending
index, so both callers name the file themselves and neither restates the limit.

## Production note

The migration must be applied to production by a human (`db:push`). Applying it locally is the whole of this work; nothing here pushes.
