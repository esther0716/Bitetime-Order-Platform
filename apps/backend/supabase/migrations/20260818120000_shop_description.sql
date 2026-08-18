-- The one line a customer reads under a shop's name on its storefront. The
-- merchant writes it on the dashboard's Storefront section, next to the menu
-- preview it appears above.
--
-- TWO columns, matching every other pair of merchant-authored strings
-- (products.name/name_zh, descr/descr_zh, the categories jsonb). description_zh
-- is optional and falls back to the English line, so a shop that never fills it
-- in reads the same in both languages rather than reading blank in one.
--
-- NO length CHECK here, deliberately. The cap is SHOP_DESCRIPTION_MAX in
-- @bitetime/shared, enforced by pickMerchantConfig on the way in and counted
-- against by the card while the merchant types. A constraint would answer a
-- 161st character with a bare 500 out of PostgREST, long after the merchant who
-- typed it has moved on; the allowlist answers with a 400 that names the rule.
alter table public.merchants
  add column if not exists description text,
  add column if not exists description_zh text;
