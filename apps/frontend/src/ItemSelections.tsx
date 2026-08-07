import { useSession } from './SessionContext'
import type { OrderItem } from './types'

/**
 * What was chosen on one order line — "Chocolate ×4, Red velvet ×2".
 *
 * ONE renderer, used by every list of items there is: the cart summary, the success screen, the
 * receipt, the customer's order history and the merchant's order detail. They were written at
 * different times and each formats its own line, so a selection added to one of them is a
 * selection missing from the other four — which is exactly what happened when menu options
 * shipped: the order stored them and both notifications printed them, while every screen in the
 * app showed "Box of 6 Muffins × 1" and nothing else.
 *
 * Reads the SNAPSHOT on the order, never the product's current groups. That is the whole point of
 * storing names on the row: a merchant renaming "Red velvet" next month must not rewrite what an
 * order from today says it was.
 *
 * Renders NOTHING when the line has no selections, so a shop that asks no questions — most shops
 * — sees exactly what it saw before.
 */
export function ItemSelections({ item, className = '' }: { item: OrderItem; className?: string }) {
  const { lang } = useSession()
  // Rows written before menu options carry no `selections` key at all. Absent must read as "no
  // options", never as a crash — the same rule `promo` already follows on these rows.
  const picks = Array.isArray(item.selections) ? item.selections : []
  if (picks.length === 0) return null

  return (
    <span className={`block text-[12px] text-muted-foreground ${className}`}>
      {picks
        .map((p: Record<string, unknown>) => {
          const name = (lang === 'zh' && p.optionName_zh) ? p.optionName_zh : p.optionName
          return `${String(name ?? '')} ×${String(p.qty ?? 0)}`
        })
        .join(', ')}
    </span>
  )
}
