-- Superadmin-set flag: shop appears in the landing page sample-shops carousel
-- (GET /api/merchants/samples) when true AND status = 'active'. Toggled from
-- /admin/merchants (POST /api/admin/set-merchant-sample), never by the merchant
-- themselves. See docs/superpowers/specs/2026-08-04-sample-shops-carousel-design.md.
alter table public.merchants
  add column if not exists is_sample boolean not null default false;
