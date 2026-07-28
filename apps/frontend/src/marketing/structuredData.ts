// The landing page's own Schema.org markup: its FAQ.
//
// The site's IDENTITY — Organization, WebSite, SoftwareApplication — is NOT here. It is a static
// block in index.html, because a crawler that does not execute JavaScript (most of the LLM ones)
// must still be able to answer "who publishes this", and because identity is true on every route,
// which is what makes it safe in a file served for every path.
//
// The FAQ is the opposite on both counts, which is why it stays here:
//
//  1. It is true of ONE page. index.html is served for every path (vercel.json rewrites), so a
//     static FAQPage block would claim that every storefront and every legal page is this FAQ.
//     Same trap as the canonical tag — see canonical.ts.
//  2. It is bilingual, and structured data has to describe what the visitor can actually read. A
//     Chinese page carrying English FAQ markup is a mismatch, and Google treats markup that
//     disagrees with the visible page as a reason to distrust all of it.
//
// The entries come from faq.ts — the same array the accordion renders — so the markup cannot drift
// from the page. Nothing here states a price: the plan prices are resolved per region at runtime,
// and an Offer frozen into a build is a wrong price the moment they move.

import { useEffect } from 'react'
import type { Lang } from '../types'
import { SITE_URL } from '../site'
import { FAQ } from './faq'

/**
 * The landing page's FAQ, as a Schema.org `FAQPage`.
 *
 * Identified against `SITE_URL` rather than the serving origin, so it hangs off the same
 * Organization node the static block in index.html declares — on a preview deployment too, where
 * the alternative would be a second, orphaned identity.
 */
export function landingStructuredData(lang: Lang): object {
  const pick = <T>(en: T, zh: T) => (lang === 'zh' ? zh : en)

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SITE_URL}/#faq`,
    url: `${SITE_URL}/`,
    inLanguage: pick('en', 'zh'),
    isPartOf: { '@id': `${SITE_URL}/#website` },
    publisher: { '@id': `${SITE_URL}/#organization` },
    mainEntity: FAQ.map(entry => ({
      '@type': 'Question',
      name: pick(entry.q.en, entry.q.zh),
      acceptedAnswer: {
        '@type': 'Answer',
        text: pick(entry.a.en, entry.a.zh),
      },
    })),
  }
}

/** The prerendered block, or the one a previous run of this effect left behind. */
const SELECTOR = 'script[data-structured-data="landing-faq"]'

/** Keeps exactly one `<script type="application/ld+json">` in `<head>` while the page is mounted. */
export function useLandingStructuredData(lang: Lang): void {
  useEffect(() => {
    // ADOPT, do not append: the build prerenders this block into index.html (see
    // scripts/prerender.tsx) so a crawler that runs no JavaScript still gets the FAQ. Appending a
    // second one would publish the same @id twice — and on a Chinese page, twice in two languages.
    const script =
      document.head.querySelector<HTMLScriptElement>(SELECTOR) ?? document.createElement('script')
    script.type = 'application/ld+json'
    script.dataset.structuredData = 'landing-faq'
    script.textContent = JSON.stringify(landingStructuredData(lang))
    if (!script.isConnected) document.head.appendChild(script)
    // Removed on unmount — including when it was the prerendered one — so navigating to a
    // storefront does not leave this page's FAQ behind claiming to describe that shop.
    return () => script.remove()
  }, [lang])
}
