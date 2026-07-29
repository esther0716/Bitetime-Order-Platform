import { describe, it, expect } from 'vitest'
import { PRICING_TIERS, PLAN_COMPARISON } from './pricingTiers'

// Same job as faq.test.ts: this content is BILINGUAL, and a half-translated entry is invisible to
// the compiler — both fields are strings, so an entry carrying English in its Chinese slot type
// checks perfectly and ships inside a Chinese page. Nothing here tests rendering.

/** Every `{en, zh}` pair in the tier data, labelled well enough to name the one that failed. */
function pairs(): [string, { en: string; zh: string }][] {
  const out: [string, { en: string; zh: string }][] = []
  for (const tier of PRICING_TIERS) {
    out.push([`${tier.id}.name`, tier.name])
    out.push([`${tier.id}.blurb`, tier.blurb])
    out.push([`${tier.id}.cta`, tier.cta])
    out.push([`${tier.id}.note`, tier.note])
    if (tier.inherits) out.push([`${tier.id}.inherits`, tier.inherits])
    if (tier.badge) out.push([`${tier.id}.badge`, tier.badge])
    tier.features.forEach((f, i) => out.push([`${tier.id}.features[${i}]`, f]))
  }
  for (const row of PLAN_COMPARISON) {
    out.push([`${row.id}.label`, row.label])
    out.push([`${row.id}.basic`, row.basic])
    out.push([`${row.id}.pro`, row.pro])
  }
  return out
}

describe('pricing content', () => {
  it('has both tiers, basic before pro', () => {
    expect(PRICING_TIERS.map(t => t.id)).toEqual(['basic', 'pro'])
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

  it('highlights exactly one tier, so one card carries the badge', () => {
    expect(PRICING_TIERS.filter(t => t.highlight)).toHaveLength(1)
  })

  it('gives every comparison row a unique id', () => {
    const ids = PLAN_COMPARISON.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // The comparison is the page's argument for Pro. A table where no row differs is a table that
  // argues for Basic — worth failing on, because it is the shape a careless edit leaves behind.
  it('has rows where the two plans actually differ', () => {
    const differing = PLAN_COMPARISON.filter(r => r.basic.en !== r.pro.en)
    expect(differing.length).toBeGreaterThan(0)
  })
})
