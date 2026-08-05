import { Badge } from '@/components/ui/badge'

export const ORDER_STATUSES = ['pending_payment', 'new', 'preparing', 'ready', 'completed', 'cancelled']

export const STATUS_LABELS: Record<string, { en: string; zh: string }> = {
  pending_payment: { en: 'Pending payment', zh: '待付款' },
  new:       { en: 'New',       zh: '新订单' },
  preparing: { en: 'Preparing', zh: '备料中' },
  ready:     { en: 'Ready',     zh: '已备好' },
  completed: { en: 'Completed', zh: '已完成' },
  cancelled: { en: 'Cancelled', zh: '已取消' },
}

type BadgeConfig = { variant?: 'infoBlue' | 'warn' | 'danger'; className?: string }
export const STATUS_BADGE: Record<string, BadgeConfig> = {
  // The plain warn variant (bg-warn-bg/text-warn-fg), not preparing's -alt pair below — same
  // amber family AdminMerchants already uses for a merchant's own 'pending' status, but a
  // distinct shade so the two order statuses never look like the same badge.
  pending_payment: { variant: 'warn' },
  new:       { variant: 'infoBlue' },
  preparing: { className: 'bg-warn-bg-alt text-warn-fg-alt border-transparent' },
  ready:     { className: 'bg-success-bg-soft text-success-deep border-transparent' },
  completed: { className: 'bg-prep-bg-alt text-prep-fg-alt border-transparent' },
  cancelled: { className: 'bg-danger-bg text-danger-fg border-transparent' },
}

export function StatusBadge({ status, t }: { status: string; t: (en: string, zh: string) => string }) {
  const badge = STATUS_BADGE[status] ?? { variant: 'infoBlue' as const }
  return (
    <Badge variant={badge.variant} className={badge.className}>
      {t(STATUS_LABELS[status]?.en ?? status, STATUS_LABELS[status]?.zh ?? status)}
    </Badge>
  )
}
