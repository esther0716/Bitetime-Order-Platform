-- What kind of business each shop runs (#161), so the platform can see which industries
-- it actually serves. Collected at signup, editable afterwards in Shop Settings, and
-- grouped on by the superadmin Overview.
--
-- A real column rather than a key in the `config` jsonb: this is aggregated across every
-- shop on the platform, and a CHECK is what keeps that aggregate from being a pile of
-- near-duplicate free text. Same reasoning as `tax_enabled` / `merchant_feedback.category`.
--
-- NULLABLE, and every EXISTING shop keeps NULL: they signed up before the field existed and
-- there is nothing honest to backfill them with. The admin Overview counts them as
-- "Unspecified" and they clear it themselves from Shop Settings. Making it NOT NULL DEFAULT
-- 'other' would be a lie that reads as a real answer on the very chart this exists to draw.
alter table merchants
  add column business_nature text;

-- The list is duplicated in `packages/shared/src/businessNature.ts`, which is what the signup
-- dropdown renders and what the backend validates against. This CHECK is the final authority;
-- adding a code means a new migration AND that file. Never rename a code in place — every shop
-- already carrying it would silently change industry.
alter table merchants
  add constraint merchants_business_nature_check check (
    business_nature is null or business_nature in (
      'bakery', 'restaurant', 'beverages', 'grocery',
      'catering', 'snacks', 'florist', 'other'
    )
  );

comment on column merchants.business_nature is
  'Industry the shop operates in (#161). NULL = signed up before the field existed, or never set.';
