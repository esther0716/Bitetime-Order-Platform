# Order Drawer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the merchant order detail drawer as a header, a scrolling body of cards, and a fixed status footer, so that seven equal-weight sections become a readable hierarchy.

**Architecture:** `apps/frontend/src/merchant/OrderDetailSheet.tsx` (436 lines) becomes the folder `apps/frontend/src/merchant/orderDetail/`. The sheet keeps the state, the three save handlers and the frame; eight child components own one region each. One new pure module, `nextStatus.ts`, holds the rule for the advance button. No Supabase call, endpoint or migration changes.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4, Base UI (`@base-ui/react`) behind the local `components/ui/*` wrappers, Vitest, `sonner` for toasts, `lucide-react` for icons.

**Spec:** `docs/superpowers/specs/2026-08-21-order-drawer-redesign-design.md`

## Global Constraints

- **Frontend only.** Do not touch `apps/backend/`, `packages/shared/`, or `apps/frontend/src/store.ts`. No migration. No new endpoint.
- **Every string is bilingual.** There is no i18n library. Write `t('English', '中文')`, where `t` comes from `useSession()`. A string with no Chinese half is a defect.
- **Public props of the drawer do not change:** `order: any | null`, `onClose: () => void`, `onOrderUpdated: (o: any) => void`, `readOnly?: boolean`.
- **The three save calls do not change:** `setOrderStatus(id, status, merchantId)`, `setOrderNote(id, note, merchantId)`, `setOrderTracking(id, courier | null, awb, merchantId)`. Each returns a `Result`; on `r.ok` call `onOrderUpdated(r.data)`.
- **The status vocabulary is fixed** and lives in `apps/frontend/src/orderStatus.tsx`: `ORDER_STATUSES = ['pending_payment', 'new', 'preparing', 'ready', 'completed', 'cancelled']`.
- **No `matchMedia`, no `useMediaQuery`.** The repository has none. Every responsive difference is a Tailwind class on one DOM tree.
- **Tailwind breakpoint is `sm` (640px).** "Phone" means below `sm`; "desktop" means `sm` and above.
- **Run `pnpm lint` and `pnpm typecheck` from the repo root** before every commit. Both must pass.
- Order the file's imports the way the existing file does: React, then app modules, then `@/components/ui/*`.

## Setup (before Task 1)

```bash
cd /Users/leongcheefai/Documents/private/projects/bitetimeco/ordering-app
git checkout dev
git pull
git checkout -b feat/order-drawer-redesign
```

## File Structure

| File | Responsibility |
|------|----------------|
| `apps/frontend/src/merchant/orderDetail/nextStatus.ts` | **New, pure.** `nextStatus(status)` → the successor status and its button label, or `null`. |
| `apps/frontend/src/merchant/orderDetail/nextStatus.test.ts` | **New.** Its tests. |
| `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx` | **Moved.** The `Sheet`, the drafts, the three save handlers, the header/body/footer frame. |
| `apps/frontend/src/merchant/orderDetail/DrawerCard.tsx` | **New.** The white card: title row, body, optional footer. |
| `apps/frontend/src/merchant/orderDetail/OrderHeader.tsx` | **New.** Number, copy, status + mode chips, dates, invoice actions, `⋯` menu. |
| `apps/frontend/src/merchant/orderDetail/StatusFooter.tsx` | **New.** The fixed footer, in both its shapes. |
| `apps/frontend/src/merchant/orderDetail/ItemsCard.tsx` | **New.** The line items. |
| `apps/frontend/src/merchant/orderDetail/PaymentCard.tsx` | **New.** Totals and the payment proof, including the proof fetch effect. |
| `apps/frontend/src/merchant/orderDetail/CustomerCard.tsx` | **New.** Customer and fulfilment fields. |
| `apps/frontend/src/merchant/orderDetail/TrackingCard.tsx` | **New.** Courier and AWB, editable or read-only. |
| `apps/frontend/src/merchant/orderDetail/NoteCard.tsx` | **New.** The note, editable or read-only. |
| `apps/frontend/src/merchant/OrdersView.tsx:14` | Import path only. |
| `apps/frontend/src/merchant/CustomersView.tsx` | Import path only. |

---

### Task 1: The advance rule

**Files:**
- Create: `apps/frontend/src/merchant/orderDetail/nextStatus.ts`
- Test: `apps/frontend/src/merchant/orderDetail/nextStatus.test.ts`

**Interfaces:**
- Consumes: `ORDER_STATUSES` from `apps/frontend/src/orderStatus.tsx` (test only).
- Produces: `export type NextStatus = { to: string; en: string; zh: string }` and `export function nextStatus(status: string | null | undefined): NextStatus | null`. Task 5 renders its label and writes `to`.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/merchant/orderDetail/nextStatus.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ORDER_STATUSES } from '../../orderStatus'
import { nextStatus } from './nextStatus'

