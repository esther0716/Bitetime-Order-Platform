import { Star } from 'lucide-react'
import { useSession } from '../../SessionContext'
import { cn } from '@/lib/utils'
import DrawerCard from './DrawerCard'
import type { Order } from '../../types'

/**
 * What the customer said about this order — read-only, always.
 *
 * A merchant cannot write, edit or delete a review. There is no door for it on the backend
 * either: both review routes scope to the CUSTOMER, so this is a display and nothing more.
 *
 * Renders nothing for an unrated order. An empty "Review" card on every order the customer never
 * rated would put a hole in six drawers out of seven, and say nothing in any of them.
 */
export default function ReviewCard({ order }: { order: Order }) {
  const { t } = useSession()
  const rating = order.review_rating ?? null
  if (!rating) return null

  return (
    <DrawerCard title={t('Customer review', '顾客评价')}>
      <div className="flex items-center gap-1" aria-label={t('Rating', '评分')}>
        {[1, 2, 3, 4, 5].map(n => (
          <Star
            key={n}
            size={18}
            strokeWidth={1.75}
            aria-hidden
            className={cn(rating >= n ? 'fill-primary text-primary' : 'text-muted-foreground')}
          />
        ))}
        <span className="ml-1 text-[13px] text-muted-foreground tabular-nums">{rating}/5</span>
      </div>
      {order.review_comment && (
        <p className="text-[13px] text-foreground break-words whitespace-pre-wrap">
          {order.review_comment}
        </p>
      )}
    </DrawerCard>
  )
}
