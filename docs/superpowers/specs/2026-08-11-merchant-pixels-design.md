# Merchant-owned Meta and TikTok pixels on storefronts — design

Issue: [#220](https://github.com/leongcheefai/Bitetime-Order-Platform/issues/220)
Follows: [#217](https://github.com/leongcheefai/Bitetime-Order-Platform/issues/217) —
`docs/superpowers/specs/2026-08-11-marketing-pixels-design.md`
Date: 2026-08-11

## Problem

A merchant who runs a Facebook or TikTok ad for their own shop cannot tell either platform which
click became an order. The ad money is spent blind, exactly as TinyOrder's own was before #217 —
except this time the shop pays for the ads and TinyOrder can do nothing about it.

#217 deliberately kept TinyOrder's pixels off `/s/:slug`: those are the merchant's customers, and
sending them to TinyOrder's ad accounts is harvesting. This feature is the other half, and it is
cleaner legally rather than merely permitted. `documents.ts` §1 already makes a shop separately
responsible for the customer data it receives, so a merchant's own pixel on their own storefront
makes the **merchant** the data controller for that tracking.

## Goal

A Pro shop pastes its Meta and/or TikTok pixel id into Shop Settings. That pixel — and only that
pixel — loads on that shop's storefront, behind the customer's consent, and reports PageView,
AddToCart, InitiateCheckout and Purchase with the order value the backend actually committed.

## Non-goals

- **A Basic shop.** Pro-gated, enforced on the write and on the load. See *Entitlement*.
- **TinyOrder's own pixels on a storefront.** Unchanged and still never — `pixelDecision` returns
  no for every question off a marketing path, and this feature adds a second, separate decision
  rather than relaxing that one.
- **The Conversions API / server-side events.** Browser pixels only. An ad blocker therefore costs
  the merchant the event, which is the same deal every shop on every platform gets today.
- **Advanced matching.** No email, phone, name or address is sent to either vendor. `value` and
  `currency` on Purchase are the entire payload, and the `track.ts` signatures are what enforce
  that rather than a sentence in this document.
- **ViewContent.** The storefront has no product page — only an options dialog over a grid — so the
  event would fire on a dialog open and mean close to nothing. Left out until there is a page for
  it to describe.
- **A merchant-facing report of what the pixel saw.** That is Meta's and TikTok's own dashboard,
  and the merchant owns the ad account.
- **Verifying that a pasted id is real.** See *Known limits*.

## Decisions

| Decision | Choice |
|---|---|
| Where the ids live | `merchants.meta_pixel_id` / `merchants.tiktok_pixel_id` |
| Who may set them | Pro only, gated at the route on whether the value MOVED |
| What a downgrade does | The pixel stops loading; the id stays in the row |
| Consent | A banner scoped `shop:<slug>`, fails closed, the same module #217 built |
| Events | PageView, AddToCart, InitiateCheckout, Purchase |
| Purchase value | The `quotedTotal` the backend accepted, plus the shop's currency |

## Data

One migration:

```sql
alter table merchants
  add column if not exists meta_pixel_id text,
  add column if not exists tiktok_pixel_id text;
```

**On `merchants`, not `merchant_secrets`.** A pixel id ships inside the page to every visitor; both
vendors treat it as public. It is a switch, not a secret, and putting it behind the restricted
grants `merchant_secrets` carries would buy nothing and cost the storefront a second fetch.

`GET /api/merchants/:slug` is public and returns `select('*')` minus `owner_id` and
`referred_by_code`, so both ids **and `plan`** reach an anonymous storefront visitor the moment the
columns exist. No new endpoint, no route change, no second round trip on the critical path.

The two ids are added to `Merchant` in `src/types.ts` as `string | null`.

## The write path, and the plan gate

`meta_pixel_id` and `tiktok_pixel_id` join `MERCHANT_CONFIG_FIELDS` in `writes.ts`, and
`pickMerchantConfig` validates their shape under that file's standing rule — **a present-but-invalid
value is refused, never coerced**:

- Meta: `^\d{15,16}$`
- TikTok: `^[A-Z0-9]{20}$`
- `''` and `null` both mean "take it down", and are the only way back to no pixel.

The shapes are a typo filter, not a proof of existence. They exist because the alternative failure —
a merchant pastes their ad *account* id, saves, and gets a success toast — is indistinguishable
from working until a campaign has already run.

The Pro gate is at the route, not `requirePro` middleware, because `PATCH /api/merchants/:id` is
the endpoint every Basic shop edits its shipping rates through:

```ts
if (pixelIdsChanged(patch, stored) && !(await hasProAccess(c))) {
  return c.json({ error: REQUIRES_PRO }, 403)
}
```

`pixelIdsChanged` is the third sibling of `menuCategoriesChanged` (ADR 0013) and
`customDatesChanged` (ADR 0015), and exists for the same recorded reason: ShopSettings resubmits a
whole config bag, so asking whether the body **carries** the field would refuse a Basic ex-Pro shop
editing its delivery fees. The question is whether the value **moved**.

### Clearing is allowed on Basic — and that differs from ADR 0013 on purpose

For menu categories, clearing counts as a change and is refused, so that ceasing to pay cannot
destroy shop data.

A pixel id is the opposite case in both directions. Removing it destroys nothing — the id is a
public 16-digit number the merchant can paste again — and it stops third-party tracking of a
merchant's customers. Refusing it would leave a downgraded shop's customers under a pixel the shop
is no longer able to switch off, which is a worse outcome than any it protects against. So
`pixelIdsChanged` gates **setting or changing** an id, and a change to `null` is always allowed.

## Entitlement, and what a downgrade does

The storefront loads nothing unless `merchant.plan === 'pro'`. That is the same field the backend's
`hasProAccess` reads, so the two cannot disagree about what Pro means; a comped shop is Pro because
comping sets `plan`.

Downgrade follows the ADR 0010 rule — **the downgrade hides, it does not delete**. The id stays in
the row, the storefront stops loading the pixel the moment the plan changes, and re-upgrading
restores it with no retyping. Nothing sweeps the column.

## Module changes in `src/pixels/`

#217 built this folder so that everything except `usePixels.ts` and `platformPixelIds()` takes its
inputs as arguments and reads no environment and no route table. That seam holds. What follows is
what it costs to use it.

| File | Change |
|---|---|
| `ids.ts` | `+ merchantPixelIds(merchant)` — ids off the row, through the same `configured()` trim |
| `decision.ts` | `+ entitled` input |
| `track.ts` | id-scoped calls, a per-vendor event-name map, and a `value`/`currency` payload |
| `ConsentBanner.tsx` | `+ message` prop |
| `load.ts` | unchanged |
| `consent.ts` | unchanged |
| `useMerchantPixels.ts` | new |

### `decision.ts` gains `entitled`

`pixelDecision` takes a fourth input rather than having the plan folded into `configured`. The plan
gate is then a row in the truth table `decision.test.ts` already asserts against, instead of an
`if` inside a hook that only a click-through can reach — which is the argument that file's own
header makes for why it exists at all. `usePixels` passes `entitled: true`; the platform's pixels
are not on a plan.

### `track.ts` — two bugs to prevent, not one refactor to enjoy

**A shared `fbq('track', …)` reports to every inited pixel.** Meta's queue is global: once shop A's
and shop B's pixels are both inited in one SPA session — a customer following two storefront links,
which is a normal afternoon — a bare `fbq('track','Purchase')` sends B's order to A's ad account.
`load.ts`'s `injected` set is already keyed `vendor:id` in anticipation of exactly this. The fix is
`fbq('trackSingle', id, event, params)` and `ttq.instance(id).track(event, params)`.

The platform's own calls move onto the same id-scoped functions. One code path, not a safe one and
a leaky one — a second set of unscoped helpers is a footgun left loaded for whoever adds the next
event.

**The two vendors spell the sale differently.** Meta says `Purchase`; TikTok says `CompletePayment`.
A single string handed to both is an event TikTok drops in silence. So the event union maps to a
per-vendor name:

| Domain event | Meta | TikTok |
|---|---|---|
| `PageView` | `PageView` | `ttq.page()` |
| `AddToCart` | `AddToCart` | `AddToCart` |
| `InitiateCheckout` | `InitiateCheckout` | `InitiateCheckout` |
| `Purchase` | `Purchase` | `CompletePayment` |
| `CompleteRegistration` | `CompleteRegistration` | `CompleteRegistration` |

`pixelTrack` gains an optional `{ value, currency }` params argument — the one #217's `track.ts`
doc says #220 would want, and the only payload either vendor is given. Every call stays wrapped in
the existing `quietly()` guard: these fire from route effects and click handlers, and an ad blocker
that leaves a throwing global must not take down a checkout.

### `ConsentBanner.tsx` gains a `message`

Its current copy reads *"…and never on a shop's page."* This change makes that sentence false. The
banner takes its wording as a prop; the platform passes what it says today, the shop passes text
that names the shop's own responsibility and links to the shop's storefront context rather than to
TinyOrder's marketing claim. Accept and Reject stay the same control at the same weight — that is
the one thing in the file its header forbids tidying.

### `useMerchantPixels.ts`

The sibling of `usePixels.ts`, and the only new file that knows this is a shop:

- ids from `merchantPixelIds(merchant)` off `MerchantContext`
- `entitled` from `merchant.plan === 'pro'`
- `inScope` — we are inside this shop's storefront
- consent scope `shop:${slug}`, so an answer given at `kopi-corner` is not read as an answer at
  `roti-lab`, and neither is read as an answer to TinyOrder's own banner

Mounted inside `Storefront`, which already renders only for a shop resolved by slug and
`status === 'active'`. The platform banner cannot collide with it: `pixelDecision` answers
`banner: false` for every question off a marketing path.

## Storefront events

| Event | Fires when |
|---|---|
| `PageView` | the storefront mounts, and once per shop |
| `AddToCart` | a line is added to the cart |
| `InitiateCheckout` | the customer presses submit, before `placeOrder` |
| `Purchase` | `placeOrder` resolves ok |

**The Purchase value is not a browser recomputation.** `placeOrder` returns `{ orderNumber, id }`
and no total, but order intake re-prices with the same `@bitetime/shared` `priceOrder()` and
refuses any quote it disagrees with (`price_changed`). A **successful** `placeOrder` is therefore
the backend stating that `quotedTotal` is the number it committed. That is the value sent, with
`merchant.currency` as the ISO code — no new endpoint and no widened response.

A refused order reports nothing, because the transaction rolled back and there is no sale.

## Legal

Both documents become false the moment a merchant saves an id, so this is required work rather than
a follow-up.

**Terms** — a new section: a shop that adds an advertising pixel to its storefront is the data
controller for that tracking; it must disclose the pixel to its own customers; it is bound by the
ad platform's own terms; and TinyOrder provides the field, not the ad account. It renumbers the
sections after it, which is mechanical and pinned by `legal.test.ts`.

**Privacy §5** — the sentence *"Advertising cookies are separate, and we only ever set them on our
own marketing pages — never on a shop's storefront"* is replaced. The true version: TinyOrder's own
advertising cookies stay on TinyOrder's own pages; a shop may add its own advertising pixel to its
storefront, which asks you separately and is that shop's responsibility. §1 already says a shop is
a separate controller and needs no change.

## Marketing

Both surfaces read `pricingTiers.ts`, so it is the only file that changes:

- A Pro card feature line — the merchant-facing promise that they can run ads that measure
  themselves, using their own pixel on their own shop.
- A comparison row in the **Customers & marketing** group: `basic: false`, `pro: true`. A genuine
  yes/no, which is the only case that file's `ComparisonValue` doc permits a ✓/– pair.

That file's standing rule applies: every line must be true of the product as shipped, and this one
is enforced by `pixelIdsChanged` on the write and by `entitled` on the load.

## Tests

Vitest, pure, no network:

- `ids` — a row with neither column yields `{}`; whitespace yields `{}`; one column yields one id.
- `decision` — the truth table extended with `entitled`: a configured, in-scope, accepted shop that
  is not entitled loads nothing, reports nothing and shows no banner.
- `track` — `Purchase` reaches TikTok as `CompletePayment`; a call is scoped to its own id and does
  not report to a second inited pixel; absent and throwing globals no-op.
- `writes` — each id shape refused rather than coerced; `pixelIdsChanged` false for a resubmitted
  identical bag, true for a set or a change, and clearing allowed on Basic.
- `legal` — the new Terms section and the rewritten Privacy paragraph.

The banner, the settings form and the storefront wiring are verified by running the app, per
CLAUDE.md. There are no component tests here.

## Known limits

- **A wrong id is silent.** The shape check catches a typo, not a transposition into a stranger's
  live pixel. The merchant confirms it in Meta's own Events Manager, which is where they would look
  anyway; the settings help text says so.
- **A shop with a pixel puts a cookie banner in front of its own customers, on the conversion
  path.** That is real friction on someone else's sales, it is the price of the pixel, and the
  settings copy states it before the merchant saves.
- **Consent is per-browser and per-shop.** A customer who orders from three shops answers three
  times. Correct — three controllers — and it is friction the alternative cannot remove.
- **An ad blocker costs the merchant the event.** Browser pixels only; see *Non-goals*.
- **Nothing is disclosed on the shop's behalf.** TinyOrder's own privacy notice covers TinyOrder.
  Whether a merchant tells its customers is the merchant's obligation under the new Terms section,
  and TinyOrder does not check it.
