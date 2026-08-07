import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useSession } from '../SessionContext'
import { syncBilling } from '../store'
import PendingScreen from './PendingScreen'
import SuspendedScreen from './SuspendedScreen'
import CheckoutActivating from './CheckoutActivating'
import Dashboard from './Dashboard'
import { PageSkeleton } from '../components/Loaders'

/**
 * How long to wait before each further attempt at opening a just-paid shop, in ms. Four attempts
 * over ~15s: long enough to cover a webhook that is merely slow, short enough that a merchant is
 * not left watching an ellipsis. The retry button spends a fresh set, and the two together stay
 * under the backend's per-shop rate limit on `/api/billing/sync`.
 */
const ACTIVATION_BACKOFF_MS = [1000, 2000, 4000, 8000]

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export default function MerchantHome() {
  const { slug } = useParams()
  const { t, merchant, ownMerchant, role, impersonate, stopImpersonating, refreshMerchant } = useSession()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { pathname, hash } = useLocation()
  // Records which slug the resolution belongs to, so a stale result from a
  // previous slug doesn't render as ready after navigating between shops.
  const [resolved, setResolved] = useState<{ slug: string | null; notFound: boolean }>({ slug: null, notFound: false })

  // Superadmin viewing a specific shop by slug: load it into the session as the
  // active merchant, and release it when leaving this route.
  useEffect(() => {
    if (!slug) return
    let active = true
    impersonate(slug).then(m => { if (active) setResolved({ slug, notFound: !m }) })
    return () => { active = false; stopImpersonating() }
  }, [slug, impersonate, stopImpersonating])

  // Just back from Stripe Checkout. The shop is opened by `checkout.session.completed`, which
  // usually lands within a second or two — and, when it does not, never lands at all. This used
  // to re-read the shop every two seconds forever and render one line of text meanwhile, so a
  // merchant who had been charged and whose webhook was lost had no error, no retry and no way
  // off the page (the screen this replaced is described in CheckoutActivating.tsx).
  //
  // So it no longer waits on the webhook alone: each attempt asks the backend to reconcile the
  // shop against Stripe directly (`POST /api/billing/sync`), which opens it whether or not the
  // event ever arrived. The attempts are BOUNDED, and running out is a state the merchant is
  // shown rather than an ellipsis that never resolves.
  const justPaid = params.get('checkout') === 'success'
  const [stalled, setStalled] = useState(false)
  const [attemptKey, setAttemptKey] = useState(0)

  // The shop is open: drop the marker so a refresh (or the Back button) does not re-enter this.
  //
  // Navigated rather than `setSearchParams({})`, which writes a partial path of just the query
  // and so takes the HASH down with it. Checkout returns to `?checkout=success#settings/
  // subscription` precisely so the new subscriber lands on the tab they bought from, and that
  // deep link was being dropped at this line — every paid merchant arrived on Overview instead.
  useEffect(() => {
    if (slug || !justPaid || ownMerchant?.status !== 'active') return
    navigate({ pathname, hash }, { replace: true })
  }, [slug, justPaid, ownMerchant?.status, navigate, pathname, hash])

  // Held in a ref because `refreshMerchant` is a new function on every provider render: as a
  // dependency it would restart the sequence below on each one, which is an unbounded loop of
  // Stripe calls rather than four.
  const refresh = useRef(refreshMerchant)
  useEffect(() => { refresh.current = refreshMerchant })

  const activating = !slug && justPaid && !!ownMerchant && ownMerchant.status !== 'active'
  useEffect(() => {
    if (!activating) return
    let alive = true
    void (async () => {
      for (const wait of ACTIVATION_BACKOFF_MS) {
        const r = await syncBilling()
        if (!alive) return
        // `merchantStatus` is the shop's status AFTER the reconcile, so this needs no re-read to
        // know it worked — the refresh below is only to move the UI.
        if (r.ok && r.data.merchantStatus === 'active') { await refresh.current(); return }
        // A shop a human closed is not reopened by paying, and the backend will not do it. Stop
        // asking rather than spend the remaining attempts on a refusal that cannot change.
        if (r.ok && r.data.reason === 'suspended_by_admin') break
        await delay(wait)
        if (!alive) return
        // The webhook may have landed while we waited; if it did, `activating` goes false and
        // this loop is torn down on the next render.
        await refresh.current()
        if (!alive) return
      }
      setStalled(true)
    })()
    return () => { alive = false }
  }, [activating, attemptKey])

  if (slug) {
    if (role !== 'superadmin') return <Navigate to="/" replace />
    const ready = resolved.slug === slug
    if (!ready || !merchant) return <PageSkeleton />
    if (resolved.notFound) return <div className="form-wrap"><h2>{t('Shop not found', '找不到店铺')}</h2></div>
    return <Dashboard />
  }

  // A superadmin owns no shop of their own — send them to the admin console
  // rather than the merchant signup flow.
  if (!ownMerchant) return <Navigate to={role === 'superadmin' ? '/admin' : '/merchant/signup'} replace />
  if (activating) {
    return (
      <CheckoutActivating
        stalled={stalled}
        onRetry={() => { setStalled(false); setAttemptKey(k => k + 1) }}
      />
    )
  }
  if (ownMerchant.status === 'pending') return <PendingScreen />
  if (ownMerchant.status === 'suspended') return <SuspendedScreen />
  return <Dashboard />
}
