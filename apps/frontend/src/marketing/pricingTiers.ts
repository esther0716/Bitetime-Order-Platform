// The plan, as data — same reasoning as faq.ts and features.ts, plus one this file has on its own:
// it is rendered in TWO places (the landing summary and the /pricing page), and a feature list
// copy-pasted into both is a page that quietly disagrees with itself about what a shop gets.
//
// MERCHANT-FACING, and every line must be TRUE OF THE PRODUCT AS SHIPPED — these are pre-purchase
// promises. Where a feature changes, this file changes with it.
//
// NO AMOUNTS HERE. The price is resolved at runtime by usePlatformPricing and comes from Stripe; a
// number frozen into this file is a wrong price the moment it moves. Same reason structuredData.ts
// states no Offer.

export interface PricingTier {
  /** Stable key. One plan since #222, so this is `'pro'` and the array has one entry. */
  id: 'pro'
  /** Untranslated: "Pro" is the same word in both languages. */
  name: { en: string; zh: string }
  blurb: { en: string; zh: string }
  features: { en: string; zh: string }[]
  cta: { en: string; zh: string }
  /** Risk reversal, at the click: the trial is cardless and every shop starts on it. */
  note: { en: string; zh: string }
  highlight: boolean
  badge?: { en: string; zh: string }
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'pro',
    name: { en: 'Pro', zh: 'Pro' },
    blurb: {
      en: 'Everything you need to take orders — and to know the moment one lands.',
      zh: '接单所需的一切——订单一进来，你第一个知道。',
    },
    features: [
      {
        en: 'Your own order page, ready to share',
        zh: '专属订单页面，随时分享',
      },
      {
        en: 'Full control of your products — add, edit, or remove items anytime',
        zh: '产品完全自主管理——随时增加、修改、删除商品',
      },
      {
        en: 'Instant Telegram alerts the second an order comes in',
        zh: '订单一进来，Telegram 即时通知你',
      },
      {
        en: 'Bring customers back with built-in vouchers',
        zh: '内建优惠券，让客人主动回购',
      },
      {
        // "90 days", not "3 months", though the request was worded in months: the horizon is
        // FULFILMENT_HORIZON_DAYS and 90 days is short of three calendar months for most of the
        // year. A pre-purchase promise has to be true on the date the merchant reads it.
        en: 'Take orders only on the dates you pick — tick your delivery days up to 90 days ahead',
        zh: '只在你勾选的日期接单——最多可预订未来 90 天',
      },
      {
        // "your own pixel, your own ad account" is the load-bearing half (#220): the shop is the
        // data controller for this tracking, which is what the Terms section says and what makes
        // the feature honest to sell. A line promising "ad tracking" without it would read as
        // TinyOrder doing the advertising.
        en: 'Know which Facebook and TikTok ads bring orders — your own pixel, your own ad account',
        zh: '看清哪些 Facebook 与 TikTok 广告带来订单——用你自己的像素和广告账户',
      },
      {
        en: 'Turn a photo of your menu into your product list — you check every price before it saves',
        zh: '拍张菜单照片就能生成产品列表——每个价格都由你确认后才保存',
      },
      {
        en: 'Ask your dashboard about your own orders and get a straight answer',
        zh: '直接询问仪表板你自己的订单，获得直接的答案',
      },
      {
        en: 'Priority support — your questions jump the queue',
        zh: '优先支持——你的问题优先处理',
      },
    ],
    cta: { en: 'Start your shop', zh: '开始建店' },
    note: { en: 'Free for 7 days · no card', zh: '免费试用 7 天 · 无需信用卡' },
    highlight: true,
    badge: { en: 'Everything included', zh: '功能全包含' },
  },
]

/**
 * What the subscription includes, line by line — the detail the landing page's summary
 * deliberately does not carry, and the reason /pricing is a page of its own rather than a second
 * copy of the card.
 *
 * `detail` is optional and is the words a row needs beyond its label ("Unlimited — no commission").
 * A row with no detail renders as a plain included line. It replaced a two-column comparison when
 * the second plan went (#222): a table with nothing to compare reads as an accident.
 */
export interface IncludedRow {
  id: string
  label: { en: string; zh: string }
  detail?: { en: string; zh: string }
}

