// Pure aggregation for the superadmin Overview dashboard. Turns the merchant list
// into platform KPIs + chart series. No Supabase / React — unit-tested like pricing.ts.

import { BUSINESS_NATURES } from '@bitetime/shared'
import type { Merchant, MerchantStatus } from '../types'

export interface StatusSlice { status: MerchantStatus; count: number; pct: number }
export interface SignupPoint { key: string; label: string; count: number }
/** One industry bucket. `nature === null` is "never said" — every shop that signed up before
 *  the field existed, plus any that has not set one since. */
export interface IndustrySlice {
  nature: string | null
  count: number
  /** Share of ALL merchants, 0–100. */
  pct: number
  /** Bar width, 0–100 — scaled against the biggest NAMED industry, not against the platform
   *  total and not against Unspecified. See `industrySeries`. */
  bar: number
}

export interface AdminStats {
  total: number
  active: number
  pending: number
  suspended: number
  statusBreakdown: StatusSlice[]
  signups: SignupPoint[]
  /** Ranked most merchants first — the answer to "which industry are we actually serving?" (#161). */
  industries: IndustrySlice[]
  recent: Merchant[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthKey(iso?: string): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.getFullYear() * 12 + d.getMonth()
}

// Signups per calendar month for the last `months` months ending on `now`.
function signupSeries(merchants: Merchant[], now: Date, months: number): SignupPoint[] {
  const points: SignupPoint[] = []
  const index = new Map<number, SignupPoint>()
  const nowKey = now.getFullYear() * 12 + now.getMonth()
  for (let i = months - 1; i >= 0; i--) {
    const k = nowKey - i
    const p: SignupPoint = { key: String(k), label: MONTHS[((k % 12) + 12) % 12], count: 0 }
    points.push(p); index.set(k, p)
  }
  for (const m of merchants) {
    const k = monthKey(m.created_at)
    if (k == null) continue
    const p = index.get(k)
    if (p) p.count += 1
  }
  return points
}

// Merchants per industry, ranked (#161).
//
// The "never said" bucket is `null` and always sorts LAST, however large it is: it is not an
// industry, and a chart topped by "Unspecified" would answer a question nobody asked. It is
// still COUNTED — dropping those shops would quietly turn the chart into a census of a subset
// while reading as one of the whole platform.
//
// A code this build does not recognise (an older bundle against a newer database) keeps its own
// bucket rather than folding into 'other': 'other' is a real answer a merchant picked, and must
// not be inflated by rows that meant something else. Ties break by the vocabulary's own declared
// order, then alphabetically, so the chart does not reshuffle between identical loads.
function industrySeries(merchants: Merchant[]): IndustrySlice[] {
  const counts = new Map<string | null, number>()
  for (const m of merchants) {
    const nature = m.business_nature || null
    counts.set(nature, (counts.get(nature) ?? 0) + 1)
  }
  const total = merchants.length
  const declared = (nature: string | null) => {
    const i = (BUSINESS_NATURES as readonly string[]).indexOf(nature ?? '')
    return i === -1 ? BUSINESS_NATURES.length : i
  }
  const ranked = [...counts.entries()]
    .map(([nature, count]) => ({ nature, count, pct: total ? Math.round((count / total) * 100) : 0 }))
    .sort((a, b) =>
      (a.nature === null ? 1 : 0) - (b.nature === null ? 1 : 0)
      || b.count - a.count
      || declared(a.nature) - declared(b.nature)
      || String(a.nature).localeCompare(String(b.nature)))

  // Bars are scaled against the biggest NAMED industry, not the platform total and NOT
  // Unspecified. Against the total, eight industries all sit near the left edge; against
  // Unspecified — which on day one is every shop on the platform — every real industry
  // collapses to a stub beside one full bar for the bucket that answers nothing. Unspecified
  // therefore takes a full bar of its own, and its true count and share are printed beside it.
  const widest = Math.max(0, ...ranked.filter(s => s.nature !== null).map(s => s.count))
  return ranked.map(s => ({
    ...s,
    bar: s.nature === null || widest === 0 ? 100 : Math.round((s.count / widest) * 100),
  }))
}

export function computeAdminStats(merchants: Merchant[], now: Date = new Date(), months = 6): AdminStats {
  const by: Record<MerchantStatus, number> = { active: 0, pending: 0, suspended: 0 }
  for (const m of merchants) {
    if (m.status in by) by[m.status] += 1
  }
  const total = merchants.length
  const order: MerchantStatus[] = ['active', 'pending', 'suspended']
  const statusBreakdown = order
    .map(status => ({ status, count: by[status], pct: total ? Math.round((by[status] / total) * 100) : 0 }))
    .filter(s => s.count > 0)

  const recent = [...merchants]
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    .slice(0, 5)

  return {
    total,
    active: by.active,
    pending: by.pending,
    suspended: by.suspended,
    statusBreakdown,
    signups: signupSeries(merchants, now, months),
    industries: industrySeries(merchants),
    recent,
  }
}
