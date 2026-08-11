// The ONE file that knows this is the platform's own tracking.
//
// Everything it calls takes its inputs as arguments and reads no environment and no route table.
// That is what lets the merchant-pixel feature (#220) add a sibling hook — ids off MerchantContext,
// scope `shop:<slug>` — and reuse load, track, consent and the banner untouched.

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { platformPixelIds, hasAnyPixel } from './ids'
import { isMarketingPath } from './marketingPaths'
import { readConsent, writeConsent, PLATFORM_CONSENT_SCOPE } from './consent'
import type { ConsentChoice } from './consent'
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
  const onMarketingPath = isMarketingPath(pathname)

  // Read during the FIRST render, not in an effect. An effect would render `null` first and then
  // flash the banner at someone who accepted months ago. Safe to do here because this component
  // never renders during the prerender: scripts/prerender.tsx renders each route element directly
  // rather than mounting AppRouter, and readConsent answers null without storage anyway.
  const [choice, setChoice] = useState<ConsentChoice | null>(
    () => readConsent(PLATFORM_CONSENT_SCOPE),
  )

  // The single point at which a third-party script may exist. Nothing else calls loadPixels.
  useEffect(() => {
    if (!CONFIGURED || choice !== 'accepted') return
    loadPixels(IDS)
  }, [choice])

  // One pageview per marketing route, the first one included. A non-marketing route reports
  // nothing: the script stays in the document because an SPA cannot unload it, but it is never
  // told anything — which is how a storefront visit reaches no ad account.
  useEffect(() => {
    if (!CONFIGURED || choice !== 'accepted' || !onMarketingPath) return
    pixelPageView()
  }, [choice, onMarketingPath, pathname])

  return {
    showBanner: CONFIGURED && onMarketingPath && choice === null,
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
