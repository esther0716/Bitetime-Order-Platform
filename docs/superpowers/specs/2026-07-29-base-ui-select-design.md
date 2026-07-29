# Standardise every select on the shadcn Base UI `Select`

**Date:** 2026-07-29

## Problem

Two unrelated inconsistencies share one component.

**The primitive is wrong.** `apps/frontend/src/components/ui/select.tsx` is built on
`@radix-ui/react-select`. It is the only Radix component left in the repo — the other
nineteen files in `components/ui/` are all on `@base-ui/react`, and `components.json`
declares `"style": "base-nova"`. `@radix-ui/react-select` exists in `package.json` for
this one file.

**Five selects never got the component at all.** Seven files already import the shadcn
`Select`. Four files still hand-roll a native `<select>`, two of them carrying a
duplicated `SELECT_CLS` string and a base64 chevron `CHEVRON_SVG` to fake the styling:

| Site | What it picks |
|------|---------------|
| `merchant/OptionGroupsEditor.tsx:89` | copy option groups from another product |
| `merchant/VouchersManager.tsx:206` | voucher kind (percent / fixed) |
| `merchant/OrderDetailSheet.tsx:234` | courier |
| `merchant/OrderDetailSheet.tsx:312` | order status |
| `store/Storefront.tsx:1316` | Malaysian state, in the checkout address form |

## Goal

One select primitive, one select component, zero native `<select>` and zero Radix
dependency in the frontend.

## Non-goals

- Re-theming the select. `index.css` already aliases the shadcn tokens onto the brand
  palette (`--input: var(--color-clay-border)`, `--popover: var(--color-surface-high)`),
  so the existing class strings already render brand colours. Carrying them across
  unchanged is what keeps this refactor invisible to the eye.
- Touching any other `components/ui/` file.

## Design

### 1. Rewrite `ui/select.tsx` on `@base-ui/react/select`

