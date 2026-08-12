// The ONE file that knows this app is the thing being measured.
//
// Everything it calls takes its inputs as arguments and reads no route table of its own — the same
// split usePixels.ts uses, and for the same reason.
//
// THE SDK'S AUTOMATIC CAPTURE IS OFF, and that is not a preference. `praxor` captures pageviews by
// patching window.history.pushState/replaceState and captures outbound clicks with a listener on
// document. Both are global to the page, and neither can be told to ignore /s/:slug. This app is
// one SPA, so a visitor reaches a storefront from /pricing with no document load — left to the
// SDK, that navigation reports a pageview out of a merchant customer's browser. See scope.ts.

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { initPraxor } from 'praxor'
import type { PraxorClient } from 'praxor'
import { praxorSettings } from './config'
import { isPlatformPath } from './scope'
import { setAnalyticsClient, trackEvent } from './events'
import type { Billing } from './events'

// Read once at module scope: the settings are inlined at build time and cannot change while the
// app runs, so re-reading them per render would be re-deriving a constant.
const SETTINGS = praxorSettings()

/** The href every signup CTA points at. */
const SIGNUP_PREFIX = '/merchant/signup'

/**
 * `/merchant/signup/yearly`, and also the older `/merchant/signup/pro/yearly` still sitting in
 * inboxes and in Stripe's cancel_url history — hence a scan of the segments rather than a fixed
 * position. See the route comment in AppRouter.tsx.
 */
function billingFromHref(href: string): Billing | undefined {
  const segments = href.split('?')[0].split('#')[0].split('/')
  if (segments.includes('yearly')) return 'yearly'
  if (segments.includes('monthly')) return 'monthly'
  return undefined
}

export function useAnalytics(): void {
  const { pathname } = useLocation()
  const clientRef = useRef<PraxorClient | null>(null)
  const inScope = isPlatformPath(pathname)

  // Created once, and NEVER destroyed. initPraxor is an application-wide singleton and StrictMode
  // mounts every effect twice in development; a cleanup that called destroy() would tear down the
  // client the second mount then reuses. There is nothing to clean up either — with automatic
  // capture and outbound links both off, this client installs no listener of its own.
  useEffect(() => {
    if (!SETTINGS) return
    const client = initPraxor({
      siteId: SETTINGS.siteId,
      ...(SETTINGS.apiUrl ? { apiUrl: SETTINGS.apiUrl } : {}),
      autoCapturePageviews: false,
      trackOutboundLinks: false,
    })
    clientRef.current = client
    setAnalyticsClient(client)
  }, [])

  // One pageview per platform route, the first one included. The path is passed EXPLICITLY rather
  // than left to the SDK: the SDK reads window.location.pathname when it builds the request, and
  // this effect already knows which route it is reporting.
  useEffect(() => {
    if (!inScope) return
    void clientRef.current?.trackPageview(pathname)
  }, [inScope, pathname])

  // One delegated listener instead of a handler in each of the seven components that render a
  // signup CTA. `data-cta` refines the label where a page has more than one; without it the event
  // still arrives, named `link`.
  useEffect(() => {
    if (!SETTINGS || !inScope) return
    function onClick(event: MouseEvent): void {
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest('a[href]')
      if (!link) return
      const href = link.getAttribute('href') ?? ''
      if (href !== SIGNUP_PREFIX && !href.startsWith(`${SIGNUP_PREFIX}/`)) return
      const billing = billingFromHref(href)
      trackEvent('cta_click', {
        from: pathname,
        cta: link.getAttribute('data-cta') ?? 'link',
        ...(billing ? { billing } : {}),
      })
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [inScope, pathname])
}
