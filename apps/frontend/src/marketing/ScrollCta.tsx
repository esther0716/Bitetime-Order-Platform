// The signup card that appears once a reader reaches the end of a marketing page.
//
// One card, mounted by MarketingFooter, so every marketing page has it and no page can be
// forgotten — the footer is the one thing all six of them render. How long a refusal lasts lives
// next door as a pure function (scrollCtaState.ts); what is left here is the browser.
//
// THE TRIGGER IS AN INTERSECTION OBSERVER ON A SENTINEL ABOVE THE FOOTER, not a scroll listener
// measuring how far down the page the reader is, and the difference is the bug it fixes. A scroll
// listener only ever learns about scrolling that happens AFTER it is attached: a reader who
// scrolls while the route chunk is still arriving moves the page past the end, the events land on
// nobody, and — since the page is not scrolled again — the card never appears at all. An observer
// reports the sentinel's CURRENT state as soon as it starts observing, so where the reader already
// is counts the same as where they scroll to.
//
// IT RENDERS NO CARD UNTIL THE OBSERVER FIRES, and that is what keeps it out of the prerendered
// markup: scripts/prerender.tsx renders these routes with renderToStaticMarkup, which fires no
// effects, so the card is absent from the HTML a crawler downloads and the pages it measures are
// byte-identical to what they were. The sentinel itself is an empty, zero-height div.

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import { useSession } from '../SessionContext'
import { trackEvent } from '../analytics/events'
import { platformPixelIds, hasAnyPixel } from '../pixels/ids'
import { isMarketingPath } from '../pixels/marketingPaths'
import { readConsent, PLATFORM_CONSENT_SCOPE } from '../pixels/consent'
import { pixelDecision } from '../pixels/decision'
import { dismissalHolds, readDismissedAt, writeDismissal } from './scrollCtaState'
import { ctaPrimary } from './ctaStyles'
import { cn } from '../lib/utils'

// Read once at module scope: the pixel ids are inlined at build time and cannot change while the
// app runs. Same reason usePixels.ts reads them there.
const PIXEL_IDS = platformPixelIds()
const PIXELS_CONFIGURED = hasAnyPixel(PIXEL_IDS)

/**
 * Is the advertising-consent banner on screen right now?
 *
 * It is `fixed inset-x-0 bottom-0 z-50`, so a card in the same corner would sit under it. Asked
 * through the SAME decision function usePixels asks, rather than a second copy of the rule — this
 * has to be the banner's real answer, including the routes (/for/<slug>) where it never appears.
 *
 * Read at the moment the card wants to show rather than once at mount: the visitor may answer the
 * banner while reading, and the next scroll then finds the corner free.
 */
function consentBannerOpen(pathname: string): boolean {
  return pixelDecision({
    configured: PIXELS_CONFIGURED,
    inScope: isMarketingPath(pathname),
    choice: readConsent(PLATFORM_CONSENT_SCOPE),
  }).banner
}

export default function ScrollCta() {
  const { t, account } = useSession()
  const { pathname } = useLocation()
  const [visible, setVisible] = useState(false)
  // Read during the FIRST render, not in an effect, so a reader who closed the card last week
  // never sees it flash back. Safe here: readDismissedAt answers null without storage, which is
  // what happens during the prerender.
  const [dismissed, setDismissed] = useState(() => dismissalHolds(readDismissedAt(), Date.now()))
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // SIGNED OUT ONLY. `account` is `undefined` while the session is still resolving and `null` when
  // there is nobody, so the test is against null rather than falsiness: anything else — a merchant,
  // a superadmin, a shop's customer, or a session not yet read — leaves the card off. Erring toward
  // silence is deliberate; the visitor this card is for is the one with no account at all, and a
  // card that flashes up while the session loads would be shown to exactly the wrong people.
  const signedOut = account === null

  useEffect(() => {
    if (visible || dismissed || !signedOut) return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      // Asked HERE rather than at mount, and the observer is deliberately left connected when the
      // answer is yes: a reader who answers the banner and carries on scrolling crosses the
      // sentinel again, and that second crossing is the one that shows the card.
      if (consentBannerOpen(pathname)) return
      setVisible(true)
      trackEvent('scroll_cta_shown', { from: pathname })
    // The sentinel sits directly above the footer, so it enters the viewport as the footer does —
    // 120px early, so the card is on screen while the closing section is still being read rather
    // than after the reader has stopped.
    }, { rootMargin: '0px 0px 120px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [visible, dismissed, signedOut, pathname])

  // ONLY A CLOSE IS REMEMBERED. Closing the card is a refusal and is worth honouring for a month;
  // clicking it is not, so a reader who follows the link and then comes back to read more is asked
  // again. The click needs no handler at all — following the link unmounts this page's footer, and
  // the card with it.
  function close(): void {
    writeDismissal()
    setDismissed(true)
    setVisible(false)
    trackEvent('scroll_cta_dismissed', { from: pathname })
  }

  return (
    <>
      {/* The mark the observer watches, in the page's own flow directly above the footer. Empty and
          zero-height, so it changes no layout and adds nothing to the prerendered markup a crawler
          reads; it is rendered whether or not the card is, because it is what decides. */}
      <div ref={sentinelRef} aria-hidden="true" className="h-0" />
      {visible && (
        <div
          role="complementary"
          aria-label={t('Start your shop', '开始建店')}
          // z-40 keeps it under the consent banner (z-50) and under every dialog; the banner is
          // suppressed above anyway, so the two can never share the corner.
          // The entry fade is the app's own `.page-enter` keyframe rather than a JS animation, for the
          // reason at the top of motion.tsx: the resting style is the visible one, so an animation
          // that never runs leaves a readable card instead of an invisible one. Reduced motion is
          // handled globally by index.css.
          // The width caps with a PERCENTAGE, never a `vw` unit: a fixed box's containing block IS the
          // viewport, so 100% is the same measurement without the failure src/layout.test.ts exists to
          // stop — an in-app browser that lays the page out off screen resolves `100vw` as 0.
          className={cn(
            'page-enter fixed z-40 bottom-4 right-4 w-[360px] max-w-[calc(100%-2rem)]',
            'max-[600px]:left-4 max-[600px]:right-4 max-[600px]:w-auto',
            'rounded-lg border border-border bg-card p-5 pr-10',
            'shadow-[0_8px_28px_rgba(0,0,0,0.10)]',
          )}
        >
          <button
            type="button"
            onClick={close}
            aria-label={t('Close', '关闭')}
            className="absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground [transition:color_0.15s,background_0.15s] hover:bg-brand-100 hover:text-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
          <p className="font-heading text-[16px] font-medium text-foreground leading-[1.35] mb-2">
            {t('Ready to take your own orders?', '准备好自己收单了吗？')}
          </p>
          <p className="text-[13px] leading-[1.65] text-muted-foreground mb-4">
            {t(
              'Set up your shop in minutes. Seven days free, and no card to start.',
              '几分钟就能开好店。七天免费，无需信用卡。',
            )}
          </p>
          {/* `data-cta` is what the delegated listener in useAnalytics reports as `cta_click`, so the
              click half of this funnel needs no handler of its own — only the close does. */}
          <Link
            to="/merchant/signup"
            data-cta="scroll-end"
            className={cn(ctaPrimary, 'block w-full text-center')}
          >
            {t('Start your shop', '开始建店')}
          </Link>
        </div>
      )}
    </>
  )
}
