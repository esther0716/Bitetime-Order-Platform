// The question itself. Knows nothing about ids, routes or storage — it takes two callbacks.
//
// ACCEPT AND REJECT ARE THE SAME CONTROL: same variant, same size, same place, one after the
// other. A greyed-out, hidden or link-styled Reject beside a filled Accept is the specific pattern
// regulators cite as invalid consent, and it is the one a reviewer is most likely to "tidy"
// without knowing why it is deliberate. Making Accept the filled primary was tried and reverted
// for exactly that reason — a decline that is visibly the lesser button is not a free choice.

import { Link } from 'react-router-dom'
import { useSession } from '../SessionContext'
import { Button } from '../components/ui/button'

export default function ConsentBanner({
  onAccept,
  onReject,
  message,
}: {
  onAccept: () => void
  onReject: () => void
  /**
   * What is being asked, already translated by the caller.
   *
   * A prop, because the two askers are not asking the same question. TinyOrder asks about its
   * own pixels on its own pages; a shop asks about ITS pixel on ITS storefront, and it is the
   * merchant — not TinyOrder — who is the controller of that tracking (#220). The wording below
   * used to be fixed and said the pixels load "never on a shop's page", which the shop pixels
   * made false the moment they shipped.
   */
  message: string
}) {
  const { t } = useSession()
  return (
    <div
      role="region"
      aria-label={t('Advertising cookies', '广告 Cookie')}
      className="fixed inset-x-0 bottom-0 z-50 border-t-[0.5px] border-border bg-card px-4 py-3 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]"
    >
      <div className="mx-auto flex max-w-[720px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-[1.6] text-muted-foreground">
          {message}{' '}
          <Link to="/privacy" className="text-primary underline underline-offset-2">
            {t('Privacy Policy', '隐私政策')}
          </Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={onReject}>
            {t('Reject', '拒绝')}
          </Button>
          <Button variant="outline" size="sm" onClick={onAccept}>
            {t('Accept', '接受')}
          </Button>
        </div>
      </div>
    </div>
  )
}
