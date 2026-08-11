-- Merchant-owned advertising pixel ids (#220). A Pro shop pastes its own Meta
-- and/or TikTok pixel id here, and that pixel — and only that pixel — loads on
-- that shop's storefront, behind the customer's own consent.
--
-- ON merchants, NOT merchant_secrets. A pixel id ships inside the page to every
-- visitor and both vendors treat it as public; it is a switch, not a secret.
-- GET /api/merchants/:slug already returns select('*') minus the two internal
-- columns, so these reach an anonymous storefront with no new endpoint.
--
-- NO plan check lives here. The Pro gate is in the route (pixelIdsChanged in
-- writes.ts) and on the load (merchant.plan === 'pro' in the browser); a column
-- default or CHECK cannot see a plan, and a downgrade must HIDE the pixel while
-- keeping the id — see docs/superpowers/specs/2026-08-11-merchant-pixels-design.md.
alter table public.merchants
  add column if not exists meta_pixel_id text,
  add column if not exists tiktok_pixel_id text;
