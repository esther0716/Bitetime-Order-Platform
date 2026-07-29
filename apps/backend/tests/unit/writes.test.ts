import { describe, it, expect } from 'vitest'
import { pickMerchantConfig, promoChanged, optionGroupsChanged } from '../../src/writes.js'

describe('pickMerchantConfig — fulfilment', () => {
  it('accepts a config bag and a real timezone', () => {
    expect(pickMerchantConfig({
      config: { fulfilment: { lead_days: 1, window_days: 7, closed_weekdays: [1] } },
      timezone: 'Asia/Kuala_Lumpur',
    })).toEqual({
      ok: true,
      patch: {
        config: { fulfilment: { lead_days: 1, window_days: 7, closed_weekdays: [1] } },
        timezone: 'Asia/Kuala_Lumpur',
      },
    })
  })

  it('drops a timezone Intl cannot parse rather than writing it', () => {
    expect(pickMerchantConfig({ timezone: 'Mars/Olympus' })).toEqual({ ok: true, patch: {} })
  })

  it('still refuses the privilege columns', () => {
    expect(pickMerchantConfig({ status: 'active', owner_id: 'x', slug: 'y', plan: 'pro' })).toEqual({ ok: true, patch: {} })
  })
})

describe('pickMerchantConfig — tax (#88)', () => {
  it('accepts a valid enabled + rate pair', () => {
    expect(pickMerchantConfig({ tax_enabled: true, tax_rate: 6 })).toEqual({
      ok: true,
      patch: { tax_enabled: true, tax_rate: 6 },
    })
  })

  it('coerces a numeric-string rate (PATCH bodies can carry either)', () => {
    expect(pickMerchantConfig({ tax_rate: '6' })).toEqual({ ok: true, patch: { tax_rate: 6 } })
  })

  it('refuses a rate above 100 rather than clamping it', () => {
    expect(pickMerchantConfig({ tax_rate: 150 })).toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a negative rate', () => {
    expect(pickMerchantConfig({ tax_rate: -1 })).toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a non-numeric rate', () => {
    expect(pickMerchantConfig({ tax_rate: 'six' })).toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a blank rate rather than coercing it to 0', () => {
    expect(pickMerchantConfig({ tax_rate: '' })).toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a whitespace-only rate rather than coercing it to 0', () => {
    expect(pickMerchantConfig({ tax_rate: '   ' })).toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a non-boolean tax_enabled', () => {
    expect(pickMerchantConfig({ tax_enabled: 'yes' })).toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a rate the numeric(5,2) column would round on write', () => {
    expect(pickMerchantConfig({ tax_rate: 100.005 })).toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a rate with more than 2 decimal places', () => {
    expect(pickMerchantConfig({ tax_rate: 6.567 })).toEqual({ ok: false, error: expect.any(String) })
  })

  it('accepts a rate with exactly 1 decimal place', () => {
    expect(pickMerchantConfig({ tax_rate: 6.5 })).toEqual({ ok: true, patch: { tax_rate: 6.5 } })
  })

  it('accepts a whole-number rate', () => {
    expect(pickMerchantConfig({ tax_rate: 6 })).toEqual({ ok: true, patch: { tax_rate: 6 } })
  })
})

describe('pickMerchantConfig — onboarding flags (#102)', () => {
  it('accepts the three onboarding booleans', () => {
    expect(pickMerchantConfig({
      onboarding_shipping_set: true,
      onboarding_link_shared: true,
      onboarding_dismissed: true,
    })).toEqual({
      ok: true,
      patch: {
        onboarding_shipping_set: true,
        onboarding_link_shared: true,
        onboarding_dismissed: true,
      },
    })
  })

  it('passes a field through untouched when absent', () => {
    expect(pickMerchantConfig({ onboarding_link_shared: true })).toEqual({
      ok: true,
      patch: { onboarding_link_shared: true },
    })
  })

  it('refuses a non-boolean onboarding flag rather than coercing it', () => {
    expect(pickMerchantConfig({ onboarding_shipping_set: 'yes' }))
      .toEqual({ ok: false, error: expect.any(String) })
    expect(pickMerchantConfig({ onboarding_dismissed: 1 }))
      .toEqual({ ok: false, error: expect.any(String) })
  })
})

