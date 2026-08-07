import { describe, it, expect } from 'vitest'
import { BUSINESS_NATURES } from '@bitetime/shared'
import { pickMerchantConfig, promoChanged, optionGroupsChanged, menuCategoriesChanged, categoryChanged } from '../../src/writes.js'

// The shop being written. Only `payment_qr` is judged against it (a Storage path belongs to one
// merchant's folder); every other field in this file is tenant-agnostic, so these cases pass the
// same stand-in rather than one id each.
const SHOP = '33333333-3333-3333-3333-333333333333'

describe('pickMerchantConfig — fulfilment', () => {
  it('accepts a config bag and a real timezone', () => {
    expect(pickMerchantConfig({
      config: { fulfilment: { lead_days: 1, window_days: 7, closed_weekdays: [1] } },
      timezone: 'Asia/Kuala_Lumpur',
    }, SHOP)).toEqual({
      ok: true,
      patch: {
        config: { fulfilment: { lead_days: 1, window_days: 7, closed_weekdays: [1] } },
        timezone: 'Asia/Kuala_Lumpur',
      },
    })
  })

  it('drops a timezone Intl cannot parse rather than writing it', () => {
    expect(pickMerchantConfig({ timezone: 'Mars/Olympus' }, SHOP)).toEqual({ ok: true, patch: {} })
  })

  it('still refuses the privilege columns', () => {
    expect(pickMerchantConfig({ status: 'active', owner_id: 'x', slug: 'y', plan: 'pro' }, SHOP)).toEqual({ ok: true, patch: {} })
  })
})

describe('pickMerchantConfig — tax (#88)', () => {
  it('accepts a valid enabled + rate pair', () => {
    expect(pickMerchantConfig({ tax_enabled: true, tax_rate: 6 }, SHOP)).toEqual({
      ok: true,
      patch: { tax_enabled: true, tax_rate: 6 },
    })
  })

  it('coerces a numeric-string rate (PATCH bodies can carry either)', () => {
    expect(pickMerchantConfig({ tax_rate: '6' }, SHOP)).toEqual({ ok: true, patch: { tax_rate: 6 } })
  })

  it('refuses a rate above 100 rather than clamping it', () => {
    expect(pickMerchantConfig({ tax_rate: 150 }, SHOP)).toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a negative rate', () => {
    expect(pickMerchantConfig({ tax_rate: -1 }, SHOP)).toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a non-numeric rate', () => {
    expect(pickMerchantConfig({ tax_rate: 'six' }, SHOP)).toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a blank rate rather than coercing it to 0', () => {
    expect(pickMerchantConfig({ tax_rate: '' }, SHOP)).toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a whitespace-only rate rather than coercing it to 0', () => {
    expect(pickMerchantConfig({ tax_rate: '   ' }, SHOP)).toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a non-boolean tax_enabled', () => {
    expect(pickMerchantConfig({ tax_enabled: 'yes' }, SHOP)).toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a rate the numeric(5,2) column would round on write', () => {
    expect(pickMerchantConfig({ tax_rate: 100.005 }, SHOP)).toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a rate with more than 2 decimal places', () => {
    expect(pickMerchantConfig({ tax_rate: 6.567 }, SHOP)).toEqual({ ok: false, error: expect.any(String) })
  })

  it('accepts a rate with exactly 1 decimal place', () => {
    expect(pickMerchantConfig({ tax_rate: 6.5 }, SHOP)).toEqual({ ok: true, patch: { tax_rate: 6.5 } })
  })

  it('accepts a whole-number rate', () => {
    expect(pickMerchantConfig({ tax_rate: 6 }, SHOP)).toEqual({ ok: true, patch: { tax_rate: 6 } })
  })
})

describe('pickMerchantConfig — onboarding flags (#102)', () => {
  it('accepts the three onboarding booleans', () => {
    expect(pickMerchantConfig({
      onboarding_shipping_set: true,
      onboarding_link_shared: true,
      onboarding_dismissed: true,
    }, SHOP)).toEqual({
      ok: true,
      patch: {
        onboarding_shipping_set: true,
        onboarding_link_shared: true,
        onboarding_dismissed: true,
      },
    })
  })

  it('passes a field through untouched when absent', () => {
    expect(pickMerchantConfig({ onboarding_link_shared: true }, SHOP)).toEqual({
      ok: true,
      patch: { onboarding_link_shared: true },
    })
  })

  it('refuses a non-boolean onboarding flag rather than coercing it', () => {
    expect(pickMerchantConfig({ onboarding_shipping_set: 'yes' }, SHOP))
      .toEqual({ ok: false, error: expect.any(String) })
    expect(pickMerchantConfig({ onboarding_dismissed: 1 }, SHOP))
      .toEqual({ ok: false, error: expect.any(String) })
  })
})