describe('nextStatus', () => {
  it('walks the working chain one step at a time', () => {
    expect(nextStatus('new')?.to).toBe('preparing')
    expect(nextStatus('preparing')?.to).toBe('ready')
    expect(nextStatus('ready')?.to).toBe('completed')
  })

  it('labels each step in both languages', () => {
    expect(nextStatus('new')).toMatchObject({ en: 'Start preparing →', zh: '开始备料 →' })
    expect(nextStatus('preparing')).toMatchObject({ en: 'Mark ready →', zh: '标记为已备好 →' })
    expect(nextStatus('ready')).toMatchObject({ en: 'Mark completed →', zh: '标记为已完成 →' })
  })

  it('offers no one-click advance out of pending_payment', () => {
    // To advance a pending_payment order is to say the money arrived. That decision goes
    // through the status list, where the merchant picks the value themselves.
    expect(nextStatus('pending_payment')).toBeNull()
  })

  it('offers no advance from a settled status', () => {
    expect(nextStatus('completed')).toBeNull()
    expect(nextStatus('cancelled')).toBeNull()
  })

  it('offers no advance for a status it has not been taught', () => {
    // Same rule as STATUS_BADGE's neutral fallback: an unknown status is untaught, not a
    // status to guess a successor for.
    expect(nextStatus('sameday')).toBeNull()
    expect(nextStatus(null)).toBeNull()
    expect(nextStatus(undefined)).toBeNull()
  })

  it('only ever names a status the app knows', () => {
    for (const s of ORDER_STATUSES) {
      const n = nextStatus(s)
      if (n) expect(ORDER_STATUSES).toContain(n.to)
    }
  })

  it('never skips a step in the ORDER_STATUSES order', () => {
    for (const s of ORDER_STATUSES) {
      const n = nextStatus(s)
      if (n) expect(ORDER_STATUSES.indexOf(n.to)).toBe(ORDER_STATUSES.indexOf(s) + 1)
    }
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @bitetime/frontend test -- nextStatus`
Expected: FAIL — `Failed to resolve import "./nextStatus"`.

- [ ] **Step 3: Write the module**

Create `apps/frontend/src/merchant/orderDetail/nextStatus.ts`:

```ts
/**
 * The ONE rule for the drawer's advance button: given the status an order is in, the status
 * one press moves it to, and what that press should be called.
 *
 * It is a lookup and not `ORDER_STATUSES[i + 1]` on purpose. That array is a vocabulary, and
 * two of its members are not steps on a line: `pending_payment` sits before `new` because it
 * reads well in a list, and `cancelled` sits after `completed` for the same reason. Walking
 * the array by index would offer "cancel this order" as the one-click move on a completed
 * order, and would advance an unpaid order to `new` — which is a claim that the money arrived.
 */

export type NextStatus = { to: string; en: string; zh: string }

const CHAIN: Record<string, NextStatus> = {
  new:       { to: 'preparing', en: 'Start preparing →',    zh: '开始备料 →' },
  preparing: { to: 'ready',     en: 'Mark ready →',         zh: '标记为已备好 →' },
  ready:     { to: 'completed', en: 'Mark completed →',     zh: '标记为已完成 →' },
}

/**
 * The next status, or `null` when there is no one-click move. `null` covers four cases and
 * they all render the same way — the footer shows the status list alone:
 *
 *   `pending_payment` — advancing it asserts that the money arrived. The merchant says that
 *                       themselves, by choosing the value.
 *   `completed`       — the order is finished.
 *   `cancelled`       — the order is finished the other way.
 *   anything else     — a status this module has not been taught. `STATUS_BADGE` falls back
 *                       to neutral for the same reason; guessing a successor would write a
 *                       value to the database on a guess.
 */
export function nextStatus(status: string | null | undefined): NextStatus | null {
  if (!status) return null
  return CHAIN[status] ?? null
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @bitetime/frontend test -- nextStatus`
Expected: PASS, 7 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/merchant/orderDetail/nextStatus.ts \
        apps/frontend/src/merchant/orderDetail/nextStatus.test.ts
git commit -m "feat(orders): the rule for one-click status advance

The drawer gets a button that moves an order one status forward. The rule is a
lookup, not the next index in ORDER_STATUSES: that array is a vocabulary, and
walking it would offer 'cancel' as the one-click move on a completed order and
would advance an unpaid order, which claims the money arrived."
```

---

### Task 2: Move the drawer into its own folder

A pure move. Nothing about the drawer changes, so every later diff reads as a real change instead of as a rename.

**Files:**
- Move: `apps/frontend/src/merchant/OrderDetailSheet.tsx` → `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx`
- Modify: `apps/frontend/src/merchant/OrdersView.tsx:14`
- Modify: `apps/frontend/src/merchant/CustomersView.tsx` (its `OrderDetailSheet` import)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx` as the default export the other tasks edit.

- [ ] **Step 1: Move the file**

```bash
git mv apps/frontend/src/merchant/OrderDetailSheet.tsx \
       apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx
```

- [ ] **Step 2: Fix the moved file's relative imports**

Every `from '../x'` becomes `from '../../x'`; every `from './x'` that names a sibling in `merchant/` becomes `from '../x'`. The `@/…` imports do not change — they are aliased to `src/`.

In `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx`, the import block becomes:

```tsx
import { useState, useEffect } from 'react'
import { useSession } from '../../SessionContext'
import { setOrderStatus, setOrderNote, setOrderTracking, fetchPaymentProof, fetchOrderInvoice } from '../../store'
import { formatMoney } from '../../currency'
import { formatAddress } from '../../address'
import { formatCalendarDate } from '../../orderDate'
import { fmtDateTime } from '../../merchantDate'
import { formatTaxRate } from '../../taxRate'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { COURIERS, trackingUrl, courierName } from '../../couriers'
import { ORDER_STATUSES, STATUS_LABELS, StatusBadge } from '../../orderStatus'
import { fulfilmentLabel } from '../../fulfilmentLabel'
import { canIssueInvoice } from '@bitetime/shared'
import WaLink from '../WaLink'
import InvoiceButton from '../../components/InvoiceButton'
import SendInvoiceOnWa from '../SendInvoiceOnWa'
import { ItemSelections } from '../../ItemSelections'
```

Nothing else in the file changes.

- [ ] **Step 3: Update the two call sites**

In `apps/frontend/src/merchant/OrdersView.tsx`, line 14:

```tsx
import OrderDetailSheet from './orderDetail/OrderDetailSheet'
```

In `apps/frontend/src/merchant/CustomersView.tsx`, the same edit to its `OrderDetailSheet` import.

- [ ] **Step 4: Verify nothing else imports the old path**

Run: `grep -rn "merchant/OrderDetailSheet\|from './OrderDetailSheet'" apps/frontend/src`
Expected: no output.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add -A apps/frontend/src/merchant
git commit -m "refactor(orders): the order drawer moves into its own folder

A pure move, so the redesign that follows reads as a change and not as a
rename. The drawer is about to become nine files."
```

---

### Task 3: The frame and the card

The drawer becomes header / scrolling body / fixed footer, and the hairline `Section` becomes a white card on a cream body.

**Files:**
- Create: `apps/frontend/src/merchant/orderDetail/DrawerCard.tsx`
- Modify: `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx`

**Interfaces:**
- Consumes: nothing from Tasks 1–2 beyond the moved file.
- Produces: `DrawerCard` — `{ title?: string; aside?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode }`. Tasks 6–10 render their content inside it. Also `export const LBL` moves here and is imported by Tasks 7–10.

- [ ] **Step 1: Write the card**

Create `apps/frontend/src/merchant/orderDetail/DrawerCard.tsx`:

```tsx
/** 11px semibold uppercase muted label — the drawer's one small-caption style. */
export const LBL = 'text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground shrink-0'

/**
 * One group in the drawer body: a white card on the cream canvas, the same treatment the
 * dashboard already gives its panels.
 *
 * It replaces a hairline rule and a caption. Seven groups separated by hairlines gave every
 * group the same weight, so "Payment proof" read as being as important as "Items"; a card has
 * an edge, so the eye can tell one group from the next without reading either.
 *
 * `aside` is the right-hand end of the title row — a count, or a chip. `footer` is the save
 * button belonging to a card that edits something: the button that writes a card's fields
 * belongs to that card, not to a run of buttons somewhere down the page.
 */
export default function DrawerCard({
  title,
  aside,
  footer,
  children,
}: {
  title?: string
  aside?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="shrink-0 bg-card border border-border rounded-xl">
      {(title || aside) && (
        <div className="flex items-center gap-2 px-4 pt-3">
          {title && <span className={LBL}>{title}</span>}
          {aside && <span className="ml-auto">{aside}</span>}
        </div>
      )}
      <div className="px-4 pt-2.5 pb-3.5">{children}</div>
      {footer && (
        <div className="flex justify-end gap-2 px-4 py-2.5 border-t border-border">{footer}</div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Rebuild the frame in the sheet**

In `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx`, replace the `<SheetContent>` opening tag and the body wrapper.

Replace this line:

```tsx
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
```

with:

```tsx
      {/* `data-[side=right]:sm:max-w-[680px]`, not a bare `sm:max-w-[680px]`: the base
          SheetContent already carries `data-[side=right]:sm:max-w-sm`, and a plain utility
          has one variant against its two, so Tailwind orders it FIRST and the base wins.
          Matching the variant lets tailwind-merge drop the base one instead.
          `gap-0` and `overflow-hidden` undo the base popup's `gap-4` and let the body be the
          only thing that scrolls. */}
      <SheetContent
        side="right"
        className="w-full data-[side=right]:sm:max-w-[680px] gap-0 overflow-hidden"
      >
```

Replace this line:

```tsx
            <div className="flex flex-col px-4 pb-4">
```

with:

```tsx
            <div className="flex-1 min-h-0 overflow-y-auto bg-background flex flex-col gap-3 p-3 sm:p-4">
```

`flex-1 min-h-0 overflow-y-auto` is what makes the body the scroller. Without `min-h-0` a flex child refuses to shrink below its content and the whole popup scrolls instead, which puts the header out of reach.

- [ ] **Step 3: Pin the header so it does not scroll**

Change the `SheetHeader` opening tag from:

```tsx
            <SheetHeader className="border-b border-muted">
```

to:

```tsx
            <SheetHeader className="shrink-0 border-b border-border pr-9">
```

`pr-9` clears the sheet's own close button, which `SheetContent` draws `absolute top-3 right-3`.

- [ ] **Step 4: Convert every `Section` to `DrawerCard`**

Delete the local `Section` function. Import the card at the top of the file:

```tsx
import DrawerCard, { LBL } from './DrawerCard'
```

Delete the file's own `const LBL = …` line — it now comes from `DrawerCard`.

Then rename every `<Section title={…}>` element to `<DrawerCard title={…}>` and each `</Section>` to `</DrawerCard>`. Their contents do not change in this task.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both pass.

- [ ] **Step 6: Look at it**

Start the app and local Supabase, then open any order from the dashboard Orders tab.

```bash
pnpm dev
```

Expected: the drawer is ~680px wide on a laptop; the header stays put while the body scrolls; each group is a white card on the cream background. The status select is still the last card — Task 5 moves it.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/merchant/orderDetail
git commit -m "feat(orders): the drawer becomes a header, a scrolling body and cards

Seven groups separated by hairlines gave every group the same weight, so the
payment proof read as being as important as the items. Each group is now a white
card on the cream canvas, the treatment the dashboard already uses, and only the
body scrolls, so the order number stays on screen.

The drawer also widens to 680px on a desktop, where it was capped at the sheet's
own small size."
```

---

### Task 4: The header

**Files:**
- Create: `apps/frontend/src/merchant/orderDetail/OrderHeader.tsx`
- Modify: `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `OrderHeader` — `{ order: any; readOnly: boolean; merchantId: string }`, default export.

The `⋯` menu is a **`Popover`**, not a `DropdownMenu`. Its two entries are the existing
`InvoiceButton` and `SendInvoiceOnWa`, and both render a button or an anchor of their own. A
`DropdownMenuItem` is `role="menuitem"`, so putting a button inside one nests an interactive
element in an interactive element — which a screen reader reads wrong and which swallows the
inner element's own click handling. A popover panel has no such semantics, so both components
go in untouched.

- [ ] **Step 1: Write the header**

Create `apps/frontend/src/merchant/orderDetail/OrderHeader.tsx`:

```tsx
import { toast } from 'sonner'
import { Copy, MoreHorizontal } from 'lucide-react'
import { useSession } from '../../SessionContext'
import { fetchOrderInvoice } from '../../store'
import { fmtDateTime } from '../../merchantDate'
import { formatCalendarDate } from '../../orderDate'
import { StatusBadge } from '../../orderStatus'
import { fulfilmentLabel } from '../../fulfilmentLabel'
import { canIssueInvoice } from '@bitetime/shared'
import InvoiceButton from '../../components/InvoiceButton'
import SendInvoiceOnWa from '../SendInvoiceOnWa'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'

/**
 * The drawer's header says WHICH order this is, and nothing else.
 *
 * It used to also carry a row of invoice controls, captioned INVOICE, under a title that is
 * mostly an order number — which wrapped onto its own line and made the header read as a wall
 * of text. Those controls now sit at the end of the title row, and on a phone they collapse
 * into one `⋯` menu.
 */
export default function OrderHeader({
  order,
  readOnly,
  merchantId,
}: {
  order: any
  readOnly: boolean
  merchantId: string
}) {
  const { t, lang } = useSession()
  const invoiceable = canIssueInvoice(order.status)
  // Below `sm` the panel always has something to hold — copy and download live there. At `sm`
  // and above those two are visible in the row instead, so the only entry left is the WhatsApp
  // send, which a suspended shop does not get. Without this the desktop `⋯` would open an
  // empty panel. `sm:hidden` on the button is what makes "desktop" mean the same thing here as
  // it does for the entries inside.
  const menuOnDesktop = !readOnly

  // The number is what a merchant reads back to a customer on the phone or pastes into their
  // own books. Selecting six characters of a sheet title on a phone is the fiddly part.
  const copyOrderNumber = async (n: string) => {
    try {
      await navigator.clipboard.writeText(n)
      toast.success(t('Order number copied', '订单号已复制'))
    } catch {
      toast.error(t('Could not copy — copy it manually', '无法复制 — 请手动复制'))
    }
  }

  return (
    <SheetHeader className="shrink-0 border-b border-border pr-9">
      <div className="flex items-center gap-2">
        <SheetTitle className="text-[17px] sm:text-[19px]">{order.order_number || '—'}</SheetTitle>
        {order.order_number && (
          <Button
            variant="ghost"
            size="iconRound"
            aria-label={t('Copy order number', '复制订单号')}
            onClick={() => copyOrderNumber(order.order_number!)}
            className="hidden sm:inline-flex"
          >
            <Copy className="size-3.5" />
          </Button>
        )}

        {invoiceable && (
          <>
            {/* Visible on a desktop, where there is room for a word. On a phone the same
                action lives in the menu below. Two instances, but they are breakpoint
                exclusive — only one is ever on screen. */}
            <span className="ml-auto hidden sm:inline-flex">
              <InvoiceButton
                status={order.status}
                orderNumber={order.order_number}
                fetcher={() => fetchOrderInvoice(merchantId, order.id)}
                className="text-[13px]"
                label={t('Download invoice', '下载账单')}
              />
            </span>

            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="iconRound"
                    aria-label={t('More actions', '更多操作')}
                    className={cn('ml-auto sm:ml-0', !menuOnDesktop && 'sm:hidden')}
                  />
                }
              >
                <MoreHorizontal className="size-4" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto min-w-[190px] flex flex-col items-start gap-2.5 p-3">
                {order.order_number && (
                  <Button
                    variant="link"
                    size="none"
                    className="sm:hidden inline-flex items-center gap-1.5 text-[13px] text-foreground"
                    onClick={() => copyOrderNumber(order.order_number!)}
                  >
                    <Copy className="size-3.5" />
                    {t('Copy order number', '复制订单号')}
                  </Button>
                )}
                <span className="sm:hidden">
                  <InvoiceButton
                    status={order.status}
                    orderNumber={order.order_number}
                    fetcher={() => fetchOrderInvoice(merchantId, order.id)}
                    className="text-[13px]"
                    label={t('Download invoice', '下载账单')}
                  />
                </span>
                {/* A WhatsApp message the merchant presses send on. It carries the LINK to
                    that customer's own invoice door, never the file — see `invoiceShare.ts`.
                    It renders null with no WhatsApp number, which is why the panel sizes to
                    its content rather than to a fixed row count. */}
                {!readOnly && (
                  <SendInvoiceOnWa
                    status={order.status}
                    orderNumber={order.order_number}
                    customerWa={order.customer_wa}
                    customerName={order.customer_name}
                  />
                )}
              </PopoverContent>
            </Popover>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-1.5">
        <StatusBadge status={order.status || 'new'} t={t} />
        <Badge className="bg-neutral-100 text-neutral-fg border-transparent">
          {fulfilmentLabel(order.mode, t)}
        </Badge>
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-1 text-[12px] text-muted-foreground">
        <span>{t('Placed', '下单')} {fmtDateTime(order.created_at)}</span>
        {/* The date the CUSTOMER asked for — what the merchant schedules around — not
            `created_at` beside it. Shown as `—` rather than dropped for a legacy order: a
            missing date would read as "this order has no fulfilment info" rather than
            "placed before #91". */}
        <span aria-hidden="true" className="text-border">·</span>
        <span>
          {t('For', '取货日期')}{' '}
          {order.fulfil_date ? formatCalendarDate(order.fulfil_date, lang) : '—'}
        </span>
      </div>
    </SheetHeader>
  )
}
```

- [ ] **Step 2: Use it in the sheet**

In `OrderDetailSheet.tsx`, delete the whole `<SheetHeader>…</SheetHeader>` block and put in its place:

```tsx
            <OrderHeader order={order} readOnly={readOnly} merchantId={merchant!.id} />
```

Add the import:

```tsx
import OrderHeader from './OrderHeader'
```

Then delete the imports the sheet no longer uses: `Copy` from `lucide-react`, `fetchOrderInvoice` from `../../store`, `InvoiceButton`, `SendInvoiceOnWa`, `canIssueInvoice`, `SheetHeader`, `SheetTitle`, and the `copyOrderNumber` function. Keep `fmtDateTime` only if another part of the file still calls it; if not, delete that import too.

- [ ] **Step 3: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both pass. `pnpm lint` is what catches an import left behind.

- [ ] **Step 4: Look at it**

With `pnpm dev` running, open an order whose status is `completed` (invoice actions show) and one whose status is `pending_payment` (they do not).

Expected on a laptop: number, copy button, `Download invoice`, `⋯`; below them a status chip and a mode chip; below those the two dates. The sheet's own close X does not overlap the `⋯`.
Expected at 390px (browser device toolbar): number and `⋯` only; copy and download are inside the menu.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/merchant/orderDetail
git commit -m "feat(orders): the drawer header states identity only

The header carried an order number, a copy button, a status badge, a timestamp
and a captioned row of two invoice buttons. The invoice row wrapped onto its own
line. The invoice actions now sit at the end of the title row, and on a phone
they collapse into one menu.

The header also gains the mode chip and the date the customer asked for, which
the body used to hold three scrolls further down."
```

---

### Task 5: The status footer

**Files:**
- Create: `apps/frontend/src/merchant/orderDetail/StatusFooter.tsx`
- Modify: `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx`

**Interfaces:**
- Consumes: `nextStatus` from `./nextStatus` (Task 1). It needs nothing from `DrawerCard` — the footer is not a card.
- Produces: `StatusFooter` — `{ status: string; onChange: (status: string) => void }`, default export.

- [ ] **Step 1: Write the footer**

Create `apps/frontend/src/merchant/orderDetail/StatusFooter.tsx`:

```tsx
import { useSession } from '../../SessionContext'
import { ORDER_STATUSES, STATUS_LABELS } from '../../orderStatus'
import { nextStatus } from './nextStatus'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * The status control, pinned to the bottom of the drawer.
 *
 * Changing the status is the thing a merchant opens this drawer to do most often, and it used
 * to be the LAST control on the page — reachable only by scrolling past the items, the address,
 * the courier fields and the note. It does not scroll any more, and the usual next step is a
 * button rather than a list to open and read.
 *
 * One `Select` serves both shapes. There is no `useMediaQuery` in this codebase and no reason
 * to add one: the only difference is how the trigger is dressed, which is a class.
 */
export default function StatusFooter({
  status,
  onChange,
}: {
  status: string
  onChange: (status: string) => void
}) {
  const { t } = useSession()
  const next = nextStatus(status)
  const statusItems = ORDER_STATUSES.map(s => ({
    value: s,
    label: t(STATUS_LABELS[s].en, STATUS_LABELS[s].zh),
  }))

  return (
    <div className="shrink-0 border-t border-border bg-card px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <Select
        value={status}
        // `if (v)` rather than `??` — this handler writes to the database, so a null must be
        // dropped, never coerced into a status.
        onValueChange={v => { if (v) onChange(v) }}
        items={statusItems}
      >
        <SelectTrigger
          aria-label={t('Order status', '订单状态')}
          className={cn(
            'w-full bg-background text-[13px] sm:w-[190px]',
            // With an advance button present, the phone shows the list as a quiet text
            // button under it — the primary move gets the thumb-sized target. On a desktop,
            // and whenever there is no advance button, it is an ordinary select box.
            next && 'order-2 justify-center border-0 shadow-none text-muted-foreground underline underline-offset-2 [&_svg]:hidden sm:order-1 sm:justify-between sm:border sm:border-input sm:shadow-xs sm:no-underline sm:text-foreground sm:[&_svg]:block',
          )}
        >
          {next ? (
            <>
              <span className="sm:hidden">{t('Set another status', '设置其他状态')}</span>
              <SelectValue className="hidden sm:flex" />
            </>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          {statusItems.map(i => (
            <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {next && (
        <Button
          type="button"
          size="none"
          onClick={() => onChange(next.to)}
          className="order-1 w-full rounded-lg px-[14px] py-[10px] text-[14px] sm:order-2 sm:ml-auto sm:w-auto"
        >
          {t(next.en, next.zh)}
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Use it in the sheet**

In `OrderDetailSheet.tsx`, delete the last `DrawerCard` — the whole `{!readOnly && (<DrawerCard title={t('Status', '状态')}> … </DrawerCard>)}` block — and its `statusItems` constant.

Immediately after the closing `</div>` of the scrolling body, add:

```tsx
            {!readOnly && (
              <StatusFooter
                status={order.status || 'new'}
                onChange={s => handleStatusChange(order, s)}
              />
            )}
```

Add the import:

```tsx
import StatusFooter from './StatusFooter'
```

Delete the sheet's now-unused imports: `ORDER_STATUSES`, `STATUS_LABELS`, and — if nothing else in the file uses them — `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue`. The tracking card still uses the Select in this task, so keep them until Task 9 moves it.

- [ ] **Step 3: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both pass.

- [ ] **Step 4: Drive it**

With `pnpm dev` running:

1. Open a `new` order. The footer reads `Start preparing →`. Press it. The badge in the header becomes `Preparing`, and the row behind the drawer updates.
2. The footer now reads `Mark ready →`. Press it, then press `Mark completed →`.
3. The footer now shows the select alone, with no button.
4. Open a `pending_payment` order. The footer shows the select alone.
5. Use the select to set `cancelled`. The button disappears.
6. At 390px, repeat step 1: a full-width primary button, with `Set another status` underneath it. Press that text and confirm the full six-item list opens.
7. Open the drawer from the suspended-shop screen. There is no footer at all.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/merchant/orderDetail
git commit -m "feat(orders): the status control leaves the scroll

Changing the status is what a merchant opens this drawer to do most often, and
it was the last control on the page — reachable only past the items, the
address, the courier fields and the note. It is now a fixed footer, and the
usual next step is one button instead of a list to open and read.

A suspended shop still gets no footer, so no status write is reachable there."
```

---

### Task 6: The items card

**Files:**
- Create: `apps/frontend/src/merchant/orderDetail/ItemsCard.tsx`
- Modify: `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx`

**Interfaces:**
- Consumes: `DrawerCard` from `./DrawerCard` (Task 3).
- Produces: `ItemsCard` — `{ items: any[]; currency?: string }`, default export.

- [ ] **Step 1: Write the card**

Create `apps/frontend/src/merchant/orderDetail/ItemsCard.tsx`:

```tsx
import { useSession } from '../../SessionContext'
import { formatMoney } from '../../currency'
import { ItemSelections } from '../../ItemSelections'
import DrawerCard from './DrawerCard'

/** What was ordered. The money it adds up to is `PaymentCard`'s. */
export default function ItemsCard({ items, currency }: { items: any[]; currency?: string }) {
  const { t } = useSession()
  const count = items.length

  return (
    <DrawerCard
      title={t('Items', '商品')}
      aside={
        <span className="text-[12px] text-muted-foreground">
          {t(`${count} item${count === 1 ? '' : 's'}`, `${count} 件商品`)}
        </span>
      }
    >
      <ul className="flex flex-col">
        {items.map((it: any, i: number) => (
          // Index key, deliberately not id: a split promo puts two lines with the SAME
          // product id in `items` (base half + promo half), and keying by id would collapse
          // them into one row on screen while charging for both.
          <li
            key={i}
            className="flex justify-between gap-3 py-1.5 text-[13px] text-foreground border-t border-dashed border-border first:border-t-0 first:pt-0"
          >
            <span className="min-w-0 break-words">
              <span className="text-muted-foreground tabular-nums">{it.qty}×</span> {it.name}
              <ItemSelections item={it} />
              {/* `it.promo` missing (rows written before I-2) reads as false, not a crash. */}
              {it.promo && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-pill bg-primary text-white text-[10px] leading-[14px] font-medium align-middle">
                  {t('Promo', '优惠')}
                </span>
              )}
            </span>
            <span className="tabular-nums text-muted-foreground whitespace-nowrap">
              {formatMoney((it.price ?? 0) * (it.qty ?? 0), currency)}
            </span>
          </li>
        ))}
      </ul>
    </DrawerCard>
  )
}
```

- [ ] **Step 2: Use it in the sheet**

In `OrderDetailSheet.tsx`, the `Items` card currently holds both the item list and the totals block. Replace only the `<ul>…</ul>` part: delete the `<DrawerCard title={t('Items', '商品')}>` wrapper and its `<ul>`, and put in their place, as the first child of the scrolling body:

```tsx
              <ItemsCard items={order.items ?? []} currency={orderCurrency} />
```

Leave the totals `<div className="flex flex-col gap-1 pt-2 mt-1 border-t border-dashed …">` in place for now, wrapped in its own temporary `<DrawerCard title={t('Payment', '付款')}>`. Task 7 replaces it.

Add the import:

```tsx
import ItemsCard from './ItemsCard'
```

Delete `ItemSelections` from the sheet's imports.

- [ ] **Step 3: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both pass.

- [ ] **Step 4: Look at it**

Open an order with at least two items, one of which has option selections, and ideally one promo line.
Expected: an `Items` card headed by the line count on the right; dashed rules between lines and none above the first; options in muted 12px under the name; the promo pill unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/merchant/orderDetail
git commit -m "feat(orders): the items become their own card

The card also states its line count, so a long order says how long it is before
the merchant scrolls it."
```

---

### Task 7: The payment card

**Files:**
- Create: `apps/frontend/src/merchant/orderDetail/PaymentCard.tsx`
- Modify: `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx`

**Interfaces:**
- Consumes: `DrawerCard` from `./DrawerCard` (Task 3).
- Produces: `PaymentCard` — `{ order: any; currency?: string; merchantId: string }`, default export. It owns the payment-proof fetch effect, which leaves `OrderDetailSheet`.

- [ ] **Step 1: Write the card**

Create `apps/frontend/src/merchant/orderDetail/PaymentCard.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useSession } from '../../SessionContext'
import { fetchPaymentProof } from '../../store'
import { formatMoney } from '../../currency'
import { formatTaxRate } from '../../taxRate'
import { Badge } from '@/components/ui/badge'
import DrawerCard from './DrawerCard'

/**
 * What is owed, and what the customer sent to show they paid it.
 *
 * The proof used to be its own section three groups above the total it proves. It sits beside
 * the money now — on a desktop next to the summary, and under it on a phone, where there is no
 * width for a column.
 */
export default function PaymentCard({
  order,
  currency,
  merchantId,
}: {
  order: any
  currency?: string
  merchantId: string
}) {
  const { t } = useSession()
  // `orderId` on the record is what proves a fetched url still belongs to the order on screen —
  // switching to a different order (proof or not) must not keep showing the last one's image
  // while its own fetch is still in flight.
  const [proof, setProof] = useState<{ orderId: string; url: string } | null>(null)

  // Lazy: only fetched when the drawer is open for an order that actually has one, not on every
  // dashboard list render. ONE effect owns the whole lifecycle of one fetched image — it revokes
  // the url ITS OWN fetch created, in ITS OWN cleanup — so switching to a DIFFERENT order (proof
  // or not) or unmounting always revokes, not just "a new proof landed".
  useEffect(() => {
    if (!order?.payment_proof) return
    const orderId = order.id!
    let cancelled = false
    let url: string | null = null
    fetchPaymentProof(merchantId, orderId).then((r) => {
      if (cancelled || !r.ok) return
      url = URL.createObjectURL(r.data)
      setProof({ orderId, url })
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [order?.id, order?.payment_proof, merchantId])

  const proofUrl = proof && proof.orderId === order?.id ? proof.url : null

  return (
    <DrawerCard
      title={t('Payment', '付款')}
      aside={
        order.payment_proof ? (
          <Badge className="bg-success-100 text-success-fg border-transparent">
            {t('Proof uploaded', '已上传凭证')}
          </Badge>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-start sm:gap-4">
        <div className="flex-1 min-w-0 text-[13px]">
          {order.shipping_fee != null && (
            <div className="flex justify-between py-0.5">
              {/* The dashboard keeps its own word for this ("Shipping"), which is the
                  merchant's, not the customer's — only the DISTANCE is added here. The
                  stored value labels it, never a re-derivation: null (region-priced, or
                  placed before #101) prints the plain label, never `0.0 km`. */}
              <span className="text-muted-foreground">
                {order.delivery_distance_km != null
                  ? t(`Shipping (${Number(order.delivery_distance_km).toFixed(1)} km)`,
                      `运费（${Number(order.delivery_distance_km).toFixed(1)} 公里）`)
                  : t('Shipping', '运费')}
              </span>
              <span className="tabular-nums text-foreground">{formatMoney(order.shipping_fee, currency)}</span>
            </div>
          )}
          {order.discount != null && order.discount > 0 && (
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">
                {t('Discount', '折扣')}{order.voucher_code ? ` (${order.voucher_code})` : ''}
              </span>
              <span className="tabular-nums text-foreground">−{formatMoney(order.discount, currency)}</span>
            </div>
          )}
          {order.tax_rate != null && order.tax_rate > 0 && (
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">{t('Tax', '税')} ({formatTaxRate(order.tax_rate)}%)</span>
              <span className="tabular-nums text-foreground">{formatMoney(order.tax ?? 0, currency)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline mt-2 px-3 py-2.5 rounded-lg bg-brand-50 text-[15px] font-medium">
            <span className="text-foreground">{t('Total', '总计')}</span>
            <span className="tabular-nums text-primary">{formatMoney(order.total, currency)}</span>
          </div>
        </div>

        {order.payment_proof && (
          <div className="shrink-0">
            {proofUrl ? (
              <a href={proofUrl} target="_blank" rel="noopener noreferrer" className="block w-[78px]">
                <img
                  src={proofUrl}
                  alt={t('Payment proof', '付款凭证')}
                  className="w-[78px] h-[78px] object-cover rounded-lg border border-border"
                />
              </a>
            ) : (
              <span className="text-[13px] text-muted-foreground">{t('Loading…', '加载中…')}</span>
            )}
          </div>
        )}
      </div>
    </DrawerCard>
  )
}
```

`sm:flex-row-reverse` puts the summary on the left and the proof on the right at desktop width, while the phone stack keeps the summary first, above the proof.

- [ ] **Step 2: Use it in the sheet**

In `OrderDetailSheet.tsx`:

- Delete the temporary `Payment` `DrawerCard` from Task 6 and the whole totals `<div>` inside it.
- Delete the `Payment proof` `DrawerCard`.
- Delete the `proof` state, the `useEffect` that fetches it, and the `proofUrl` constant.
- Put this immediately after `<ItemsCard … />`:

```tsx
              <PaymentCard order={order} currency={orderCurrency} merchantId={merchant!.id} />
```

Add the import:

```tsx
import PaymentCard from './PaymentCard'
```

Delete the sheet's now-unused imports: `useEffect` from `react`, `fetchPaymentProof` from `../../store`, `formatMoney`, `formatTaxRate`.

- [ ] **Step 3: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both pass.

- [ ] **Step 4: Drive it**

1. Open an order that has a payment proof. The card is headed `Proof uploaded`; the thumbnail sits to the right of the summary on a laptop. Click it — the full image opens in a new tab.
2. Open a different order that has NO proof, then go back to the first one. The right order's image shows each time. There is no flash of the previous order's image.
3. Open an order with a voucher and one with a tax rate, and confirm both lines print with their code and their percentage.
4. Open a pickup order. There is no shipping line.
5. At 390px, the summary is above the thumbnail.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/merchant/orderDetail
git commit -m "feat(orders): the payment proof sits beside the money it proves

The proof was its own section three groups above the total. One card now holds
the summary and the screenshot. The fetch effect moves with it unchanged: it
still keys on the order id and revokes the url its own fetch created."
```

---

### Task 8: The customer and delivery card

**Files:**
- Create: `apps/frontend/src/merchant/orderDetail/CustomerCard.tsx`
- Modify: `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx`

**Interfaces:**
- Consumes: `DrawerCard`, `LBL` from `./DrawerCard` (Task 3).
- Produces: `CustomerCard` — `{ order: any }`, default export.

- [ ] **Step 1: Write the card**

Create `apps/frontend/src/merchant/orderDetail/CustomerCard.tsx`:

```tsx
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { useSession } from '../../SessionContext'
import { formatAddress } from '../../address'
import { formatCalendarDate } from '../../orderDate'
import { fulfilmentLabel } from '../../fulfilmentLabel'
import WaLink from '../WaLink'
import { Button } from '@/components/ui/button'
import DrawerCard, { LBL } from './DrawerCard'

/**
 * Who the order is for and where it goes.
 *
 * These were two groups, `Customer` and `Fulfilment`, and the second drew its rows through a
 * fixed 84px label column — which left a delivery address about 300px to wrap in, so a real
 * Malaysian address took three lines. The label sits ABOVE its value now, and the field spans
 * both columns, so the address gets the full width of the card.
 */
function Field({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className={`${LBL} flex items-center gap-1`}>{label}{action}</span>
      <span className="text-[13px] text-foreground break-words">{children}</span>
    </div>
  )
}

export default function CustomerCard({ order }: { order: any }) {
  const { t, lang } = useSession()
  const address = order.address ? formatAddress(order.address) : null

  const copyAddress = async (a: string) => {
    try {
      await navigator.clipboard.writeText(a)
      toast.success(t('Address copied', '地址已复制'))
    } catch {
      toast.error(t('Could not copy — copy it manually', '无法复制 — 请手动复制'))
    }
  }

  return (
    <DrawerCard title={t('Customer & delivery', '顾客与配送')}>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-x-6">
        <Field label={t('Customer', '顾客')}>
          {order.customer_name || '—'}
        </Field>

        {order.customer_wa && (
          <Field label={t('WhatsApp', 'WhatsApp')}>
            <WaLink wa={order.customer_wa} />
          </Field>
        )}

        <Field label={t('Fulfilment', '配送')}>
          {/* The date the CUSTOMER asked for, shown as `—` rather than omitted for a legacy
              order: a missing row would read as "this order has no fulfilment info" rather
              than "placed before #91". */}
          {fulfilmentLabel(order.mode, t)}
          {' · '}
          {order.fulfil_date ? formatCalendarDate(order.fulfil_date, lang) : '—'}
        </Field>

        {order.region && (
          <Field label={t('Region', '地区')}>{order.region}</Field>
        )}

        {address && (
          <div className="sm:col-span-2">
            <Field
              label={t('Address', '地址')}
              action={
                <Button
                  variant="ghost"
                  size="iconRound"
                  className="size-5"
                  aria-label={t('Copy address', '复制地址')}
                  onClick={() => copyAddress(address)}
                >
                  <Copy className="size-3" />
                </Button>
              }
            >
              {address}
            </Field>
          </div>
        )}
      </div>
    </DrawerCard>
  )
}
```

- [ ] **Step 2: Use it in the sheet**

In `OrderDetailSheet.tsx`:

- Delete the `Customer` `DrawerCard`.
- Delete the `Fulfilment` `DrawerCard` in full, including its courier and AWB `DetailRow`s. Those two facts are Task 9's, and drawing them here is the duplicate the spec removes.
- Delete the local `DetailRow` function.
- Put this immediately after `<PaymentCard … />`:

```tsx
              <CustomerCard order={order} />
```

Add the import:

```tsx
import CustomerCard from './CustomerCard'
```

Delete the sheet's now-unused imports: `formatAddress`, `formatCalendarDate`, `fulfilmentLabel`, `WaLink`, `courierName` from `../../couriers`.

- [ ] **Step 3: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both pass. Lint fails on any import left behind.

- [ ] **Step 4: Look at it**

1. Open a delivery order with a long address. Expected: two columns on a laptop; the address spans both and takes one or two lines, not three.
2. Press the copy button beside `Address`. A toast says `Address copied`. Paste it somewhere and check it matches.
3. Open a pickup order. There is no address field and no region field, and the layout does not leave a hole.
4. Open an order placed before fulfilment dates existed, or one with a null `fulfil_date`. The `Fulfilment` field reads e.g. `Delivery · —`.
5. At 390px, all fields are one column.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/merchant/orderDetail
git commit -m "feat(orders): the customer and the delivery become one card

They were two groups, and the second drew its rows through a fixed 84px label
column — which left a real Malaysian address about 300px to wrap in, so it took
three lines. The label sits above its value now and the address spans the card.

The card also drops the read-only courier and AWB rows. Those two facts were
drawn twice, here and in the tracking form, chosen by a condition on the mode
and on readOnly. The tracking card is the one place that says them."
```

---

### Task 9: The tracking card

**Files:**
- Create: `apps/frontend/src/merchant/orderDetail/TrackingCard.tsx`
- Modify: `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx`

**Interfaces:**
- Consumes: `DrawerCard`, `LBL` from `./DrawerCard` (Task 3).
- Produces: `TrackingCard` — `{ order: any; courier: string; awb: string; onCourier: (v: string) => void; onAwb: (v: string) => void; onSave: () => void; saving: boolean; dirty: boolean; readOnly: boolean }`, default export. The drafts stay in `OrderDetailSheet`, which is where they are re-seeded when a different order opens.

- [ ] **Step 1: Write the card**

Create `apps/frontend/src/merchant/orderDetail/TrackingCard.tsx`:

```tsx
import { useSession } from '../../SessionContext'
import { COURIERS, trackingUrl, courierName } from '../../couriers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DrawerCard, { LBL } from './DrawerCard'

/**
 * The courier and the air waybill, said ONCE.
 *
 * They used to be drawn twice — as read-only rows under `Fulfilment`, and as this form —
 * with a condition on the mode and on `readOnly` picking between them. Two renderings of one
 * fact is two places to change it. This component renders the inputs when the merchant may
 * edit them and the same two facts as text when they may not.
 */
export default function TrackingCard({
  order,
  courier,
  awb,
  onCourier,
  onAwb,
  onSave,
  saving,
  dirty,
  readOnly,
}: {
  order: any
  courier: string
  awb: string
  onCourier: (v: string) => void
  onAwb: (v: string) => void
  onSave: () => void
  saving: boolean
  dirty: boolean
  readOnly: boolean
}) {
  const { t } = useSession()
  const courierItems = COURIERS.map(c => ({ value: c.code, label: c.name }))
  const editable = order.mode === 'delivery' && !readOnly

  // Nothing to say and nothing to enter — a card headed TRACKING with two em dashes under it
  // tells a merchant less than no card at all.
  if (!editable && !order.courier && !order.awb) return null

  if (!editable) {
    return (
      <DrawerCard title={t('Tracking', '物流')}>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-x-6">
          {order.courier && (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className={LBL}>{t('Courier', '快递公司')}</span>
              <span className="text-[13px] break-words">{courierName(order.courier) || order.courier}</span>
            </div>
          )}
          {order.awb && (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className={LBL}>{t('AWB / Tracking no.', '运单号')}</span>
              <span className="text-[13px] break-words tabular-nums">{order.awb}</span>
            </div>
          )}
        </div>
      </DrawerCard>
    )
  }

  const preview = trackingUrl(courier, awb)

  return (
    <DrawerCard
      title={t('Tracking', '物流')}
      footer={
        <Button
          type="button"
          size="none"
          className="rounded-lg py-[6px] px-[14px] text-[13px]"
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving ? t('Saving…', '保存中…') : t('Save tracking', '保存物流')}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-x-6">
        <div className="flex flex-col gap-1 min-w-0">
          <label className={LBL} htmlFor={`courier-${order.id}`}>{t('Courier', '快递公司')}</label>
          <Select
            // `courier` stays a string; Base UI spells "nothing selected" as null, so the two
            // meet here rather than anywhere downstream.
            value={courier || null}
            onValueChange={v => onCourier(v ?? '')}
            items={courierItems}
          >
            <SelectTrigger id={`courier-${order.id}`} className="w-full bg-background text-[13px]">
              <SelectValue placeholder={t('Select courier…', '选择快递…')} />
            </SelectTrigger>
            <SelectContent>
              {courierItems.map(c => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1 min-w-0">
          <label className={LBL} htmlFor={`awb-${order.id}`}>{t('AWB / Tracking no.', '运单号')}</label>
          <Input
            id={`awb-${order.id}`}
            value={awb}
            onChange={e => onAwb(e.target.value)}
            placeholder={t('e.g. 630123456789', '例如 630123456789')}
            className="text-[13px] bg-background border-border"
          />
        </div>
      </div>

      {preview && (
        <a
          href={preview}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-[13px] text-primary font-medium hover:underline w-fit"
        >
          {t('Preview track link →', '预览追踪链接 →')}
        </a>
      )}
    </DrawerCard>
  )
}
```

- [ ] **Step 2: Use it in the sheet**

In `OrderDetailSheet.tsx`, delete the whole `{order.mode === 'delivery' && !readOnly && (<DrawerCard title={t('Delivery tracking', '物流追踪')}> … </DrawerCard>)}` block and put in its place:

```tsx
              <TrackingCard
                order={order}
                courier={courierDraft}
                awb={awbDraft}
                onCourier={setCourierDraft}
                onAwb={setAwbDraft}
                onSave={handleTrackingSave}
                saving={savingTrack}
                dirty={trackDirty}
                readOnly={readOnly}
              />
```

Add the import:

```tsx
import TrackingCard from './TrackingCard'
```

Delete the sheet's now-unused imports: `COURIERS`, `trackingUrl` from `../../couriers`, `Input`, and the `Select` family — the sheet has no select left.

- [ ] **Step 3: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both pass.

- [ ] **Step 4: Drive it**

1. Open a delivery order. Pick a courier, type an AWB. `Save tracking` enables only once something changed. Press it — a toast says `Tracking saved`.
2. Close the drawer, reopen the same order, and confirm both values came back.
3. With both filled, the `Preview track link →` appears. Click it and confirm it opens the courier's page for that AWB.
4. Open a pickup order that has no courier and no AWB. There is no tracking card at all.
5. Open the drawer from the suspended-shop screen for a delivery order that HAS a courier. The card shows the courier and the AWB as text, with no inputs and no save button.
6. Switch between two delivery orders with different couriers without closing the drawer. Each shows its own values.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/merchant/orderDetail
git commit -m "feat(orders): the courier and the AWB are said once

They were drawn as read-only rows under Fulfilment AND as the tracking form,
with a condition on the mode and on readOnly picking between them. One card now
renders inputs when the merchant may edit them and text when they may not, and
it renders nothing at all when there is neither."
```

---

### Task 10: The note card, and the last of the old drawer

**Files:**
- Create: `apps/frontend/src/merchant/orderDetail/NoteCard.tsx`
- Modify: `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx`

**Interfaces:**
- Consumes: `DrawerCard` from `./DrawerCard` (Task 3).
- Produces: `NoteCard` — `{ note: string; saved: string | null; onChange: (v: string) => void; onSave: () => void; saving: boolean; dirty: boolean; readOnly: boolean }`, default export.

- [ ] **Step 1: Write the card**

Create `apps/frontend/src/merchant/orderDetail/NoteCard.tsx`:

```tsx
import { useSession } from '../../SessionContext'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import DrawerCard from './DrawerCard'

/** The merchant's own note on the order. Read-only for a suspended shop. */
export default function NoteCard({
  note,
  saved,
  onChange,
  onSave,
  saving,
  dirty,
  readOnly,
}: {
  note: string
  saved: string | null
  onChange: (v: string) => void
  onSave: () => void
  saving: boolean
  dirty: boolean
  readOnly: boolean
}) {
  const { t } = useSession()

  if (readOnly) {
    // A suspended shop with no note has nothing to show and no way to write one.
    if (!saved) return null
    return (
      <DrawerCard title={t('Note', '备注')}>
        <p className="text-[13px] text-foreground break-words whitespace-pre-wrap">{saved}</p>
      </DrawerCard>
    )
  }

  return (
    <DrawerCard
      title={t('Note', '备注')}
      footer={
        <Button
          type="button"
          size="none"
          className="rounded-lg py-[6px] px-[14px] text-[13px]"
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving ? t('Saving…', '保存中…') : t('Save note', '保存备注')}
        </Button>
      }
    >
      <Textarea
        value={note}
        onChange={e => onChange(e.target.value)}
        rows={3}
        placeholder={t('Add a note for this order…', '为此订单添加备注…')}
        className="text-[13px] bg-background border-border resize-none"
      />
    </DrawerCard>
  )
}
```

- [ ] **Step 2: Use it in the sheet**

In `OrderDetailSheet.tsx`, delete the whole `{readOnly ? ( … ) : ( … )}` note block and put in its place:

```tsx
              <NoteCard
                note={noteDraft}
                saved={order.note ?? null}
                onChange={setNoteDraft}
                onSave={handleNoteSave}
                saving={savingNote}
                dirty={noteDirty}
                readOnly={readOnly}
              />
```

Add the import:

```tsx
import NoteCard from './NoteCard'
```

Delete the sheet's now-unused imports: `Textarea`, and `Button` if the sheet has no button of its own left.

- [ ] **Step 3: Confirm the old drawer is gone**

Run: `grep -n "DetailRow\|function Section\|const LBL" apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx`
Expected: no output. `DrawerCard.tsx` is the only file that defines `LBL`.

Run: `grep -rn "sm:max-w-md" apps/frontend/src/merchant/orderDetail`
Expected: no output.

- [ ] **Step 4: Read the finished sheet**

Open `apps/frontend/src/merchant/orderDetail/OrderDetailSheet.tsx` and confirm it is now only: the imports, the props, the six pieces of state, the re-seed block keyed on `order.id`, the three save handlers, `orderCurrency`, `noteDirty`, `trackDirty`, and a `return` of the `Sheet` holding `OrderHeader`, a scrolling body of five cards and `StatusFooter`. It should be roughly 130 lines. If any markup other than the frame is left in it, move it to the card it belongs to.

- [ ] **Step 5: Lint, typecheck and test**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all three pass.

- [ ] **Step 6: Drive the whole drawer**

Use the `verify` skill: run the app against local Supabase and walk every path.

- From **Orders**: open an order, advance its status twice, save a courier and an AWB, save a note, view a payment proof, copy the order number, copy the address, download the invoice.
- From **Customers**: open a customer, open one of their orders, and confirm the drawer looks and behaves the same.
- From the **suspended-shop** screen: open an order and confirm there is no status footer, the note is text, and the tracking card has no inputs.
- Switch straight from one order to another without closing the drawer. Confirm the note, the courier and the AWB re-seed to the new order, and that the previous order's payment proof never appears.
- Repeat the first bullet at 390px.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/merchant/orderDetail
git commit -m "feat(orders): the note becomes a card, and the old drawer is gone

OrderDetailSheet is now the Sheet, the drafts, the three save handlers and the
frame. Every group is a component that owns one region. DetailRow and Section,
which gave seven groups one weight between them, are deleted."
```

---

### Task 11: Write down what changed

**Files:**
- Modify: `CONTEXT.md`

**Interfaces:**
- Consumes: the finished drawer.
- Produces: nothing code depends on.

- [ ] **Step 1: Add a paragraph to `CONTEXT.md`**

Under the section that covers merchant order handling, add:

```markdown
The merchant's **order drawer** (`merchant/orderDetail/`) is a header, a scrolling body of
cards and a fixed status footer. The footer is where the status lives, and it offers one
button for the next step in the chain `new → preparing → ready → completed`. `nextStatus.ts`
holds that chain as a lookup and not as the next index in `ORDER_STATUSES`: that array is a
vocabulary, and walking it by index would offer "cancel" as the one-click move on a completed
order and would advance a `pending_payment` order — which asserts that the money arrived. A
merchant says that themselves, through the status list.
```

- [ ] **Step 2: Commit**

```bash
git add CONTEXT.md
git commit -m "docs: the order drawer's shape and its advance rule"
```

- [ ] **Step 3: Open the pull request**

```bash
git push -u origin feat/order-drawer-redesign
gh pr create --base dev --title "feat(orders): the order drawer becomes cards with a fixed status footer" --body "$(cat <<'EOF'
The merchant order drawer held seven sections in one flat scroll. Each new order
feature added another one, so every section carried the same weight, the save
buttons sat scattered through the body, and the status select — the control a
merchant opens this drawer to use most — was last.

The drawer is now a header, a scrolling body of cards, and a fixed footer.

- The header states identity only. The invoice row that wrapped onto its own
  line is now one button and one menu at the end of the title row.
- Each group is a white card on the cream canvas. A card that edits something
  owns its save button.
- The status leaves the scroll. The footer also offers one button for the next
  step, from a new pure module, `nextStatus.ts`. It offers nothing out of
  `pending_payment`: to advance that order is to say the money arrived.
- The customer and the fulfilment become one card, two columns, with the label
  above its value — so a real address stops wrapping to three lines.
- The courier and the AWB are said once. They used to be drawn both as
  read-only rows and as the edit form.
- The drawer widens to 680px on a desktop.

Frontend only. No `store.ts` call, endpoint or migration changes. The drawer's
props are unchanged, so `OrdersView`, `CustomersView` and `SuspendedScreen`
change by an import path.

Spec: `docs/superpowers/specs/2026-08-21-order-drawer-redesign-design.md`
Plan: `docs/superpowers/plans/2026-08-21-order-drawer-redesign.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Btz7iAzh91to1VKMJkPg69
EOF
)"
```

---

## Appendix: the finished `OrderDetailSheet.tsx`

Task 10 ends here. Use this to check the shape, not to paste over your work.

```tsx
import { useState } from 'react'
import { toast } from 'sonner'
import { useSession } from '../../SessionContext'
import { setOrderStatus, setOrderNote, setOrderTracking } from '../../store'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import OrderHeader from './OrderHeader'
import ItemsCard from './ItemsCard'
import PaymentCard from './PaymentCard'
import CustomerCard from './CustomerCard'
import TrackingCard from './TrackingCard'
import NoteCard from './NoteCard'
import StatusFooter from './StatusFooter'

// The order-detail drawer, shared by OrdersView and CustomersView. Open when `order` is
// non-null; owns its own note/courier/awb drafts and bubbles every status/note/tracking save
// up via `onOrderUpdated` so the parent can patch its own list.
export default function OrderDetailSheet({
  order,
  onClose,
  onOrderUpdated,
  readOnly = false,
}: {
  order: any | null
  onClose: () => void
  onOrderUpdated: (o: any) => void
  readOnly?: boolean
}) {
  const { merchant, t } = useSession()
  const [noteDraft, setNoteDraft] = useState('')
  const [drawerFor, setDrawerFor] = useState<string | undefined>(undefined)
  const [savingNote, setSavingNote] = useState(false)
  const [courierDraft, setCourierDraft] = useState('')
  const [awbDraft, setAwbDraft] = useState('')
  const [savingTrack, setSavingTrack] = useState(false)

  // Re-seed the drafts when a different order opens (adjust-state-during-render: keyed on id
  // so a status/note/tracking patch that replaces `order` mid-view keeps typing).
  if (order && order.id !== drawerFor) {
    setDrawerFor(order.id)
    setNoteDraft(order.note ?? '')
    setCourierDraft(order.courier ?? '')
    setAwbDraft(order.awb ?? '')
  }

  // These three are character-for-character what the drawer has today. Task 2 moved them and
  // no later task edits them. Do not retype them from this appendix — they are elided here
  // only to show what the finished file is made of.
  function handleStatusChange(o: any, status: string) { /* unchanged from the current file */ }
  function handleNoteSave() { /* unchanged from the current file */ }
  function handleTrackingSave() { /* unchanged from the current file */ }

  const orderCurrency = order?.currency ?? merchant?.currency
  const noteDirty = order != null && noteDraft.trim() !== (order.note ?? '')
  const trackDirty = order != null &&
    (courierDraft !== (order.courier ?? '') || awbDraft.trim() !== (order.awb ?? ''))

  return (
    <Sheet open={order !== null} onOpenChange={open => { if (!open) { onClose(); setDrawerFor(undefined) } }}>
      <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-[680px] gap-0 overflow-hidden">
        {order && (
          <>
            <OrderHeader order={order} readOnly={readOnly} merchantId={merchant!.id} />
            <div className="flex-1 min-h-0 overflow-y-auto bg-background flex flex-col gap-3 p-3 sm:p-4">
              <ItemsCard items={order.items ?? []} currency={orderCurrency} />
              <PaymentCard order={order} currency={orderCurrency} merchantId={merchant!.id} />
              <CustomerCard order={order} />
              <TrackingCard
                order={order} courier={courierDraft} awb={awbDraft}
                onCourier={setCourierDraft} onAwb={setAwbDraft}
                onSave={handleTrackingSave} saving={savingTrack} dirty={trackDirty} readOnly={readOnly}
              />
              <NoteCard
                note={noteDraft} saved={order.note ?? null} onChange={setNoteDraft}
                onSave={handleNoteSave} saving={savingNote} dirty={noteDirty} readOnly={readOnly}
              />
            </div>
            {!readOnly && (
              <StatusFooter status={order.status || 'new'} onChange={s => handleStatusChange(order, s)} />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
```
