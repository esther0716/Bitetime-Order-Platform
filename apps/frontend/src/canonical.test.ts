import { describe, it, expect } from 'vitest'
import { canonicalUrl, canonicalPath } from './canonical'

describe('canonicalUrl', () => {
  it('names the route the visitor asked for, not the homepage', () => {
    expect(canonicalUrl('https://tinyorder.shop', '/s/mei')).toBe('https://tinyorder.shop/s/mei')
  })

  it('keeps the root slash', () => {
    expect(canonicalUrl('https://tinyorder.shop', '/')).toBe('https://tinyorder.shop/')
  })

  it('drops a trailing slash so one page cannot be indexed twice', () => {
    expect(canonicalUrl('https://tinyorder.shop', '/s/mei/')).toBe('https://tinyorder.shop/s/mei')
  })

  it('tolerates an origin that carries its own trailing slash', () => {
    expect(canonicalUrl('https://tinyorder.shop/', '/terms')).toBe('https://tinyorder.shop/terms')
  })

  it('works on a preview origin with a port', () => {
    expect(canonicalUrl('http://localhost:5173', '/merchant/signup')).toBe(
      'http://localhost:5173/merchant/signup',
    )
  })

  it('collapses a preselected plan, so four pricing CTAs are one indexed page', () => {
    expect(canonicalUrl('https://tinyorder.shop', '/merchant/signup/pro/yearly')).toBe(
      'https://tinyorder.shop/merchant/signup',
    )
  })
})

describe('canonicalPath', () => {
  it('leaves a page that is nobody else\'s preselection alone', () => {
    expect(canonicalPath('/s/mei')).toBe('/s/mei')
    expect(canonicalPath('/terms')).toBe('/terms')
  })

  it('collapses every depth of a preselection route to its base', () => {
    expect(canonicalPath('/merchant/signup')).toBe('/merchant/signup')
    expect(canonicalPath('/merchant/signup/basic')).toBe('/merchant/signup')
    expect(canonicalPath('/merchant/signup/basic/monthly')).toBe('/merchant/signup')
  })

  it('does not collapse a route that merely starts with the same letters', () => {
    expect(canonicalPath('/merchant/signup-old')).toBe('/merchant/signup-old')
  })

  it('leaves the login screen alone — it is a different page, not a preselection', () => {
    expect(canonicalPath('/merchant/login')).toBe('/merchant/login')
  })
})
