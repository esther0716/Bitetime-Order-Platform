# Filtering a shop's customers by tag (#205)

## Where this starts

A merchant asked for "customer filter with tag" through the dashboard feedback button (#205).

The filter already exists. `GET /api/merchants/:id/customers` takes a `tag` query parameter, `matchesTag` applies it in `shopCustomers.ts`, the endpoint gates it behind Pro alongside sorting, and `CustomersView.tsx` holds a `tag` state that it passes to `fetchShopCustomers`. The response even carries `shopTags` — the shop's whole tag vocabulary, deliberately neither filtered nor paged because, in CONTEXT.md's own words, "it is what the tag filter *chooses from*".

What is missing is the choosing. The only way to set `tag` today is to open a customer's drawer and click one of *that customer's* tag chips. A merchant who wants to see their VIPs must first find a VIP. Nothing on the list screen says the filter is there.

So this is a frontend-only change: give the vocabulary a control.

## Scope

**No backend change. No migration. No new endpoint. No change to `store.ts` or `types.ts`.**

Everything below happens in `apps/frontend/src/merchant/CustomersView.tsx` and `apps/frontend/src/merchant/tagSuggestions.ts`.

## Decisions taken during design

| Question | Decision |
|---|---|
| One tag or several | **One.** Matches the shipped backend (`matchesTag` takes a single tag) and the shipped drawer behaviour. Multi-tag AND/OR is a separate story with a wire change |
| Control shape | **A chip row** below the existing toolbar, styled like the drawer's tag chips — not a dropdown. The vocabulary is visible without a click, which is the discoverability gap the feedback is actually about |
| What a Basic shop sees | **Nothing.** Not the repo's usual shown-but-locked — see below |
| Overflow | First **10** chips, then a `+N more` toggle. The selected tag is always in the visible set |
| Empty vocabulary | Row is not rendered. A shop that has written no tags has nothing to filter by, and an empty row labelled *Tags* reads as a broken control |
| The existing clear-chip | **Deleted.** The row shows selection itself |

### Why a Basic shop sees nothing here

The house rule is shown-but-locked — the sort dropdown sits right there, disabled, beside a Pro badge, because hiding a feature "reads as a missing feature and leaves nothing to sell against".

The tag row is the one place that rule inverts, and for a reason that is about the *data*, not the control. On a Pro → Basic step-down, notes and tags **survive, hidden not deleted** (CONTEXT.md → *Shop customer*). Rendering the chip row disabled would print a downgraded shop's own tag vocabulary across the top of the list — un-hiding, in the name of a padlock, exactly what the downgrade rule hides.

A never-Pro shop has written no tags at all, so for them the row is empty by the empty-vocabulary rule anyway. Both cases land in the same place.

The sell is not lost: the drawer's Notes & tags panel already shows every Basic shop a Pro pitch and an upgrade link, and the sort control beside the search box still carries the badge whose tooltip says *"Sorting and tags are a Pro feature."*

## The pure part

One new export in `tagSuggestions.ts` — the module that already owns "which of a shop's own tags to show, and in what order". Same subject, same file.

```ts
/** How many chips the row shows before it has to be asked for the rest. */
export const TAG_CHIP_CAP = 10

export function filterChips(
  shopTags: string[],
  selected: string | null,
  expanded: boolean,
): { chips: string[]; hidden: number }
```

Rules it decides:

- Collapsed, it returns the first `TAG_CHIP_CAP` tags in the caller's order — which is the backend's order, case-folded so `vip` and `VIP` sit adjacent. No re-sorting here, for the reason `tagSuggestions` already states: re-sorting would be a second opinion about a question already answered.
- **The selected tag is always in `chips`**, even when it sorts past the cap. A filter the merchant cannot see is a list that appears to be missing rows. It is pulled into the visible set rather than moved to the front — a row that reshuffles when you click it is a row you cannot click twice.
- `hidden` is what `+N more` counts, and is `0` when expanded or when the vocabulary fits.
- A `selected` tag that is not in `shopTags` at all is still returned (see *Accepted* below).

Tested in `tagSuggestions.test.ts`. The UI it feeds is verified by running the app, per CLAUDE.md.

## The UI

A `TagFilterRow` component in `CustomersView.tsx`, rendered between the toolbar and the table:

```
[ Search by name or WhatsApp… ]  [ Most recent order ▾ ]

Tags:  (VIP)  (halal)  (熟客)  (catering)  … (+12 more)
```

- Renders only when `isPro && shopTags.length > 0`.
- Unselected chip: the drawer's outline pill. Selected chip: filled (`bg-brand-100`, `text-primary`) with a trailing `X` — the same shape the deleted clear-chip had, so the affordance is not new to anyone who has used it.
- Click unselected → `narrow(setTag)(tag)`. Click selected → `narrow(setTag)(null)`. Every narrowing returns to page 1, which `narrow` already does.
- `expanded` is local state in the row. It survives a filter change and resets on remount; there is nothing to refetch either way.
- Labels are `t(en, zh)` like everything else: `t('Tags', '标签')`, `t('+N more', '还有 N 个')`, `t('Show fewer', '收起')`.

`CustomersView.tsx:132-141` — the standalone selected-tag chip in the toolbar — is deleted. It existed because there was no other way to see or clear the active tag. Keeping it would put the same tag on screen twice with two ways to clear it.

The drawer's `onTagClicked` path is untouched: clicking a tag inside a customer's drawer still closes it and filters the list, and now the chip row shows that selection.

## Accepted

`mergeShopTags` is additive by design, so removing a tag from its last holder leaves its chip in the row until the next list load. Clicking that chip returns nothing and the list says *"No customers match that."* This is the existing, documented behaviour of the drawer's suggestions — the vocabulary can run ahead of the server, never behind it — and the alternative is refetching the whole list to redraw one row of chips. `filterChips` therefore keeps a `selected` tag it does not recognise rather than dropping it, so the chip stays clearable instead of stranding the filter with nothing on screen to clear it with.

## Out of scope

Multi-tag filtering, filtering by note text, merging two spellings of one tag, and any tag control on the storefront side.
