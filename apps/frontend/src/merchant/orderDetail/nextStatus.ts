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
  new:       { to: 'preparing', en: 'Start preparing →', zh: '开始备料 →' },
  preparing: { to: 'ready',     en: 'Mark ready →',      zh: '标记为已备好 →' },
  ready:     { to: 'completed', en: 'Mark completed →',  zh: '标记为已完成 →' },
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
