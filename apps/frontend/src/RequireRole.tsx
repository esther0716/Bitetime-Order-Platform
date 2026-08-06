import { useState, lazy } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useSession } from './SessionContext'
import type { Role } from './types'
import { PageSkeleton } from './components/Loaders'
import { Button } from '@/components/ui/button'
import Wordmark from './components/Wordmark'

// Shown instead of the bounce when we could not read the user's shop at all. A merchant whose
// shop we failed to load is still a merchant: sending them to the marketing page states, as
// fact, something we never learned — and hides the outage that caused it.
function ShopUnreachable() {
  const { t, refreshMerchant } = useSession()
  const [busy, setBusy] = useState(false)

  async function retry() {
    setBusy(true)
    await refreshMerchant()
    setBusy(false)
  }

  return (
    <div className="form-wrap text-center pt-8 pb-12">
      <div className="text-center mb-10">
        <h1><Wordmark className="h-8 mx-auto" /></h1>
        <p className="font-heading text-[13px] italic text-muted-foreground mt-[5px]">{t('Merchant Portal', '商家入口')}</p>
      </div>
      <div className="bg-card border-[0.5px] border-border rounded-2xl p-5 mb-6 w-full box-border text-left">
        <p className="text-muted-foreground text-[14px] leading-[1.6] mt-1.5">
          {t(
            "We couldn't reach the server to load your shop. You are still signed in — this is on our side, not yours.",
            '我们暂时无法连接服务器来加载您的店铺。您仍处于登录状态——这是我们这边的问题。',
          )}
        </p>
      </div>
      <Button variant="default" size="md" onClick={retry} disabled={busy}>
        {busy ? t('Retrying…', '重试中…') : t('Try again', '重试')}
      </Button>
    </div>
  )
}

// Lazy so the merchant-signup half of the bundle stays out of the guard every route imports.
// Rendered under AppRouter's own Suspense.
const FinishSignupScreen = lazy(() => import('./merchant/FinishSignupScreen'))

export default function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { role: current, loading, merchantUnknown, account } = useSession()
  if (loading) return <PageSkeleton />
  if (current === 'superadmin') return children
  if (current !== role) {
    // A lookup that never landed is not an answer. Treating it as one is what turned an
    // unreachable API into "you are not a merchant" and bounced every login to the landing
    // page, silently (#98) — the role here is derived from a shop row we failed to read.
    if (merchantUnknown) return <ShopUnreachable />
    // A SIGNED-IN user asking for the merchant console who owns no shop is the other half of
    // merchant signup, not a stranger: email confirmation splits account creation from shop
    // creation, and the shop half is lost whenever the sign-in between them fails. Bouncing
    // them to the marketing page is what made that unrecoverable. Signed OUT is still a
    // bounce — there is no one to finish signing up.
    if (role === 'merchant' && account) return <FinishSignupScreen />
    return <Navigate to="/" replace />
  }
  return children
}
