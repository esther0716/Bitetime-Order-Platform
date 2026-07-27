-- Enforce the product-image size and type limits at the bucket, not just in the browser.
--
-- `store.ts` has checked both since the feature shipped (PRODUCT_IMAGE_TYPES,
-- MAX_PRODUCT_IMAGE_BYTES), but a browser check is a UX affordance, not a control: the upload
-- goes straight from the client to Storage with the merchant's own token, so anything holding
-- that token — curl, a stale tab, a modified bundle — writes whatever it likes. The bucket was
-- created with neither limit set, which means "any size, any type".
--
-- What that bought an attacker: `product-images` is PUBLIC (the storefront needs it to be), so
-- an authenticated merchant could park arbitrary files of arbitrary size on a world-readable URL
-- under the platform's own Supabase domain, and bill the platform for the storage and egress.
-- The existing folder policy scopes WHERE a merchant may write; it says nothing about WHAT.
--
-- These two settings are the same numbers store.ts already enforces. They are stated in both
-- places on purpose — the client check is what produces a usable error message before a 5MB
-- upload crosses the wire, and this is what makes the rule true regardless of the client.
-- If one changes, change the other.
update storage.buckets
set
  file_size_limit = 5242880, -- 5 MiB — MAX_PRODUCT_IMAGE_BYTES in store.ts
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] -- PRODUCT_IMAGE_TYPES
where id = 'product-images';
