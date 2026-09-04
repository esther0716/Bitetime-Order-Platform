import { useSession } from '../../SessionContext'
import { fmtDate, fmtTime } from '../../merchantDate'
import DrawerCard from './DrawerCard'
import { orderEventLine } from './orderEventLine'
import type { OrderEvent } from '@bitetime/shared'
import type { Order } from '../../types'

/**
 * The order log (#268) — what happened to this order, oldest first, grouped by day. Read-only,
 * always: the log is written by the backend with the action that caused it (ADR 0025), and the
 * merchant can neither edit nor clear it.
 *
 * An order placed before the log has no `created` event. Its first line is read off the order's
 * own `created_at` — a fact the row already holds, not an invented event — and a muted line says
 * that nothing before the log began was recorded. `events` is null while the log is loading and
 * `'failed'` when the read did not come back — shown as its own line, because an empty log and
 * a log that could not be read look identical and only one of them is true (ADR 0025).
 */
export default function LogCard({ order, events }: { order: Order; events: OrderEvent[] | null | 'failed' }) {
  const { t } = useSession()

  const loaded = Array.isArray(events) ? events : null
  const hasCreated = loaded?.some(e => e.kind === 'created') ?? true
  const lines: { key: string; at: string; text: string; muted?: boolean }[] = []
  if (loaded && !hasCreated && order.created_at) {
    lines.push({ key: 'placed', at: order.created_at, text: t('Order placed', '已下单') })
    lines.push({ key: 'gap', at: order.created_at, text: t('Changes before the log began were not recorded', '日志开始前的变更未被记录'), muted: true })
  }
  for (const e of loaded ?? []) lines.push({ key: e.id, at: e.created_at, text: orderEventLine(e, t) })

  // Group by calendar day, in the merchant's own locale like every other dashboard date.
  const days: { day: string; lines: typeof lines }[] = []
  for (const l of lines) {
    const day = fmtDate(l.at)
    const last = days[days.length - 1]
    if (last && last.day === day) last.lines.push(l)
    else days.push({ day, lines: [l] })
  }

  return (
    <DrawerCard title={t('Log', '日志')}>
      {events === null ? (
        <p className="text-[13px] text-muted-foreground">{t('Loading…', '加载中…')}</p>
      ) : events === 'failed' ? (
        <p className="text-[13px] text-danger">{t('Could not load the log.', '无法加载日志。')}</p>
      ) : days.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t('Nothing recorded yet.', '尚无记录。')}</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {days.map(d => (
            <li key={d.day} className="flex flex-col gap-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{d.day}</div>
              <ul className="flex flex-col gap-1">
                {d.lines.map(l => (
                  <li key={l.key} className="flex gap-2.5 text-[13px]">
                    <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground w-[4.6em]">{l.muted ? '' : fmtTime(l.at)}</span>
                    <span className={l.muted ? 'text-muted-foreground italic' : 'text-foreground'}>{l.text}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </DrawerCard>
  )
}
