-- Closes the gap left by the original currency column (#186): `currency` is chosen once at
-- signup and never editable afterwards, but until now nothing in Postgres said so — the lock
-- was a UI-only affordance in ShopSettings.tsx, and a direct PATCH could set anything.
--
-- The list is duplicated in `packages/shared/src/currency.ts`, which is what the signup dropdown
-- renders and what the backend validates against. This CHECK is the final authority; adding a
-- currency means a new migration AND that file. Never rename a code in place — every shop
-- already carrying it would silently re-denominate.
alter table public.merchants
  add constraint merchants_currency_check check (
    currency in ('MYR', 'SGD', 'USD', 'THB', 'PHP', 'IDR', 'VND', 'JPY')
  );
