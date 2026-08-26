-- Whether a MERCHANT's email address has been proved to be theirs.
--
-- Deliberately NOT `profiles.email_confirmed`, which already exists and cannot carry this: the
-- browser rewrites that column from `auth.users.email_confirmed_at` on every SIGNED_IN
-- (store.ts's onAuthChange). Merchant accounts are now created pre-confirmed by
-- POST /api/merchant/signup, so that field says `true` from the moment the account exists and
-- would overwrite any flag stored beside it on the very next sign-in.
--
-- This column is written by the backend only, from a link the merchant clicked. It is absent
-- from PROFILE_FIELDS in writes.ts, which is what stops a caller from PUTting themselves
-- verified through /api/me/profile.
alter table profiles add column if not exists email_verified_at timestamptz;

-- Backfill: every merchant owner who exists today reached us THROUGH the confirmation round
-- trip, because that was the only door before this migration. Their address is proved; the
-- banner must not appear for them.
--
-- Scoped to shop owners on purpose. Customers have been created pre-confirmed by
-- POST /api/customer/signup since it shipped, so their addresses are NOT proved, and marking
-- them verified would be a lie written into the table. Nothing reads this column for a
-- customer — for them null means "never asked", and that is the honest value.
update profiles p
set email_verified_at = u.email_confirmed_at
from auth.users u
where u.id = p.user_id
  and p.merchant_id is null
  and p.email_verified_at is null
  and u.email_confirmed_at is not null
  and exists (select 1 from merchants m where m.owner_id = p.user_id);
