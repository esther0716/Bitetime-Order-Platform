import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, QrCode } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { canShareReferral } from '@bitetime/shared'
import { useSession } from '../SessionContext'
import { referralCodeOf, fetchReferredShops, fetchEarnedRewards, fetchMyBilling } from '../store'
import { referralSignupUrl } from '../referralSignupUrl'
import { currencyDef, formatMoney } from '../currency'
import { fmtDate } from '../merchantDate'
import type { EarnedReward, ReferredShop } from '../types'
import type { SubscriptionSnapshot } from './subscriptionTabState'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SkeletonText } from '../components/Loaders'

// Display-only referral card (mirrors ShareStorefront). The code is derived from the
// signed-in user's auth id so it matches profiles.referral_code written at signup.
//
// The code is shown only to a shop that could actually earn the reward — `canShareReferral`, the
// same rule `GET /api/referrals/check` answers the signup form with, so a code shown here is a
// code that validates there. Without it a merchant on trial, past due or winding down shares a
// code that reads as good to the shop they invite and then pays nothing when that shop's first
// invoice clears, which is a promise the platform never sees itself break.
export default function ReferralTab() {
  const { t, account, merchant } = useSession()
  const [qrOpen, setQrOpen] = useState(false)
  const [shops, setShops] = useState<ReferredShop[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [rewards, setRewards] = useState<EarnedReward[] | null>(null)
  const [rewardsError, setRewardsError] = useState(false)
  const [billing, setBilling] = useState<SubscriptionSnapshot | null>(null)
  const [billingLoaded, setBillingLoaded] = useState(false)
  const merchantId = merchant?.id

  useEffect(() => {
    let alive = true
    fetchReferredShops()
      .then((r) => { if (!alive) return; if (r.ok) setShops(r.data); else setLoadError(true) })
    fetchEarnedRewards()
      .then((r) => { if (!alive) return; if (r.ok) setRewards(r.data); else setRewardsError(true) })
    return () => { alive = false }
  }, [])

  // Separate from the two above because it is keyed on the merchant id, and because a FAILED read
  // must not be mistaken for "no subscription": `billingLoaded` gates the card either way, and a
  // failure leaves `billing` null, which the rule refuses. Hiding the code on a failed read is
  // the safe side to err on — the wrong direction hands out a code that cannot earn.
  useEffect(() => {
    if (!merchantId) return
    let alive = true
    fetchMyBilling(merchantId)
      .then((r) => { if (!alive) return; setBilling(r.ok ? r.data : null); setBillingLoaded(true) })
    return () => { alive = false }
  }, [merchantId])

  if (!account) return null

  const code = referralCodeOf(account.id)
  if (!code) return null
  const link = referralSignupUrl(code, window.location.origin)

  const copyText = async (text: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(ok)
    } catch {
      toast.error(t('Could not copy — copy it manually', '无法复制 — 请手动复制'))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Invite & earn', '邀请赚奖励')}</CardTitle>
          <CardDescription>
            {t(
              'Share your referral code with other shop owners. Every shop that signs up with it and starts paying earns you one free month of your own subscription.',
              '把您的推荐码分享给其他店主。每有一家用您的推荐码注册的店铺开始付费，您就获得一个月您当前方案的免费额度。',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!billingLoaded ? (
            <SkeletonText />
          ) : !canShareReferral(billing) ? (
            // No code, no link, no QR. A disabled Copy button would still leave the code on
            // screen to be read out, and the code is the whole thing being withheld.
            <div className="flex flex-col items-start gap-3">
              <p className="text-[13px] text-muted-foreground">{blockedNotice(billing, t)}</p>
              {/* The hash IS the tab (useDashboardSubsection), so this switches to Subscription
                  without a reload. Safe past the NavGuard: only the active tab can be dirty and
                  this one has no form. */}
              <Link to="#settings/subscription" className="text-[13px] text-primary cursor-pointer underline underline-offset-2">
                {t('Go to Subscription', '前往订阅')}
              </Link>
            </div>
          ) : (
          <>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-muted-foreground">{t('Your referral code', '您的推荐码')}</span>
            <div className="rounded-lg border-[0.5px] border-border bg-muted px-3 py-2 font-mono text-[15px] tracking-wider break-all text-foreground">
              {code}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-muted-foreground">{t('Invite link', '邀请链接')}</span>
            <div className="rounded-lg border-[0.5px] border-border bg-muted px-3 py-2 font-mono text-[13px] break-all text-foreground">
              {link}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="default" size="sm" className="w-auto" onClick={() => copyText(code, t('Code copied', '推荐码已复制'))}>
              <Copy /> {t('Copy code', '复制推荐码')}
            </Button>
            <Button variant="outline" size="sm" className="w-auto" onClick={() => copyText(link, t('Link copied', '链接已复制'))}>
              <Copy /> {t('Copy link', '复制链接')}
            </Button>
            <Button variant="outline" size="sm" className="w-auto" onClick={() => setQrOpen(true)}>
              <QrCode /> {t('QR code', '二维码')}
            </Button>
          </div>
          </>
          )}
        </CardContent>

        <Dialog open={qrOpen} onOpenChange={setQrOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('Scan to sign up', '扫码注册')}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={link} size={180} />
              </div>
              <p className="font-mono text-[12px] break-all text-center text-muted-foreground">{link}</p>
            </div>
          </DialogContent>
        </Dialog>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('Rewards earned', '已获得奖励')}{rewards ? ` (${rewards.length})` : ''}
          </CardTitle>
          <CardDescription>
            {t(
              'One month of your subscription, free — at whatever you pay today.',
              '免费获得一个月订阅 — 按您当前的付费金额计算。',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* The reward rules the ledger alone cannot show: what triggers it, that it stacks,
              how it is delivered, and the one case where it is forfeited (backend:
              referralReward.ts / docs/prd-referral-reward.md). */}
          <ul className="flex list-disc flex-col gap-1.5 rounded-lg border-[0.5px] border-border bg-muted py-2.5 pl-7 pr-3 text-[13px] text-muted-foreground">
            <li>{t(
              'Earned when an invited shop pays its first invoice — their free trial does not count.',
              '当受邀店铺支付第一张账单时获得 — 免费试用不算。',
            )}</li>
            <li>{t(
              'Free months stack: three paying shops means three free months.',
              '免费月份可累积：三家付费店铺就是三个月免费。',
            )}</li>
            <li>{t(
              'Added to your account as credit and taken off your next invoice automatically.',
              '以账户余额形式自动抵扣您的下一张账单。',
            )}</li>
            <li>{t(
              'You need an active paid subscription of your own when their first payment goes through.',
              '在对方首次付款时，您本人需处于有效的付费订阅中。',
            )}</li>
          </ul>
          {rewardsError ? (
            <p className="text-[13px] text-muted-foreground">{t('Could not load rewards.', '无法加载奖励。')}</p>
          ) : rewards === null ? (
            <p className="text-[13px] text-muted-foreground">{t('Loading…', '加载中…')}</p>
          ) : rewards.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{t('No rewards yet — you earn one when an invited shop starts paying.', '还没有奖励 — 当受邀店铺开始付费时即可获得。')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {rewards.map((r, i) => (
                <li key={i} className="flex items-center justify-between py-2">
                  <div className="flex flex-col">
                    <span className="text-[14px] text-foreground">{r.referred_shop_name}</span>
                    <span className="text-[12px] text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  <span className="text-[13px] font-medium text-primary">
                    {t('1 month free', '免费1个月')} · {formatRewardAmount(r)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('Invited shops', '已邀请店铺')}{shops ? ` (${shops.length})` : ''}
          </CardTitle>
          <CardDescription>
            {t('Shops that signed up with your code.', '使用您推荐码注册的店铺。')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-[13px] text-muted-foreground">{t('Could not load invited shops.', '无法加载已邀请店铺。')}</p>
          ) : shops === null ? (
            <p className="text-[13px] text-muted-foreground">{t('Loading…', '加载中…')}</p>
          ) : shops.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{t('No invited shops yet.', '还没有已邀请的店铺。')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {shops.map((s, i) => (
                <li key={i} className="flex items-center justify-between py-2">
                  <div className="flex flex-col">
                    <span className="text-[14px] text-foreground">{s.name}</span>
                    <span className="text-[12px] text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</span>
                  </div>
                  <StatusBadge status={s.status} t={t} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Why the code is withheld, in the merchant's own terms.
 *
 * Four different pieces of news, and collapsing them into one sentence is what makes a gate feel
 * arbitrary: "your subscription ends on the 3rd" is a thing the merchant chose and can undo,
 * while "invites open when your subscription starts" is a thing they are waiting for. The order
 * follows billingBannerState's — a wind-down outranks a failed payment, because once a
 * subscription is ending the failing card no longer decides anything.
 *
 * `canShareReferral` decides WHETHER; this only explains. It is never called for a shop that can
 * share, so it has no "you can" branch.
 */
function blockedNotice(
  billing: SubscriptionSnapshot | null,
  t: (en: string, zh: string) => string,
): string {
  if (billing?.cancel_at_period_end) {
    const on = fmtDate(billing.current_period_end)
    return t(
      `Your subscription ends on ${on}, so invites are paused. Resume it to share your code again.`,
      `您的订阅将于 ${on} 结束，邀请已暂停。恢复订阅后即可继续分享推荐码。`,
    )
  }
  if (billing?.comped) {
    return t(
      'Your shop runs on a complimentary plan, so there is no subscription for a free month to come off.',
      '您的店铺使用赠送方案，没有可抵扣免费月份的订阅。',
    )
  }
  if (billing?.status === 'past_due') {
    return t(
      'Invites resume once your payment goes through.',
      '付款成功后即可继续邀请。',
    )
  }
  return t(
    'Invites open when your paid subscription starts. A free month is taken off your own invoice, so there has to be one.',
    '开始付费订阅后即可邀请。免费月份会从您自己的账单中抵扣，因此需要先有订阅。',
  )
}

// The reward `amount` is Stripe's smallest currency unit (cents); its `currency` is Stripe's
// lowercase code. Convert to major units by the currency's own decimals, then render through
// the shared money formatter (uppercased to match the currency registry's keys).
function formatRewardAmount(r: EarnedReward): string {
  const code = r.currency.toUpperCase()
  const major = r.amount / 10 ** currencyDef(code).decimals
  return formatMoney(major, code)
}

function StatusBadge({ status, t }: { status: ReferredShop['status']; t: (en: string, zh?: string) => string }) {
  const label = status === 'active' ? t('Active', '营业中')
    : status === 'suspended' ? t('Suspended', '已暂停')
    : t('Pending', '待审核')
  const tone = status === 'active' ? 'text-primary' : 'text-muted-foreground'
  return (
    <span className={`rounded-pill border-[0.5px] border-border bg-muted px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {label}
    </span>
  )
}
