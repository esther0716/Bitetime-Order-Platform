# Option group editor: icon-based controls

## Problem

`apps/frontend/src/merchant/OptionGroupsEditor.tsx` (merchant product-form "Options" box) is text-heavy: "Add choice", "Switch off"/"Switched off", "Remove question", "Available"/"Sold out" are all full-word buttons crammed into a narrow card, which is also why the choice row already has documented wrap-collision comments.

## Design

Use `lucide-react` (already a dependency, established import/size/color conventions elsewhere in the codebase) to replace word-heavy controls with icons. All icon-only buttons keep `aria-label` + `title` for accessibility — matching the pattern the current "Available"/"×" buttons already use.

| Control | Before | After |
|---|---|---|
| Remove question | text button in per-group toolbar row | `Trash2` icon-only button, moved to the top-right corner of the group's card |
| Switch off / Switched off (group) | text toggle button | `Power` / `PowerOff` icon-only toggle |
| Available / Sold out (per-choice) | text chip | `Power` / `PowerOff` icon-only toggle (also relieves the row-width pressure noted in the existing code comment) |
| Remove choice (`×`) | plain `×` glyph | `Trash2` icon (small), same glyph family as the group-level remove |
| Add choice / Add a question | text-only button | `Plus` icon + short label ("+ Choice" / "+ Question"), matching the icon+text pattern already used in `CustomersView.tsx` |
| Move up / down | Unicode `↑`/`↓` | `ArrowUp` / `ArrowDown` lucide icons, for one consistent icon family in the toolbar row |

`Power`/`PowerOff` is reused for both the group-level and choice-level active toggle — one icon meaning ("active/inactive") instead of two icon vocabularies for the same underlying `active` boolean at different scopes.

## Scope

Single file: `apps/frontend/src/merchant/OptionGroupsEditor.tsx`. No behavior change — same handlers, same state, same validation. Purely swapping button contents/layout and adding `aria-label`/`title` where a button loses its visible text.

## Out of scope

No other editors/components in the app are touched. No new icon vocabulary invented beyond what's listed above.
