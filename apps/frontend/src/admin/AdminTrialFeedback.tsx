import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { useSession } from '../SessionContext'
import { fetchAdminTrialFeedback } from '../store'
import type { TrialFeedbackAdminItem } from '../types'
import { Card } from '../components/ui/card'

/**
 * Superadmin's read-only list of trial-feedback survey RESPONSES (#155) — merchants who
 * were sent the survey and never answered are not shown here; see CONTEXT.md → Trial
 * feedback. Newest-first, no triage actions: unlike AdminFeedback this is a survey, not a
 * complaint queue.
 */
export default function AdminTrialFeedback() {
  const { t, lang } = useSession()
  const [items, setItems] = useState<TrialFeedbackAdminItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchAdminTrialFeedback()
      .then(r => {
        if (cancelled) return
        if (r.ok) { setItems(r.data); setError('') }
        else setError(r.error.message || t('Could not load feedback', '无法加载反馈'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [t])

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-MY', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-heading text-[20px] text-primary">{t('Trial feedback', '试用反馈')}</h2>

      {error && <p className="text-[13px] text-danger-fg">{error}</p>}
      {loading && <p className="text-[13px] text-muted-foreground">{t('Loading…', '加载中…')}</p>}
      {!loading && items.length === 0 && (
        <p className="text-[13px] text-muted-foreground">{t('No responses yet.', '暂无回复。')}</p>
      )}

      {items.map(item => (
        <Card key={item.merchant_id} className="p-4 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-[15px] text-primary">
              {item.shop_name ?? t('Deleted shop', '已删除的店铺')}
            </span>
            {item.shop_slug && (
              <span className="text-[12px] text-muted-foreground">/s/{item.shop_slug}</span>
            )}
            <span className="ml-auto text-[12px] text-muted-foreground">
              {item.responded_at ? formatDate(item.responded_at) : ''}
            </span>
          </div>

          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map(n => (
              <Star
                key={n}
                size={16}
                strokeWidth={1.75}
                className={(item.rating ?? 0) >= n ? 'fill-primary text-primary' : 'text-muted-foreground'}
              />
            ))}
          </div>

          {item.comment && <p className="text-[14px] text-foreground whitespace-pre-wrap">{item.comment}</p>}
        </Card>
      ))}
    </div>
  )
}
