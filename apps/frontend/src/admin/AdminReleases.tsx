import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { MoreHorizontal } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  adminPullReleases, adminListReleases, adminSetReleaseStatus, adminRegenerateRelease,
} from '../store'
import { unwrap } from '../api'
import { useSession } from '../SessionContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, SortableHeader } from '@/components/ui/data-table'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import ReleaseSummary from '../components/ReleaseSummary'
import type { AdminRelease } from '../types'

// Handlers + language + in-flight id ride on table.options.meta so the column defs
// stay stable (defined once) and never reset sorting when a row action refetches.
interface AdminTableMeta {
  t: (en: string, zh: string) => string
  busy: string | null
  onPreview: (row: AdminRelease) => void
  onRegenerate: (row: AdminRelease) => void
  onTogglePublish: (row: AdminRelease) => void
}

const columns: ColumnDef<AdminRelease>[] = [
  {
    accessorKey: 'tag',
    header: ({ column, table }) => (
      <SortableHeader column={column} label={(table.options.meta as AdminTableMeta).t('Tag', '版本')} />
    ),
    cell: ({ row }) => <span className="font-medium">{row.original.tag}</span>,
  },
  {
    id: 'title',
    accessorFn: (r) => r.title ?? r.name,
    header: ({ column, table }) => (
      <SortableHeader column={column} label={(table.options.meta as AdminTableMeta).t('Title', '标题')} />
    ),
    cell: ({ row }) => {
      const r = row.original
      return (
        <div>
          <span>{r.title ?? r.name}</span>
          {r.humanize_error && (
            <div className="text-[11px] text-danger-fg mt-0.5">{r.humanize_error}</div>
          )}
        </div>
      )
    },
  },
  {
    accessorKey: 'status',
    header: ({ column, table }) => (
      <SortableHeader column={column} label={(table.options.meta as AdminTableMeta).t('Status', '状态')} />
    ),
    cell: ({ row, table }) => {
      const { t } = table.options.meta as AdminTableMeta
      const s = row.original.status
      return (
        <Badge variant={s === 'published' ? 'success' : 'outline'}>
          {s === 'published' ? t('Published', '已发布') : t('Draft', '草稿')}
        </Badge>
      )
    },
  },
  {
    accessorKey: 'published_at',
    header: ({ column, table }) => (
      <SortableHeader column={column} label={(table.options.meta as AdminTableMeta).t('Published', '发布时间')} />
    ),
    cell: ({ row }) => new Date(row.original.published_at).toLocaleDateString(),
  },
  {
    id: 'actions',
    header: ({ table }) => (
      <div className="text-right whitespace-nowrap">{(table.options.meta as AdminTableMeta).t('Actions', '操作')}</div>
    ),
    cell: ({ row, table }) => {
      const meta = table.options.meta as AdminTableMeta
      const { t, busy } = meta
      const r = row.original
      return (
        // Row click opens the preview (see onRowClick on DataTable below) — stop that click
        // from also firing when it lands in this cell, or opening the actions menu would
        // simultaneously pop the preview dialog underneath it.
        <div className="text-right" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="none"
                  className="size-8 p-0 rounded-full cursor-pointer hover:bg-brand-100 hover:text-primary"
                  disabled={busy === r.id}
                  aria-label={t('Actions', '操作')}
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="cursor-pointer" onClick={() => meta.onRegenerate(r)}>
                {t('Regenerate', '重新生成')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!r.title}
                className="cursor-pointer"
                onClick={() => meta.onTogglePublish(r)}
              >
                {r.status === 'published' ? t('Unpublish', '取消发布') : t('Publish', '发布')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )
    },
  },
]

export default function AdminReleases() {
  const { t } = useSession()
  const [rows, setRows] = useState<AdminRelease[] | null>(null)
  const [pulling, setPulling] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  // Lets superadmin read a draft's full title + summary before publishing — the public
  // /releases/:tag endpoint 404s on a draft by design, so this reuses the row data
  // adminListReleases already fetched rather than adding a second endpoint.
  const [previewRow, setPreviewRow] = useState<AdminRelease | null>(null)

  async function load() {
    setRows(unwrap(await adminListReleases()))
  }
  useEffect(() => {
    adminListReleases().then((r) => setRows(unwrap(r)))
  }, [])

  async function pull() {
    setPulling(true)
    const r = await adminPullReleases()
    if (r.ok) {
      toast.success(t(`Pulled ${r.data.pulled} release(s)`, `已拉取 ${r.data.pulled} 条更新`))
      await load()
    } else {
      toast.error(r.error.message || t('Pull failed', '拉取失败'))
    }
    setPulling(false)
  }

  async function togglePublish(row: AdminRelease) {
    setBusy(row.id)
    const next = row.status === 'published' ? 'draft' : 'published'
    const r = await adminSetReleaseStatus(row.id, next)
    if (r.ok) { toast.success(t('Updated', '已更新')); await load() }
    else toast.error(r.error.message || t('Could not update', '无法更新'))
    setBusy(null)
  }

  async function regenerate(row: AdminRelease) {
    setBusy(row.id)
    const r = await adminRegenerateRelease(row.id)
    if (r.ok) { toast.success(t('Regenerated', '已重新生成')); await load() }
    else toast.error(r.error.message || t('Regenerate failed', '重新生成失败'))
    setBusy(null)
  }

  const meta: AdminTableMeta = {
    t, busy,
    // Deferred a tick: opening the Dialog synchronously inside the DropdownMenuItem's onClick
    // mounts it while the menu's own closing click is still bubbling, and the Dialog's
    // outside-click listener catches that same event and closes it right back — the classic
    // Base UI/Radix overlay-inside-overlay trap. A fresh event-loop tick decouples them.
    onPreview: (row) => setTimeout(() => setPreviewRow(row), 0),
    onRegenerate: regenerate,
    onTogglePublish: togglePublish,
  }

  const data = useMemo(() => rows ?? [], [rows])

  if (!rows) return (
    <p className="text-[13px] text-muted-foreground italic pt-4">{t('Loading…', '加载中…')}</p>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-heading text-foreground">{t('Releases', '更新日志')}</h2>
        <Button variant="default" size="sm" onClick={pull} disabled={pulling}>
          {pulling ? t('Pulling…', '拉取中…') : t('Pull releases from GitHub', '从 GitHub 拉取更新')}
        </Button>
      </div>
      <div className="bg-card border-[0.5px] border-border rounded-2xl p-5 mb-8 w-full box-border">
        <DataTable
          columns={columns}
          data={data}
          meta={meta}
          onRowClick={(row) => { if (row.title) meta.onPreview(row) }}
          searchPlaceholder={t('Search releases…', '搜索更新…')}
          emptyText={t('No releases pulled yet.', '尚未拉取任何更新。')}
          prevLabel={t('Previous', '上一页')}
          nextLabel={t('Next', '下一页')}
        />
      </div>
      <Dialog open={!!previewRow} onOpenChange={(open) => { if (!open) setPreviewRow(null) }}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewRow?.title}</DialogTitle>
          </DialogHeader>
          {previewRow && <ReleaseSummary text={previewRow.summary ?? ''} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