describe('pickMerchantConfig — business nature is signup-only, not editable (#161)', () => {
  // business_nature is set once at signup (POST /api/merchants) and deliberately not in
  // MERCHANT_CONFIG_FIELDS, so a PATCH naming it — valid code or not — is silently ignored
  // rather than refused; the merchant simply has no field left that writes this column.
  it('ignores business_nature entirely, valid or not', () => {
    for (const code of BUSINESS_NATURES) {
      expect(pickMerchantConfig({ business_nature: code }, SHOP)).toEqual({ ok: true, patch: {} })
    }
    expect(pickMerchantConfig({ business_nature: 'cake shop' }, SHOP)).toEqual({ ok: true, patch: {} })
    expect(pickMerchantConfig({ business_nature: null }, SHOP)).toEqual({ ok: true, patch: {} })
  })

  it('still passes other fields through when business_nature rides along in the same body', () => {
    expect(pickMerchantConfig({ business_nature: 'bakery', timezone: 'Asia/Kuala_Lumpur' }, SHOP))
      .toEqual({ ok: true, patch: { timezone: 'Asia/Kuala_Lumpur' } })
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

describe('pickMerchantConfig — payment QR (#156)', () => {
  const M = '11111111-1111-1111-1111-111111111111'
  const OTHER = '22222222-2222-2222-2222-222222222222'

  it('accepts a path inside the merchant\'s own Storage folder', () => {
    expect(pickMerchantConfig({ payment_qr: `${M}/abc-duitnow.png` }, M))
      .toEqual({ ok: true, patch: { payment_qr: `${M}/abc-duitnow.png` } })
  })

  it('accepts null — the only way to take the QR back down', () => {
    expect(pickMerchantConfig({ payment_qr: null }, M)).toEqual({ ok: true, patch: { payment_qr: null } })
  })

  it('reads an empty string as null rather than storing a blank path', () => {
    expect(pickMerchantConfig({ payment_qr: '' }, M)).toEqual({ ok: true, patch: { payment_qr: null } })
  })

  // The whole reason this check exists: the backend writes through the service role, so nothing
  // in Postgres stops a merchant from pointing their row at a stranger's object.
  it('refuses a path in another merchant\'s folder', () => {
    expect(pickMerchantConfig({ payment_qr: `${OTHER}/abc-duitnow.png` }, M))
      .toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a traversal that would climb out of the folder', () => {
    expect(pickMerchantConfig({ payment_qr: `${M}/../${OTHER}/qr.png` }, M))
      .toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses an absolute URL — the column holds a Storage PATH', () => {
    expect(pickMerchantConfig({ payment_qr: 'https://evil.example/qr.png' }, M))
      .toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a non-string', () => {
    expect(pickMerchantConfig({ payment_qr: 42 }, M)).toEqual({ ok: false, error: expect.any(String) })
  })

  // The argument is required, so this is the empty-string case a caller could still reach — a
  // caller that cannot name the merchant cannot prove the path belongs to them, and the field is
  // refused rather than written unchecked.
  it('refuses a QR path when the merchant id is blank', () => {
    expect(pickMerchantConfig({ payment_qr: `${M}/qr.png` }, '')).toEqual({ ok: false, error: expect.any(String) })
  })
})

// Menu categories (ADR 0013). The list is shop-level config on the merchant row, so it goes
// through pickMerchantConfig — but unlike every other field there it is a Pro feature, and the
// gate that decides that is `menuCategoriesChanged` below. The allowlist's job here is only to
// refuse a list Postgres would happily store: ADR 0013 bought a write path that already existed
// and paid for it in check constraints, and `validateMenuCategories` is what stands there.
describe('pickMerchantConfig — menu categories (ADR 0013)', () => {
  const cakes = [{ id: 'c1', name: 'Cakes', name_zh: '蛋糕', active: true }]

  it('accepts a well-formed list, and an empty one', () => {
    expect(pickMerchantConfig({ product_categories: cakes }, SHOP))
      .toEqual({ ok: true, patch: { product_categories: cakes } })
    expect(pickMerchantConfig({ product_categories: [] }, SHOP))
      .toEqual({ ok: true, patch: { product_categories: [] } })
  })

  // Refused, never dropped — same rule as tax_rate. A list that silently failed to save is a
  // merchant watching their menu structure not stick, with a success toast on top of it.
  it('refuses a list the validator rejects, rather than dropping it', () => {
    expect(pickMerchantConfig({ product_categories: 'nope' }, SHOP).ok).toBe(false)
    expect(pickMerchantConfig({ product_categories: [{}] }, SHOP).ok).toBe(false)
    expect(pickMerchantConfig({ product_categories: [{ id: 'c1', name: '  ', active: true }] }, SHOP).ok).toBe(false)
    expect(pickMerchantConfig({
      product_categories: [{ id: 'c1', name: 'Cakes', active: true }, { id: 'c2', name: 'cakes', active: true }],
    }, SHOP).ok).toBe(false)
  })

  it('names the offending rule in the error', () => {
    const r = pickMerchantConfig({
      product_categories: [{ id: 'c1', name: 'Cakes', active: true }, { id: 'c2', name: 'CAKES', active: true }],
    }, SHOP)
    expect(r).toEqual({ ok: false, error: expect.stringContaining('duplicate_category_name') })
  })
})

// `optionGroupsChanged`'s sibling, one endpoint over. Same question, same jsonb comparison, and
// the same load-bearing distinction: the gate asks whether the list CHANGED, never whether the
// body contained it — a Basic shop editing its shipping rates resubmits its whole config, and
// refusing on presence would 403 that, or (worse) teach the dashboard to omit the field and put
// the shop's menu structure one payload mistake from being cleared.
describe('menuCategoriesChanged', () => {
  const cakes = [{ id: 'c1', name: 'Cakes', name_zh: '蛋糕', active: true }]

  it('is false when the column is not submitted at all', () => {
    expect(menuCategoriesChanged({ tax_rate: 6 }, { product_categories: cakes })).toBe(false)
  })

  it('is false on an unchanged resubmit, through key order and a text-typed stored value', () => {
    expect(menuCategoriesChanged({ product_categories: cakes }, { product_categories: cakes })).toBe(false)
    expect(menuCategoriesChanged(
      { product_categories: [{ active: true, name_zh: '蛋糕', name: 'Cakes', id: 'c1' }] },
      { product_categories: cakes },
    )).toBe(false)
    expect(menuCategoriesChanged({ product_categories: cakes }, { product_categories: JSON.stringify(cakes) })).toBe(false)
  })

  it('is true when a name, an order, a hide or a membership moves', () => {
    expect(menuCategoriesChanged({ product_categories: [{ ...cakes[0], name: 'Cake' }] }, { product_categories: cakes })).toBe(true)
    expect(menuCategoriesChanged({ product_categories: [{ ...cakes[0], active: false }] }, { product_categories: cakes })).toBe(true)
    expect(menuCategoriesChanged({ product_categories: [...cakes, { id: 'c2', name: 'Tea', active: true }] }, { product_categories: cakes })).toBe(true)
  })

  // Array order IS display order, so a reorder is a change — the one way this differs from a
  // comparison that sorted its input before hashing.
  it('is true when only the order moved', () => {
    const tea = { id: 'c2', name: 'Tea', active: true }
    expect(menuCategoriesChanged({ product_categories: [tea, cakes[0]] }, { product_categories: [cakes[0], tea] })).toBe(true)
  })

  // Clearing is a change. A Pro feature must not be removable by the act of ceasing to pay for
  // it — the merchant's authored list outlives the subscription, hidden rather than gone.
  it('is true when a Basic shop clears the list', () => {
    expect(menuCategoriesChanged({ product_categories: [] }, { product_categories: cakes })).toBe(true)
  })

  // `stored` is a shop that predates the column, so its list reads as empty. A shop cannot be
  // born categorized on Basic, and a no-op empty submit is still not a change.
  it('treats an absent stored column as no categories', () => {
    expect(menuCategoriesChanged({ product_categories: [] }, {})).toBe(false)
    expect(menuCategoriesChanged({ product_categories: cakes }, {})).toBe(true)
  })
})

// The product side of the same gate: which section this product sits in. A plain string compare
// would do, except for the two shapes "no category" arrives in — `null` from Postgres, and the
// `undefined` of a row written before the column existed. Those are ONE state (uncategorized),
// and calling them different would 403 a Basic shop renaming an old product.
describe('categoryChanged', () => {
  it('is false when the column is not submitted at all', () => {
    expect(categoryChanged({ name: 'Latte' }, { category_id: 'c1' })).toBe(false)
  })

  it('is false on an unchanged resubmit', () => {
    expect(categoryChanged({ category_id: 'c1' }, { category_id: 'c1' })).toBe(false)
  })

  it('reads null and an absent column as the same uncategorized state', () => {
    expect(categoryChanged({ category_id: null }, { category_id: null })).toBe(false)
    expect(categoryChanged({ category_id: null }, {})).toBe(false)
    expect(categoryChanged({ category_id: null }, { category_id: undefined })).toBe(false)
  })

  it('is true when the product is filed, refiled, or unfiled', () => {
    expect(categoryChanged({ category_id: 'c1' }, { category_id: null })).toBe(true)
    expect(categoryChanged({ category_id: 'c2' }, { category_id: 'c1' })).toBe(true)
    expect(categoryChanged({ category_id: null }, { category_id: 'c1' })).toBe(true)
  })

  // The create path (`mayCreate`) has no stored row — any category at all is new, so a Basic
  // shop cannot be born with one, while a plain uncategorized product still saves.
  it('treats a create as new only when a category is actually set', () => {
    expect(categoryChanged({ category_id: 'c1' }, null)).toBe(true)
    expect(categoryChanged({ category_id: null }, null)).toBe(false)
  })
})
