// Put a marketing page at its top when you arrive on it.
//
// The app does not restore scroll on navigation — a route swap leaves the window wherever the last
// page was. That was invisible while `/` was the only marketing page and `#pricing` was an anchor
// inside it, and stopped being invisible the moment /pricing became a route of its own (#169):
// clicking "See how TinyOrder works" from the foot of the pricing page dropped the visitor into the
// middle of the landing page, which reads as a broken link rather than a scroll position.
//
// SCOPED TO THE MARKETING ROUTES on purpose. A blanket scroll-to-top in the router would also fire
// on the dashboard's hash-driven tab switches and on a storefront's own in-page navigation, where
// staying put is the correct behaviour and this would be a regression dressed as a fix.
//
// `instant`, NOT `auto`: `auto` does not mean "immediately", it means "defer to the CSS", and
// index.css sets `html { scroll-behavior: smooth }` — which never completes in a backgrounded tab.
// Same reasoning, and same wording, as legal/LegalPage.tsx.

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export function useTopOnRouteChange(): void {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    // A fragment is a request for a specific place on the page and outranks this — the landing
    // page's own #pricing and #faq links still work, from any page.
    const target = hash ? document.getElementById(hash.slice(1)) : null
    if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' })
    else window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname, hash])
}
