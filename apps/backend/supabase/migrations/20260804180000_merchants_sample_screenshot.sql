-- Screenshot of a sample shop's live storefront, captured weekly by a GitHub Actions cron
-- (.github/workflows/sample-shop-screenshot-sweep.yml) via Playwright, uploaded through
-- POST /api/internal/sample-shop-screenshot/:merchantId. Null until the first successful capture.
alter table public.merchants
  add column if not exists sample_screenshot_path text;

comment on column public.merchants.sample_screenshot_path is
  'Storage path in the PUBLIC `sample-shop-screenshots` bucket ({merchant_id}.png). Never a URL —
   resolve with sampleShopScreenshotUrl() in store.ts. Set only by the internal sweep endpoint
   (service role); no merchant or superadmin ever writes this directly.';

insert into storage.buckets (id, name, public)
values ('sample-shop-screenshots', 'sample-shop-screenshots', true)
on conflict (id) do nothing;

update storage.buckets
set
  file_size_limit = 3145728, -- 3 MiB — MAX_SAMPLE_SCREENSHOT_BYTES in app.ts, a single PNG viewport capture
  allowed_mime_types = array['image/png']
where id = 'sample-shop-screenshots';

-- No storage.objects policy for this bucket, deliberately — mirrors payment-proof's "no policy
-- means no access" (20260804160000). Read is public via the bucket flag above; write only ever
-- happens through admin.storage in the sweep endpoint, which is service_role and bypasses RLS
-- entirely. tests/rls/sample-shot-storage.test.ts is the proof anon/authenticated get neither.
