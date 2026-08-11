// A shop's own pixels, mounted once for the whole storefront (#220).
//
// A CONTEXT rather than a hook each screen calls, because the consent question must be asked once
// per shop, not once per component. Two `useMerchantPixels` calls in one tree would hold two
// copies of the answer and render two banners, and the second one would still be asking after the
// customer had already answered the first.
//
// Mounted BELOW the storefront shell's not-found and status gates, which is what makes
// `inScope: true` inside the hook a fact rather than a claim: this subtree exists only for a shop
// that resolved by slug and is active.

import { createContext, useContext, lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { useSession } from '../SessionContext'
import { useMerchantPixels } from './useMerchantPixels'
import type { PixelEvent, PixelValue } from './track'
import type { Merchant } from '../types'

const ConsentBanner = lazy(() => import('./ConsentBanner'))

type TrackFn = (event: PixelEvent, value?: PixelValue) => void

// A no-op default, so a screen rendered outside a storefront (a test, a future reuse) reports
// nothing instead of throwing. Nothing is the correct behaviour for "no shop here" anyway.
const ShopPixelsContext = createContext<TrackFn>(() => {})

export function ShopPixelsProvider({ merchant, children }: { merchant: Merchant | null; children: ReactNode }) {
  const { t } = useSession()
  const { showBanner, accept, reject, track } = useMerchantPixels(merchant)
  return (
    <ShopPixelsContext.Provider value={track}>
      {children}
      {showBanner && (
        <Suspense fallback={null}>
          {/* The shop's own wording, not the platform's. TinyOrder's banner says its advertising
              cookies never load on a shop's page — true of TinyOrder's, and it is this shop's
              pixel being asked about here. Naming the shop is what makes the question answerable:
              the customer is agreeing to be measured by THIS merchant, who is the controller. */}
          <ConsentBanner
            onAccept={accept}
            onReject={reject}
            message={t(
              `${merchant?.name ?? 'This shop'} uses advertising cookies to measure its own ads. They load only if you agree, and they are this shop’s, not TinyOrder’s.`,
              `${merchant?.name ?? '本店'} 使用广告 Cookie 来衡量自家广告效果。只有你同意后才会加载；这些 Cookie 属于本店，不属于 TinyOrder。`,
            )}
          />
        </Suspense>
      )}
    </ShopPixelsContext.Provider>
  )
}

/**
 * Report one of this shop's events. A no-op unless the shop has a pixel, is Pro, and the customer
 * accepted — so a call site never asks any of those three questions.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useShopPixelTrack = () => useContext(ShopPixelsContext)
