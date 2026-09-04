import { ReceiptText, ImageUp, ArrowRightCircle, StickyNote, Truck, Hash, Ticket, TicketX } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSession } from '../../SessionContext'
import { cn } from '@/lib/utils'
import { fmtDate, fmtTime } from '../../merchantDate'
import DrawerCard from './DrawerCard'
import { orderEventLine } from './orderEventLine'
import type { OrderEvent, OrderEventKind } from '@bitetime/shared'
import type { Order } from '../../types'

// One icon per kind, so a merchant scanning the rail can tell a status move from a proof
// landing without reading. Exhaustive: a kind without an icon fails the build here, the same
// way one without a sentence fails in orderEventLine.ts.
const ICON: Record<OrderEventKind, LucideIcon> = {
  created: ReceiptText,
  payment_proof_uploaded: ImageUp,
  merchant_payment_proof_uploaded: ImageUp,
  status_changed: ArrowRightCircle,
  note_changed: StickyNote,
  courier_changed: Truck,
  awb_changed: Hash,
  voucher_released: TicketX,
  voucher_restored: Ticket,
}

type Line =
  | { key: string; day: string; time: string; text: string; icon: LucideIcon }
  | { key: string; day: string; gap: true; text: string }

/**
 * The order log (#268) as a vertical timeline — what happened to this order, oldest first, one
 * node per event on a rail, with the day marked where it changes. Read-only, always: the log is
 * written by the backend with the action that caused it (ADR 0025), and the merchant can neither
 * edit nor clear it. Same node vocabulary as the storefront's `OrderTimeline` (size-7 pill, the
 * live one filled), so the two surfaces read as the same thing seen from two sides.
 *
 * An order placed before the log has no `created` event. Its first node is read off the order's
 * own `created_at` — a fact the row already holds, not an invented event — followed by a muted
 * line saying nothing before the log began was recorded. `events` is null while the log is
 * loading and `'failed'` when the read did not come back — shown as its own line, because an
 * empty log and a log that could not be read look identical and only one of them is true.
 */
export default function LogCard({ order, events }: { order: Order; events: OrderEvent[] | null | 'failed' }) {
  const { t } = useSession()

  const loaded = Array.isArray(events) ? events : null
  const hasCreated = loaded?.some(e => e.kind === 'created') ?? true
  const lines: Line[] = []
  if (loaded && !hasCreated && order.created_at) {
    const day = fmtDate(order.created_at)
    lines.push({ key: 'placed', day, time: fmtTime(order.created_at), text: t('Order placed', '已下单'), icon: ReceiptText })
    lines.push({ key: 'gap', day, gap: true, text: t('Changes before the log began were not recorded', '日志开始前的变更未被记录') })
  }
  for (const e of loaded ?? []) {
    lines.push({ key: e.id, day: fmtDate(e.created_at), time: fmtTime(e.created_at), text: orderEventLine(e, t), icon: ICON[e.kind] })
  }
  const lastKey = [...lines].reverse().find(l => !('gap' in l))?.key

  // One rail per day. A day heading is plain text across the card, and the rail below it runs
  // from the first node's centre to the last's — so the line never has to pass "through" a
  // heading, which is what made the earlier single rail read as detached from its nodes.
  const days: { day: string; lines: Line[] }[] = []
  for (const l of lines) {
    const last = days[days.length - 1]
    if (last && last.day === l.day) last.lines.push(l)
    else days.push({ day: l.day, lines: [l] })
  }

  return (
    <DrawerCard title={t('Log', '日志')}>
      {events === null ? (
        <p className="text-[13px] text-muted-foreground">{t('Loading…', '加载中…')}</p>
      ) : events === 'failed' ? (
        <p className="text-[13px] text-danger">{t('Could not load the log.', '无法加载日志。')}</p>
      ) : lines.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t('Nothing recorded yet.', '尚无记录。')}</p>
      ) : (
        <div className="flex flex-col gap-3" aria-label={t('Order log', '订单日志')}>
          {days.map(d => (
            <section key={d.day} className="flex flex-col gap-1">
              {/* Lighter than the card's own LBL caption — a day is a divider inside the log,
                  not a second title beside "Log". */}
              <h4 className="text-[11px] font-medium text-muted-foreground">{d.day}</h4>
              <ol className="flex flex-col">
                {d.lines.map((l, i) => (
                  <li key={l.key} className="relative flex items-start gap-3 py-1.5">
                    {/* The rail, one segment per row, drawn behind the size-7 (28px) nodes at
                        their horizontal centre (13.5px). A node's segment starts at its own
                        centre (6px row padding + 14px) and runs 20px past the row's bottom to
                        the NEXT node's centre; a gap row's runs straight through. The last row
                        draws none, so the rail ends on a node and never dangles into space. */}
                    {i < d.lines.length - 1 && (
                      <span
                        aria-hidden
                        className={cn(
                          'absolute left-[13.5px] -bottom-5 w-px',
                          'gap' in l ? 'top-0' : 'top-5',
                          // Dashed into the "not recorded" row — the storefront tracker's idiom
                          // for a stretch the data does not cover.
                          'gap' in d.lines[i + 1] ? 'border-l border-dashed border-border' : 'bg-border',
                        )}
                      />
                    )}
                    {'gap' in l ? (
                      <>
                        <span aria-hidden className="size-7 shrink-0" />
                        <span className="min-w-0 flex-1 pt-1 text-[13px] italic text-muted-foreground">{l.text}</span>
                      </>
                    ) : (
                      <>
                        <span
                          className={cn(
                            'relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-pill',
                            l.key === lastKey
                              ? 'bg-primary text-primary-foreground ring-4 ring-primary/15'
                              : 'border-[0.5px] border-border bg-card text-ink-400',
                          )}
                        >
                          <l.icon className="size-[15px]" strokeWidth={2} />
                        </span>
                        <span className={cn('min-w-0 flex-1 pt-1.5 text-[13px] text-foreground', l.key === lastKey && 'font-medium')}>
                          {l.text}
                        </span>
                        <span className="shrink-0 whitespace-nowrap pt-1.5 text-[12px] tabular-nums text-muted-foreground">{l.time}</span>
                      </>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </DrawerCard>
  )
}
