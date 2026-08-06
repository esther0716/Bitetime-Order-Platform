// /sample-shops — browse real shops built with TinyOrder.
//
// Reached only by clicking the hero's "See sample shops" button (Landing.tsx) — a page of its
// own, not a landing-page section, so a visitor asking to see shops gets the full list rather
// than a teaser row competing with the rest of the homepage for scroll depth. Not prerendered:
// unlike /pricing or /faq this page has no static content worth baking for a crawler — the shop
// list is fetched client-side and useSampleShops has no fallback data, so a prerendered shell
// would ship empty markup anyway. See docs/superpowers/specs/2026-08-04-sample-shops-carousel-design.md.
import { useSession } from '../SessionContext'
import { MarketingNav, MarketingFooter } from './MarketingChrome'
import { useTopOnRouteChange } from './useTopOnRouteChange'
import { useSampleShops } from '../useSampleShops'
import { Reveal } from './LandingMotion'
import { sectionTitle } from './ctaStyles'
import SampleShopsCarousel from './SampleShopsCarousel'

export default function SampleShopsPage() {
  const { t } = useSession()
  const { shops, loading } = useSampleShops()
  useTopOnRouteChange()

  return (
    <div className="mm-land relative isolate flex flex-col items-stretch min-h-screen font-sans text-ink bg-cream">

      <MarketingNav />

      <section className="px-8 pt-16 pb-16 max-[600px]:px-5 max-[600px]:pt-10 max-[600px]:pb-10">
        <Reveal>
          <h1 className={sectionTitle}>
            {t('Real shops on TinyOrder', 'TinyOrder 上的真实店铺')}
          </h1>
          <p className="-mt-6 mb-10 text-[15px] leading-[1.7] text-ink-soft text-center max-w-[560px] mx-auto">
            {t(
              'A few real shops built with TinyOrder, so you can see what yours could look like.',
              '看看用 TinyOrder 开的真实店铺，了解你的店铺可以是什么样子。',
            )}
          </p>
          {shops.length > 0 ? (
            <SampleShopsCarousel shops={shops} />
          ) : !loading ? (
            <p className="text-center text-[14px] text-rose-muted">
              {t('No sample shops yet — check back soon.', '暂无示例店铺，请稍后再来看看。')}
            </p>
          ) : null}
        </Reveal>
      </section>

      <MarketingFooter />
    </div>
  )
}
