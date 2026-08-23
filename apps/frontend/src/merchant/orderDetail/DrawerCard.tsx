import { Button } from '@/components/ui/button'

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
      {/* `flex flex-col gap-2` is what the hairline `Section` this replaces gave its children.
          A card whose content is one element does not notice; one that stacks a name over a
          phone number, or fields over a preview link, would collapse without it. */}
      <div className="flex flex-col gap-2 px-4 pt-2.5 pb-3.5">{children}</div>
      {footer && (
        <div className="flex justify-end gap-2 px-4 py-2.5 border-t border-border">{footer}</div>
      )}
    </section>
  )
}

/**
 * The two-column field grid, one column below `sm`. Three cards lay their facts out this way
 * and the string was copied into each.
 */
export const FIELD_GRID = 'grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-x-6'

/**
 * One labelled fact: the label ABOVE its value, not beside it.
 *
 * The drawer used to draw these through a fixed 84px label column, which left a real Malaysian
 * address about 300px to wrap in. `action` is an optional control that belongs to the label —
 * today only the address's copy button.
 */
export function Field({
  label,
  action,
  children,
}: {
  label: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className={`${LBL} flex items-center gap-1`}>{label}{action}</span>
      <span className="text-[13px] text-foreground break-words">{children}</span>
    </div>
  )
}

/**
 * The button in a card's footer that writes that card's fields. Both editing cards had it
 * character-for-character, down to the padding.
 */
export function CardSaveButton({
  label,
  savingLabel,
  saving,
  dirty,
  onSave,
}: {
  label: string
  savingLabel: string
  saving: boolean
  dirty: boolean
  onSave: () => void
}) {
  return (
    <Button
      type="button"
      size="none"
      className="rounded-lg py-[6px] px-[14px] text-[13px]"
      disabled={!dirty || saving}
      onClick={onSave}
    >
      {saving ? savingLabel : label}
    </Button>
  )
}
