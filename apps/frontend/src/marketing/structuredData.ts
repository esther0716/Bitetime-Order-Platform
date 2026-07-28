// Schema.org markup for the marketing page, as JSON-LD.
//
// Written at runtime rather than parked in index.html, for two reasons that both matter:
//
//  1. index.html is served for EVERY path (vercel.json rewrites), so a static FAQPage block would
//     claim that every storefront and every legal page is this FAQ. Same trap as the canonical
//     tag — see canonical.ts.
//  2. The page is bilingual, and structured data has to describe what the visitor can actually
//     read. A Chinese page carrying English FAQ markup is a mismatch, and Google treats markup
//     that disagrees with the visible page as a reason to distrust all of it.
//
// The FAQ entries come from faq.ts — the same array the accordion renders — so the markup cannot
// drift from the page. Nothing here states a price: the plan prices are resolved per region at
// runtime, and an Offer frozen into a build is a wrong price the moment they move.

import { useEffect } from 'react'
import type { Lang } from '../types'
import { FAQ } from './faq'

const NAME = 'TinyOrder'

const DESCRIPTION = {
  en: 'An online ordering page for home kitchens and small food businesses: one branded storefront link, a menu you control, delivery fees by region or distance, and every order in one place.',
  zh: '专为家厨与小型食品业者打造的在线接单页面：专属店面链接、自主管理的菜单、依地区或距离计算的运费，所有订单集中一处。',
}

/**
 * The `@graph` the landing page publishes.
 *
 * `origin` is passed in rather than read from `window` so this stays pure and testable, and so the
 * markup names whatever host actually served the page — production, a Vercel preview, or a laptop.
 */
export function landingStructuredData(origin: string, lang: Lang): object {
  const base = origin.replace(/\/+$/, '')
  const pick = <T>(en: T, zh: T) => (lang === 'zh' ? zh : en)

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${base}/#organization`,
        name: NAME,
        url: `${base}/`,
        description: pick(DESCRIPTION.en, DESCRIPTION.zh),
        logo: {
          '@type': 'ImageObject',
          url: `${base}/android-chrome-512x512.png`,
          width: 512,
          height: 512,
        },
      },
      {
        '@type': 'WebSite',
        '@id': `${base}/#website`,
        url: `${base}/`,
        name: NAME,
        description: pick(DESCRIPTION.en, DESCRIPTION.zh),
        publisher: { '@id': `${base}/#organization` },
        inLanguage: pick('en', 'zh'),
      },
      {
        // What the product IS. `applicationCategory` and `operatingSystem` are the two properties
        // that make this more than a name — it runs in a browser, and it is a business tool.
        '@type': 'SoftwareApplication',
        '@id': `${base}/#app`,
        name: NAME,
        url: `${base}/`,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description: pick(DESCRIPTION.en, DESCRIPTION.zh),
        publisher: { '@id': `${base}/#organization` },
      },
      {
        '@type': 'FAQPage',
        '@id': `${base}/#faq`,
        inLanguage: pick('en', 'zh'),
        mainEntity: FAQ.map(entry => ({
          '@type': 'Question',
          name: pick(entry.q.en, entry.q.zh),
          acceptedAnswer: {
            '@type': 'Answer',
            text: pick(entry.a.en, entry.a.zh),
          },
        })),
      },
    ],
  }
}

/** Keeps one `<script type="application/ld+json">` in `<head>` for as long as the page is mounted. */
export function useLandingStructuredData(lang: Lang): void {
  useEffect(() => {
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.dataset.structuredData = 'landing'
    script.textContent = JSON.stringify(landingStructuredData(window.location.origin, lang))
    document.head.appendChild(script)
    // Removed on unmount, so navigating to a storefront does not leave this page's FAQ behind
    // claiming to describe that shop.
    return () => script.remove()
  }, [lang])
}
