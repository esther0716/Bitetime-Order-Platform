// The ONE file that knows this is a SHOP's own tracking, and the sibling of usePixels.ts.
//
// It reuses decision, load, track, consent and the banner exactly as #217 left them — the seam
// that made this possible is that all five take their inputs as arguments and read no environment
// and no route table. What this file adds is where a shop's inputs come from: the ids off the
// merchant row, the entitlement off its plan, and a consent scope of its own.
//
// THE MERCHANT IS THE DATA CONTROLLER HERE, not TinyOrder. `documents.ts` §1 already makes a shop
// separately responsible for the customer data it receives, and the Terms now say so about its
// pixel specifically. That is the reason this exists as a separate hook rather than as a wider
// `usePixels`: TinyOrder's pixels must never fire on a storefront, and a shop's must never fire
// anywhere else, and two hooks cannot be talked into swapping audiences the way one with a flag
// can.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { merchantPixelIds, hasAnyPixel } from './ids'
import { readConsent, writeConsent } from './consent'
import type { ConsentChoice } from './consent'
import { pixelDecision } from './decision'
import { loadPixels } from './load'
import { pixelPageView, pixelTrack } from './track'
import type { PixelEvent, PixelValue } from './track'
import type { Merchant } from '../types'

/**
 * This shop's consent scope, and the reason `readConsent`/`writeConsent` take one at all.
 *
 * A customer's answer at `kopi-corner` is an answer about kopi-corner's pixel and nobody else's.
 * It must not be read as an answer at the next shop — a different controller asking a different
 * question — nor as an answer to TinyOrder's own banner.
 */
export function shopConsentScope(slug: string): string {
  return `shop:${slug}`
}

export interface MerchantPixelsState {
  /** Ask this shop's customer. False once they have answered, and false wherever we would not track. */
  showBanner: boolean
  accept: () => void
  reject: () => void
  /**
   * Report one of this shop's events. A NO-OP unless the pixel is loaded, so a call site never
   * has to ask whether the customer accepted, whether the shop is Pro, or whether an id exists.
   */
  track: (event: PixelEvent, value?: PixelValue) => void
}

export function useMerchantPixels(merchant: Merchant | null): MerchantPixelsState {
  const { pathname } = useLocation()

  const ids = merchantPixelIds(merchant)
  const configured = hasAnyPixel(ids)
  // `plan === 'pro'` and nothing else — the same field the backend's `hasProAccess` reads, so the
  // two cannot disagree about what Pro means. A shop that stops paying stops tracking: the id
  // stays in its row (a downgrade hides, it does not delete) and the LOAD is what stops, which
  // matters because the load is the third-party request and the advertising cookie.
  //
  // Not `useProAccess`: that hook answers about the signed-in merchant's OWN shop and lets a
  // superadmin through. The person here is a customer, and whose storefront they are standing on
  // has nothing to do with who they are signed in as.
  const entitled = merchant?.plan === 'pro'
  const slug = merchant?.slug ?? ''
  const scope = shopConsentScope(slug)

  // DERIVED from storage, not copied into state, and that is deliberate. usePixels can hold the
  // answer in state because the platform has exactly one scope for the life of the app; a shop's
  // scope changes the moment the customer opens a different storefront in the same session, and a
  // remembered copy would carry shop A's answer into shop B — the exact cross-shop leak `scope`
  // exists to prevent, arriving through React state instead of through storage.
  //
  // What state DOES hold is this session's own answer, tagged with the scope it was given at —
  // and it is not a cache. `writeConsent` swallows a storage failure (Safari private mode throws
  // on write), so without this an Accept would be forgotten by the next render and the banner
  // would come straight back. Tagged, so it is discarded the moment the scope moves.
  const [answer, setAnswer] = useState<{ scope: string; choice: ConsentChoice } | null>(null)
  const choice: ConsentChoice | null = useMemo(
    () => (answer?.scope === scope ? answer.choice : slug ? readConsent(scope) : null),
    [slug, scope, answer],
  )

  // `inScope` is TRUE by construction: this hook is mounted only inside the storefront shell,
  // below its not-found and status gates, so reaching this line IS being on an active shop's
  // storefront. Stated as an argument anyway rather than dropped, because the decision has to be
  // readable in one place — see decision.ts's own header for what happened when it was not.
  const { load, pageView, banner } = pixelDecision({ configured, entitled, inScope: true, choice })

  useEffect(() => {
    if (load) loadPixels(ids)
    // `ids` is a fresh object every render, so the id STRINGS are the dependency. loadPixels is
    // idempotent per vendor and id regardless (load.ts keys its guard `vendor:id`).
  }, [load, ids.meta, ids.tiktok]) // eslint-disable-line react-hooks/exhaustive-deps

  // One pageview per storefront route — the shop's own page and its order-history page. Scoped to
  // this shop's ids, so a customer who has two storefronts open in one SPA session cannot report
  // one shop's traffic to the other's ad account. See track.ts.
  useEffect(() => {
    if (pageView) pixelPageView(ids)
  }, [pageView, pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  const track = useCallback((event: PixelEvent, value?: PixelValue) => {
    if (!load) return
    pixelTrack(ids, event, value)
  }, [load, ids.meta, ids.tiktok]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    showBanner: banner,
    accept: () => {
      writeConsent(scope, 'accepted')
      setAnswer({ scope, choice: 'accepted' })
    },
    reject: () => {
      writeConsent(scope, 'rejected')
      setAnswer({ scope, choice: 'rejected' })
    },
    track,
  }
}
