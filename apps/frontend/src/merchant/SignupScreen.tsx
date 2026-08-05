import { useState, useEffect } from 'react'
import { useSearchParams, useParams, Link } from 'react-router-dom'
import { signUp, signIn, createMerchant, startCheckout } from '../store'
import { toSlugBase } from '../slug'
import { useSession } from '../SessionContext'
import { usePlatformPricing } from '../usePlatformPricing'
import { formatMoney, CURRENCIES, CURRENCY_CODES, DEFAULT_CURRENCY, currencyDef } from '../currency'
import type { CurrencyCode } from '../currency'
import BusinessNaturePicker from '../components/BusinessNaturePicker'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../components/ui/select'
import Wordmark from '../components/Wordmark'

const PLANS = ['basic', 'pro']
const CYCLES = ['monthly', 'yearly']

/**
 * The first of `candidates` that is one of `allowed`, else `fallback`.
 *
 * Two candidates, in order, because the plan reaches this screen two ways. The path segment
 * (`/merchant/signup/pro/yearly`) is what the pricing cards link to — a query string is what a
 * link auditor and a human both read as an unfriendly URL. The query string (`?plan=pro`) is what
 * Stripe's `cancel_url` sends back and what any link already sitting in an inbox still says, so
 * it keeps working rather than silently landing everyone on Basic.
 */
function pick(allowed: string[], candidates: (string | null | undefined)[], fallback: string) {
  return candidates.find(c => c != null && allowed.includes(c)) ?? fallback
}

