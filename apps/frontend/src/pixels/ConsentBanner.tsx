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
}: {
  onAccept: () => void
  onReject: () => void
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
          {t(
            'We use advertising cookies on our own pages to measure our advertising. They load only if you accept, and never on a shop’s page.',
            '我们在自己的页面上使用广告 Cookie 来衡量广告效果。只有你接受后才会加载，店铺页面上永远不会使用。',
          )}{' '}
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
