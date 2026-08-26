import { sampleShopScreenshotUrl, type CapturedSampleShop } from '../store'
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from '../components/ui/carousel'

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
//
// ONE CARD KIND, and that is the fix for what visitors were complaining about. This used to fall
// back to an avatar-and-product-list card for a shop whose screenshot had not been captured yet,
// so a row could hold two screenshots and one list card — three shops rendered three different
// ways, which reads as a broken page rather than as a gallery. A shop without a screenshot is now
// filtered out upstream (useSampleShops) and simply is not in the row. The screenshot arrives
// within minutes of the superadmin flagging the shop: POST /api/admin/set-merchant-sample asks
// GitHub Actions to capture it there and then.
//
// Fixed aspect-[3/4], never h-full: with h-full the card took its height from the TALLEST card in
// the row, so where a 390x844 capture got cropped depended on which other shops happened to be
// flagged. Every card is the same shape now, cropped from the top.
export default function SampleShopsCarousel({ shops }: { shops: CapturedSampleShop[] }) {
  return (
    <Carousel opts={{ align: 'start' }} className="max-w-[900px] mx-auto">
      <CarouselContent>
        {shops.map((shop) => (
          <CarouselItem key={shop.id} className="basis-1/3">
            <div className="overflow-hidden rounded-2xl border-[0.5px] border-border bg-card shadow-elev-3">
              <img
                src={sampleShopScreenshotUrl(shop.screenshotPath)}
                alt={shop.name}
                className="block w-full aspect-[3/4] object-cover object-top"
              />
            </div>
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
