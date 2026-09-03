import { ORDER_STATUSES } from '../orderStatus'

/** One tally over the order list. A blank status is the "all orders" chip. */
export interface StatusChip {
  status: string
  count: number
}

/**
 * The tallies to draw over the merchant's order list, in the order a shop works through them.
 *
 * Two rules, and both are about a chip row that would otherwise move under the merchant's hand:
 *
 *  * A status the shop has no orders in is not drawn. Six chips of which four read zero say
 *    nothing and cost the row its whole width on a phone.
 *  * EXCEPT the one the merchant is standing on. Filter to Ready, mark the last ready order
 *    Completed, and a count-only rule deletes the chip that is currently switched on — leaving
 *    an empty list and no visible way back to the full one.
 *
 * The "all" chip counts every order, including one in a status this build has not been taught:
 * it is the shop's total, and a total that quietly omits rows is the defect this list already
 * had once (#144).
 */
export function statusChips(
  counts: Record<string, number> | null,
  selected: string,
): StatusChip[] {
  const c = counts ?? {}
  const all = Object.values(c).reduce((sum, n) => sum + n, 0)
  const chips: StatusChip[] = [{ status: '', count: all }]
  for (const status of ORDER_STATUSES) {
    const count = c[status] ?? 0
    if (count > 0 || status === selected) chips.push({ status, count })
  }
  return chips
}
