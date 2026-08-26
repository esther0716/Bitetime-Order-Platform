-- The one colour a merchant picks for their shop. The storefront and the
-- merchant's own dashboard derive their whole accent ramp from it in the
-- browser; nothing on the server reads this column.
--
-- NULL means "use the platform accent", and NULL is what the Reset button
-- writes -- never the literal #7A1028. A shop that never chose must stay a
-- shop that never chose, so that a later change to the platform colour still
-- reaches it. A row holding #7A1028 is a shop that picked oxblood on purpose.
--
-- NO CHECK constraint on the format, deliberately, matching description above.
-- The rule is normalizeBrandColor in @bitetime/shared, enforced by
-- pickMerchantConfig on the way in. A constraint would answer a malformed
-- value with a bare 500 out of PostgREST; the allowlist answers with a 400
-- that names the rule.
alter table public.merchants
  add column if not exists brand_color text;
