import { useEffect, useMemo, useState } from 'react'
import { ReceiptText, Wallet, Users, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Order, Product, Voucher } from '../types'
import { useSession } from '../SessionContext'
import { fetchMerchantOrders, lookupProducts, fetchMerchantCustomers, fetchMerchantVouchers } from '../store'
import { SkeletonText } from '../components/Loaders'
import { StatCard, ChartPanel, RevenueBarChart, DonutCard, BreakdownList } from '../components/charts/DashCharts'
import { computeMerchantStats, granularityFor, type Granularity } from './overviewStats'
import { formatMoney } from '../currency'
import ShareStorefront from './ShareStorefront'

const STAT_ICON = { size: 15, strokeWidth: 1.75 }

const REVENUE_RANGES = [12, 30, 60, 90] as const
type RevenueRange = (typeof REVENUE_RANGES)[number]

type OverviewRows = {
  orders: Order[]
  products: Product[]
  customers: { orderCount?: number }[]
  vouchers: Voucher[]
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border-[1.5px] px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
        active
          ? 'border-oxblood bg-oxblood text-cream'
          : 'border-rose-border bg-transparent text-text-tertiary hover:text-oxblood',
      )}
    >
      {children}
    </button>
  )
}

export default function Overview() {
  const { t, merchant } = useSession()
  const [rows, setRows] = useState<OverviewRows | null>(null)
  const [rangeDays, setRangeDays] = useState<RevenueRange>(12)
  // null = follow the default for the range. A merchant who picks a granularity keeps it
  // across range changes: they asked for daily 60 days, so switching to 90 shouldn't
  // silently re-bucket behind them.
  const [granularityChoice, setGranularityChoice] = useState<Granularity | null>(null)
  const granularity = granularityChoice ?? granularityFor(rangeDays)
  // Aggregates render in the merchant's current currency — safe because currency
  // is locked once ≥1 order exists, so totals never mix units.
  const money = (n: number) => formatMoney(n, merchant?.currency)

  useEffect(() => {
    const id = merchant?.id
    if (!id) return
    let active = true
    Promise.all([
      // All four are on the Result convention (#122); this stats panel only displays, so it
      // collapses could-not-ask to `[]` at the call site.
      fetchMerchantOrders(id).then(r => (r.ok ? r.data : [])),
      lookupProducts(id).then(r => (r.ok ? r.data : [])),
      fetchMerchantCustomers(id).then(r => (r.ok ? r.data : [])),
      fetchMerchantVouchers(id).then(r => (r.ok ? r.data : [])),
    ]).then(([orders, products, customers, vouchers]) => {
      if (active) setRows({ orders, products, customers, vouchers })
    })
    return () => { active = false }
  }, [merchant?.id])

  // Range and granularity switches recompute from the rows already in hand — no refetch.
  const stats = useMemo(
    () => rows && computeMerchantStats(rows.orders, rows.products, rows.customers, rows.vouchers, new Date(), { days: rangeDays, granularity }),
    [rows, rangeDays, granularity],
  )

  const statusLabel = (s: string) => ({
    new: t('New', '新订单'), preparing: t('Preparing', '准备中'), ready: t('Ready', '待取'),
    completed: t('Completed', '已完成'), cancelled: t('Cancelled', '已取消'),
  } as Record<string, string>)[s] ?? s

  if (!stats) return (
    <div className="flex flex-col gap-5">
      <ShareStorefront />
      <div className="grid grid-cols-4 gap-[10px] max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border-[1.5px] border-rose-border bg-surface-raised px-5 py-4"><SkeletonText lines={2} /></div>
        ))}
      </div>
      <div className="rounded-xl border-[1.5px] border-rose-border bg-surface-raised px-5 py-4"><SkeletonText lines={6} /></div>
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
          </div>
        }
      >
        <RevenueBarChart data={stats.series} revenueLabel={t('Revenue', '营收')} ordersLabel={t('Orders', '订单')} />
      </ChartPanel>

      <div className="grid grid-cols-2 gap-5 max-[900px]:grid-cols-1">
        <ChartPanel title={t('Revenue by product', '产品营收')}>
          <DonutCard data={stats.productRevenue} />
        </ChartPanel>
        <ChartPanel title={t('Orders by status', '订单状态')}>
          <BreakdownList rows={stats.statusBreakdown.map(s => ({ label: statusLabel(s.status), value: String(s.count), pct: s.pct }))} />
        </ChartPanel>
      </div>
    </div>
  )
}
