# Sample shops carousel (#107)

## What we are building

The landing page hero used to link to one hardcoded shop (`SAMPLE_SHOP_SLUG = 'bitetime-co'`, `apps/frontend/src/marketing/Landing.tsx`) so a hesitant visitor could preview a real storefront before signing up. That link was pulled today (`fcd0a57`) — customers were finding it and placing real orders on the demo shop, since it was just a normal live `/s/:slug` storefront with no distinction from any other shop.

#107 (filed 2026-07-23, before today's incident) asks for two things:
1. A carousel showing multiple sample shops, not one.
2. The sample shop(s) controlled by a database value, not a hardcoded slug.

This spec does both, and also closes the hole that caused today's incident: the carousel renders **non-clickable preview cards**, not links into the live storefront. There is no `/s/:slug` link anywhere in the new UI, so there is no path from the landing page into a real checkout.

Decisions taken during brainstorming:

| Question | Decision |
|---|---|
| Do cards link to the real storefront? | No. Static preview cards only — name, a few real products, prices. Prevents a repeat of today's incident by construction, not by convention. |
| Where does the shop data come from? | Real `merchants` rows flagged `is_sample = true`, with their real `products`. Not a separate curated content table — matches the issue's "control using database value" wording, and a merchant's own menu is the realistic preview a visitor should see. |
| How is a merchant flagged as a sample? | New action in `/admin/merchants` (superadmin only), mirroring the existing comp/uncomp toggle pattern. No raw-SQL-only path. |
| Where does the carousel live on the page? | New section right after the Hero, before "How it works". The existing `StorefrontPreview` hero mock (decorative, animated, not real data) is untouched. |
| What if there are zero sample shops, or the fetch fails? | The section renders nothing. No fabricated fallback content (unlike `usePlatformPricing`, which has a real numeric fallback because a price must always render — a fake shop card would be worse than no section). |

## Data model

`apps/backend/supabase/migrations/<ts>_merchants_is_sample.sql`:

```sql
alter table public.merchants
  add column if not exists is_sample boolean not null default false;

comment on column public.merchants.is_sample is
  'Superadmin-set flag: shop appears in the landing page sample-shops carousel
   (GET /api/merchants/samples) when true AND status = ''active''. Toggled from
   /admin/merchants, never by the merchant themselves.';
```

No RLS policy change needed. Since `20260718130000_revoke_all_browser_grants.sql`, the browser holds zero direct grants on `merchants` — every read (including the public `/s/:slug` resolution) already goes through the backend's service-role `admin` client. The samples endpoint follows the same path.

## Backend

### Admin toggle

`POST /api/admin/set-merchant-sample`, `requireSuperadmin`, mirrors the shape of the existing `set-merchant-status` handler (`apps/backend/src/app.ts`):

```ts
app.post('/api/admin/set-merchant-sample', requireSuperadmin, async (c) => {
  const { merchantId, isSample } = await c.req.json().catch(() => ({}))
  if (!merchantId || typeof isSample !== 'boolean') {
    return c.json({ error: 'Missing merchantId or isSample' }, 400)
  }
  const { data: merchant } = await admin
    .from('merchants').select('id').eq('id', merchantId).maybeSingle()
  if (!merchant) return c.json({ error: 'Merchant not found' }, 404)

  const { error } = await admin.from('merchants').update({ is_sample: isSample }).eq('id', merchantId)
  if (error) {
    console.error('set-merchant-sample failed:', error.message)
    return c.json({ error: 'Update failed' }, 500)
  }
  return c.json({ ok: true, isSample })
})
```

### Public samples endpoint

`GET /api/merchants/samples`, unauthenticated — same trust level as the existing `GET /api/merchants/:slug` and `GET /api/merchants/:id/products`, which are already public reads through `admin`.

```ts
app.get('/api/merchants/samples', async (c) => {
  const { data: merchants, error } = await admin
    .from('merchants')
    .select('id, slug, name, currency')
    .eq('is_sample', true)
    .eq('status', 'active')
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  if (!merchants?.length) return c.json([])

  const { data: products, error: pErr } = await admin
    .from('products')
    .select('id, merchant_id, name, name_zh, price, image_urls')
    .in('merchant_id', merchants.map(m => m.id))
    .eq('active', true)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true })
  if (pErr) return c.json({ error: 'Lookup failed' }, 500)

  const byMerchant = new Map<string, typeof products>()
  for (const p of products ?? []) {
    const list = byMerchant.get(p.merchant_id) ?? []
    if (list.length < 3) list.push(p)
    byMerchant.set(p.merchant_id, list)
  }

  return c.json(merchants.map(m => ({
    id: m.id,
    slug: m.slug,
    name: m.name,
    currency: m.currency,
    products: (byMerchant.get(m.id) ?? []).map(p => ({
      id: p.id,
      name: p.name,
      nameZh: p.name_zh,
      price: p.price,
      imageUrl: p.image_urls?.[0] ?? null,
    })),
  })))
})
```

A merchant flagged sample with zero active products still returns (empty `products` array) — the frontend card handles that by showing just the shop name/avatar, same as `StorefrontPreview` would with no products. This is intentionally not filtered out server-side: it is the correct state for a merchant just flagged, and hiding it silently would look like the toggle didn't work.

