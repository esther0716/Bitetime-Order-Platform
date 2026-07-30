import type { Translate } from '../types'

/**
 * Bilingual text for the error codes the billing routes return.
 *
 * It lives in its own module because three unrelated components surface the same codes — the
 * Subscription tab's portal links, its wind-down dialogs, and the Pro upgrade CTA — and a copy
 * per call site is how one of them ends up toasting a raw `stripe_unavailable` at a merchant.
 *
 * Codes only. The 404 from `/api/billing/portal` is still a sentence rather than a code, and
 * falls through to the caller's own fallback untouched.
 */
export function billingErrorMessage(code: string | undefined, t: Translate): string | null {
  switch (code) {
    case 'stripe_unavailable':
      // Deliberately blames neither side and asks for a retry: every cause (an outage, a
      // customer id Stripe does not know, a portal never enabled in the Dashboard) is ours or
      // Stripe's to fix, and none of them is something the merchant can act on from here.
      return t(
        'Could not reach our payment provider. Please try again in a moment.',
        '无法连接支付服务商，请稍后再试。',
      )
    case 'no_live_subscription':
      return t(
        'This shop no longer has a subscription to change. Reload the page.',
        '此店铺已无可更改的订阅。请刷新页面。',
      )
    case 'shop_is_comped':
      // Not folded into `no_live_subscription`: that one tells the merchant to reload, which is
      // wrong advice for a state that will not change on reload. Only a superadmin can end it.
      return t(
        'This shop is on complimentary Pro. There is no billing to manage.',
        '此店铺为赠送的 Pro 方案，无需管理账单。',
      )
    default:
      return null
  }
}
