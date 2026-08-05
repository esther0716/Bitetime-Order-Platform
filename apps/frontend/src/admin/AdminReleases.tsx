import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  adminPullReleases, adminListReleases, adminSetReleaseStatus, adminRegenerateRelease,
} from '../store'
import { unwrap } from '../api'
import { useSession } from '../SessionContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { AdminRelease } from '../types'

export default function AdminReleases() {
  const { t } = useSession()
  const [rows, setRows] = useState<AdminRelease[] | null>(null)
  const [pulling, setPulling] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

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

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-heading text-ink">{t('Releases', '更新日志')}</h2>
        <Button variant="default" size="sm" onClick={pull} disabled={pulling}>
          {pulling ? t('Pulling…', '拉取中…') : t('Pull releases from GitHub', '从 GitHub 拉取更新')}
        </Button>
      </div>
      {rows === null ? (
        <p className="text-[13px] text-rose-muted">{t('Loading…', '加载中…')}</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-rose-muted">{t('No releases pulled yet', '尚未拉取任何更新')}</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-rose-muted border-b border-divider">
              <th className="py-2 pr-3">{t('Tag', '版本')}</th>
              <th className="py-2 pr-3">{t('Title', '标题')}</th>
              <th className="py-2 pr-3">{t('Status', '状态')}</th>
              <th className="py-2 pr-3">{t('Published', '发布时间')}</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-divider">
                <td className="py-2 pr-3">{row.tag}</td>
                <td className="py-2 pr-3">
                  {row.title ?? row.name}
                  {row.humanize_error && (
                    <div className="text-[11px] text-danger-fg mt-0.5">{row.humanize_error}</div>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <Badge variant={row.status === 'published' ? 'success' : 'outline'}>
                    {row.status === 'published' ? t('Published', '已发布') : t('Draft', '草稿')}
                  </Badge>
                </td>
                <td className="py-2 pr-3">{new Date(row.published_at).toLocaleDateString()}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  <Button
                    variant="outline" size="sm" className="mr-2"
                    disabled={busy === row.id}
                    onClick={() => regenerate(row)}
                  >
                    {t('Regenerate', '重新生成')}
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={busy === row.id || !row.title}
                    onClick={() => togglePublish(row)}
                  >
                    {row.status === 'published' ? t('Unpublish', '取消发布') : t('Publish', '发布')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