export default function SignupScreen() {
  const { t, lang, refreshMerchant } = useSession()
  const { pricing } = usePlatformPricing()
  const [params] = useSearchParams()
  const path = useParams()

  const plan = pick(PLANS, [path.plan, params.get('plan')], 'basic')
  const billing = pick(CYCLES, [path.billing, params.get('billing')], 'monthly')
  const canceled = params.get('canceled') === '1'
  const ref = params.get('ref') ?? undefined

  const [name, setName] = useState('')
  // No default (#161): pre-selecting an industry would collect a guess from every merchant who
  // never opened the dropdown, on the one field that exists to be counted. Submit stays disabled
  // until they pick.
  const [businessNature, setBusinessNature] = useState('')
  // Chosen once, here, and never editable again (Shop Settings only displays it) — so unlike
  // businessNature this one DOES default, to MYR: it isn't a field the platform needs an honest
  // "never chose" signal on, just a sane starting price unit most shops won't touch.
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const [slugPreview, setSlugPreview] = useState('shop-…')
  useEffect(() => {
    let active = true
    toSlugBase(name).then(base => { if (active) setSlugPreview(base || 'shop-…') })
    return () => { active = false }
  }, [name])

  const planName = plan === 'pro' ? 'Pro' : t('Basic', '基础版')
  const cycleName = billing === 'yearly' ? t('Yearly', '按年') : t('Monthly', '按月')
  const planPrices = pricing.prices[plan as 'basic' | 'pro']
  const perMoAmount = billing === 'yearly' ? planPrices.yearly / 12 : planPrices.monthly

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true); setMsg('')
    try {
      // The shop details ride along on the auth user. With email confirmation on, the sign-in
      // below fails and `createMerchant` never runs — parked, the shop is created for them the
      // moment they confirm and log in, instead of dying with this page. See pendingShop.ts.
      await signUp(name, email, password, { name, businessNature, currency, plan: plan as 'basic' | 'pro', billing: billing as 'monthly' | 'yearly', ref })
      try {
        await signIn(email, password)
      } catch {
        setMsg(t('Account created. Check your email to confirm, then log in — we’ll finish setting up your shop for you.',
                 '账号已创建。请查收邮件确认后登录，我们会为你完成店铺设置。'))
        setBusy(false); return
      }
      const created = await createMerchant({ name, plan, billing, referredByCode: ref, businessNature, currency })
      if (!created.ok) { setMsg(created.error.message || t('Something went wrong.', '出错了。')); setBusy(false); return }
      await refreshMerchant()
      if (plan === 'basic') {
        // Cardless trial: no Checkout. The backend provisioned the trial and activated the shop
        // during createMerchant, so this lands on the dashboard. If Stripe refused, the shop is
        // still there at `pending` and MerchantHome shows the retry screen.
        // `replace`, not `assign`: the shop now exists, so Back must not return to a signup form
        // that would try to create it a second time.
        window.location.replace('/merchant')
        return
      }
      // Pro pays upfront: hand off to Stripe Checkout; webhook activates the shop.
      const checkout = await startCheckout({ plan, billing })
      if (!checkout.ok) { setMsg(checkout.error.message || t('Could not start checkout', '无法开始结账')); setBusy(false); return }
      window.location.assign(checkout.data)
    } catch (err: any) {
      setMsg(err.message || t('Something went wrong.', '出错了。'))
      setBusy(false)
    }
  }

  return (
    <div className="w-[420px] max-w-[calc(100vw-2rem)] pt-6">
      <div className="text-center mb-6">
        <h1><Wordmark className="h-8 mx-auto" /></h1>
        <p className="font-heading text-[13px] italic text-rose-muted mt-[5px]">{t('Merchant Portal', '商家入口')}</p>
      </div>
      <Card className="rounded-pill px-8 pt-7 pb-6 gap-0">
        <h2 className="font-heading text-[20px] font-medium text-oxblood mb-1">{t('Start your shop', '开店')}</h2>
        <p className="text-[13px] text-rose-muted mb-5">{t('Create your merchant account to get started.', '创建商家账号以开始使用。')}</p>

        {/* Plan banner: oxblood-tint bg, rose-border, md radius */}
        <div className="flex items-baseline flex-wrap gap-2 px-[13px] py-[10px] mb-[14px] bg-oxblood-tint border border-rose-border rounded-md">
          <span className="font-semibold text-oxblood text-[14px]">{planName} · {cycleName}</span>
          <span className="font-heading text-ink text-[15px]">{formatMoney(perMoAmount, pricing.currency)}{t('/mo', '/月')}</span>
          {pricing.estimate && perMoAmount > 0 && (
            <span className="text-rose-muted text-[13px]">≈ {formatMoney(perMoAmount * pricing.estimate.rate, pricing.estimate.currency)}{t('/mo', '/月')}</span>
          )}
          {plan === 'basic' && (
            <Badge variant="default" className="ml-auto py-[2px] tracking-[0.03em]">
              {t('7-day free trial — no card required', '7 天免费试用，无需信用卡')}
            </Badge>
          )}
        </div>

        {canceled && (
          <div className="text-[13px] text-ink-soft bg-oxblood-tint border border-rose-border rounded-sm px-[13px] py-[10px] mb-[10px] leading-[1.5]">
            {t('Checkout was canceled. Complete your details to try again.',
               '结账已取消。完善信息后可再次尝试。')}
          </div>
        )}
        {msg && (
          <div className="text-[13px] text-ink-soft bg-oxblood-tint border border-rose-border rounded-sm px-[13px] py-[10px] mb-[10px] leading-[1.5]">
            {msg}
          </div>
        )}
        <form onSubmit={onSubmit}>
          <div className="flex flex-col gap-2.5 mb-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="signup-1">{t('Shop name', '店铺名称')}</Label>
              <Input id="signup-1" value={name} onChange={e => setName(e.target.value)} required placeholder={t('e.g. Sunny Bakes', '如：阳光烘焙')} />
              {/* Folded into a plain caption under the field it describes, rather than its own
                  boxed row — same information, one line instead of a whole extra block. */}
              <p className="text-[12px] text-rose-muted font-mono tracking-[0.3px] leading-[1.4]">
                /s/{slugPreview}
              </p>
            </div>
            {/* Business nature and currency are both chosen once here and never editable again
                (Shop Settings only displays either) — paired in one row with one shared caption
                below, rather than each carrying its own full-height block. */}
            <div className="flex gap-2.5">
              <div className="flex-1 min-w-0">
                <BusinessNaturePicker id="signup-nature" value={businessNature} onChange={setBusinessNature} />
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <Label htmlFor="signup-currency">{t('Base currency', '基础货币')}</Label>
                <Select value={currency} onValueChange={(v) => setCurrency((v as CurrencyCode) ?? currency)}>
                  <SelectTrigger id="signup-currency" className="w-full" aria-label={t('Base currency', '基础货币')}>
                    <span className="truncate">
                      {currencyDef(currency).code} — {currencyDef(currency).symbol}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_CODES.map(code => (
                      <SelectItem key={code} value={code}>
                        {CURRENCIES[code].code} — {CURRENCIES[code].symbol} · {CURRENCIES[code].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[12px] text-rose-muted leading-[1.4] -mt-1">
              {t("Can't be changed after signup.", '设置后无法更改。')}
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="signup-2">{t('Email', '邮箱')}</Label>
              <Input id="signup-2" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="signup-3">{t('Password', '密码')}</Label>
              <Input id="signup-3" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
            </div>
          </div>
          {/* A Radix select carries no native `required`, so the button is the gate. */}
          <Button type="submit" variant="default" size="md" className="py-3" disabled={busy || !businessNature}>
            {busy
              ? t('Creating…', '创建中…')
              : plan === 'basic'
                ? t('Start free trial', '开始免费试用')
                : t('Continue to payment', '前往付款')}
          </Button>
          {/* Sits under the button, not above it: the merchant reads it at the moment the act
              happens. The screen said nothing about terms before, so nothing recorded that a
              merchant had agreed to anything at all. */}
          {/* One translation unit with the links interpolated into it, NOT a sentence assembled
              from translated fragments: ' and ' and '.' as their own units bake English word
              order and spacing into strings a translator cannot reorder, and Chinese wants
              neither the spaces nor the full stop. */}
          <p className="text-[14px] leading-[1.6] text-text-tertiary text-center mt-3">
            {(() => {
              const terms = (
                <Link key="terms" to="/terms" className="text-oxblood underline underline-offset-2">
                  {t('Terms of Service', '服务条款')}
                </Link>
              )
              const privacy = (
                <Link key="privacy" to="/privacy" className="text-oxblood underline underline-offset-2">
                  {t('Privacy Policy', '隐私政策')}
                </Link>
              )
              return lang === 'zh'
                ? <>创建店铺即表示你同意我们的{terms}与{privacy}。</>
                : <>By creating a shop you agree to our {terms} and {privacy}.</>
            })()}
          </p>
        </form>
        <p className="text-[13px] text-rose-muted text-center mt-4">
          <Link to="/merchant/login" className="text-oxblood cursor-pointer underline">{t('Already have a shop? Log in', '已有店铺？登录')}</Link>
        </p>
      </Card>
    </div>
  )
}