The base-nova registry item exports the same ten names as the Radix one, so
`SelectTrigger`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel` and
`SelectSeparator` call sites need no edits at all. The tree becomes
`Portal > Positioner > Popup > List`.

Port rather than paste. The registry source is written for shadcn's own app and carries
three things this repo must not take:

- `cn-menu-target` / `cn-menu-translucent` — base-nova theme classes that appear nowhere
  in this codebase. Drop them; keep the current file's class strings instead.
- `IconPlaceholder` from `@/app/(create)/components/icon-placeholder` — replace with
  plain `lucide-react` icons. Base UI has no `asChild`, so they are passed through
  `render={<Icon … />}`.
- `z-50` on the Positioner and Popup — this repo needs `z-modal-popover` (400).
  `ProductsManager` opens a select inside a dialog and depends on that layer.

Radix → Base UI renames to sweep through the class strings. Missing one is silent: the
popup simply stops animating, or a max-height resolves to nothing.

| Radix | Base UI |
|-------|---------|
| `data-[state=open]` | `data-open` |
| `data-[state=closed]` | `data-closed` |
| `data-[disabled]` | `data-disabled` |
| `data-[placeholder]` | `data-placeholder` |
| `--radix-select-content-available-height` | `--available-height` |
| `--radix-select-trigger-width` | `--anchor-width` |
| `ScrollUpButton` / `ScrollDownButton` | `ScrollUpArrow` / `ScrollDownArrow` |

`SelectContent` defaults to `side="bottom" sideOffset={4} align="center"
alignItemWithTrigger={false}`.

**`alignItemWithTrigger` is deliberately `false`.** Base UI defaults it to `true`, which
overlays the popup on the trigger so the selected item's text sits over the trigger's
value — macOS-style. The current Radix component uses `position="popper"` and drops the
list below. Base UI already force-disables the overlay on touch devices, so taking the
default would make the same select behave one way on a phone and another on a desktop,
and would change the feel of seven selects that nobody asked to change.

Finally, remove `@radix-ui/react-select` from `apps/frontend/package.json`.

### 2. Give `Select.Root` an `items` prop at the four `<SelectValue />` sites

This is the one API difference that changes behaviour rather than markup. Radix's
`SelectValue` reads the selected `SelectItemText`. Base UI's renders the raw **value**
unless `Select.Root` is given `items`, from which it looks the label up.

Without this fix each of these silently renders an internal key to the user:

| Site | Would render | Should render |
|------|-------------|---------------|
| `components/LanguageSelect.tsx:11` | `en` | `EN` |
| `merchant/CustomersView.tsx:245` | `recent` | Most recent order |
| `merchant/ProductsManager.tsx:466` | `pcs` | `pcs` in EN, but `件` in ZH |
| `merchant/FeedbackFab.tsx:145` | `bug` | the translated category label |

`FeedbackFab` already passes `placeholder`, which Base UI supports natively — only its
post-selection label is affected.

`ProductsManager` hides the worst of it: its `UNITS` values are equal to their English
labels (`pcs` → `pcs`), so an English-only check passes and the bug only shows in
Chinese, where `件` silently becomes `pcs`. Verify this one in both languages.

`ProductsManager` is the awkward one: it conditionally injects a legacy-unit item so old
rows stay selectable, so its `items` array has to be built at render time from `UNITS`
plus that same conditional entry. Deriving both the items array and the rendered
`SelectItem` list from one expression is what stops them drifting apart.

Labels are bilingual (`t(en, zh)`), so the items arrays are computed inside the component
where `t` is in scope, not hoisted to module constants.

### 3. Convert the four remaining native selects

`SELECT_CLS` and `CHEVRON_SVG` are deleted from `VouchersManager.tsx` and
`OrderDetailSheet.tsx` once nothing references them.

- **`VouchersManager.tsx:206`** — voucher kind. Two fixed options, always has a value.
  Direct swap.
- **`OrderDetailSheet.tsx:312`** — order status. Always has a value (`order.status ||
  'new'`). Direct swap, keeps calling `handleStatusChange`.
- **`OrderDetailSheet.tsx:234`** — courier. Has an empty option today.
- **`Storefront.tsx:1316`** — Malaysian state. Has an empty option today.

The last two need the empty-value mapping. Radix cannot hold `value=""`; Base UI
represents "nothing selected" as `null`. The component state stays a `string` either way,
so the translation lives at the boundary:

```tsx
value={courierDraft || null}
onValueChange={v => setCourierDraft(v ?? '')}
```

and the `<option value="">Select courier…</option>` becomes `placeholder` on
`SelectValue`. Same shape for `address.state` in the storefront.

The storefront trigger keeps `w-full` and `text-[16px]`. That font size is not
decorative — iOS Safari zooms the viewport on focus of any control below 16px, and this
is the checkout address form.

### 4. `OptionGroupsEditor.tsx:89` becomes a `DropdownMenu`

This control is not a select. Its value is permanently `""`; picking a product fires
`onChange(structuredClone(src.groups))` and the control resets. It is a one-shot action
list wearing a form control's clothes, and forcing it into `Select` would mean a
`value={null}` plus a manual reset for no gain.

It moves to the existing `components/ui/dropdown-menu.tsx`: a `Button` trigger reading
"Copy options from… / 从其他商品复制…" and one item per product in `copyFrom`. The
`structuredClone` call and the ADR-0008 comment above it are carried over verbatim — the
reason a copy is not a link has nothing to do with which control triggers it.

## Risks

**The attribute sweep in step 1 fails quietly.** A missed `data-[state=open]` does not
throw and does not fail typecheck; the popup just never animates in. A missed
`--radix-select-content-available-height` resolves to nothing and the max-height is gone,
so a long list runs off the screen. Both are only visible by opening the thing.

**The storefront state picker has no automated cover.** `e2e/guest-order.spec.ts` never
reaches the address form, and no test in the repo drives a select. This is also the
highest-stakes of the five — customer-facing, mobile-first, mid-checkout — and it is
the one that gives up the OS wheel picker for a JS listbox. It must be exercised by hand
on a mobile viewport.

## Verification

`pnpm lint`, `pnpm typecheck`, `pnpm test`.

Then run the app and open all twelve selects, per the repo's run-and-verify rule — the
failure modes above are invisible to the type checker:

- **Storefront** — checkout state picker, on a mobile viewport as well as desktop.
- **Merchant dashboard** — products (unit, inside the dialog, checking it still layers
  above), customers (sort, including the disabled basic-plan state), vouchers (kind),
  order detail (courier and status), shop settings (currency), fulfilment (timezone),
  feedback FAB (category), language switcher, and the option-groups copy menu.

For each: the trigger shows a human label and not an internal key, the list drops below
the trigger rather than over it, and the open/close animation plays.
