import { useState } from 'react'
import { Check } from 'lucide-react'
import { useSession } from '../SessionContext'
import { startCheckout } from '../store'
import { trackEvent } from '../analytics/events'
import { formatMoney } from '../currency'
import { usePlatformPricing } from '../usePlatformPricing'
import { PRICING_TIERS } from '../marketing/pricingTiers'
import { defaultReactivation, yearlySavingPercent, type Cycle } from './reactivationChoice'
import OrdersView from './OrdersView'
import TrialFeedbackPrompt from './TrialFeedbackPrompt'
import { Button } from '@/components/ui/button'

// Suspended = the subscription lapsed (trial ended unpaid, dunning exhausted)
// or a superadmin action. The storefront is closed to customers; the merchant
// keeps read-only access to their order history and one path back: pay.
// Reactivation Checkout never grants a second trial (backend guarantees it).
//
// The one choice left is the billing cycle, offered on the same axis the signup flow does and
// priced from the same live Stripe figures. What the subscription includes comes from
// PRICING_TIERS rather than a local list, for the reason that file states: a feature list
// copy-pasted into a second place is a product that quietly disagrees with itself.
export default function SuspendedScreen() {
  const { t, lang, merchant } = useSession()
  const { pricing } = usePlatformPricing()
  const [cycle, setCycle] = useState<Cycle>(defaultReactivation(merchant).cycle)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function reactivate() {
    setBusy(true); setErr('')
    // Reported BEFORE the redirect, for the same reason it is in SubscriptionTab: assign() leaves
    // this page and nothing after it runs. `from` is what separates a reactivation from an
    // ordinary upgrade in the funnel.
    trackEvent('billing_checkout_started', {
      billing: cycle === 'yearly' ? 'yearly' : 'monthly',
      from: 'suspended',
    })
    const r = await startCheckout({ billing: cycle })
    if (r.ok) window.location.assign(r.data)
    else {
      setErr(r.error.message || t('Could not start checkout', '无法开始结账'))
      setBusy(false)
    }
  }

  const saving = yearlySavingPercent(pricing.prices.pro.monthly, pricing.prices.pro.yearly)
  const per = cycle === 'yearly' ? t('/year', '/年') : t('/month', '/月')

  return (
    <div className="w-full max-w-[720px] mx-auto pt-8 px-4 pb-12">
      <div
        role="status"
        className="px-4 py-3 mb-6 rounded-md border-[0.5px] text-[13px] leading-[1.5] bg-danger-100 text-danger-fg border-danger-fg/25 font-medium"
      >
        {t('Your shop is suspended — your subscription has ended. Subscribe below to reopen it.',
           '您的店铺已暂停——订阅已结束。请在下方订阅以恢复营业。')}
      </div>

      <div className="bg-card border-[0.5px] border-border rounded-2xl p-5 mb-6 w-full box-border max-sm:p-4">
        <h2 className="font-heading text-[15px] font-medium text-primary mb-4">
          {t('Reopen your shop', '重新开张')}
        </h2>

        {/* Cycle first, because it reprices the card below. */}
        <div
          role="radiogroup"
          aria-label={t('Billing cycle', '付费周期')}
          className="inline-flex p-[3px] mb-5 rounded-pill border-[0.5px] border-border bg-card"
        >
          {(['monthly', 'yearly'] as Cycle[]).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cycle === c}
              onClick={() => setCycle(c)}
              className={`py-[5px] px-4 rounded-pill text-[13px] cursor-pointer transition-colors ${
                cycle === c ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-primary'
              }`}
            >
              {c === 'monthly' ? t('Monthly', '按月') : t('Yearly', '按年')}
              {/* Only ever rendered from live prices, and only when there is a real saving to
                  claim — see yearlySavingPercent. */}
              {c === 'yearly' && saving !== null && (
                <span className={cycle === c ? 'ml-1.5 opacity-90' : 'ml-1.5 text-primary'}>
                  {t(`− ${saving}%`, `省 ${saving}%`)}
                </span>
              )}
            </button>
          ))}
        </div>

        {(() => {
          const tier = PRICING_TIERS[0]
          const price = pricing.prices.pro[cycle]
          return (
            <div className="w-full p-4 mb-5 rounded-xl border-[0.5px] border-primary bg-brand-100">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="font-heading text-[15px] font-medium text-primary">
                  {tier.name[lang]}
                </span>
                <span className="text-[15px] font-medium text-foreground">
                  {formatMoney(price, pricing.currency)}
                  <span className="text-[12px] text-muted-foreground">{per}</span>
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground mb-2">{tier.blurb[lang]}</p>
              <ul className="flex flex-col gap-1">
                {tier.features.map((f) => (
                  <li key={f.en} className="flex items-start gap-1.5 text-[12px] text-foreground">
                    <Check size={13} strokeWidth={2} className="text-primary shrink-0 mt-[3px]" aria-hidden />
                    {f[lang]}
                  </li>
                ))}
              </ul>
            </div>
          )
        })()}

        <Button type="button" size="sm" disabled={busy} onClick={reactivate}>
          {busy ? t('Redirecting…', '跳转中…') : t('Reopen my shop — pay now', '恢复营业——立即付款')}
        </Button>
        {/* Stated because it is the one thing a returning merchant is most likely to assume
            wrongly, and the backend enforces it regardless of what this screen says. */}
        <p className="text-[12px] text-muted-foreground mt-3">
          {t('Reopening starts a new subscription and is charged today — the free trial is one per shop.',
             '恢复营业将开启新的订阅并于今日扣款——免费试用每家店铺仅一次。')}
        </p>
      </div>

      <TrialFeedbackPrompt />
      {err && (
        <div className="text-[13px] text-ink-700 bg-brand-100 border border-border rounded-sm px-[13px] py-[10px] mb-4 leading-[1.5]">
          {err}
        </div>
      )}
      <h2 className="font-heading text-[18px] font-medium text-primary mb-3">
        {t('Your orders', '您的订单')}
      </h2>
      <OrdersView readOnly />
    </div>
  )
}
