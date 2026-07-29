import { describe, it, expect } from 'vitest'
import { computeAdminStats } from './adminStats'
import type { Merchant } from '../types'

const NOW = new Date('2026-06-15T12:00:00')

function merchant(o: Partial<Merchant>): Merchant {
  return { id: o.id ?? 'm', name: 'Shop', slug: 's', status: 'active', created_at: NOW.toISOString(), ...o }
}

describe('computeAdminStats', () => {
  it('counts merchants by status', () => {
    const s = computeAdminStats([
      merchant({ id: '1', status: 'active' }),
      merchant({ id: '2', status: 'active' }),
      merchant({ id: '3', status: 'pending' }),
      merchant({ id: '4', status: 'suspended' }),
    ], NOW)
    expect(s.total).toBe(4)
    expect(s.active).toBe(2)
    expect(s.pending).toBe(1)
    expect(s.suspended).toBe(1)
  })

  it('status breakdown carries percentages and drops empty statuses', () => {
    const s = computeAdminStats([
      merchant({ id: '1', status: 'active' }),
      merchant({ id: '2', status: 'active' }),
      merchant({ id: '3', status: 'pending' }),
    ], NOW)
    expect(s.statusBreakdown.find(x => x.status === 'active')).toEqual({ status: 'active', count: 2, pct: 67 })
    expect(s.statusBreakdown.some(x => x.status === 'suspended')).toBe(false)
  })

  it('empty list yields zeroes without dividing by zero', () => {
    const s = computeAdminStats([], NOW)
    expect(s.total).toBe(0)
    expect(s.statusBreakdown).toEqual([])
    expect(s.signups).toHaveLength(6)
  })

  it('buckets signups into the last 6 months by created_at', () => {
    const s = computeAdminStats([
      merchant({ id: '1', created_at: new Date('2026-06-01T00:00:00').toISOString() }),
      merchant({ id: '2', created_at: new Date('2026-06-09T00:00:00').toISOString() }),
      merchant({ id: '3', created_at: new Date('2026-05-20T00:00:00').toISOString() }),
      merchant({ id: '4', created_at: new Date('2025-01-01T00:00:00').toISOString() }), // outside window
    ], NOW, 6)
    expect(s.signups).toHaveLength(6)
    const jun = s.signups[s.signups.length - 1]
    const may = s.signups[s.signups.length - 2]
    expect(jun.label).toBe('Jun')
    expect(jun.count).toBe(2)
    expect(may.count).toBe(1)
    expect(s.signups.reduce((sum, p) => sum + p.count, 0)).toBe(3) // old one excluded
  })

  // #161 — the question this dashboard exists to answer: which industry has the most shops.
  it('ranks industries by merchant count, most first', () => {
    const s = computeAdminStats([
      merchant({ id: '1', business_nature: 'bakery' }),
      merchant({ id: '2', business_nature: 'restaurant' }),
      merchant({ id: '3', business_nature: 'bakery' }),
      merchant({ id: '4', business_nature: 'bakery' }),
      merchant({ id: '5', business_nature: 'restaurant' }),
      merchant({ id: '6', business_nature: 'florist' }),
    ], NOW)
    expect(s.industries).toEqual([
      { nature: 'bakery', count: 3, pct: 50, bar: 100 },
      { nature: 'restaurant', count: 2, pct: 33, bar: 67 },
      { nature: 'florist', count: 1, pct: 17, bar: 33 },
    ])
  })

  // `bar` is scaled against the biggest NAMED industry, never against Unspecified. On the day
  // this ships every existing shop is Unspecified, and scaling by it would compress every real
  // industry into a stub beside one full-width bar for the bucket that answers nothing.
  it('scales bars against the biggest named industry, not the Unspecified bucket', () => {
    const s = computeAdminStats([
      ...Array.from({ length: 8 }, (_, i) => merchant({ id: `u${i}` })),   // 8 unspecified
      merchant({ id: '1', business_nature: 'bakery' }),
      merchant({ id: '2', business_nature: 'bakery' }),
      merchant({ id: '3', business_nature: 'florist' }),
    ], NOW).industries
    expect(s.map(i => [i.nature, i.bar])).toEqual([
      ['bakery', 100],
      ['florist', 50],
      [null, 100],   // pinned full width; its own count is printed beside it
    ])
  })

  it('gives the Unspecified bucket a full bar when it is the only one', () => {
    const s = computeAdminStats([merchant({ id: '1' }), merchant({ id: '2' })], NOW).industries
    expect(s).toEqual([{ nature: null, count: 2, pct: 100, bar: 100 }])
  })

  // Shops predating the field are counted, never dropped: a chart that silently omitted them
  // would read as a complete census of a platform it only partly describes.
  it('counts shops with no industry as one Unspecified bucket, always last', () => {
    const s = computeAdminStats([
      merchant({ id: '1', business_nature: null }),
      merchant({ id: '2' }),                                // column absent entirely
      merchant({ id: '3', business_nature: '' }),           // never a stored value, but not a slug either
      merchant({ id: '4', business_nature: 'bakery' }),
    ], NOW)
    expect(s.industries).toEqual([
      { nature: 'bakery', count: 1, pct: 25, bar: 100 },
      { nature: null, count: 3, pct: 75, bar: 100 },
    ])
  })

  it('keeps Unspecified last even when it is the largest bucket', () => {
    const s = computeAdminStats([
      merchant({ id: '1' }), merchant({ id: '2' }), merchant({ id: '3' }),
      merchant({ id: '4', business_nature: 'grocery' }),
    ], NOW).industries
    expect(s[s.length - 1].nature).toBeNull()
    expect(s[0]).toEqual({ nature: 'grocery', count: 1, pct: 25, bar: 100 })
  })

  // A row can carry a code this build has never heard of (an older bundle against a newer
  // database). It is its own bucket, not folded into 'other' — which is a real answer a
  // merchant chose, and must not be inflated by rows that mean something else.
  it('keeps an unrecognised code as its own bucket', () => {
    const s = computeAdminStats([
      merchant({ id: '1', business_nature: 'pharmacy' }),
      merchant({ id: '2', business_nature: 'other' }),
    ], NOW)
    expect(s.industries).toEqual([
      { nature: 'other', count: 1, pct: 50, bar: 100 },
      { nature: 'pharmacy', count: 1, pct: 50, bar: 100 },
    ])
  })

  it('has no industries at all for an empty platform', () => {
    expect(computeAdminStats([], NOW).industries).toEqual([])
  })

  it('recent returns the 5 newest by created_at desc', () => {
    const ms = Array.from({ length: 7 }, (_, i) =>
      merchant({ id: String(i), created_at: new Date(2026, 0, i + 1).toISOString() }))
    const s = computeAdminStats(ms, NOW)
    expect(s.recent).toHaveLength(5)
    expect(s.recent[0].id).toBe('6') // newest
  })
})
