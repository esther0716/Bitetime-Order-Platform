// The ONE file that knows this is the platform's own tracking.
//
// Everything it calls takes its inputs as arguments and reads no environment and no route table.
// That is what lets the merchant-pixel feature (#220) add a sibling hook — ids off MerchantContext,
// scope `shop:<slug>` — and reuse decision, load, track, consent and the banner untouched.

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { platformPixelIds, hasAnyPixel } from './ids'
import { isMarketingPath } from './marketingPaths'
import { readConsent, writeConsent, PLATFORM_CONSENT_SCOPE } from './consent'
import type { ConsentChoice } from './consent'
import { pixelDecision } from './decision'
import { loadPixels } from './load'
import { pixelPageView } from './track'

// Read once at module scope: the ids are inlined at build time and cannot change while the app
// runs, and re-reading them per render would be re-deriving a constant.
const IDS = platformPixelIds()
const CONFIGURED = hasAnyPixel(IDS)

export interface PixelsState {
  /** Ask the visitor. False once they have answered, and false wherever we would not track them. */
  showBanner: boolean
  accept: () => void
  reject: () => void
}

export function usePixels(): PixelsState {
  const { pathname } = useLocation()

  // Read during the FIRST render, not in an effect. An effect would render `null` first and then
  // flash the banner at someone who accepted months ago. Safe to do here because this component
  // never renders during the prerender: scripts/prerender.tsx renders each route element directly
  // rather than mounting AppRouter, and readConsent answers null without storage anyway.
  const [choice, setChoice] = useState<ConsentChoice | null>(
    () => readConsent(PLATFORM_CONSENT_SCOPE),
  )

  // Every rule in one place, so the load and the pageview cannot disagree about who is in scope.
  // See decision.ts for what happened when they were two separate conditions.
  const { load, pageView, banner } = pixelDecision({
    configured: CONFIGURED,
    inScope: isMarketingPath(pathname),
    choice,
  })

  // The single point at which a third-party script may exist. Nothing else calls loadPixels.
  useEffect(() => {
    if (load) loadPixels(IDS)
  }, [load])

  // One pageview per marketing route, the first one included. `pathname` is in the dep array so a
  // move between two marketing routes reports again; `load`/`pageView` going false off a marketing
  // route is what stops a storefront visit from reporting anything. The script itself stays in the
  // document once loaded — an SPA cannot unload it — but it is never told anything again.
  useEffect(() => {
    if (pageView) pixelPageView(IDS)
  }, [pageView, pathname])

  return {
    showBanner: banner,
    accept: () => {
      writeConsent(PLATFORM_CONSENT_SCOPE, 'accepted')
      setChoice('accepted')
    },
    reject: () => {
      writeConsent(PLATFORM_CONSENT_SCOPE, 'rejected')
      setChoice('rejected')
    },
  }
}
