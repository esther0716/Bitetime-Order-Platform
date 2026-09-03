import type { Translate } from './orderRefusal'

/**
 * What a refused review SAYS to the customer.
 *
 * It exists because `handleFailedResponse` in `api.ts` sets `message: body.error || …`, which is
 * ALWAYS truthy — so a card that fell back to its own copy only when `message` was empty never
 * fell back at all, and showed a Chinese customer the wire code (`order_cancelled`) or the
 * server's English validator sentence. This module is the browser's own words, keyed on the code.
 *
 * Same shape and same reason as `orderRefusal.ts`: the backend renders no copy, and this side is
 * bilingual, so the mapping from a wire code to what the customer reads is data this side owns.
 *
 * An unknown code — including the 400 the two bounds produce, which the card's own disabled
 * submit already prevents — gets the general sentence. Never the raw code.
 */
export function reviewErrorMessage(code: string | undefined, t: Translate): string {
  switch (code) {
    case 'order_cancelled':
      return t('This order was cancelled, so it cannot be rated.', '此订单已取消，无法评价。')
    case 'rate_limited':
      return t('Too many tries. Wait a minute and try again.', '尝试次数过多。请稍等一分钟后重试。')
    case 'not_found':
      return t('We could not find this order.', '找不到此订单。')
    default:
      return t('Could not send your review. Please try again.', '无法提交你的评价，请重试。')
  }
}
