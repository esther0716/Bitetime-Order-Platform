import { describe, it, expect } from 'vitest'
import { pixelDecision } from './decision'

const on = { configured: true, entitled: true, inScope: true }
const off = { configured: true, entitled: true, inScope: false }

describe('in scope, with a pixel configured', () => {
  it('asks, and does nothing else, until the visitor answers', () => {
    expect(pixelDecision({ ...on, choice: null })).toEqual({ load: false, pageView: false, banner: true })
  })

  it('loads and reports once the visitor accepts, and stops asking', () => {
    expect(pixelDecision({ ...on, choice: 'accepted' })).toEqual({ load: true, pageView: true, banner: false })
  })

  it('does nothing at all once the visitor declines, and never asks again', () => {
    expect(pixelDecision({ ...on, choice: 'rejected' })).toEqual({ load: false, pageView: false, banner: false })
  })
})

describe('out of scope', () => {
  // The rule this file exists for. A storefront belongs to a merchant, and their customers are
  // not TinyOrder's ad audience — so an earlier "accepted" on OUR pages must not follow the
  // visitor onto a shop's page and inject a script there. Gating only the pageview is not enough:
  // the load is the third-party request and the advertising cookie. It holds in the other
  // direction too, one shop to the next.
  it('loads nothing even for a visitor who already accepted', () => {
    expect(pixelDecision({ ...off, choice: 'accepted' })).toEqual({ load: false, pageView: false, banner: false })
  })

  it('asks nothing of a visitor who has not answered', () => {
    expect(pixelDecision({ ...off, choice: null })).toEqual({ load: false, pageView: false, banner: false })
  })

  it('does nothing for a visitor who declined', () => {
    expect(pixelDecision({ ...off, choice: 'rejected' })).toEqual({ load: false, pageView: false, banner: false })
  })
})

describe('with no pixel configured', () => {
  // Dev, CI and the e2e run. Nothing renders and nothing loads, with no stubbing anywhere.
  it('does nothing whatever the visitor answered', () => {
    for (const choice of [null, 'accepted', 'rejected'] as const) {
      expect(pixelDecision({ configured: false, entitled: true, inScope: true, choice }))
        .toEqual({ load: false, pageView: false, banner: false })
    }
  })
})

describe('with a pixel configured but no entitlement to use it', () => {
  // A shop that was Pro, saved a pixel, and dropped to Basic (#220). The id stays in the row —
  // a downgrade hides, it does not delete — and the LOAD is what has to stop, not merely the
  // events: the load is the third-party request and the cookie.
  it('loads nothing, reports nothing, and stops asking the shop’s customers', () => {
    for (const choice of [null, 'accepted', 'rejected'] as const) {
      expect(pixelDecision({ configured: true, entitled: false, inScope: true, choice }))
        .toEqual({ load: false, pageView: false, banner: false })
    }
  })
})
