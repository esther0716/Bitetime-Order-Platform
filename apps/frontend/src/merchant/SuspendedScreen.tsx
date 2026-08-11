import { useState } from 'react'
import { Check } from 'lucide-react'
import { useSession } from '../SessionContext'
import { startCheckout } from '../store'
import { formatMoney } from '../currency'
import { usePlatformPricing } from '../usePlatformPricing'
import { PRICING_TIERS } from '../marketing/pricingTiers'
import { defaultReactivation, yearlySavingPercent, type Plan, type Cycle } from './reactivationChoice'
import OrdersView from './OrdersView'
import TrialFeedbackPrompt from './TrialFeedbackPrompt'
import { Button } from '@/components/ui/button'

// Suspended = the subscription lapsed (trial ended unpaid, dunning exhausted)
// or a superadmin action. The storefront is closed to customers; the merchant
// keeps read-only access to their order history and one path back: pay.
// Reactivation Checkout never grants a second trial (backend guarantees it).
//
// This screen used to be a single "Reactivate — pay now" button that checked out at whatever
// `merchants.plan` happened to say. Two things were wrong with that. A merchant who wanted to
// come back on a cheaper tier — or a Basic merchant who had decided Pro was worth it — had no way
// to say so from the only screen they can still reach. And after `lapseMerchant` returns a lapsed
// shop to Basic, that button silently sold Basic to a shop that had been Pro, with nothing on the
// page admitting a choice had been made for them.
//
// So the choice is explicit, and it is the SAME two axes the signup flow offers, priced from the
// same live Stripe figures. The tier copy comes from PRICING_TIERS rather than a local list for
// the reason that file states: a tier list copy-pasted into a second place is a product that
// quietly disagrees with itself about what Pro buys.
export default function SuspendedScreen() {
  const { t, lang, merchant } = useSession()
  const { pricing } = usePlatformPricing()
  const initial = defaultReactivation(merchant)
  const [plan, setPlan] = useState<Plan>(initial.plan)
  const [cycle, setCycle] = useState<Cycle>(initial.cycle)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function reactivate() {
    setBusy(true); setErr('')
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
        {t('Your shop is suspended — your subscription has ended. Choose a plan below to reopen it.',
           '您的店铺已暂停——订阅已结束。请在下方选择方案以恢复营业。')}
      </div>

      <div className="bg-card border-[0.5px] border-border rounded-2xl p-5 mb-6 w-full box-border max-sm:p-4">
        <h2 className="font-heading text-[15px] font-medium text-primary mb-4">
          {t('Reopen your shop', '重新开张')}
        </h2>

        {/* Cycle first, because it reprices both tiers below — choosing the plan against a
            monthly figure and then discovering the yearly one is the wrong order to read in. */}
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

        <div role="radiogroup" aria-label={t('Plan', '方案')} className="flex flex-col gap-3 mb-5">
          {PRICING_TIERS.map((tier) => {
            const selected = plan === tier.id
            const price = pricing.prices.pro[cycle]
            return (
              <button
                key={tier.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPlan(tier.id)}
                className={`text-left w-full p-4 rounded-xl border-[0.5px] cursor-pointer transition-colors ${
                  selected ? 'border-primary bg-brand-100' : 'border-border bg-card hover:border-primary/40'
                }`}
              >
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
                {/* The Pro card lists only what Pro ADDS — its `inherits` line is what makes that
                    honest, and is why the tier data carries one. */}
                {tier.inherits && (
                  <p className="text-[12px] text-muted-foreground mb-1">{tier.inherits[lang]}</p>
                )}
                <ul className="flex flex-col gap-1">
                  {tier.features.map((f) => (
                    <li key={f.en} className="flex items-start gap-1.5 text-[12px] text-foreground">
                      <Check size={13} strokeWidth={2} className="text-primary shrink-0 mt-[3px]" aria-hidden />
                      {f[lang]}
                    </li>
                  ))}
                </ul>
              </button>
            )
          })}
        </div>

        <Button type="button" size="sm" disabled={busy} onClick={reactivate}>
          {busy
            ? t('Redirecting…', '跳转中…')
            : t(`Reopen on ${plan === 'pro' ? 'Pro' : 'Basic'} — pay now`,
                `以${plan === 'pro' ? ' Pro ' : '基础版'}恢复营业——立即付款`)}
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
