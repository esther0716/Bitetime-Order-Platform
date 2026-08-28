# Storefront SEO is head injection at the edge, not SSR

A storefront at `/s/<slug>` used to serve the empty SPA shell: no per-shop title, no canonical,
no structured data, and a blank document to any crawler that does not run JavaScript. The goal is
brand findability — a customer searching the shop's own name finds the shop — so what a crawler
needs is the **head** (title, description, canonical, `LocalBusiness` JSON-LD with capped product
offers), not the rendered menu body.

We decided: a **Vercel Function inside the frontend project** serves `/s/:slug` and its subpaths.
It reads the shop through the **backend's public API**, injects the head into the **same deploy's
shell**, and caches at the CDN (`s-maxage=300, stale-while-revalidate`). On any error it
**fails open** to the untouched shell — the pre-feature behaviour. A second function serves
`/sitemap-shops.xml` (active shops only; 503 on database failure, never an empty 200).

## Considered options

- **Full SSR of the storefront** — true content parity for JS-less crawlers, but a rendering-
  architecture change that duplicates what `Storefront.tsx` renders. Head-only gets the search
  result (title, snippet via meta description, rich data via JSON-LD) for a fraction of the work,
  and body markup can be added later without undoing anything.
- **Rewrite to the Railway backend** — couples storefront availability to the backend and needs a
  copy of the shell that drifts per deploy. Rejected; the function bundles the shell from its own
  deploy, so drift is impossible.
- **Service-role key in the function, direct Supabase read** — no Railway coupling, but it puts
  the RLS-exempt key on a third runtime surface and re-implements the which-columns-are-public
  decision that `pickMerchantConfig` owns. Rejected: the public API is the one authority, and
  fail-open makes the backend coupling harmless.
- **Crawler-only rendering (UA sniffing)** — zero human-facing risk, but a maintenance tax and a
  legacy workaround in Google's eyes. Humans and crawlers now see identical bytes, so no cloaking
  question can arise.

## Consequences

- Fail-open means total breakage is invisible in a browser: the page still works, only the served
  head is default. The rewrite-ordering test (`vercelRewrites.test.ts`, the #169 failure class),
  the head-builder unit tests and a post-deploy canary are the only detection.
- Merchant-controlled text (shop name, description, product names) lands in raw head HTML and in
  a `<script type="application/ld+json">` block. HTML-escaping the meta values and escaping
  `</script` inside JSON-LD are pinned by unit tests; without them a shop name is stored XSS on
  the crawler-facing document.
- A slug rename would 404 the indexed URL and break printed QR codes, so renames write a slug
  history and the function 301s old → new. Claim-wins: a new shop claiming a slug in another
  shop's history takes it and the redirect dies.
- Statuses: unknown slug → 404; `suspended`/`pending` → 200 + noindex. Subpaths canonicalise to
  the shop root, never noindex (mixed signals).
- Head language is English only; per-shop hreflang is out of scope.
