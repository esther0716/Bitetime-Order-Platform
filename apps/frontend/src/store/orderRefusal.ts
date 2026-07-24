import { MAX_CART_QTY, MAX_CART_LINES, type OrderRefusal } from '@bitetime/shared'

/**
 * What a refusal SAYS and what it DOES to the checkout, as data.
 *
 * The vocabulary itself lives in `@bitetime/shared` (`refusal.ts`) because both sides of the
 * wire must agree on it. Copy and recovery live here because the backend renders neither, and
 * because two of the messages depend on browser state the backend cannot know.
 *
 * This used to be a 13-branch `if/else` chain inside `Storefront.tsx`'s `handleSubmit` catch
 * block — a closure over component state, so the mapping from "the server refused" to "this is
 * what the customer is told and this is what we do about it" could only be exercised by mounting
 * the storefront and driving a checkout. It is the highest-stakes decision in the flow: it
 * decides whether a customer can get their order placed at all after a refusal.
 */

export type Translate = (en: string, zh: string) => string

/**
 * A recovery step, named rather than performed. The component owns the state these act on; this
 * module only decides WHICH of them run and IN WHAT ORDER — and the order is load-bearing, so
 * it is data a test can assert rather than statement order in a catch block.
 */
export type RefusalAction =
  /** The server refused the voucher, so the discount is gone; drop it before the retry. */
  | 'drop_voucher'
  /** Re-read the menu, the voucher and the clock — and adopt the server clock the refusal carried. */
  | 'refresh_sources'
  /** Throw away the distance quote; it may be what moved. */
  | 'clear_quote'
  /** Ask for the distance again. MUST come after `refresh_sources`. */
  | 'requote'
  /** Clear the chosen fulfilment date so the stale one leaves the grid. */
  | 'clear_date'

export interface RefusalPlan {
  readonly message: string
  /** Ordered. Run them in sequence — `refresh_sources` before `requote` is not a preference. */
  readonly actions: readonly RefusalAction[]
}

export interface OrderRefusalCtx {
  readonly t: Translate
  /** The shop offers pickup, so a delivery refusal may point at it. */
  readonly pickupEscape: boolean
  /** This order is distance-priced and holds a place id, so a re-quote is possible. */
  readonly canRequote: boolean
}

/** Everything the checkout's catch block can see: the wire codes plus the browser's own. */
export type OrderRefusalCode = OrderRefusal | 'network'

const generic = (t: Translate): RefusalPlan => ({
  message: t('Failed to place order. Please try again.', '下单失败，请重试。'),
  actions: [],
})

/**
 * Every voucher refusal means the order rolled back and NOTHING was written, so each message
 * ends by asking for the order again without the voucher. Saying "failed, try again" while
 * silently keeping a voucher the server has already refused would fail them again, forever.
 */
const dropVoucher = (message: string): RefusalPlan => ({ message, actions: ['drop_voucher'] })

