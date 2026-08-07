# Customer Tag Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a Pro merchant a visible way to filter their customer list by one of their own tags, by rendering the shop's tag vocabulary as a row of clickable chips under the Customers toolbar (#205).

**Architecture:** Frontend only. The filter already works end to end — `GET /api/merchants/:id/customers` accepts a `tag` parameter, `shopCustomers.ts` applies it, the endpoint gates it behind Pro, and the response already carries `shopTags` (the shop's whole vocabulary, unfiltered and unpaged, exactly so a control can choose from it). `CustomersView.tsx` already holds the `tag` state and passes it to `fetchShopCustomers`. Two changes: a pure `filterChips` function that decides which chips are visible, and a `TagFilterRow` component that renders them.

**Tech Stack:** React 19, TypeScript, Vitest, Tailwind, existing `@/components/ui/button` primitives.

## Global Constraints

- **No backend change, no migration, no new endpoint, no change to `store.ts` or `types.ts`.** Only `apps/frontend/src/merchant/tagSuggestions.ts`, its test, and `apps/frontend/src/merchant/CustomersView.tsx`.
- **Every user-visible string is `t(english, chinese)`.** There is no i18n library; `t` comes from `useSession()`.
- **Chip cap is 10** (`TAG_CHIP_CAP`).
- **One tag at a time.** The backend's `matchesTag` takes a single tag; do not send repeated `tag` params.
- **The selected tag is always among the rendered chips**, even when it sorts past the cap.
- **Never re-sort `shopTags`.** The backend already sorted it case-insensitively so `vip` and `VIP` land side by side; re-sorting in the browser is a second opinion about a settled question.
- **A Basic (non-Pro) shop renders none of this row** — not disabled, not greyed. Tags survive a downgrade hidden-not-deleted, so a disabled chip row would print the very vocabulary the downgrade hides.
- Spec: `docs/superpowers/specs/2026-08-07-customer-tag-filter-design.md`.

---

### Task 1: `filterChips` — which tags the row shows

**Files:**
- Modify: `apps/frontend/src/merchant/tagSuggestions.ts` (append; do not touch `tagSuggestions` or `mergeShopTags`)
- Test: `apps/frontend/src/merchant/tagSuggestions.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `export const TAG_CHIP_CAP: number` (value `10`)
  - `export function filterChips(shopTags: string[], selected: string | null, expanded: boolean): { chips: string[]; hidden: number }`

  Task 2 imports both from `./tagSuggestions`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/frontend/src/merchant/tagSuggestions.test.ts`:

```ts
describe('filterChips', () => {
  const many = Array.from({ length: 15 }, (_, i) => `tag${i}`)

  it('shows the whole vocabulary when it fits under the cap', () => {
    expect(filterChips(['office', 'vip'], null, false)).toEqual({ chips: ['office', 'vip'], hidden: 0 })
  })

  it('shows nothing when the shop has written nothing', () => {
    expect(filterChips([], null, false)).toEqual({ chips: [], hidden: 0 })
  })

  it('caps the row and counts what it held back', () => {
    const { chips, hidden } = filterChips(many, null, false)
    expect(chips).toEqual(many.slice(0, TAG_CHIP_CAP))
    expect(hidden).toBe(5)
  })

  // A filter the merchant cannot see is a list that looks like it is missing rows.
  it('pulls the selected tag in when it sorts past the cap', () => {
    const { chips } = filterChips(many, 'tag12', false)
    expect(chips).toContain('tag12')
  })

  // Appended, not moved: a row that reshuffles when you click it is a row you cannot click twice.
  it('appends the pulled-in tag rather than reordering the row', () => {
    const { chips } = filterChips(many, 'tag12', false)
    expect(chips).toEqual([...many.slice(0, TAG_CHIP_CAP), 'tag12'])
  })

  it('does not still count the pulled-in tag as hidden', () => {
    expect(filterChips(many, 'tag12', false).hidden).toBe(4)
  })

  it('leaves the row alone when the selected tag is already visible', () => {
    const { chips, hidden } = filterChips(many, 'tag3', false)
    expect(chips).toEqual(many.slice(0, TAG_CHIP_CAP))
    expect(hidden).toBe(5)
  })

  it('shows everything once expanded, with nothing left to ask for', () => {
    expect(filterChips(many, null, true)).toEqual({ chips: many, hidden: 0 })
  })

  // mergeShopTags is additive, so the vocabulary can run ahead of the server but never behind
  // it — and a selected tag the list no longer holds must stay clickable, or the filter is
  // stuck with nothing on screen to clear it with.
  it('keeps a selected tag the vocabulary no longer holds', () => {
    expect(filterChips(['office'], 'retired', false)).toEqual({ chips: ['office', 'retired'], hidden: 0 })
  })
})
```

Update the import at the top of the file to:

```ts
import { tagSuggestions, mergeShopTags, filterChips, TAG_CHIP_CAP } from './tagSuggestions'
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @bitetime/frontend test -- tagSuggestions
```

Expected: FAIL — `filterChips is not a function` / `TAG_CHIP_CAP is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `apps/frontend/src/merchant/tagSuggestions.ts`:

```ts
/** How many chips the filter row shows before it has to be asked for the rest (#205). */
export const TAG_CHIP_CAP = 10

/**
 * Which of the shop's tags the filter row draws, and how many it is holding back.
 *
 * The cap exists because a shop's vocabulary is unbounded — twenty tags wrap the row over four
 * lines on a phone and push the table it filters below the fold.
 *
 * Two rules earn their place:
 *
 *   * The SELECTED tag is always drawn, even when it sorts past the cap. A filter the merchant
 *     cannot see is a list that reads as missing rows, with nothing on screen to explain it.
 *   * It is APPENDED, never moved to the front. A row that reshuffles the moment you click it
 *     is a row you cannot click twice, and clicking a selected chip is how the filter clears.
 *
 * `hidden` is counted against what is actually drawn rather than derived from the cap, so a
 * pulled-in tag is not still counted as hidden — `+5 more` above a row already showing one of
 * the five is a number the merchant can see is wrong.
 *
 * A `selected` tag absent from `shopTags` survives, because `mergeShopTags` is additive: the
 * vocabulary can run ahead of the server but never behind it, so a tag whose last holder just
 * lost it lingers until the next list load. Dropping the chip would strand the filter with
 * nothing to clear it with. Order is the caller's, as it is for `tagSuggestions`.
 */
export function filterChips(
  shopTags: string[],
  selected: string | null,
  expanded: boolean,
): { chips: string[]; hidden: number } {
  const visible = expanded ? shopTags : shopTags.slice(0, TAG_CHIP_CAP)
  const chips = selected !== null && !visible.includes(selected) ? [...visible, selected] : visible
  return { chips, hidden: shopTags.filter(tag => !chips.includes(tag)).length }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @bitetime/frontend test -- tagSuggestions
```

Expected: PASS — the nine new cases plus the existing `tagSuggestions` and `mergeShopTags` blocks.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/merchant/tagSuggestions.ts apps/frontend/src/merchant/tagSuggestions.test.ts
git commit -m "feat(customers): decide which tag chips the filter row shows

The row has to cap — a shop's vocabulary is unbounded and twenty tags
wrap over four lines on a phone. Two rules make the cap safe: the
selected tag is always drawn even when it sorts past the cap, and it is
appended rather than moved, so clicking a chip does not reshuffle the
row out from under the next click. Part of #205."
```

---

### Task 2: `TagFilterRow` — the control itself

**Files:**
- Modify: `apps/frontend/src/merchant/CustomersView.tsx`
  - imports (line 20): add `filterChips`, `TAG_CHIP_CAP`
  - delete the standalone clear-chip at lines 132-141
  - render `<TagFilterRow />` after the toolbar `div`
  - add the `TagFilterRow` component below `SortControl`
- Test: none. UI is verified by running the app (CLAUDE.md); the logic that is worth a test is Task 1's.

**Interfaces:**
- Consumes: `filterChips(shopTags, selected, expanded)` and `TAG_CHIP_CAP` from `./tagSuggestions` (Task 1).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Widen the tagSuggestions import**

In `apps/frontend/src/merchant/CustomersView.tsx`, replace:

```tsx
import { mergeShopTags, tagSuggestions } from './tagSuggestions'
```

with:

```tsx
import { filterChips, mergeShopTags, TAG_CHIP_CAP, tagSuggestions } from './tagSuggestions'
```

- [ ] **Step 2: Delete the standalone clear-chip from the toolbar**

In the toolbar `div` (`className="mb-4 flex flex-wrap items-center gap-3"`), delete this whole block:

```tsx
        {tag && (
          <button
            type="button"
            onClick={() => narrow(setTag)(null)}
            className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-brand-100 px-3 py-1 text-[12px] text-primary"
          >
            {tag}
            <X size={12} />
          </button>
        )}
```

It existed because there was no other way to see or clear the active tag. The chip row now shows the selection itself, and two clear affordances for one filter is one too many.

Leave the `X` import alone — `TagFilterRow` and `NotesPanel` both still use it.

- [ ] **Step 3: Render the row**

Immediately after the closing `</div>` of the toolbar (and before the `{customers!.length === 0 ? (` block), add:

```tsx
      {isPro && shopTags.length > 0 && (
        <TagFilterRow shopTags={shopTags} selected={tag} onSelect={narrow(setTag)} />
      )}
```

- [ ] **Step 4: Add the component**

Insert below `SortControl` (before the `ListFooter` doc comment):

```tsx
/**
 * The shop's own tags, as a row of filters (#205).
 *
 * The filter is not new — the endpoint has taken `tag` since #143 and the list response has
 * carried `shopTags` since #150, described in CONTEXT.md as "what the tag filter chooses from".
 * What was missing was the choosing: the only way to set a tag was to open a customer's drawer
 * and click one of theirs, so a merchant looking for their VIPs had to find a VIP first.
 *
 * A chip row rather than a dropdown because the gap being closed is DISCOVERABILITY — the
 * vocabulary has to be visible without a click, or the merchant still does not know the filter
 * is there.
 *
 * Basic shops render nothing here, which inverts the shown-but-locked rule the sort control
 * beside it follows, and deliberately: notes and tags survive a downgrade hidden-not-deleted,
 * so a disabled chip row would print the very vocabulary the downgrade hides. The pitch is not
 * lost — it lives in the drawer's Notes & tags panel and in the sort control's own badge.
 */
function TagFilterRow({
  shopTags, selected, onSelect,
}: { shopTags: string[]; selected: string | null; onSelect: (tag: string | null) => void }) {
  const { t } = useSession()
  const [expanded, setExpanded] = useState(false)
  const { chips, hidden } = filterChips(shopTags, selected, expanded)

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">{t('Tags', '标签')}</span>

      {chips.map(chip => {
        const on = chip === selected
        return (
          <button
            key={chip}
            type="button"
            aria-pressed={on}
            // Clicking the selected chip clears the filter — the same act, reversed, so there
            // is one control and not a filter plus a separate way to undo it.
            onClick={() => onSelect(on ? null : chip)}
            className={`inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-[12px] transition-colors ${
              on
                ? 'border-primary bg-brand-100 text-primary'
                : 'border-border bg-background text-muted-foreground hover:border-primary hover:text-primary'
            }`}
          >
            {chip}
            {on && <X size={11} />}
          </button>
        )
      })}

      {hidden > 0 && (
        <Button
          type="button"
          variant="link"
          size="none"
          onClick={() => setExpanded(true)}
          className="text-[12px]"
        >
          {t(`+${hidden} more`, `还有 ${hidden} 个`)}
        </Button>
      )}

      {/* Guarded on the cap, not on `expanded` alone: a vocabulary that shrank below the cap
          while expanded would otherwise offer to collapse a row that is already whole. */}
      {expanded && shopTags.length > TAG_CHIP_CAP && (
        <Button
          type="button"
          variant="link"
          size="none"
          onClick={() => setExpanded(false)}
          className="text-[12px]"
        >
          {t('Show fewer', '收起')}
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Typecheck, lint, and run the unit tests**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @bitetime/frontend test
```

Expected: all clean, all pass.

- [ ] **Step 6: Run the app and verify (this is the real test for UI)**

Start the stack:

```bash
cd apps/backend && supabase start   # if it is not already up
cd - && pnpm dev
```

Sign in at `http://localhost:5173/merchant/login` as a **Pro** merchant (the seeded `demo-pro` shop) and open the **Customers** section. Verify, in order:

1. **No tags yet** → no chip row at all, and the toolbar is unchanged.
2. Open a customer's drawer, add tags `VIP` and `halal`, close it → the chip row appears under the toolbar with both tags. (The row is fed by `shopTags`, which `mergeShopTags` keeps current without a reload.)
3. Click `VIP` → the chip fills and gains an `X`; the list narrows to VIP customers; the pager returns to page 1.
4. Click `VIP` again → the filter clears and the full list returns.
5. Click `halal` while `VIP` is selected → the selection moves; only one tag is ever active.
6. Open a drawer, click a tag chip **inside** the drawer → the drawer closes, the list filters, and the matching chip in the row is now shown as selected.
7. Add more than ten distinct tags across customers → the row shows ten chips plus `+N more`; clicking it expands the row and offers `Show fewer`.
8. Select a tag that sorts past the cap (from inside a drawer), then collapse the row → that tag is still on screen, appended after the tenth chip.
9. Switch the dashboard language to 中文 → the row reads `标签`, `还有 N 个`, `收起`.
10. Sign in as a **Basic** merchant → the Customers list renders with **no chip row**, the sort dropdown is disabled beside its Pro badge, and the drawer shows the Notes & tags pitch.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/merchant/CustomersView.tsx
git commit -m "feat(customers): filter the customer list by tag from a chip row

Closes #205.

The filter itself already shipped — the endpoint takes \`tag\`, the pure
module applies it, and the response carries the shop's whole tag
vocabulary precisely so a control could choose from it. Nothing ever
chose: the only way to set a tag was to open a customer's drawer and
click one of theirs, so a merchant looking for their VIPs had to find a
VIP first.

A chip row rather than a dropdown, because the gap is discoverability —
the vocabulary has to be visible without a click. Clicking the selected
chip clears the filter, which retires the separate clear-chip that used
to sit in the toolbar: one control, not a filter plus an undo.

Basic shops render none of it. That inverts the shown-but-locked rule
the sort control follows, and it has to: tags survive a downgrade
hidden-not-deleted, so a disabled row would print the very vocabulary
the downgrade hides."
```

---

### Task 3: Record it in the domain doc

**Files:**
- Modify: `CONTEXT.md` — the *Shop customer* section, the paragraph beginning "**Tags offer, they do not normalise** (#150)"

**Interfaces:**
- Consumes: the behaviour built in Tasks 1 and 2.
- Produces: nothing.

- [ ] **Step 1: Append the filter's own sentences**

CONTEXT.md already says `shopTags` "is what the tag filter *chooses from*" — a forward reference to a control that did not exist. Add, at the end of that paragraph:

```markdown
**The row is the choosing** (#205). The vocabulary is drawn as chips under the customer list, one tag active at a time, and clicking the active chip clears it — there is no separate clear control. Capped at ten with a `+N more`, and the selected tag is always drawn even when it sorts past the cap: a filter the merchant cannot see is a list that reads as missing rows. **Basic shops see no row at all**, which inverts the shown-but-locked rule the sort control follows and is the one place it should invert — tags survive a downgrade hidden-not-deleted, so a disabled row would print the very vocabulary the downgrade hides.
```

- [ ] **Step 2: Verify no test pins the file**

```bash
pnpm --filter @bitetime/frontend test && pnpm --filter @bitetime/backend test
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add CONTEXT.md
git commit -m "docs(context): the tag filter now has a control

The Shop customer section already called shopTags 'what the tag filter
chooses from' — a forward reference to something that did not exist.
Names the chip row, the one-tag-at-a-time rule, and why basic shops see
none of it. Part of #205."
```
