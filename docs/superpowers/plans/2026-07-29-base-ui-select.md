# Base UI Select Standardisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `apps/frontend/src/components/ui/select.tsx` on `@base-ui/react`, then route every remaining native `<select>` through it, so the frontend has one select primitive and no Radix dependency.

**Architecture:** The base-nova registry item exports the same ten names as the Radix one, so the swap is invisible to `SelectTrigger` / `SelectContent` / `SelectItem` call sites. Two API differences do bite: Base UI's `Select.Value` renders the raw *value* unless `Select.Root` is given `items`, and `onValueChange` hands back `T | null` rather than `T`. Both are fixed in Task 1 so no commit ever ships wrong labels. Tasks 2–5 then convert the four native selects one file at a time.

**Tech Stack:** React 19, TypeScript (strict), Vite, Tailwind v4, `@base-ui/react` 1.6.0, shadcn `base-nova` style, lucide-react.

## Global Constraints

- **No component tests.** `CLAUDE.md`: "UI is verified by running the app (run-and-verify), not component tests." Do **not** add a `select.test.tsx`. The gate for every task is `pnpm lint && pnpm typecheck && pnpm test` (which must stay green, not grow) plus the named browser checks in that task's verify step.
- Frontend uses `moduleResolution: bundler` — relative imports are extensionless. Do not add `.js` specifiers (that is the backend's rule).
- All user-facing copy is `t(englishString, chineseString)`. There is no i18n library. Every label added here must be bilingual.
- `z-modal-popover` is the repo's layer 400. The select popup must sit on it — `ProductsManager` opens a select inside a dialog and depends on clearing it. Do not use the registry's `z-50`.
- Do not re-theme. `index.css` already aliases the shadcn tokens onto the brand palette (`--input: var(--color-clay-border)`, `--popover: var(--color-surface-high)`, `--ring: var(--color-oxblood)`), so the existing class strings already render brand colours. Carrying them across unchanged is what keeps this refactor invisible.
- Do not paste the base-nova registry source. It imports `IconPlaceholder` from `@/app/(create)/components/icon-placeholder` and `cn` from `@/registry/base-nova/lib/utils`, and applies `cn-menu-target` / `cn-menu-translucent` classes that exist nowhere in this repo.
- Branch is `refactor/base-ui-select`. Commit after every task.

## Radix → Base UI rename table

Every class string touched in Task 1 must be swept for these. **Missing one does not throw and does not fail typecheck** — the popup silently stops animating, or a max-height resolves to nothing and a long list runs off screen.

| Radix | Base UI |
|-------|---------|
| `data-[state=open]` | `data-open` |
| `data-[state=closed]` | `data-closed` |
| `data-[disabled]` | `data-disabled` |
| `data-[placeholder]` | `data-placeholder` |
| `--radix-select-content-available-height` | `--available-height` |
| `--radix-select-trigger-width` | `--anchor-width` |
| `--radix-select-content-transform-origin` | `--transform-origin` |
| `<Icon asChild><X/></Icon>` | `<Icon render={<X/>} />` |
| `ScrollUpButton` / `ScrollDownButton` | `ScrollUpArrow` / `ScrollDownArrow` |
| `Label` (group heading) | `GroupLabel` |
| `Content` (single part) | `Positioner` > `Popup` > `List` |

---

### Task 1: Swap the primitive and fix every existing call site

The primitive swap and the `items` fix ship together on purpose. Base UI's `Select.Value` renders the raw value without `items`, so splitting them would mean committing a state where `LanguageSelect` shows `en` instead of `EN`.

**Files:**
- Modify: `apps/frontend/src/components/ui/select.tsx` (full rewrite)
- Modify: `apps/frontend/package.json` (remove `@radix-ui/react-select`)
- Modify: `apps/frontend/src/components/LanguageSelect.tsx`
- Modify: `apps/frontend/src/merchant/CustomersView.tsx:243-245`
- Modify: `apps/frontend/src/merchant/ProductsManager.tsx:464-466`
- Modify: `apps/frontend/src/merchant/FeedbackFab.tsx:143-145`
- Modify: `apps/frontend/src/components/BusinessNaturePicker.tsx:27`
- Modify: `apps/frontend/src/merchant/ShopSettings.tsx:581`
- Modify: `apps/frontend/src/merchant/FulfilmentTab.tsx:176`
- Test: none — see Global Constraints.

**Interfaces:**
- Produces: `Select`, `SelectContent`, `SelectGroup`, `SelectItem`, `SelectLabel`, `SelectScrollDownButton`, `SelectScrollUpButton`, `SelectSeparator`, `SelectTrigger`, `SelectValue` from `@/components/ui/select` — the same ten names as today.
- `Select` is now `SelectPrimitive.Root` directly, typed `<Value, Multiple>`. Props of note: `value?: Value | null`, `onValueChange?: (value: Value | null, eventDetails) => void`, `items?: Record<string, React.ReactNode> | ReadonlyArray<{ label: React.ReactNode; value: any }>`, `disabled?: boolean`.
- `SelectValue` props: `placeholder?: React.ReactNode`, `children?: React.ReactNode | ((value: any) => React.ReactNode)`.
- `SelectContent` accepts `SelectPrimitive.Popup.Props` plus `side` / `sideOffset` / `align` / `alignOffset` / `alignItemWithTrigger` forwarded to the Positioner.

- [ ] **Step 1: Rewrite `apps/frontend/src/components/ui/select.tsx`**

Replace the whole file with this. Note `alignItemWithTrigger = false` — Base UI defaults it to `true`, which overlays the popup on the trigger macOS-style. The Radix component used `position="popper"` and dropped the list below; Base UI force-disables the overlay on touch anyway, so taking the default would make the same select behave one way on a phone and another on a desktop.

```tsx
import * as React from "react"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { Select as SelectPrimitive } from "@base-ui/react/select"

import { cn } from "@/lib/utils"

// Base UI's Root renders no element, so there is no `data-slot` to hang on it.
const Select = SelectPrimitive.Root

function SelectGroup({ ...props }: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({ ...props }: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none cursor-pointer focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={<ChevronDownIcon className="size-4 opacity-50" />}
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  // Base UI defaults this to true (popup overlays the trigger, macOS-style). The Radix
  // component this replaced dropped the list below the trigger, and Base UI disables the
  // overlay on touch regardless — so the default would split desktop from mobile.
  alignItemWithTrigger = false,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "side" | "sideOffset" | "align" | "alignOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        // z-modal-popover (400) — floats above modals
        className="isolate z-modal-popover outline-none"
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            // min-w is max(8rem, trigger width) — the Radix original set both separately,
            // on the content and the viewport. One property expresses the same thing.
            "relative z-modal-popover max-h-(--available-height) min-w-[max(8rem,var(--anchor-width))] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List className="p-1 scroll-my-1">
            {children}
          </SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // Both `focus:` and `data-highlighted:` — Base UI marks the active item with
        // data-highlighted; keyboard navigation also moves DOM focus. Covering both is
        // cheaper than finding out which one the version in use actually fires.
        "relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator
        render={
          <span
            data-slot="select-item-indicator"
            className="absolute right-2 flex size-3.5 items-center justify-center"
          />
        }
      >
        <CheckIcon className="size-4" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
```

- [ ] **Step 2: Run typecheck to see the call sites that now fail**

Run: `pnpm typecheck`

Expected: FAIL. `onValueChange` now yields `T | null`, so four sites that assign straight into `string` state break — `BusinessNaturePicker.tsx:27`, `ShopSettings.tsx:581`, `FulfilmentTab.tsx:176`, `ProductsManager.tsx:464`. Errors read roughly `Type 'string | null' is not assignable to type 'string'`. This is the signal that the swap landed; Steps 3–4 clear it.

- [ ] **Step 3: Fix the four `onValueChange` sites**

None of these selects contains an item with `value={null}`, so `null` is unreachable at runtime — each falls back to the value it already had rather than inventing an empty string.

In `apps/frontend/src/components/BusinessNaturePicker.tsx:27`, replace:

```tsx
      <Select value={value} onValueChange={onChange}>
```

with:

```tsx
      <Select value={value} onValueChange={v => onChange(v ?? '')}>
```

In `apps/frontend/src/merchant/ShopSettings.tsx:581`, replace:

```tsx
            onValueChange={(v) => setFields(f => ({ ...f, currency: v }))}
```

with:

```tsx
            onValueChange={(v) => setFields(f => ({ ...f, currency: v ?? f.currency }))}
```

In `apps/frontend/src/merchant/FulfilmentTab.tsx:176`, replace:

```tsx
          <Select value={fields.timezone} onValueChange={v => setFields(f => ({ ...f, timezone: v }))}>
```

with:

```tsx
          <Select value={fields.timezone} onValueChange={v => setFields(f => ({ ...f, timezone: v ?? f.timezone }))}>
```

In `apps/frontend/src/merchant/ProductsManager.tsx:464`, replace:

```tsx
                  <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v })}>
```

with:

```tsx
                  <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v ?? form.unit })}>
```

- [ ] **Step 4: Add `items` to the four `<SelectValue />` sites**

These four render `<SelectValue />` with no children. Under Radix that read the selected `SelectItemText`; under Base UI it renders the raw value unless `Select.Root` is given `items`. Without this each shows an internal key to the user.

The `SelectTrigger`-with-a-`<span>` sites (`BusinessNaturePicker`, `FulfilmentTab`, `ShopSettings`) render their own label and need nothing.

**`apps/frontend/src/components/LanguageSelect.tsx`** — replace the whole file:

```tsx
import { useSession } from '../SessionContext'
import type { Lang } from '../types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

// `items` is what lets <SelectValue/> show "EN" rather than the raw value "en" — Base UI's
// Value renders the value itself unless the Root can look a label up.
const LANG_ITEMS = [
  { value: 'en', label: 'EN' },
  { value: 'zh', label: '中文' },
] as const

/** Language switcher (EN / 中文) backed by the shadcn Select. */
export default function LanguageSelect({ className }: { className?: string }) {
  const { lang, setLang } = useSession()
  return (
    <Select value={lang} onValueChange={(v) => setLang(v as Lang)} items={LANG_ITEMS}>
      <SelectTrigger size="sm" className={className} aria-label="Language / 语言">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LANG_ITEMS.map(i => (
          <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

**`apps/frontend/src/merchant/CustomersView.tsx:243-253`** — the labels are bilingual, so the array is built inside the component where `t` is in scope. Replace:

```tsx
      <Select value={sort} onValueChange={v => onSort(v as ShopCustomerSort)} disabled={!isPro}>
        <SelectTrigger className="w-[190px] bg-cream border-clay-border text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="recent">{t('Most recent order', '最近下单')}</SelectItem>
          <SelectItem value="spend">{t('Highest spend', '消费最高')}</SelectItem>
          <SelectItem value="orders">{t('Most orders', '订单最多')}</SelectItem>
        </SelectContent>
      </Select>
```

with:

```tsx
      <Select value={sort} onValueChange={v => onSort(v as ShopCustomerSort)} disabled={!isPro} items={sortItems}>
        <SelectTrigger className="w-[190px] bg-cream border-clay-border text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sortItems.map(i => (
            <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
```

and add this immediately above that component's `return (`, alongside the existing `const { t } = useSession()`:

```tsx
  // One array feeds both `items` (what the trigger reads a label from) and the rendered
  // list, so the two cannot drift apart.
  const sortItems = [
    { value: 'recent', label: t('Most recent order', '最近下单') },
    { value: 'spend', label: t('Highest spend', '消费最高') },
    { value: 'orders', label: t('Most orders', '订单最多') },
  ]
```

**`apps/frontend/src/merchant/ProductsManager.tsx:464-478`** — this one conditionally injects a legacy unit so old rows stay selectable, so its items array has to be built at render time. Replace:

```tsx
                  <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v ?? form.unit })}>
                    <SelectTrigger id="pm-5" className="flex-1 bg-cream border-clay-border text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    {/* z-modal-popover (400) floats above the dialog popup (z-modal). */}
                    <SelectContent className="z-modal-popover">
                      {/* Keep a legacy value (e.g. old "pc") selectable so existing rows survive. */}
                      {form.unit && !UNITS.some(u => u.value === form.unit) && (
                        <SelectItem value={form.unit}>{form.unit}</SelectItem>
                      )}
                      {UNITS.map(u => (
                        <SelectItem key={u.value} value={u.value}>{t(u.en, u.zh)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
```

with:

```tsx
                  <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v ?? form.unit })} items={unitItems}>
                    <SelectTrigger id="pm-5" className="flex-1 bg-cream border-clay-border text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    {/* z-modal-popover (400) floats above the dialog popup (z-modal). */}
                    <SelectContent className="z-modal-popover">
                      {unitItems.map(u => (
                        <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
```

and add this inside the same component, above its `return (`, where `form` and `t` are both in scope:

```tsx
  // `items` feeds the trigger's label lookup and the rendered list from one expression.
  // The leading entry keeps a legacy value (e.g. an old "pc") selectable so existing rows
  // survive — dropping it would silently rewrite a merchant's unit on the next save.
  const unitItems = [
    ...(form.unit && !UNITS.some(u => u.value === form.unit)
      ? [{ value: form.unit, label: form.unit }]
      : []),
    ...UNITS.map(u => ({ value: u.value, label: t(u.en, u.zh) })),
  ]
```

**`apps/frontend/src/merchant/FeedbackFab.tsx:143-153`** — `placeholder` already works (Base UI supports it natively), but the post-selection label would show `bug`. Replace:

```tsx
              <Select value={category} onValueChange={(v) => setCategory(v as FeedbackCategory)}>
                <SelectTrigger aria-label={t('Category', '类别')}>
                  <SelectValue placeholder={t('Pick a category', '选择类别')} />
                </SelectTrigger>
                <SelectContent>
                  {FEEDBACK_CATEGORIES.map(key => (
                    <SelectItem key={key} value={key}>
                      {t(CATEGORY_LABELS[key].en, CATEGORY_LABELS[key].zh)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
```

with:

```tsx
              <Select value={category} onValueChange={(v) => setCategory(v as FeedbackCategory)} items={categoryItems}>
                <SelectTrigger aria-label={t('Category', '类别')}>
                  <SelectValue placeholder={t('Pick a category', '选择类别')} />
                </SelectTrigger>
                <SelectContent>
                  {categoryItems.map(i => (
                    <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
```

and add this inside the same component, above its `return (`:

```tsx
  // Still keyed off the shared FEEDBACK_CATEGORIES tuple, so a fifth category upstream is
  // still a compile error here until it is given a label.
  const categoryItems = FEEDBACK_CATEGORIES.map(key => ({
    value: key,
    label: t(CATEGORY_LABELS[key].en, CATEGORY_LABELS[key].zh),
  }))
```

- [ ] **Step 5: Drop the Radix dependency**

`ui/select.tsx` was the only importer. Remove this line from `apps/frontend/package.json` dependencies:

```json
    "@radix-ui/react-select": "^2.3.1",
```

Then run: `pnpm install`

- [ ] **Step 6: Confirm no Radix import survives**

Run: `grep -rn "@radix-ui" apps/frontend/src apps/frontend/package.json`

Expected: no output. If anything matches, it was missed — fix it before continuing.

- [ ] **Step 7: Run the full check suite**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

Expected: all PASS. `pnpm build` matters here specifically — it runs `scripts/prerender.tsx`, an SSR pass over the landing route, and the landing page renders `LanguageSelect`. A Base UI part that touches `document` at module scope would surface as a prerender crash and nowhere else.

- [ ] **Step 8: Verify in the browser**

Run: `pnpm dev`, then open each of the seven existing selects. For every one, check three things: **the trigger shows a human label, not an internal key**; **the list drops below the trigger rather than overlapping it**; **the open and close animations play**.

- Language switcher (top bar) — shows `EN` / `中文`, never `en` / `zh`.
- `/merchant` → Products → edit a product → the unit select **inside the dialog**. Confirm the popup renders above the dialog, not behind it. Then switch the app to 中文 and reopen it: it must read `件`, not `pcs`. **This is the one bug an English-only check cannot see** — `UNITS` values equal their English labels, so `pcs` looks correct until the language changes.
- `/merchant` → Customers → the sort select. Check it on a Pro shop (enabled, shows "Most recent order") and on a basic shop (disabled, greyed, still legible next to the Pro badge).
- `/merchant` → feedback FAB → category. Placeholder reads "Pick a category" before selection, and the chosen category's full label after.
- `/merchant` → Settings → Base currency; and Fulfilment → Time zone. Both render their own `<span>`, so they only need the drop-below and animation checks.
- `/merchant/signup` (or Settings) → the business-nature picker. Placeholder styling (`text-rose-muted`) must still show when nothing is chosen.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/package.json apps/frontend/pnpm-lock.yaml pnpm-lock.yaml apps/frontend/src/components/ui/select.tsx apps/frontend/src/components/LanguageSelect.tsx apps/frontend/src/components/BusinessNaturePicker.tsx apps/frontend/src/merchant/CustomersView.tsx apps/frontend/src/merchant/ProductsManager.tsx apps/frontend/src/merchant/FeedbackFab.tsx apps/frontend/src/merchant/ShopSettings.tsx apps/frontend/src/merchant/FulfilmentTab.tsx
git commit -m "refactor(ui): rebuild Select on Base UI

select.tsx was the last @radix-ui component in a frontend whose other
nineteen ui/ files are on @base-ui/react, and whose components.json
already declares the base-nova style.

Two API differences needed call-site work rather than a straight swap.
Base UI's Select.Value renders the raw value unless Root is given
\`items\`, which would have shown \`en\` in the language switcher and
\`bug\` in the feedback form; four sites now pass items. And
onValueChange yields \`T | null\`, which four more sites assigned
straight into string state.

SelectContent pins alignItemWithTrigger={false}. Base UI defaults it to
true, overlaying the popup on the trigger, but disables that on touch —
so the default would have split desktop behaviour from mobile."
```

---

### Task 2: VouchersManager — voucher kind

**Files:**
- Modify: `apps/frontend/src/merchant/VouchersManager.tsx` (lines 36-42 deleted, 206-215 replaced)
- Test: none — see Global Constraints.

**Interfaces:**
- Consumes: `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` from Task 1.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the import**

`VouchersManager.tsx` does not currently import the Select. Add alongside the other `components/ui` imports:

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
```

Place it after the `Label` import at line 12. This file uses the `../components/ui/x` relative form throughout; the repo also uses the `@/components/ui/x` alias elsewhere, so match the file, not the repo.

- [ ] **Step 2: Replace the native select**

Replace this block (around line 206):

```tsx
              <select
                id="vm-kind"
                className={SELECT_CLS}
                style={{ backgroundImage: CHEVRON_SVG, backgroundPosition: 'right 10px center' }}
                value={form.kind}
                onChange={e => setForm({ ...form, kind: e.target.value })}
              >
                <option value="percent">{t('Percentage (%)', '百分比 (%)')}</option>
                <option value="fixed">{t(`Fixed amount (${symbol})`, `固定金额 (${symbol})`)}</option>
              </select>
```

with:

```tsx
              <Select
                value={form.kind}
                onValueChange={v => setForm({ ...form, kind: v ?? form.kind })}
                items={kindItems}
              >
                <SelectTrigger id="vm-kind" className="w-full bg-cream text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kindItems.map(i => (
                    <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
```

The `kind` select always holds a value, so there is no placeholder and no null case — `?? form.kind` is only there because Base UI types `onValueChange` as `T | null`.

- [ ] **Step 3: Add the items array**

The `fixed` label interpolates the shop's currency `symbol`, so this must live inside the component where `symbol` and `t` are in scope. Add above the component's `return (`:

```tsx
  const kindItems = [
    { value: 'percent', label: t('Percentage (%)', '百分比 (%)') },
    { value: 'fixed', label: t(`Fixed amount (${symbol})`, `固定金额 (${symbol})`) },
  ]
```

- [ ] **Step 4: Delete the dead style constants**

`SELECT_CLS` and `CHEVRON_SVG` had exactly one consumer each in this file. Delete lines 34-42 — both constants **and** both comments, which describe nothing else. Note this file's `SELECT_CLS` is *not* identical to the one in `OrderDetailSheet.tsx`; it carries no `min-w-[140px]`, which is why the trigger added in Step 2 does not either.

```tsx
// Self-contained select classes — pixel-match of .admin-field select in .admin-field.full context
const SELECT_CLS =
  'w-full py-[7px] pl-[10px] pr-[32px] border border-clay-border rounded-sm text-[13px] ' +
  'bg-cream text-ink font-sans appearance-none bg-no-repeat cursor-pointer ' +
  'focus:outline-none focus:border-oxblood focus:shadow-[0_0_0_2px_rgba(122,16,40,0.1)]'

// Chevron SVG data-URI — matches the one in .admin-field select
const CHEVRON_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%237A4F55' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`
```

- [ ] **Step 5: Confirm nothing still references them**

Run: `grep -n "SELECT_CLS\|CHEVRON_SVG" apps/frontend/src/merchant/VouchersManager.tsx`

Expected: no output.

- [ ] **Step 6: Check**

Run: `pnpm lint && pnpm typecheck`

Expected: PASS. ESLint's unused-vars rule would also have caught a leftover constant.

- [ ] **Step 7: Verify in the browser**

`pnpm dev` → `/merchant` → Vouchers → open the create/edit form.

- The Type field opens a two-item list below the trigger.
- Picking "Fixed amount" changes the sibling Amount field's label and its `step` (`0.01` for fixed, `1` for percent) — this is the wiring that proves `onValueChange` fires, not just that the popup renders.
- The trigger's label carries the shop's currency symbol, e.g. "Fixed amount (RM)".
- The field's width still lines up with the other fields in the form row.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/merchant/VouchersManager.tsx
git commit -m "refactor(merchant): move the voucher kind field onto Select

Also deletes this file's copy of SELECT_CLS and the base64 chevron
background — both existed only to make a native <select> resemble the
component it can now just use."
```

---

### Task 3: OrderDetailSheet — courier and status

Two selects in one file, and the file's own `SELECT_CLS` / `CHEVRON_SVG` die with them. Courier is the first of the two conversions that has to represent "nothing selected": Radix cannot hold `value=""`, Base UI uses `null`, and the component state stays a `string`, so the translation lives at the boundary.

**Files:**
- Modify: `apps/frontend/src/merchant/OrderDetailSheet.tsx` (lines 26-31 deleted, 234-247 and 312-320 replaced)
- Test: none — see Global Constraints.

**Interfaces:**
- Consumes: `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` from Task 1.
- Existing in-file constants used here: `COURIERS: { code: string; name: string; track: ((awb: string) => string) | null }[]` from `../couriers`; `ORDER_STATUSES: string[]` and `STATUS_LABELS: Record<string, { en: string; zh: string }>` from `../orderStatus`.

- [ ] **Step 1: Add the import**

After the `Sheet` import block (line 16). This file uses the `@/components/ui/x` alias form throughout, unlike `VouchersManager` — match the file.

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
```

- [ ] **Step 2: Replace the courier select**

Replace this block (around line 234):

```tsx
                    <select
                      id={`courier-${order.id}`}
                      className={SELECT_CLS}
                      style={{ backgroundImage: CHEVRON_SVG, backgroundPosition: 'right 10px center' }}
                      value={courierDraft}
                      onChange={e => setCourierDraft(e.target.value)}
                    >
                      <option value="">{t('Select courier…', '选择快递…')}</option>
                      {COURIERS.map(c => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
```

with:

```tsx
                    <Select
                      // `courierDraft` stays a string; Base UI spells "nothing selected"
                      // as null, so the two meet here rather than anywhere downstream.
                      value={courierDraft || null}
                      onValueChange={v => setCourierDraft(v ?? '')}
                      items={COURIERS.map(c => ({ value: c.code, label: c.name }))}
                    >
                      <SelectTrigger id={`courier-${order.id}`} className="w-full min-w-[140px] bg-cream text-[13px]">
                        <SelectValue placeholder={t('Select courier…', '选择快递…')} />
                      </SelectTrigger>
                      <SelectContent>
                        {COURIERS.map(c => (
                          <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
```

Courier names are proper nouns, not translated, so `items` can be derived inline — there is no `t` call to keep in sync.

- [ ] **Step 3: Replace the status select**

Replace this block (around line 312):

```tsx
                  <select
                    id={`status-${order.id}`}
                    className={SELECT_CLS}
                    style={{ backgroundImage: CHEVRON_SVG, backgroundPosition: 'right 10px center' }}
                    value={order.status || 'new'}
                    onChange={e => handleStatusChange(order, e.target.value)}
                  >
                    {ORDER_STATUSES.map(s => (
                      <option key={s} value={s}>{t(STATUS_LABELS[s].en, STATUS_LABELS[s].zh)}</option>
                    ))}
                  </select>
```

with:

```tsx
                  <Select
                    value={order.status || 'new'}
                    onValueChange={v => { if (v) handleStatusChange(order, v) }}
                    items={statusItems}
                  >
                    <SelectTrigger id={`status-${order.id}`} className="w-full min-w-[140px] bg-cream text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statusItems.map(i => (
                        <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
```

`if (v)` rather than `?? `: `handleStatusChange` writes to the database, so a null must be dropped, never coerced into a status.

- [ ] **Step 4: Add the status items array**

Status labels are bilingual, so this goes inside the component where `t` is in scope, above its `return (`:

```tsx
  const statusItems = ORDER_STATUSES.map(s => ({
    value: s,
    label: t(STATUS_LABELS[s].en, STATUS_LABELS[s].zh),
  }))
```

- [ ] **Step 5: Delete the dead style constants**

Delete lines 26-31, including the comment that only describes them:

```tsx
// Self-contained select classes (pixel-match of .admin-field-select).
const SELECT_CLS =
  'w-full py-[7px] pl-[10px] pr-[32px] border border-clay-border rounded-sm text-[13px] ' +
  'bg-cream text-ink font-sans appearance-none bg-no-repeat cursor-pointer min-w-[140px] ' +
  'focus:outline-none focus:border-oxblood focus:shadow-[0_0_0_2px_rgba(122,16,40,0.1)]'

const CHEVRON_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%237A4F55' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`
```

Keep `LBL` — the `<label>` elements above both selects still use it.

- [ ] **Step 6: Confirm nothing still references them**

Run: `grep -n "SELECT_CLS\|CHEVRON_SVG" apps/frontend/src/merchant/OrderDetailSheet.tsx`

Expected: no output.

- [ ] **Step 7: Check**

Run: `pnpm lint && pnpm typecheck`

Expected: PASS.

- [ ] **Step 8: Verify in the browser**

`pnpm dev` → `/merchant` → Orders → open an order's detail sheet. **Both selects live inside a Sheet**, so the popup layering is the thing to watch.

- Status select: the popup renders above the sheet, not clipped by it or behind it. Changing status fires a real write — the badge at the top of the sheet updates and a toast appears.
- Open a **delivery** order (the courier field only renders for `mode === 'delivery'` and when not read-only). Before a courier is chosen the trigger reads "Select courier…" in the muted placeholder colour; after choosing, it reads the courier's name.
- Saving tracking with a courier + AWB still produces a working tracking link on the order.
- Open a **pickup** order and confirm the courier field is still absent.
- Switch to 中文 and reopen: status labels read 新订单 / 备料中 / 已备好 / 已完成 / 已取消.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/merchant/OrderDetailSheet.tsx
git commit -m "refactor(merchant): move courier and status onto Select

The courier field is the first here that has to express \"nothing
chosen\": Radix could not hold value=\"\" so the empty <option> carried
it, and Base UI spells it null. courierDraft stays a string and the two
meet at the component boundary.

Status drops a null rather than coercing it — that handler writes to the
database.

Deletes this file's SELECT_CLS and base64 chevron, which had no other
consumer."
```

---

### Task 4: Storefront — Malaysian state picker

The riskiest change in the plan: customer-facing, mobile-first, mid-checkout, and covered by no test. `e2e/guest-order.spec.ts` never reaches the address form and nothing in the repo drives a select. It is also the one conversion that gives up the OS wheel picker for a JS listbox — a deliberate trade, made for consistency.

**Files:**
- Modify: `apps/frontend/src/store/Storefront.tsx` (imports, and the block at 1315-1326)
- Test: none — see Global Constraints.

**Interfaces:**
- Consumes: `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` from Task 1.
- Existing in scope: `MY_STATES` (a `readonly string[]` of sixteen states, already imported at line 24); `patchAddress(patch: Partial<AddressParts>)`; `address` derived from `addressInput`, so `address.state` is `string | undefined`.

- [ ] **Step 1: Add the import**

After the `Label` import at line 40, joining the `Button` / `Input` / `Label` block. This file uses the `../components/ui/x` relative form.

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
```

- [ ] **Step 2: Replace the native select**

Replace this block (around line 1315):

```tsx
                      <select
                        id="sf-state"
                        value={address.state}
                        onChange={e => patchAddress({ state: e.target.value })}
                        className="w-full min-w-0 rounded-md border border-clay-border bg-surface-raised px-[13px] py-2.5 text-[16px] text-ink transition-colors outline-none focus-visible:border-oxblood focus-visible:ring-3 focus-visible:ring-oxblood/10"
                      >
                        <option value="">{t('Select state…', '选择州属…')}</option>
                        {MY_STATES.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
```

with:

```tsx
                      <Select
                        value={address.state || null}
                        onValueChange={v => patchAddress({ state: v ?? '' })}
                      >
                        {/* The class string is Input's, verbatim — this field sits between two
                            Inputs and has always been pixel-matched to them. text-[16px] is not
                            decorative: iOS Safari zooms the viewport on focus of any control
                            under 16px, and this is the checkout address form. h-auto overrides
                            the trigger's default h-9, which is shorter than an Input. */}
                        <SelectTrigger
                          id="sf-state"
                          className="w-full min-w-0 h-auto rounded-md border border-clay-border bg-surface-raised px-[13px] py-2.5 text-[16px] text-ink transition-colors outline-none focus-visible:border-oxblood focus-visible:ring-3 focus-visible:ring-oxblood/10 data-placeholder:text-text-tertiary"
                        >
                          <SelectValue placeholder={t('Select state…', '选择州属…')} />
                        </SelectTrigger>
                        <SelectContent>
                          {MY_STATES.map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
```

No `items` prop: state values are their own labels (`'Selangor'` → `Selangor`), so there is nothing for Base UI to look up.

`data-placeholder:text-text-tertiary` matches the sibling Inputs' `placeholder:text-text-tertiary`, so the unset state reads the same across the three fields.

- [ ] **Step 3: Check**

Run: `pnpm lint && pnpm typecheck && pnpm build`

Expected: PASS.

- [ ] **Step 4: Verify in the browser — desktop**

`pnpm dev` → open any active shop's storefront at `/s/<slug>`, add an item, go to checkout, choose **delivery** (the address form only renders for delivery).

- The State field is the same height, width and border as the Postcode and City inputs above it. Compare them directly; a mismatch is the most likely defect here.
- Before choosing, it reads "Select state…" in the same muted tone as the inputs' placeholders.
- Choosing **Sabah**, **Sarawak** or **W.P. Labuan** must flip the shipping fee to the East Malaysia rate on a region-priced shop. This is the check that proves `patchAddress` still fires — the picker feeding pricing is the whole reason the field exists.
- Choosing a West Malaysia state (e.g. Selangor) restores the WM rate.
- Place the order through to the confirmation number, then open it in `/merchant` → Orders and confirm the state landed on the saved address.

- [ ] **Step 5: Verify in the browser — mobile**

Reload the same checkout in a mobile viewport (device toolbar at 390×844, or a real phone against the dev server).

- Focusing the State field must **not** zoom the viewport. If it does, the `text-[16px]` did not survive onto the trigger.
- The popup is reachable and scrollable through all sixteen states, and does not extend past the viewport.
- Base UI disables `alignItemWithTrigger` on touch regardless, so the list should drop below the trigger, matching desktop.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/store/Storefront.tsx
git commit -m "refactor(store): move the checkout state picker onto Select

The last native <select> in the app, and the only one that was
customer-facing. It trades the OS wheel picker on mobile for the same
listbox every other select uses — a deliberate call for consistency,
made knowing this form is covered by no test.

The trigger keeps Input's class string verbatim, including text-[16px],
which stops iOS Safari zooming the viewport on focus."
```

---

### Task 5: OptionGroupsEditor — copy-options becomes a DropdownMenu

This control is not a select. Its value is permanently `""`; picking a product fires `onChange(structuredClone(src.groups))` and the control resets. It is a one-shot action list wearing a form control's clothes, and forcing it into `Select` would mean a `value={null}` plus a manual reset for no gain.

**Files:**
- Modify: `apps/frontend/src/merchant/OptionGroupsEditor.tsx` (imports, and the block at 88-102)
- Test: none — see Global Constraints.

**Interfaces:**
- Consumes: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` from `../components/ui/dropdown-menu` (existing, unchanged by this plan).
- Existing in scope: `copyFrom: { id: string; name: string; groups: OptionGroup[] }[]` (defaulted to `[]`), `onChange: (groups: OptionGroup[]) => void`, `value: OptionGroup[]`, `t`.
- `DropdownMenuTrigger` takes a `render` prop rather than `asChild` — see `AdminMerchants.tsx:135` and `ProductsManager.tsx:117` for the established pattern in this repo.

- [ ] **Step 1: Add the import**

Below the existing `Button` / `Input` / `Label` imports:

```tsx
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '../components/ui/dropdown-menu'
```

- [ ] **Step 2: Replace the native select**

Replace this block (lines 88-102):

```tsx
        {copyFrom.length > 0 && value.length === 0 && (
          <select
            className="text-[12px] border border-clay-border rounded px-2 py-1 bg-transparent"
            value=""
            onChange={e => {
              const src = copyFrom.find(p => p.id === e.target.value)
              // A COPY, not a link. Editing "Milk" on one drink must never reprice eleven others
              // — that surprise is why there is no shared library (ADR 0008).
              if (src) onChange(structuredClone(src.groups))
            }}
          >
            <option value="">{t('Copy options from…', '从其他商品复制…')}</option>
            {copyFrom.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
```

with:

```tsx
        {copyFrom.length > 0 && value.length === 0 && (
          // A menu, not a select: this holds no value. It fires once, copies, and the
          // condition above then hides it because `value` is no longer empty.
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button" variant="outline" size="none"
                  className="text-[12px] px-2 py-1 rounded"
                />
              }
            >
              {t('Copy options from…', '从其他商品复制…')}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {copyFrom.map(p => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => {
                    // A COPY, not a link. Editing "Milk" on one drink must never reprice eleven
                    // others — that surprise is why there is no shared library (ADR 0008).
                    onChange(structuredClone(p.groups))
                  }}
                >
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
```

The `copyFrom.find(...)` lookup is gone because the menu item already closes over the product — the id round-trip only existed to get a value back out of a `<select>`.

- [ ] **Step 3: Check**

Run: `pnpm lint && pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Verify in the browser**

`pnpm dev` → `/merchant` → Products. You need **at least two products, one of which already has option groups**, or the control does not render (it requires `copyFrom.length > 0`).

- Edit a product that has **no** options → "Add options" → the "Copy options from…" button appears in the Options header row.
- It opens above the product dialog, not behind it.
- Picking a product copies its groups into the editor, and the button then disappears (its condition is `value.length === 0`).
- Edit one of the copied option's names and confirm the **source** product is untouched after saving — that is the ADR-0008 property the comment is about, and the only behaviour here worth breaking.
- Edit a product that already **has** options and confirm the button is absent.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/merchant/OptionGroupsEditor.tsx
git commit -m "refactor(merchant): copy-options is a menu, not a select

Its value was permanently \"\" — it fired once, copied, and reset. That
is an action list, so it now uses DropdownMenu. The id round-trip
through the option value goes away with it; the menu item closes over
the product directly.

The structuredClone and its ADR-0008 note are carried over unchanged."
```

---

### Task 6: Close out

**Files:**
- Modify: none expected.
- Test: none — see Global Constraints.

- [ ] **Step 1: Confirm no native select survives**

Run: `grep -rn "<select" apps/frontend/src`

Expected: no output.

- [ ] **Step 2: Confirm no Radix reference survives**

Run: `grep -rn "@radix-ui" apps/frontend/ --exclude-dir=node_modules`

Expected: no output.

- [ ] **Step 3: Full check suite**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

Expected: all PASS.

- [ ] **Step 4: Full manual sweep of all twelve selects**

Per `CLAUDE.md`, this is the real gate — the failure modes in the rename table are invisible to the type checker. Open every one and confirm the same three properties: **human label on the trigger, list drops below rather than overlapping, animations play**.

Storefront: checkout state picker (desktop **and** mobile viewport).
Merchant: products unit (inside the dialog), customers sort (Pro **and** basic), vouchers kind, order detail courier, order detail status, shop settings currency, fulfilment timezone, feedback FAB category, language switcher, option-groups copy menu.

Do one full pass in **English** and one in **中文**. The Chinese pass is not optional — `ProductsManager`'s unit values equal their English labels, so a missing `items` prop is invisible in English and shows `pcs` where `件` belongs.

- [ ] **Step 5: Push and open a PR**

```bash
git push -u origin refactor/base-ui-select
```

Open the PR against `dev`. CI runs lint, typecheck, `test` and both builds, plus the DB-backed suite — none of which covers these selects, so say in the PR body that the verification was manual and list which screens were opened.

---

## Notes for the reviewer

**What is most likely to be wrong.** The rename sweep in Task 1. A missed `data-[state=open]` compiles, typechecks, lints and renders — the popup simply appears without animating. A missed `--radix-select-content-available-height` leaves the max-height unset and a long list (the sixteen states, the eleven units) runs off the bottom of the screen. Neither is caught by anything but opening the thing.

**What has no safety net.** `Storefront.tsx`. No test in this repo drives a select, and `e2e/guest-order.spec.ts` never reaches the address form. It is also the highest-stakes screen — customer-facing, mid-checkout, mobile-first.

**What was deliberately not done.** The select was not re-themed. `index.css` already aliases the shadcn tokens onto the brand palette, so the class strings carried over from the Radix file render brand colours unchanged. If the select now looks different from before, that is a defect, not the redesign.