/** A section of the list (Take App's "Orders & catalog" / "Delivery" / … pattern) — a label row
 *  plus the rows it groups, so a long flat list reads as a handful of short ones. */
export interface IncludedGroup {
  id: string
  label: { en: string; zh: string }
  rows: IncludedRow[]
}

export const INCLUDED_GROUPS: IncludedGroup[] = [
  {
    id: 'storefront',
    label: { en: 'Storefront & catalog', zh: '店铺与商品' },
    rows: [
      {
        id: 'storefront',
        label: { en: 'Your own storefront link', zh: '专属店铺链接' },
      },
      {
        id: 'menuimport',
        label: { en: 'Build your product list from a photo of your menu', zh: '拍下菜单照片即可建立产品列表' },
        detail: { en: 'You review and correct every draft before it saves', zh: '每份草稿都由你核对更正后才保存' },
      },
      {
        id: 'products',
        label: { en: 'Products on your menu', zh: '菜单上的产品' },
        detail: { en: 'Unlimited', zh: '无限制' },
      },
      {
        id: 'languages',
        label: { en: 'Bilingual shop (English + Chinese)', zh: '双语店铺（中文＋英文）' },
      },
      {
        id: 'options',
        label: { en: 'Choices on an item (size, add-ons, notes)', zh: '商品选项（规格、加料、备注）' },
      },
    ],
  },
  {
    id: 'orders',
    label: { en: 'Orders & delivery', zh: '订单与配送' },
    rows: [
      {
        id: 'orders',
        label: { en: 'Orders a month', zh: '每月订单数' },
        detail: { en: 'Unlimited — no commission', zh: '无限制——不抽佣金' },
      },
      {
        id: 'delivery',
        label: { en: 'Delivery tracking — flat, by region, or by road distance', zh: '运费——统一、按地区，或按实际路程' },
      },
      {
        id: 'assistant',
        label: { en: 'Ask questions about your orders in plain words', zh: '用日常语言询问你的订单' },
        detail: { en: 'Answered from your own figures — never another shop\'s', zh: '依你自己的数据作答——绝不涉及其他店铺' },
      },
      {
        id: 'orderdates',
        label: { en: 'Dates customers can order for', zh: '顾客可选的日期' },
        detail: { en: 'A rolling window, or the exact dates you tick', zh: '滚动日期范围，或你逐一勾选的日期' },
      },
      {
        id: 'tracking',
        label: { en: 'Customers look up their own order', zh: '顾客自助查询订单' },
      },
      {
        id: 'export',
        label: { en: 'Download your orders as a spreadsheet', zh: '订单导出为表格' },
      },
    ],
  },
  {
    id: 'customers',
    label: { en: 'Customers & marketing', zh: '顾客与营销' },
    rows: [
      {
        id: 'customers',
        label: { en: 'Your customer list', zh: '顾客名单' },
        detail: { en: 'Included, plus sorting and tag filters', zh: '包含，另可排序与标签筛选' },
      },
      {
        id: 'notes',
        label: { en: 'Notes and tags on a customer', zh: '顾客备注与标签' },
      },
      {
        id: 'vouchers',
        label: { en: 'Vouchers', zh: '优惠券' },
      },
      {
        id: 'promos',
        label: { en: 'Sale prices on your products', zh: '产品促销价' },
      },
      {
        // Enforced on the load — the storefront reads the shop's own ids before a script exists
        // (#220) — which is what this file's header asks of every row.
        id: 'adpixel',
        label: { en: 'Your own Meta and TikTok ad pixel', zh: '自有 Meta 与 TikTok 广告像素' },
      },
    ],
  },
  {
    id: 'account',
    label: { en: 'Alerts & support', zh: '通知与支持' },
    rows: [
      {
        id: 'telegram',
        label: { en: 'Instant Telegram order alerts', zh: 'Telegram 即时订单通知' },
      },
      {
        id: 'support',
        label: { en: 'Support', zh: '客户支持' },
        detail: { en: 'Priority — your questions jump the queue', zh: '优先——你的问题优先处理' },
      },
      {
        id: 'trial',
        label: { en: 'Free trial', zh: '免费试用' },
        detail: { en: '7 days, no card', zh: '7 天，无需信用卡' },
      },
    ],
  },
]
