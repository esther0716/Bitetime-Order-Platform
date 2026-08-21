import { Badge } from '@/components/ui/badge'

export const ORDER_STATUSES = ['pending_payment', 'new', 'preparing', 'ready', 'completed', 'cancelled']

export const STATUS_LABELS: Record<string, { en: string; zh: string }> = {
  pending_payment: { en: 'Pending Payment', zh: '待付款' },
  new:       { en: 'New',       zh: '新订单' },
  preparing: { en: 'Preparing', zh: '备料中' },
  ready:     { en: 'Ready',     zh: '已备好' },
  completed: { en: 'Completed', zh: '已完成' },
  cancelled: { en: 'Cancelled', zh: '已取消' },
}

type BadgeConfig = { className: string }

/* An unrecognised status is not a colour decision — it is a status this file has not been
   taught. It renders neutral — the one status treatment no real status uses. */
const NEUTRAL = 'bg-neutral-100 text-neutral-fg border-transparent'

/* Four tone families, six statuses. Two pairs share a hue and are separated by FILL
   WEIGHT — solid vs subtle — rather than by a fifth colour: `new`/`preparing` on info,
   and `ready`/`completed` on success. Solid is the one that still wants the merchant's
   hands; subtle is the one that is settled. A merchant scanning a busy table still sees
   two different things; the palette still has four entries. Every pair here is asserted
   AA by tokens.test.ts. */
export const STATUS_BADGE: Record<string, BadgeConfig> = {
  pending_payment: { className: 'bg-warning-100 text-warning-fg border-transparent' },
  new:             { className: 'bg-info-fg text-white border-transparent' },
  preparing:       { className: 'bg-info-100 text-info-fg border-transparent' },
  ready:           { className: 'bg-success-fg text-white border-transparent' },
  completed:       { className: 'bg-success-100 text-success-fg border-transparent' },
  cancelled:       { className: 'bg-danger-100 text-danger-fg border-transparent' },
}

export function StatusBadge({ status, t }: { status: string; t: (en: string, zh: string) => string }) {
  const badge = STATUS_BADGE[status] ?? { className: NEUTRAL }
  return (
    <Badge className={badge.className}>
      {t(STATUS_LABELS[status]?.en ?? status, STATUS_LABELS[status]?.zh ?? status)}
    </Badge>
  )
}
