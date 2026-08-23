# Customer invoice — one PDF, three doors

Date: 2026-08-20
Issue: #242. Reopens ground closed by
[#83](https://github.com/leongcheefai/Bitetime-Order-Platform/issues/83).
Decisions: [ADR 0017](../../adr/0017-the-invoice-is-a-pdf-and-the-only-invoice.md) — the invoice is a
PDF and the only invoice. [ADR 0018](../../adr/0018-a-guest-proves-an-order-with-its-number-and-a-phone.md)
— a guest proves an order with its number and a phone.

## Problem

Customers ask merchants for an invoice, and they keep asking. There is nothing to send them.

The platform once had the document. `store/ReceiptDialog.tsx` rendered one order as a printable page
and `receipt.ts` did its arithmetic. Commit `d940791` removed the trigger from `OrderHistory.tsx` for
#83 and left both files in place, orphaned; `index.css` still carries the `@media print` block that
served them. So today the merchant answers by hand: they read the dashboard and retype it, or they
screenshot it.

Guests are the harder half, and the more common one. A guest order carries `user_id = null` for ever,
the order confirmation email skips such orders structurally, and the old `/track` route no longer
exists in `AppRouter.tsx`. Once the tab closes, the platform cannot reach that customer at all.

## Goal

Any customer of any shop can obtain a PDF invoice for their own order, without the merchant doing
anything — and the merchant can send one anyway when asked.

## Non-goals

- **A tax invoice.** No SST registration number, no MyInvois submission, no validated QR. `merchants`
  has no registration column and gains none here. If a merchant needs a tax invoice, that is a
  separate feature driven by a merchant who asks for it.
- **A payment receipt.** The invoice asserts what was ordered and what is owed. It never says paid.
- **Editing an order.** Nothing here writes to `orders`.
- **Reinstating `/track`.** The guest gets an invoice door, not an order-status page.
- **An emailed invoice.** Guests have no email on file; adding one is its own decision.

## The document

Title **Invoice**, filename `Invoice-<order_number>.pdf`, PDF document title `Invoice <order_number>`.

The page is a **ticket, 226pt wide** (80mm), as tall as the order needs up to one sheet (842pt),
then continued on further pages with the shop name and order number repeated and a `1 / 2` foot. Blocks run: header (INVOICE over the shop name), the shop's address, a perforation, the
order pairs (number/amount, placed/for, method), billed-to and delivery address, a perforation, the
item lines, the money block with the total in 15pt, the payment well, a perforation, and the QR
block over a scalloped foot.

| Block | Content |
|---|---|
| Header | shop name, shop address (`pickup_address ?? origin_address`, omitted when neither), `Invoice`, order number, placed date-time |
| Fulfilment | method label from `orderNotice.ts`'s `MODE_LABELS` — the backend's own English twin of the frontend's `fulfilmentLabel.ts`, since the two workspaces cannot import each other — fulfil date as `21 Aug 2026` — a calendar date formatted from its parts, never parsed into an instant, or a reader in another zone gets the day before |
| Bill to | customer name; delivery address (`formatAddress`) on `delivery` / `express` only |
| Lines | per `orders.items[]`: name, chosen options with their charged deltas, qty, unit price, line total |
| Money | subtotal, fee (named by method, with its km when there is one), voucher, tax with rate, total |
| Payment | `payment_bank` and `payment_note` as text, when the shop has them |

**English labels**, always. **Not printed**: order status, courier, AWB, the customer's WhatsApp
number, the payment QR image.

Rules the numbers follow, unchanged from the old dialog:

- Subtotal is `receiptSubtotal(order.items)` — summed **back from the printed lines**, each rounded to
  cents before summing, so the printed column adds up. Never `total − shipping + discount`, which
  reconciles with the total while disagreeing with the lines above it.
- Money is formatted in **`order.currency`**, never `merchant.currency`. An invoice re-denominated by
  a later settings change is a forgery.
- Tax rate prints via `formatTaxRate` (`6`, `6.5`, never `6.00`) — `tax_rate` is `numeric(5,2)` and
  arrives as a number or a string depending on the client.
- Names and prices come from the order's snapshot. **No menu read.** `orders.items[].name` is
  `products.name` as it stood; options carry both languages inline and the English one wins.

## Availability

Issued at `new`, `preparing`, `ready`, `completed`. Refused at `pending_payment` and `cancelled`.

The gate is a pure predicate beside the generator, not an inline `if` in a route, because three doors
share it.

Consequence to handle in UI: at a shop with manual payment configured, an order is **born**
`pending_payment` (#182), so the order-placed screen cannot offer the file. It shows a line instead —
*"Your invoice will be available once the shop confirms your payment."*

## Doors

Mirrors the `payment-proof` pair exactly, plus one public door.

| Route | Guard | Caller |
|---|---|---|
| `GET /api/merchants/:id/orders/:orderId/invoice.pdf` | `requireMerchantOwns` + `requireOwnsChild('orders','orderId')` | dashboard |
| `GET /api/orders/:orderId/invoice.pdf` | `requireUser`, inline `order.user_id === user.id` | signed-in customer |
| `POST /api/orders/invoice` | public, rate-limited | guest |

Public door body: `{ shop: slug, orderNumber, phone }`. Match is
`merchant_id = <shop>` **and** `order_number = <normalised>` **and**
`customer_phone_key = phoneKey(phone)`. The slug is required because an order number is unique per
shop only — the prefix is the first two alphanumerics of the slug (`orderPrefix.ts`).

Normalisation: the order number is uppercased and trimmed; the phone is fed to `phoneKey()`, which
already reduces any format to its last eight digits.

Failure shape, all three doors: **404 `not_found`**, identical for a missing order, a wrong phone, a
stranger's order and a status that cannot be issued. Any distinction turns the door into an oracle
for which order numbers are real. The status refusal is the one exception worth reconsidering if
support traffic shows customers cannot tell "not yet" from "not found" — deferred, not dismissed.

Rate limit on the public door: `rateLimit.ts` sliding windows, **10/minute and 60/hour per IP**
(`clientIp.ts`). In memory, so a second instance doubles both — the #101 caveat, accepted.

## Surfaces

1. **Order-placed screen** (`store/Storefront.tsx`) — *Download invoice* under the totals, or the
   "once the shop confirms" line when the order is `pending_payment`.
2. **Storefront header** — a quiet *Get an invoice* link beside the existing *Sign in* / *Your orders*
   link, pointing at `/invoice?shop=<slug>`.
3. **Order history** (`store/OrderHistory.tsx`) — *Download invoice* in the expanded row, where *View
   receipt* used to sit.
4. **Merchant order sheet** (`merchant/OrderDetailSheet.tsx`) — *Download invoice*.
5. **`/invoice?shop=<slug>`** — the guest lookup page. Two fields (order number, WhatsApp number), one
   button, one refusal sentence. **Top-level in `AppRouter.tsx`**, outside `MerchantProvider`'s status
   gate, exactly as `ResetPasswordPage` is: a suspended shop must not hold its past customers'
   invoices hostage. Not prerendered, not in `sitemap.xml`, not in `llms.txt` — it is a form over
   private data, not an indexable page.

## Generation

`pdf-lib` + upstream **`fontkit@2`** (never `@pdf-lib/fontkit` — it subsets this face to empty
glyphs; see ADR 0017 and `src/pdfFontkit.ts`). **Noto Sans SC**, one weight, embedded
unconditionally.

The font ships as `src/assets/NotoSansSC.ttf` and the build script copies it to `dist/assets/`;
`invoiceFont.ts` reads it relative to `import.meta.url`, so dev, Vitest and the bundle all take one
path. `tests/unit/invoiceFont.test.ts` pins the copy step.

Backend build gains three `--external:` flags (`pdf-lib`, `fontkit`, `qrcode`) — CLAUDE.md's rule: a new backend
runtime dependency without its flag gets bundled.

The face is a static weight-400 instance, trimmed to Latin + punctuation + currency + the CJK
Unified Ideographs block: 7.0MB rather than the upstream 17MB, regenerable by the commands in
`src/assets/README.md`.

No bold: `pdf-lib` does not synthesise weight and a second face is a second 7MB. Hierarchy is size,
spacing and uppercase — the same device `OrderDetailSheet`'s `LBL` style uses on screen.

## Module shape

Follows the Claude-adapter pattern (`menuImport.ts`, `shopAssistant.ts`): the expensive, decision-heavy
part is **pure**, so `pnpm --filter @bitetime/backend test` drives it with no Supabase and no env.

- `invoice.ts` — pure. `(order, merchant) → Uint8Array`. Imports nothing from `supabase.ts`, `db.ts`
  or `env.ts`. The font arrives as a parameter, the same way an API key does.
- `invoiceStatus.ts` (or a named export beside the generator) — pure predicate: may this status be
  issued?
- The lookup query stays in the route beside the other order reads — it is two `admin` selects, and moving it into `invoice.ts` is what would cost that module its purity.

## Deletions

- `apps/frontend/src/store/ReceiptDialog.tsx`.
- The `@media print` block in `apps/frontend/src/index.css` — `body:has([data-receipt])` and its two
  companions exist solely for that dialog.
- `receipt.ts` becomes **`taxRate.ts`**. The plan said it would stay, on the belief that
  `receiptSubtotal` had callers; it had exactly one, `ReceiptDialog`, so it goes with the dialog and
  the arithmetic now lives on the backend where the document is built. What survives is
  `formatTaxRate`, whose three callers (`OrderHistory.tsx`, `OrderDetailSheet.tsx`,
  `Storefront.tsx`) are rewired — and the file loses the word "receipt", which by this change means
  the slip the CUSTOMER uploads.

## Stale comments to correct while here

Three code comments describe `/track` as a live route. It does not exist in `AppRouter.tsx`.

- `store/CheckoutGate.tsx` — *"It does not claim the order is unfindable: /track still resolves a
  single order by number."* The guest warning's honesty rests on this sentence, and the recourse it
  names is now the invoice door.
- `store/OrderHistory.tsx` and `store/Storefront.tsx` — both explain why they do **not** link to
  `/track`.

`CONTEXT.md`'s *Shop customer* section is corrected in this change set.

## Tests

- `apps/backend/tests/unit/invoice.test.ts` — the money block reconciles (subtotal + fee − voucher
  + tax = total) for a promo-split order, an option-bearing order and a zero-fee pickup order; the
  emitted bytes start with `%PDF`; the status predicate refuses `pending_payment` and `cancelled`;
  and — the one that matters most — the embedded subset is read back out of the rendered PDF and
  every glyph it carries must have an OUTLINE. That last assertion exists because a broken
  subsetter passes every other test in the file while printing two thirds of the letters as
  nothing.
- `apps/backend/tests/api/invoice.test.ts` — db-backed: the merchant door refuses a stranger's order;
  the customer door refuses an order belonging to another account; the guest door accepts the right
  pair, refuses a wrong phone **with the same 404** as a missing order, and refuses a right pair at
  the wrong shop.
- UI is verified by running the app, per CLAUDE.md.

## Deferred

- A tax invoice (registration number, MyInvois).
- Persisting the rate limit in Postgres, as `ai_usage` does.
- Emailing the invoice — needs an email for guests.
- A path for the guest who lost their order number. Today: ask the merchant, who has a button.
