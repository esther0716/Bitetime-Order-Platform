import { useEffect, useState } from 'react'
import type { FeedbackCategory, FeedbackStatus } from '@bitetime/shared'
import { useSession } from '../SessionContext'
import { fetchAdminFeedback, setFeedbackStatus, fetchFeedbackImage } from '../store'
import type { FeedbackItem } from '../types'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'

// Record<FeedbackCategory, …>, not Record<string, …> — same reasoning as FeedbackFab's
// CATEGORY_LABELS: a fifth category upstream should be a compile error here too, not a
// silent raw-key fallback. Wording is intentionally different (admin-facing vs
// merchant-facing); only the type is shared.
const CATEGORY_LABELS: Record<FeedbackCategory, { en: string; zh: string }> = {
  bug:     { en: 'Broken',  zh: '故障' },
  feature: { en: 'Request', zh: '建议' },
  billing: { en: 'Billing', zh: '账单' },
  other:   { en: 'Other',   zh: '其他' },
}

/**
 * The superadmin's feedback inbox (#89). Newest-first, with an open-only filter and one
 * button per row to flip open ↔ resolved. Deliberately not a ticket system: no assignment,
 * no threading, no reply. If it grows one, that is a separate decision.
 */
export default function AdminFeedback() {
  const { t, lang } = useSession()
  const [openOnly, setOpenOnly] = useState(true)
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // react-hooks/set-state-in-effect forbids a setState reachable synchronously from an
  // effect body (even through a locally-defined function) — so unlike the rest of this
  // component's calls, every setState here rides a .then/.catch/.finally callback, never
  // the synchronous top of the effect. The "loading" / "error" resets for a *user-driven*
  // refetch happen in the filter button's onClick instead (an event handler, not an effect).
  useEffect(() => {
    let cancelled = false
    fetchAdminFeedback(openOnly ? 'open' : undefined)
      .then(r => {
        if (cancelled) return
        if (r.ok) { setItems(r.data); setError('') }
        else setError(r.error.message || t('Could not load feedback', '无法加载反馈'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [openOnly, t])

  const toggle = async (item: FeedbackItem) => {
    const next: FeedbackStatus = item.status === 'open' ? 'resolved' : 'open'
    const r = await setFeedbackStatus(item.id, next)
    if (!r.ok) {
      setError(r.error.message || t('Could not update feedback', '无法更新反馈'))
      return
    }
    const updated = r.data
    // Filtering to open means a resolved row no longer belongs in the list.
    setItems(prev => openOnly && next === 'resolved'
      ? prev.filter(row => row.id !== item.id)
      : prev.map(row => (row.id === item.id ? { ...row, ...updated } : row)))
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-MY', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-[20px] text-oxblood">{t('Feedback', '反馈')}</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setLoading(true); setError(''); setOpenOnly(v => !v) }}
        >
          {openOnly ? t('Show all', '显示全部') : t('Show open only', '仅显示未处理')}
        </Button>
      </div>

      {error && <p className="text-[13px] text-danger-fg">{error}</p>}
      {loading && <p className="text-[13px] text-text-tertiary">{t('Loading…', '加载中…')}</p>}

      {!loading && items.length === 0 && (
        <p className="text-[13px] text-text-tertiary">
          {openOnly
            ? t('No open feedback.', '没有未处理的反馈。')
            : t('No feedback yet.', '还没有反馈。')}
        </p>
      )}

      {items.map(item => (
        <Card key={item.id} className="p-4 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-[15px] text-oxblood">
              {item.shop_name ?? t('Deleted shop', '已删除的店铺')}
            </span>
            {item.shop_slug && (
              <span className="text-[12px] text-text-tertiary">/s/{item.shop_slug}</span>
            )}
            <Badge variant="secondary">
              {t(CATEGORY_LABELS[item.category].en, CATEGORY_LABELS[item.category].zh)}
            </Badge>
            {item.status === 'resolved' && (
              <Badge variant="outline">{t('Resolved', '已处理')}</Badge>
            )}
            <span className="ml-auto text-[12px] text-text-tertiary">{formatDate(item.created_at)}</span>
          </div>

          {item.github_issue_url && (
            <a
              href={item.github_issue_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-oxblood underline w-fit"
            >
              {t('View issue', '查看 Issue')} #{item.github_issue_number} ↗
            </a>
          )}

          <p className="text-[14px] text-ink whitespace-pre-wrap">{item.message}</p>

          <FeedbackImages item={item} />

          <div>
            <Button variant="outline" size="sm" onClick={() => void toggle(item)}>
              {item.status === 'open' ? t('Resolve', '标记已处理') : t('Reopen', '重新打开')}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  )
}

/**
 * The screenshots on one feedback row. Its own component so the object-URL lifecycle belongs
 * to something that unmounts when the row leaves the list — filtering to open-only removes
 * rows, and a leaked blob per removed row adds up across a triage session.
 *
 * These are AUTHENTICATED fetches, not <img src="…"> against a URL: the `feedback-images`
 * bucket is private with no storage policies, so the bytes only exist behind
 * GET /api/admin/feedback/:feedbackId/images/:index.
 */
function FeedbackImages({ item }: { item: FeedbackItem }) {
  const { t } = useSession()
  // `null` is "still fetching"; an array is the settled answer, however many of the fetches
  // actually succeeded. Deriving "loading" from `urls.length < count` instead is what made a
  // single failed fetch sit under a Loading… hint forever — a terminal state wearing a
  // transient state's label.
  const [urls, setUrls] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(0)
  // Paths never change for a given feedback id, so the COUNT plus the id is the whole of what
  // drives this — depending on the array itself would refetch every time toggle() rebuilds the
  // row object with a fresh array reference.
  const count = item.image_paths.length

  // Same react-hooks/set-state-in-effect constraint as the list effect above: setState rides a
  // .then callback, never the synchronous top of the effect body.
  useEffect(() => {
    let cancelled = false
    const created: string[] = []

    void Promise.all(Array.from({ length: count }, (_, i) => fetchFeedbackImage(item.id, i)))
      .then(results => {
        // Nothing has been created yet at this point, so an unmount here leaks nothing — the
        // cleanup below only ever has to revoke what this branch went on to make.
        if (cancelled) return
        for (const r of results) if (r.ok) created.push(URL.createObjectURL(r.data))
        setUrls(created)
        setFailed(results.filter(r => !r.ok).length)
      })

    return () => {
      cancelled = true
      for (const u of created) URL.revokeObjectURL(u)
    }
  }, [item.id, count])

  if (count === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {(urls ?? []).map((url, i) => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer">
          <img
            src={url}
            alt={t(`Screenshot ${i + 1}`, `截图 ${i + 1}`)}
            className="h-20 w-20 rounded object-cover border border-border"
          />
        </a>
      ))}
      {urls === null && (
        <span className="self-center text-[12px] text-text-tertiary">
          {t('Loading screenshots…', '正在加载截图…')}
        </span>
      )}
      {failed > 0 && (
        <span className="self-center text-[12px] text-danger-fg">
          {t(
            `${failed} of ${count} could not be loaded.`,
            `${count} 张截图中有 ${failed} 张无法加载。`,
          )}
        </span>
      )}
    </div>
  )
}