// The Pro gate on the product upsert asks "did the promo CHANGE?", not "is a promo field
// present?" (#145). Presence is the wrong question: a shop that dropped from pro to basic still
// has promo columns on its rows, so any client that resubmits the whole row — which the dashboard
// does — would be refused an ordinary rename, or have to omit the columns and hope the upsert
// leaves them alone. This is the comparison that replaces it.
describe('promoChanged', () => {
  it('is false when no promo column is submitted at all', () => {
    expect(promoChanged({ name: 'Cookie' }, { promo_price: 8, promo_limit: 10, promo_end: null })).toBe(false)
  })

  it('is false when the submitted promo equals the stored one', () => {
    expect(promoChanged(
      { promo_price: 8, promo_limit: 10, promo_end: '2030-01-01T15:59:59.999Z' },
      { promo_price: 8, promo_limit: 10, promo_end: '2030-01-01T15:59:59.999Z' },
    )).toBe(false)
  })

  it('sees through numeric column formatting (PostgREST returns numeric as a string)', () => {
    expect(promoChanged({ promo_price: 8 }, { promo_price: '8.00' })).toBe(false)
  })

  it('compares promo_end as an instant, not as a string', () => {
    expect(promoChanged(
      { promo_end: '2030-01-01T15:59:59.999Z' },
      { promo_end: '2030-01-01T15:59:59.999+00:00' },
    )).toBe(false)
  })

  it('is true when the price, the cap or the end date moves', () => {
    expect(promoChanged({ promo_price: 7 }, { promo_price: 8 })).toBe(true)
    expect(promoChanged({ promo_limit: 99 }, { promo_limit: 10 })).toBe(true)
    expect(promoChanged({ promo_end: '2031-01-01T00:00:00.000Z' }, { promo_end: '2030-01-01T00:00:00.000Z' })).toBe(true)
  })

  // promo_price 0 is a real promo — a free item. Testing for truthiness anywhere in this
  // comparison reads a stored 0 as "no promo" and lets a basic shop set one for free.
  it('treats 0 as a promo, on both sides', () => {
    expect(promoChanged({ promo_price: 0 }, { promo_price: 0 })).toBe(false)
    expect(promoChanged({ promo_price: 0 }, { promo_price: null })).toBe(true)
    expect(promoChanged({ promo_price: null }, { promo_price: 0 })).toBe(true)
    expect(promoChanged({ promo_limit: 0 }, { promo_limit: null })).toBe(true)
  })

  it('reads a missing row (the create case) as no stored promo', () => {
    expect(promoChanged({ name: 'New Cookie' }, null)).toBe(false)
    expect(promoChanged({ promo_price: null }, null)).toBe(false)
    expect(promoChanged({ promo_price: 8 }, null)).toBe(true)
  })

  // Clearing a promo is a change like any other. A basic shop cannot do it — the promo it can no
  // longer edit simply stays put until the shop is Pro again.
  it('is true when a stored promo is cleared', () => {
    expect(promoChanged({ promo_price: null }, { promo_price: 8 })).toBe(true)
  })

  // Fail CLOSED: a value neither side can read as a number or an instant is not "unchanged".
  it('is true for an unparseable submitted value', () => {
    expect(promoChanged({ promo_price: 'free' }, { promo_price: 8 })).toBe(true)
    expect(promoChanged({ promo_end: 'someday' }, { promo_end: '2030-01-01T00:00:00.000Z' })).toBe(true)
  })
})

// `optionGroupsChanged` is `promoChanged`'s twin on the same endpoint, and must stay one: same
// question ("did this CHANGE?"), same answer to an unchanged full-row resubmit, same refusal of
// a clear. Where it differs is the comparison itself — jsonb, so key order and number formatting
// are noise, which is what `canonicalJson` exists to remove. That serialiser is ALSO the cart
// line key, so a bug here is a bug there: normalise away a real difference and a Basic shop can
// edit its groups; invent one and no Basic shop can save a product at all.
describe('optionGroupsChanged', () => {
  const milk = [{
    id: 'milk', name: 'Milk', minSelect: 1, maxSelect: 1, maxPerOption: 1, active: true,
    options: [{ id: 'oat', name: 'Oat', delta: 2, active: true }],
  }]

  it('is false when the column is not submitted at all', () => {
    expect(optionGroupsChanged({ name: 'Latte' }, { option_groups: milk })).toBe(false)
  })

  // The rename case. The dashboard resubmits the whole row, so this is the ordinary edit a Basic
  // ex-Pro shop must still be allowed to make.
  it('is false when the submitted groups equal the stored ones', () => {
    expect(optionGroupsChanged({ option_groups: milk }, { option_groups: milk })).toBe(false)
  })

  it('sees through key order and number formatting', () => {
    const reordered = [{
      options: [{ active: true, delta: 2.0, id: 'oat', name: 'Oat' }],
      active: true, maxPerOption: 1, maxSelect: 1, minSelect: 1, name: 'Milk', id: 'milk',
    }]
    expect(optionGroupsChanged({ option_groups: reordered }, { option_groups: milk })).toBe(false)
  })

  it('reads a stored value that arrived as text', () => {
    expect(optionGroupsChanged({ option_groups: milk }, { option_groups: JSON.stringify(milk) })).toBe(false)
  })

  it('is true when a delta, a window or an option moves', () => {
    const dearer = [{ ...milk[0], options: [{ ...milk[0].options[0], delta: 3 }] }]
    expect(optionGroupsChanged({ option_groups: dearer }, { option_groups: milk })).toBe(true)
    expect(optionGroupsChanged({ option_groups: [{ ...milk[0], maxSelect: 2 }] }, { option_groups: milk })).toBe(true)
    expect(optionGroupsChanged(
      { option_groups: [{ ...milk[0], options: [...milk[0].options, { id: 'soy', name: 'Soy', delta: 2, active: true }] }] },
      { option_groups: milk },
    )).toBe(true)
  })

  // Clearing is a change like any other — the groups a Basic shop may no longer edit stay put
  // until it is Pro again. Otherwise the feature is removable by anyone who stops paying, which
  // is the "success toast, wrong data" failure the promo gate was fixed to stop.
  it('is true when the groups are cleared', () => {
    expect(optionGroupsChanged({ option_groups: [] }, { option_groups: milk })).toBe(true)
  })

  // The create path: `stored` is null, so any groups at all are new and a Basic shop cannot be
  // born with them. An empty list is not "groups", so a plain product still saves.
  it('treats a missing stored row as no groups', () => {
    expect(optionGroupsChanged({ option_groups: milk }, null)).toBe(true)
    expect(optionGroupsChanged({ option_groups: [] }, null)).toBe(false)
  })
})
