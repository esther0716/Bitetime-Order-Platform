// The ONE file that knows this app is the thing being measured.
//
// Everything it calls takes its inputs as arguments and reads no route table of its own — the same
// split usePixels.ts uses, and for the same reason. The two rules worth testing live next door as
// pure functions (scope.ts, cta.ts); what is left here is the browser.
//
// THE SDK'S AUTOMATIC CAPTURE IS OFF, and that is not a preference. `praxor` captures pageviews by
// patching window.history.pushState/replaceState and captures outbound clicks with a listener on
// document. Both are global to the page, and neither can be told to ignore /s/:slug. This app is
// one SPA, so a visitor reaches a storefront from /pricing with no document load — left to the
// SDK, that navigation reports a pageview out of a merchant customer's browser. See scope.ts.

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { initPraxor } from 'praxor'
import { praxorSettings } from './config'
import { isPlatformPath } from './scope'
import { signupCta } from './cta'
import { setAnalyticsClient, trackEvent, trackPageview } from './events'

// Read once at module scope: the settings are inlined at build time and cannot change while the
// app runs, so re-reading them per render would be re-deriving a constant.
const SETTINGS = praxorSettings()

export function useAnalytics(): void {
  const { pathname } = useLocation()
  const inScope = isPlatformPath(pathname)

  // Created on the first platform route, and NEVER destroyed. initPraxor is an application-wide
  // singleton, so the second and later runs of this effect hand back the same client; a cleanup
  // that called destroy() would tear down the one StrictMode's second mount then reuses. There is
  // nothing to clean up either — with automatic capture and outbound links both off, this client
  // installs no listener of its own.
  //
  // Gated on `inScope` so that a visitor who only ever sees a storefront constructs nothing at
  // all. It sends nothing either way, but "no client exists" is a stronger promise than "a client
  // exists and nobody calls it".
  useEffect(() => {
    if (!SETTINGS || !inScope) return
    setAnalyticsClient(initPraxor({
      siteId: SETTINGS.siteId,
      ...(SETTINGS.apiUrl ? { apiUrl: SETTINGS.apiUrl } : {}),
      autoCapturePageviews: false,
      trackOutboundLinks: false,
    }))
  }, [inScope])

  // One pageview per platform route, the first one included. The path is passed EXPLICITLY rather
  // than left to the SDK: the SDK reads window.location.pathname when it builds the request, and
  // this effect already knows which route it is reporting.
  useEffect(() => {
    if (!inScope) return
    trackPageview(pathname)
  }, [inScope, pathname])

  // One delegated listener instead of a handler in each of the seven components that render a
  // signup CTA. `data-cta` names which one; a CTA without the attribute still reports, as `link`.
  useEffect(() => {
    if (!SETTINGS || !inScope) return
    function onClick(event: MouseEvent): void {
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest('a[href]')
      if (!link) return
      const cta = signupCta(link.getAttribute('href') ?? '')
      if (!cta) return
      trackEvent('cta_click', {
        from: pathname,
        cta: link.getAttribute('data-cta') ?? 'link',
        ...cta,
      })
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [inScope, pathname])
}
