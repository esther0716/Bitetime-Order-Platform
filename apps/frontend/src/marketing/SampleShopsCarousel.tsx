import { useSession } from '../SessionContext'
import { formatMoney } from '../currency'
import { productImageUrl, sampleShopScreenshotUrl, type SampleShop } from '../store'
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from '../components/ui/carousel'

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}

// Real shops (merchants.is_sample), NON-clickable — no <Link>/<a href> anywhere in this file.
// That is deliberate: the landing page used to link straight into a live storefront
// (`/s/bitetime-co`) and customers placed real orders on it (fcd0a57). This carousel replaces
// that link entirely rather than reintroducing it across more shops. See
// docs/superpowers/specs/2026-08-04-sample-shops-carousel-design.md.
//
// Built on shadcn's Carousel (embla-carousel-react) rather than a bare scroll-snap row: with more
// than 3-4 shops the row scrolled past the container edge with no affordance telling a visitor
// there was more to see. Prev/Next buttons only render past one shop — a single card has nothing
// to scroll to.
export default function SampleShopsCarousel({ shops }: { shops: SampleShop[] }) {
  const { lang } = useSession()

  return (
    <Carousel opts={{ align: 'start' }} className="max-w-[900px] mx-auto">
      <CarouselContent>
        {shops.map((shop) => (
          <CarouselItem key={shop.id} className="basis-1/3">
            {shop.screenshotPath ? (
              // Replaces the avatar+product-list block ENTIRELY — one card, one representation
              // of the shop, never both. A static <img>, same as every other card: no <a>/<Link>.
              <div className="h-full overflow-hidden rounded-2xl border-[0.5px] border-border bg-card shadow-elev-3">
                <img
                  src={sampleShopScreenshotUrl(shop.screenshotPath)}
                  alt={shop.name}
                  className="block w-full h-full object-cover object-top"
                />
              </div>
            ) : (
              <div className="h-full rounded-2xl border-[0.5px] border-border bg-card p-5 text-left shadow-elev-3">
                <div className="flex items-center gap-3 pb-4 border-b border-border">
                  {shop.products[0]?.imagePath ? (
                    <img
                      src={productImageUrl(shop.products[0].imagePath)}
                      alt=""
                      className="h-10 w-10 rounded-round object-cover shrink-0"
                    />
                  ) : (
                    <span className="grid h-10 w-10 place-items-center rounded-round bg-brand-100 font-heading text-[15px] font-medium text-primary shrink-0">
                      {initials(shop.name)}
                    </span>
                  )}
                  <p className="min-w-0 truncate font-heading text-[15px] font-medium text-foreground leading-tight">
                    {shop.name}
                  </p>
                </div>
                {shop.products.length > 0 && (
                  <ul className="list-none m-0 p-0 flex flex-col divide-y divide-border">
                    {shop.products.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                        <span className="text-[13.5px] text-foreground truncate">
                          {lang === 'zh' && p.nameZh ? p.nameZh : p.name}
                        </span>
                        <span className="font-heading text-[13.5px] font-medium text-primary shrink-0">
                          {formatMoney(p.price, shop.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CarouselItem>
        ))}
      </CarouselContent>
      {shops.length > 1 && (
        <>
          <CarouselPrevious />
          <CarouselNext />
        </>
      )}
    </Carousel>
  )
}
