import { useEffect, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import type { FeedbackStatus } from '@bitetime/shared'
import { Paperclip } from 'lucide-react'
import { useSession } from '../SessionContext'
import { fetchAdminFeedback, setFeedbackStatus } from '../store'
import type { FeedbackItem, Lang, Translate } from '../types'
import { SkeletonText } from '../components/Loaders'
import { DataTable, SortableHeader } from '@/components/ui/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CATEGORY_LABELS, formatFeedbackDate } from './feedbackLabels'
import FeedbackDetailSheet from './FeedbackDetailSheet'

// Language rides on table.options.meta so the column defs stay stable (defined once) and
// never reset sorting when the list refetches — same convention as OrdersView.
interface FeedbackTableMeta {
  t: Translate
  lang: Lang
}

const columns: ColumnDef<FeedbackItem>[] = [
  {
    id: 'shop',
    accessorFn: row => `${row.shop_name ?? ''} ${row.shop_slug ?? ''}`,
    header: ({ column, table }) => (
      <SortableHeader column={column} label={(table.options.meta as FeedbackTableMeta).t('Shop', '店铺')} />
    ),
    cell: ({ row, table }) => {
      const { t } = table.options.meta as FeedbackTableMeta
      const item = row.original
      return (
        <div className="min-w-[120px]">
          <div className="font-heading text-[14px] font-medium text-primary">
            {item.shop_name ?? t('Deleted shop', '已删除的店铺')}
          </div>
          {item.shop_slug && (
            <div className="text-[12px] text-muted-foreground">/s/{item.shop_slug}</div>
          )}
        </div>
      )
    },
  },
  {
    accessorKey: 'category',
    enableSorting: false,
    header: ({ table }) => <span>{(table.options.meta as FeedbackTableMeta).t('Type', '类型')}</span>,
    cell: ({ row, table }) => {
      const { t } = table.options.meta as FeedbackTableMeta
      const label = CATEGORY_LABELS[row.original.category]
      return <Badge variant={label.variant}>{t(label.en, label.zh)}</Badge>
    },
  },
  {
    accessorKey: 'message',
    enableSorting: false,
    header: ({ table }) => <span>{(table.options.meta as FeedbackTableMeta).t('Message', '内容')}</span>,
    // One line, clipped. The whole message is what the drawer is for; a wrapped paragraph here
    // makes row height depend on how much a merchant typed, which is what the old card list did.
    //
    // The screenshot count rides in this cell rather than a column of its own. A column of its
    // own is empty on most rows and still costs its width — and the width is what decides
    // whether STATUS is on screen or past the table's right edge (the table scrolls sideways
    // inside the card, so a column pushed off is a column nobody sees).
    cell: ({ row, table }) => {
      const { t } = table.options.meta as FeedbackTableMeta
      const shots = row.original.image_paths.length
      return (
        <div className="flex items-center gap-2 max-w-[340px]">
          <span className="truncate text-foreground">{row.original.message}</span>
          {shots > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground"
              title={t('Screenshots', '截图')}
            >
              <Paperclip className="size-3.5" aria-hidden="true" />
              {shots}
            </span>
          )}
        </div>
      )
    },
  },
  {
    id: 'issue',
    accessorFn: row => (row.github_issue_number ? `#${row.github_issue_number}` : ''),
    enableSorting: false,
    header: ({ table }) => <span>{(table.options.meta as FeedbackTableMeta).t('Issue', 'Issue')}</span>,
    // Plain text, not a link: the row itself is a button, and a link inside it either swallows
    // the row click or opens two things at once. The drawer carries the real link.
    cell: ({ row }) => (
      <span className="text-[12px] text-muted-foreground tabular-nums">
        {row.original.github_issue_number ? `#${row.original.github_issue_number}` : '—'}
      </span>
    ),
  },
  {
    accessorKey: 'created_at',
    header: ({ column, table }) => (
      <SortableHeader column={column} label={(table.options.meta as FeedbackTableMeta).t('Received', '收到时间')} />
    ),
    cell: ({ row, table }) => {
      const { lang } = table.options.meta as FeedbackTableMeta
      return (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatFeedbackDate(row.original.created_at, lang)}
        </span>
      )
    },
  },
  {
    accessorKey: 'status',
    enableSorting: false,
    header: ({ table }) => <span>{(table.options.meta as FeedbackTableMeta).t('Status', '状态')}</span>,
    cell: ({ row, table }) => {
      const { t } = table.options.meta as FeedbackTableMeta
      return row.original.status === 'open'
        ? <Badge variant="warn">{t('Open', '未处理')}</Badge>
        : <Badge variant="success">{t('Resolved', '已处理')}</Badge>
    },
  },
]

/**
 * The superadmin's feedback inbox (#89). A listing, newest-first, with an open-only filter;
 * a row opens the report in a drawer (FeedbackDetailSheet), which is where the message, the
 * screenshots and the resolve button live.
 *
 * Deliberately not a ticket system: no assignment, no threading, no reply. If it grows one,
 * that is a separate decision.
 */
export default function AdminFeedback() {
  const { t, lang } = useSession()
  const [openOnly, setOpenOnly] = useState(true)
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [selected, setSelected] = useState<FeedbackItem | null>(null)
  const [busy, setBusy] = useState(false)
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
    setBusy(true)
    const next: FeedbackStatus = item.status === 'open' ? 'resolved' : 'open'
    const r = await setFeedbackStatus(item.id, next)
    setBusy(false)
    if (!r.ok) {
      setError(r.error.message || t('Could not update feedback', '无法更新反馈'))
      return
    }
    const updated = r.data
    // Filtering to open means a resolved row no longer belongs in the list. The drawer stays
    // open on it either way — the admin who just resolved it is the one reading it, and a
    // drawer that vanished under them would read as a lost report rather than a filtered one.
    setItems(prev => openOnly && next === 'resolved'
      ? prev.filter(row => row.id !== item.id)
      : prev.map(row => (row.id === item.id ? { ...row, ...updated } : row)))
    setSelected(prev => (prev && prev.id === item.id ? { ...prev, ...updated } : prev))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-[20px] text-primary">{t('Feedback', '反馈')}</h2>
      </div>

      {error && <p className="text-[13px] text-danger-fg">{error}</p>}

      {/* The card ground under the table, spelled the way every other dashboard table spells it
          (OrdersView, AdminReleases): on the page's cream the rows read as one flat block. */}
      <div className="bg-card border-[0.5px] border-border rounded-2xl p-5 w-full box-border">
        {loading ? (
          <SkeletonText lines={4} />
        ) : (
          <DataTable
            columns={columns}
            data={items}
            meta={{ t, lang } satisfies FeedbackTableMeta}
            onRowClick={setSelected}
            searchPlaceholder={t('Search feedback…', '搜索反馈…')}
            emptyText={openOnly
              ? t('No open feedback.', '没有未处理的反馈。')
              : t('No feedback yet.', '还没有反馈。')}
            prevLabel={t('Previous', '上一页')}
            nextLabel={t('Next', '下一页')}
            pageSize={15}
            toolbar={
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setLoading(true); setError(''); setOpenOnly(v => !v) }}
              >
                {openOnly ? t('Show all', '显示全部') : t('Show open only', '仅显示未处理')}
              </Button>
            }
          />
        )}
      </div>

      <FeedbackDetailSheet
        item={selected}
        onClose={() => setSelected(null)}
        onToggleStatus={item => void toggle(item)}
        busy={busy}
      />
    </div>
  )
}
