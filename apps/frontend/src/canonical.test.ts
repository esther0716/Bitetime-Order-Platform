import { describe, it, expect } from 'vitest'
import { canonicalUrl } from './canonical'

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
})
