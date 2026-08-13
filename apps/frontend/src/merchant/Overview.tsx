import { useEffect, useState } from 'react'
import { ReceiptText, Wallet, Users, TrendingUp, Download, Lock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useSession } from '../SessionContext'
import { fetchMerchantStats, downloadRevenueReport } from '../store'
import { SkeletonText } from '../components/Loaders'
import { StatCard, ChartPanel, RevenueBarChart, DonutCard, BreakdownList } from '../components/charts/DashCharts'
import { granularityFor, REVENUE_RANGES, type Granularity, type MerchantStats, type RevenueRange } from '@bitetime/shared'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { formatMoney } from '../currency'
import ShareStorefront from './ShareStorefront'
import ShopAssistant from './ShopAssistant'

const STAT_ICON = { size: 15, strokeWidth: 1.75 }


function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-pill border-[0.5px] px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
        active
          ? 'border-primary bg-primary text-background'
          : 'border-border bg-transparent text-muted-foreground hover:text-primary',
      )}
    >
      {children}
    </button>
  )
}

/** The revenue export, as a button on the panel it exports. */
function DownloadReport({ days, granularity }: { days: number; granularity: Granularity }) {
  const { t, merchant } = useSession()
  const [busy, setBusy] = useState(false)

  async function download() {
    if (!merchant?.id) return
    setBusy(true)
    const r = await downloadRevenueReport(merchant.id, { days, granularity })
    setBusy(false)
    if (!r.ok) {
      toast.error(r.error.message || t('Could not build the report', '无法生成报表'))
      return
    }
    // The anchor has to be IN the document for a programmatic click to download in Firefox, and
    // the object URL has to outlive the click — revoking it synchronously can race the browser's
    // own fetch of the blob and produce an empty file.
    const url = URL.createObjectURL(r.data.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = r.data.filename ?? `revenue-${days}d.xlsx`
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  // Icon-only, and built from the same geometry as the Pill above rather than from `Button`:
  // the shared button's smallest size is px-[18px] py-[10px], which next to 11px pills reads as
  // the panel's primary action when it is a quiet affordance on a chart header.
  //
  // The words the icon drops live in the tooltip and in `aria-label`.
  const label = t('Download revenue report', '下载营收报表')
  const hint = busy ? t('Preparing…', '生成中…') : label

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="none"
            aria-label={label}
            disabled={busy}
            onClick={download}
            className={cn(
              'rounded-pill p-1.5',
              'hover:border-primary hover:bg-transparent hover:text-primary',
              'disabled:cursor-default disabled:hover:border-border disabled:hover:text-muted-foreground',
            )}
          />
        }
      >
        {busy
          ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
          : <Download size={14} strokeWidth={1.75} />}
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}

export default function Overview() {
  const { t, merchant } = useSession()
  const [stats, setStats] = useState<MerchantStats | null>(null)
  const [failed, setFailed] = useState(false)
  const [rangeDays, setRangeDays] = useState<RevenueRange>(12)
  // null = follow the default for the range. A merchant who picks a granularity keeps it
  // across range changes: they asked for daily 60 days, so switching to 90 shouldn't
  // silently re-bucket behind them.
  const [granularityChoice, setGranularityChoice] = useState<Granularity | null>(null)
  const granularity = granularityChoice ?? granularityFor(rangeDays)
  // Aggregates render in the merchant's current currency — safe because currency
  // is locked once ≥1 order exists, so totals never mix units.
  const money = (n: number) => formatMoney(n, merchant?.currency)

  // Every figure here is now computed by the backend, over the shop's WHOLE order history — the
  // browser used to fetch the orders and aggregate them itself, which meant the chart was only
  // ever as complete as PostgREST's row cap allowed and said nothing when it wasn't (#144).
  //
  // So a range or granularity switch is a REFETCH, not a recompute: the orders it would recompute
  // from are no longer here, and shipping them back just to re-bucket them is the thing this
  // change exists to stop.
  //
  // The shop's own zone still decides which day an order falls on — the backend resolves it from
  // `merchants.timezone`, so a merchant reading their chart abroad sees their shop's days.
  useEffect(() => {
    const id = merchant?.id
    if (!id) return
    let active = true
    fetchMerchantStats(id, { days: rangeDays, granularity }).then(r => {
      if (!active) return
      // A could-not-ask must NOT render as zeroes. Collapsing failure to empty is exactly how a
      // merchant comes to trust a revenue figure that isn't one, which is the defect behind #144
      // — the row cap was only how it happened.
      if (!r.ok) { setFailed(true); return }
      setFailed(false)
      setStats(r.data)
    })
    return () => { active = false }
  }, [merchant?.id, rangeDays, granularity])

  const statusLabel = (s: string) => ({
    new: t('New', '新订单'), preparing: t('Preparing', '准备中'), ready: t('Ready', '待取'),
    completed: t('Completed', '已完成'), cancelled: t('Cancelled', '已取消'),
  } as Record<string, string>)[s] ?? s

  // Said out loud rather than drawn as an empty chart: a merchant reading zeroes has no way to
  // tell "no sales" from "we could not ask".
  if (failed) return (
    <div className="flex flex-col gap-5">
      <ShareStorefront />
      <div className="rounded-xl border-[0.5px] border-border bg-card px-5 py-6 text-center text-sm text-muted-foreground">
        {t('Could not load your figures. Try again in a moment.', '无法加载数据，请稍后再试。')}
      </div>
    </div>
  )

  if (!stats) return (
    <div className="flex flex-col gap-5">
      <ShareStorefront />
      <div className="grid grid-cols-4 gap-[10px] max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border-[0.5px] border-border bg-card px-5 py-4"><SkeletonText lines={2} /></div>
        ))}
      </div>
      <div className="rounded-xl border-[0.5px] border-border bg-card px-5 py-4"><SkeletonText lines={6} /></div>
    </div>
  )

  return (
    <div className="flex flex-col gap-5">
      <ShareStorefront />
      <div className="grid grid-cols-4 gap-[10px] max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
        <StatCard label={t('Total orders', '总订单')} value={String(stats.totalOrders)} delta={stats.ordersDelta} icon={<ReceiptText {...STAT_ICON} />} />
        <StatCard label={t('Revenue', '营收')} value={money(stats.revenue)} delta={stats.revenueDelta} icon={<Wallet {...STAT_ICON} />} />
        <StatCard label={t('Customers', '顾客')} value={String(stats.customerCount)} icon={<Users {...STAT_ICON} />} />
        <StatCard label={t('Avg order', '平均订单')} value={money(stats.avgOrder)} icon={<TrendingUp {...STAT_ICON} />} />
      </div>

      <ChartPanel
        title={t(`Revenue — last ${rangeDays} days`, `营收 — 近${rangeDays}天`)}
        legend={
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
            <div className="flex gap-1" role="group" aria-label={t('Chart range', '图表时间范围')}>
              {REVENUE_RANGES.map(d => (
                <Pill key={d} active={rangeDays === d} onClick={() => setRangeDays(d)}>
                  {t(`${d}d`, `${d}天`)}
                </Pill>
              ))}
            </div>
            <div className="flex gap-1" role="group" aria-label={t('Chart detail', '图表粒度')}>
              <Pill active={granularity === 'day'} onClick={() => setGranularityChoice('day')}>
                {t('Daily', '每日')}
              </Pill>
              <Pill active={granularity === 'week'} onClick={() => setGranularityChoice('week')}>
                {t('Weekly', '每周')}
              </Pill>
            </div>
            <DownloadReport days={rangeDays} granularity={granularity} />
          </div>
        }
      >
        <RevenueBarChart data={stats.series} revenueLabel={t('Revenue', '营收')} ordersLabel={t('Orders', '订单')} />
      </ChartPanel>

      {/* Both panels cover the range picked above, so both say so — the pills live on the
          revenue chart, and without the label these read as all-time figures beside it. */}
      <div className="grid grid-cols-2 gap-5 max-[900px]:grid-cols-1">
        <ChartPanel title={t(`Revenue by product — last ${rangeDays} days`, `产品营收 — 近${rangeDays}天`)}>
          <DonutCard data={stats.productRevenue} />
        </ChartPanel>
        <ChartPanel title={t(`Orders by status — last ${rangeDays} days`, `订单状态 — 近${rangeDays}天`)}>
          <BreakdownList rows={stats.statusBreakdown.map(s => ({ label: statusLabel(s.status), value: String(s.count), pct: s.pct }))} />
        </ChartPanel>
      </div>

      {/* Under the figures, not above them. The charts are the primary surface; this is a
          shortcut through them for a merchant who would otherwise pick a range, read a bar, and
          do the comparison in their head. */}
      <ShopAssistant />
    </div>
  )
}