export function orderRefusalPlan(code: OrderRefusalCode | undefined, ctx: OrderRefusalCtx): RefusalPlan {
  const { t, pickupEscape, canRequote } = ctx
  switch (code) {
    case 'voucher_not_found':
      return dropVoucher(t('That voucher is no longer valid. Please place the order without it.', '该优惠券已失效，请不使用优惠券重新下单。'))
    case 'voucher_already_used':
      return dropVoucher(t('You have already used this voucher. Please place the order without it.', '你已使用过此优惠券，请不使用优惠券重新下单。'))
    case 'voucher_fully_used':
      return dropVoucher(t('This voucher has been fully claimed. Please place the order without it.', '此优惠券已被领完，请不使用优惠券重新下单。'))
    case 'voucher_requires_account':
      return dropVoucher(t('Please sign in to use a voucher, then place the order again.', '使用优惠券需先登录，登录后请重新下单。'))

    case 'merchant_inactive':
    case 'merchant_not_found':
      return { message: t('This shop is not taking orders right now.', '本店目前暂不接单。'), actions: [] }

    case 'price_changed':
      // The shop's prices moved mid-checkout. NOTHING was written. Show the new numbers and let
      // the customer decide — charging the new total silently would bill a number they never
      // agreed to, and honouring the stale one would let an old quote buy a withdrawn discount.
      //
      // The VOUCHER is re-read alongside the products, and has to be: an edited `vouchers.amount`
      // moves the total exactly as an edited price does, and re-quoting from the stale voucher
      // would be refused again on the very next tap.
      //
      // The DISTANCE can be part of what moved (a merchant editing the rate prices exactly like
      // an edited product), so the stale quote is dropped and asked for again. The re-quote is
      // explicit rather than left to the auto-quote effect, which cannot re-fire: it is guarded
      // on a ref already stamped with this place id, so without it the customer is left holding
      // a disabled button and an instruction they have no way to act on (#101 review).
      return {
        message: t(
          'Prices at this shop just changed. Please review your order and place it again.',
          '本店价格刚刚有所调整，请确认订单后重新下单。',
        ),
        actions: canRequote ? ['refresh_sources', 'clear_quote', 'requote'] : ['refresh_sources', 'clear_quote'],
      }

    case 'product_unavailable':
      // Refetching is what RECOVERS the checkout, not just what refreshes the menu: adopting the
      // new menu drops the cart ids that are gone. Without it the invisible id stayed in the
      // cart and every retry was refused identically.
      return {
        message: t(
          'Something in your cart is no longer available. It has been removed — please review your order and place it again.',
          '购物车中有商品已下架，已为你移除，请确认订单后重新下单。',
        ),
        actions: ['refresh_sources'],
      }

    case 'delivery_state_required':
      // Unreachable from the form — the submit gate will not let a stateless delivery through —
      // and messaged anyway, because that gate is the ONLY thing making it so.
      return { message: t('Please choose the state you are delivering to.', '请选择送货的州属。'), actions: [] }

    case 'method_not_offered':
      // Fires if the merchant switches a method off while someone is mid-checkout.
      return { message: t('This shop no longer offers that option. Please choose another.', '本店已不再提供该方式，请另选一种。'), actions: [] }

    case 'delivery_out_of_range':
      return {
        message: pickupEscape
          ? t('Sorry, this shop does not deliver to that address. Please choose pickup instead.', '抱歉，本店不配送到该地址，请改选自取。')
          : t('Sorry, this shop does not deliver to that address.', '抱歉，本店不配送到该地址。'),
        actions: [],
      }

    case 'distance_lookup_failed':
      // Deliberately does NOT promise "in a moment": this code is also what a QUOTA-exhausted
      // shop throws, and quota does not clear for up to 24 hours.
      return {
        message: pickupEscape
          ? t('We could not work out the delivery fee just now. Please try again, or choose pickup.', '暂时无法计算运费，请重试或选择自取。')
          : t('We could not work out the delivery fee just now. Please try again.', '暂时无法计算运费，请重试。'),
        actions: [],
      }

    case 'delivery_place_required':
      return { message: t('Please pick your delivery address from the suggestions.', '请从建议列表中选择您的配送地址。'), actions: [] }

    case 'fulfil_date_unavailable':
    case 'fulfil_date_required':
      // Clearing the selection is what recovers it: the re-render drops the stale date from the grid.
      return { message: t('Please choose a date for your order.', '请选择订单日期。'), actions: ['clear_date'] }

    case 'invalid_body':
      // A permanent refusal — the same cart is refused identically — so say what would change it.
      return {
        message: t(
          `Your order is too large. Please order at most ${MAX_CART_QTY} of any one item, and at most ${MAX_CART_LINES} different items.`,
          `订单过大。每种商品最多 ${MAX_CART_QTY} 件，每单最多 ${MAX_CART_LINES} 种不同商品。`,
        ),
        actions: [],
      }

    case 'network':
      // The request never landed, so no order exists and retrying is safe to suggest.
      return { message: t('Could not reach the shop. Check your connection and try again.', '无法连接店铺，请检查网络后重试。'), actions: [] }

    case 'order_failed':
      // A server fault with no reason to give. The one code that honestly wears the generic line.
      return generic(t)

    default: {
      // A NEW code in `@bitetime/shared` fails this build here, which is the point. The runtime
      // fallback below is for the other direction: a deployed browser is always older than the
      // server, and a stale client must read a sentence, never a raw wire code.
      const _exhaustive: never = code as never
      void _exhaustive
      return generic(t)
    }
  }
}
