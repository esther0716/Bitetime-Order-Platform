import { useSession } from '../SessionContext'
import { formatMoney } from '../currency'
import { productImageUrl } from '../store'
import { useSampleShops } from '../useSampleShops'
import { Reveal } from './LandingMotion'
import { sectionTitle } from './ctaStyles'

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}

// Real shops (merchants.is_sample), NON-clickable preview cards — no <Link>/<a href> anywhere in
// this file. That is deliberate: the landing page used to link straight into a live storefront
// (`/s/bitetime-co`) and customers placed real orders on it (fcd0a57). This carousel replaces
// that link entirely rather than reintroducing it across more shops. See
// docs/superpowers/specs/2026-08-04-sample-shops-carousel-design.md.
export default function SampleShopsCarousel() {
  const { t, lang } = useSession()
  const { shops } = useSampleShops()

  if (shops.length === 0) return null

  return (
    <section className="border-t border-clay-border px-8 py-16 max-[600px]:px-5 max-[600px]:py-10">
      <Reveal>
        <h2 className={sectionTitle}>
          {t('Real shops on TinyOrder', 'TinyOrder 上的真实店铺')}
        </h2>
        <div
          className="flex overflow-x-auto snap-x snap-mandatory gap-5 pb-2 max-w-[900px] mx-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {shops.map((shop) => (
            <div
              key={shop.id}
              className="shrink-0 snap-start w-[260px] rounded-2xl border-[1.5px] border-clay-border bg-surface-raised p-5 text-left shadow-[0_16px_40px_-18px_rgba(43,10,16,0.22)]"
            >
              <div className="flex items-center gap-3 pb-4 border-b border-divider">
                {shop.products[0]?.imagePath ? (
                  <img
                    src={productImageUrl(shop.products[0].imagePath)}
                    alt=""
                    className="h-10 w-10 rounded-round object-cover shrink-0"
                  />
                ) : (
                  <span className="grid h-10 w-10 place-items-center rounded-round bg-oxblood-tint font-heading text-[15px] font-medium text-oxblood shrink-0">
                    {initials(shop.name)}
                  </span>
                )}
                <p className="min-w-0 truncate font-heading text-[15px] font-medium text-ink leading-tight">
                  {shop.name}
                </p>
              </div>
              {shop.products.length > 0 && (
                <ul className="list-none m-0 p-0 flex flex-col divide-y divide-divider">
                  {shop.products.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                      <span className="text-[13.5px] text-ink truncate">
                        {lang === 'zh' && p.nameZh ? p.nameZh : p.name}
                      </span>
                      <span className="font-heading text-[13.5px] font-medium text-oxblood shrink-0">
                        {formatMoney(p.price, shop.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  )
}
