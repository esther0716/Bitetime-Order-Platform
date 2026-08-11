import { describe, it, expect } from 'vitest'
import { isMarketingPath } from './marketingPaths'
import { ROUTE_META } from '../routeMeta'

describe('isMarketingPath', () => {
  it('is true for every page that has its own title — that IS the marketing set', () => {
    for (const path of Object.keys(ROUTE_META)) {
      expect(isMarketingPath(path), path).toBe(true)
    }
  })

  it('is true for the pages by name, so a deletion from ROUTE_META cannot pass silently', () => {
    for (const path of ['/', '/pricing', '/features', '/faq', '/sample-shops',
                        '/terms', '/privacy', '/merchant/signup', '/merchant/login',
                        '/for/home-bakers']) {
      expect(isMarketingPath(path), path).toBe(true)
    }
  })

  it('is false on a storefront — a shop’s customers are never TinyOrder’s ad audience', () => {
    expect(isMarketingPath('/s/kopi-corner')).toBe(false)
    expect(isMarketingPath('/s/kopi-corner/orders')).toBe(false)
  })

  it('is false on the signed-in surfaces', () => {
    expect(isMarketingPath('/merchant')).toBe(false)
    expect(isMarketingPath('/merchant/kopi-corner')).toBe(false)
    expect(isMarketingPath('/admin')).toBe(false)
    expect(isMarketingPath('/admin/merchants')).toBe(false)
  })

  it('is false on the routes with no title of their own', () => {
    expect(isMarketingPath('/reset-password')).toBe(false)
    expect(isMarketingPath('/releases/v1.2.0')).toBe(false)
  })

  it('follows a signup preselection back to the one page it preselects', () => {
    expect(isMarketingPath('/merchant/signup/pro/yearly')).toBe(true)
    expect(isMarketingPath('/merchant/signup/basic')).toBe(true)
  })

  it('ignores a trailing slash, which is the same page', () => {
    expect(isMarketingPath('/pricing/')).toBe(true)
    expect(isMarketingPath('/')).toBe(true)
  })

  it('treats an empty pathname as the homepage rather than as nothing', () => {
    expect(isMarketingPath('')).toBe(true)
  })
})
