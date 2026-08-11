import { describe, it, expect } from 'vitest'
import { PRICING_TIERS, INCLUDED_GROUPS } from './pricingTiers'

// Same job as faq.test.ts: this content is BILINGUAL, and a half-translated entry is invisible to
// the compiler — both fields are strings, so an entry carrying English in its Chinese slot type
// checks perfectly and ships inside a Chinese page. Nothing here tests rendering.

/** The flat row list, the shape most of these tests actually care about. */
const INCLUDED_ROWS = INCLUDED_GROUPS.flatMap(g => g.rows)

/** Every `{en, zh}` pair in the tier data, labelled well enough to name the one that failed. */
function pairs(): [string, { en: string; zh: string }][] {
  const out: [string, { en: string; zh: string }][] = []
  for (const tier of PRICING_TIERS) {
    out.push([`${tier.id}.name`, tier.name])
    out.push([`${tier.id}.blurb`, tier.blurb])
    out.push([`${tier.id}.cta`, tier.cta])
    out.push([`${tier.id}.note`, tier.note])
    if (tier.badge) out.push([`${tier.id}.badge`, tier.badge])
    tier.features.forEach((f, i) => out.push([`${tier.id}.features[${i}]`, f]))
  }
  for (const group of INCLUDED_GROUPS) {
    out.push([`group:${group.id}.label`, group.label])
  }
  for (const row of INCLUDED_ROWS) {
    out.push([`${row.id}.label`, row.label])
    if (row.detail) out.push([`${row.id}.detail`, row.detail])
  }
  return out
}

describe('pricing content', () => {
  it('sells exactly one plan', () => {
    expect(PRICING_TIERS.map(t => t.id)).toEqual(['pro'])
  })

  // The trial is the risk reversal, and it sits on the plan we sell rather than on a cheaper one
  // the visitor would then have to be moved off.
  it('promises the cardless trial on the plan it sells', () => {
    expect(PRICING_TIERS[0].note.en).toContain('no card')
  })

  it('fills both languages on every string', () => {
    for (const [label, pair] of pairs()) {
      expect(pair.en.trim(), `${label}.en`).not.toBe('')
      expect(pair.zh.trim(), `${label}.zh`).not.toBe('')
    }
  })

  it('gives every Chinese string some actual Chinese', () => {
    for (const [label, pair] of pairs()) {
      // "Pro" is the product's name in both languages and the one legitimate exception; a rule
      // that forced it to differ would only produce a worse Chinese label.
      if (pair.en === 'Pro') continue
      expect(pair.zh, `${label} has no CJK characters`).toMatch(/[一-鿿]/)
    }
  })

  it('states no price — those come from Stripe at runtime, never from this file', () => {
    for (const [label, pair] of pairs()) {
      for (const side of ['en', 'zh'] as const) {
        expect(pair[side], `${label}.${side} looks like it hardcodes an amount`)
          .not.toMatch(/\b(RM|MYR|USD|\$)\s?\d/)
      }
    }
  })

  it('gives every included row a unique id, and no tier left in the shape', () => {
    const ids = INCLUDED_ROWS.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const row of INCLUDED_ROWS) {
      expect(row).not.toHaveProperty('basic')
      expect(row).not.toHaveProperty('pro')
    }
  })

  it('gives every included group a unique id, and no empty groups', () => {
    const ids = INCLUDED_GROUPS.map(g => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const group of INCLUDED_GROUPS) {
      expect(group.rows.length, `group ${group.id} has no rows`).toBeGreaterThan(0)
    }
  })
})