The response shape deliberately does not reuse `productFromRow`/`PricedProduct` from `@bitetime/shared` — that type carries promo/pricing-engine fields (`promo_price`, `promo_limit`, …) a marketing card has no use for. Pulling in the shared pricing module for a landing-page card would also be the wrong direction of dependency: pricing rules exist because they must match on both sides of a real transaction, and this endpoint has no transaction.

## Frontend

### `useSampleShops` hook (new, `apps/frontend/src/marketing/`)

Mirrors `usePlatformPricing.ts`'s shape (fetch once on mount, `loading` flag) but with no fallback data — `shops` starts `[]` and stays `[]` on error, which is exactly the "render nothing" behavior wanted:

```ts
export function useSampleShops() {
  const [shops, setShops] = useState<SampleShop[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetchSampleShops()
      .then(r => { if (active && r.ok) setShops(r.data) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return { shops, loading }
}
```

`fetchSampleShops` goes in `store.ts` alongside `fetchPlatformPricing`, following the existing `Result<T, E>` convention (#122).

### `SampleShopsCarousel` component (new, `apps/frontend/src/marketing/`)

- Renders `null` if `shops.length === 0` (covers both "still loading" and "fetch failed/empty" — no loading skeleton, the section just isn't there yet, then appears).
- Horizontal row, CSS `overflow-x: auto; scroll-snap-type: x mandatory` — no new dependency, matches the codebase's minimal-deps convention (no i18n lib, no carousel lib currently in `package.json`).
- Each card: non-interactive `<div>` (not a `<Link>` or `<a>` — no href anywhere in this component, so there is no way to click through to `/s/:slug`), shop name, up to 3 products (name/`nameZh` via `t()`, price via the existing `formatMoney(price, shop.currency)`), thumbnail from `imageUrl` if present else an initials avatar in the same style as `StorefrontPreview`'s `NK` badge.
- Section heading: `t('Real shops on TinyOrder', 'TinyOrder 上的真实店铺')` (placeholder copy, refine at implementation time).

### Landing page wiring

`Landing.tsx`: import and render `<SampleShopsCarousel />` in its own `<section>` between the Hero and "How it works". No change to `StorefrontPreview` or the hero markup.

## Testing

- **Backend (`test:db`, `tests/api/`)**: new suite covering `GET /api/merchants/samples` — returns only `is_sample=true AND status='active'` merchants, caps products at 3 in `sort` order, excludes inactive products, returns `[]` when none flagged; and `POST /api/admin/set-merchant-sample` — 400 on missing/malformed body, 404 on unknown merchant, 200 + persisted flag on success, 403 for a non-superadmin caller (existing `requireSuperadmin` behavior, asserted for this route specifically).
- **Frontend**: run-and-verify per CLAUDE.md (no component tests) — flag a merchant sample via `/admin/merchants`, confirm the card appears on `/` with real product data and no clickable link; unflag it, confirm it disappears; confirm the section is absent entirely when no merchant is flagged.

## Out of scope

- Reordering/curating which products show within a sample shop beyond the existing `sort` column.
- Any click-through from the carousel into the real storefront.
- Analytics/impression tracking on the carousel.
- Admin UI beyond the on/off toggle (e.g. picking a "spotlight" order for shops, custom carousel copy per shop).

---

## Amendment 2026-08-29 — the cards link into the live storefront

The "no click-through" decision above is **reversed**. Every card in the carousel is now a
`<Link to="/s/:slug">` into the shop's real storefront, and a visitor places an ordinary real
order there. The relevant rows of the decision table now read:

| Question | Decision (2026-08-29) |
|---|---|
| Do cards link to the real storefront? | Yes. Every card, to `/s/:slug`, same tab. |
| What is an order placed from the carousel? | An ordinary order on an ordinary storefront. No demo mode, no suppressed notify, no separate counter. |

### Why the original decision did not hold

The original rule stopped the incident of `fcd0a57` by making the page unable to reach a
checkout. It also made the page unable to show the product: a visitor deciding whether to open a
shop is looking at a screenshot of an ordering flow they cannot try. A gallery of pictures of
software is weaker evidence than the software.

### Where the guard moved

From the markup to the flag. `merchants.is_sample` no longer means "show my screenshot on the
marketing page"; it means **this shop accepts real public orders from strangers**. That flag is
set by a superadmin only, from `/admin/merchants`, and the menu there now states the consequence
in full next to the toggle. Flagging a third-party merchant who has not agreed to it sends them
real orders for food nobody will collect — that is the failure mode, and it is now a decision a
human makes with the consequence written on screen, rather than a property of the markup.

### Scope

Frontend only: `SampleShopsCarousel.tsx` (the link, the shop name and a "Start ordering" call to
action), `SampleShopsPage.tsx` (intro copy says the shops are live), `AdminMerchants.tsx` (the
warning line). No migration, and no backend change — `GET /api/merchants/samples` already returns
`slug`.

Still out of scope: a demo or sandbox order mode, a browse-only storefront, and any per-shop
distinction between shops that may and may not be ordered from.
