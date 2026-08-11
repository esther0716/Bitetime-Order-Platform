import { describe, it, expect } from 'vitest'
import { pendingShopMetadata, pendingShopFromMetadata } from './pendingShop'
import type { PendingShop } from './pendingShop'

describe('pendingShopMetadata', () => {
  it('carries every field the signup form collected', () => {
    expect(pendingShopMetadata({
      name: 'Sunny Bakes',
      businessNature: 'bakery',
      currency: 'SGD',
      billing: 'yearly',
      ref: 'ABC123',
    })).toEqual({
      shop_name: 'Sunny Bakes',
      shop_business_nature: 'bakery',
      shop_currency: 'SGD',
      shop_billing: 'yearly',
      shop_ref: 'ABC123',
    })
  })

  it('omits an absent referral rather than writing undefined', () => {
    const meta = pendingShopMetadata({ name: 'S', businessNature: 'other', currency: 'MYR', billing: 'monthly' })
    expect('shop_ref' in meta).toBe(false)
  })
})

describe('pendingShopFromMetadata', () => {
  it('reads back what pendingShopMetadata wrote', () => {
    const input: PendingShop = { name: 'Sunny Bakes', businessNature: 'bakery', currency: 'SGD', billing: 'yearly', ref: 'ABC123' }
    expect(pendingShopFromMetadata(pendingShopMetadata(input))).toEqual(input)
  })

  it('is null when no shop name was carried — nothing to finish', () => {
    expect(pendingShopFromMetadata({})).toBeNull()
    expect(pendingShopFromMetadata(null)).toBeNull()
    expect(pendingShopFromMetadata(undefined)).toBeNull()
    expect(pendingShopFromMetadata({ shop_name: '   ' })).toBeNull()
  })

  // A user can rewrite their own user_metadata (supabase.auth.updateUser), so every field
  // read back here is untrusted input, not something this app wrote.
  it('falls back to the signup form defaults on a junk billing cycle', () => {
    expect(pendingShopFromMetadata({ shop_name: 'S', shop_billing: 'weekly' }))
      .toEqual({ name: 'S', businessNature: '', currency: 'MYR', billing: 'monthly', ref: undefined })
  })

  // A shop parked before #222 carries `shop_plan`. It is read by nothing now and must not survive
  // into the object — a stale key reaching `createMerchant` is a field the backend would ignore
  // anyway, but a reader here would be reading a tier that no longer exists.
  it('drops a plan left in the metadata by an older release', () => {
    const shop = pendingShopFromMetadata({ shop_name: 'S', shop_plan: 'pro' })
    expect(shop).not.toHaveProperty('plan')
  })

  it('falls back to MYR on an unknown currency', () => {
    expect(pendingShopFromMetadata({ shop_name: 'S', shop_currency: 'XXX' })?.currency).toBe('MYR')
  })

  it('drops an unknown business nature instead of sending one the backend refuses', () => {
    expect(pendingShopFromMetadata({ shop_name: 'S', shop_business_nature: 'crypto' })?.businessNature).toBe('')
  })

  it('trims the shop name', () => {
    expect(pendingShopFromMetadata({ shop_name: '  Sunny Bakes  ' })?.name).toBe('Sunny Bakes')
  })

  it('ignores a non-string referral', () => {
    expect(pendingShopFromMetadata({ shop_name: 'S', shop_ref: 42 })?.ref).toBeUndefined()
  })
})
