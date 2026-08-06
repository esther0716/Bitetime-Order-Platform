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
