// The plan tiers, as data — same reasoning as faq.ts and features.ts, plus one this file has on its
// own: the tiers are now rendered in TWO places (the landing summary and the /pricing page), and a
// tier list copy-pasted into both is a page that quietly disagrees with itself about what Pro buys.
//
// MERCHANT-FACING, and every line must be TRUE OF THE PRODUCT AS SHIPPED — these are pre-purchase
// promises. Where an entitlement changes (`merchants.plan` and the backend's `requirePro` gate are
// what actually enforce it), this file changes with it.
//
// NO AMOUNTS HERE. Prices are resolved per region at runtime by usePlatformPricing and come from
// Stripe; a number frozen into this file is a wrong price the moment they move. Same reason
// structuredData.ts states no Offer.

export interface PricingTier {
  /** Stable key — also the `:plan` path segment on /merchant/signup. */
  id: 'basic' | 'pro'
  /** Untranslated: "Pro" is the same word in both languages, "Basic" has a translation. */
  name: { en: string; zh: string }
  blurb: { en: string; zh: string }
  /** Heading for the feature list on a tier that builds on the one before it. */
  inherits?: { en: string; zh: string }
  features: { en: string; zh: string }[]
  cta: { en: string; zh: string }
  /**
   * Risk reversal, per tier and NOT per section: the trial is Basic-only — signing up Basic is
   * cardless and the 7 days start at approval, while Pro goes straight to Checkout and is charged
   * on day one. One shared line under both cards would make the Pro card lie.
   */
  note: { en: string; zh: string }
  highlight: boolean
  badge?: { en: string; zh: string }
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'basic',
    name: { en: 'Basic', zh: '基础版' },
    blurb: {
      en: 'Get your orders out of the chat group.',
      zh: '把订单从聊天群组里解放出来。',
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
        en: 'Custom delivery fees by region',
        zh: '配送费可依地区自定义',
      },
      {
        en: 'Orders auto-calculated',
        zh: '订单自动算总价',
      },
    ],
    cta: { en: 'Start your shop', zh: '开始建店' },
    note: { en: 'Free for 7 days · no card', zh: '免费试用 7 天 · 无需信用卡' },
    highlight: false,
  },
  {
    id: 'pro',
    name: { en: 'Pro', zh: 'Pro' },
    blurb: {
      en: 'The moment your orders start piling up, you need to know first.',
      zh: '订单开始堆积的那一刻，你要第一个知道。',
    },
    inherits: { en: 'Everything in Basic, plus', zh: '包含 Basic 所有功能，再加' },
    features: [
      {
        en: 'Instant Telegram alerts the second an order comes in',
        zh: '订单一进来，Telegram 即时通知你',
      },
      {
        en: 'Bring customers back with built-in vouchers',
        zh: '内建优惠券，让客人主动回购',
      },
      {
        en: 'Priority support — your questions jump the queue',
        zh: '优先支持——你的问题优先处理',
      },
    ],
    cta: { en: 'Start your shop', zh: '开始建店' },
    note: { en: 'Start free on Basic · upgrade anytime', zh: '先免费试用基础版 · 随时升级' },
    highlight: true,
    badge: { en: 'Most popular', zh: '最受欢迎' },
  },
]

/**
 * The plan comparison, line by line — the detail the landing page's summary deliberately does not
 * carry, and the reason /pricing is a page of its own rather than a second copy of the tier cards.
 *
 * `basic` / `pro` are what the row says about each plan, NOT a tick and a cross: "delivery fees by
 * region" and "…by region or road distance" is a real difference a ✓/✗ pair would flatten into a
 * lie. Where a row is genuinely present-or-absent, the string says so in words.
 */
export interface ComparisonRow {
  id: string
  label: { en: string; zh: string }
  basic: { en: string; zh: string }
  pro: { en: string; zh: string }
}

export const PLAN_COMPARISON: ComparisonRow[] = [
  {
    id: 'storefront',
    label: { en: 'Your own storefront link', zh: '专属店铺链接' },
    basic: { en: 'Included', zh: '包含' },
    pro: { en: 'Included', zh: '包含' },
  },
  {
    id: 'products',
    label: { en: 'Products on your menu', zh: '菜单上的产品' },
    basic: { en: 'Unlimited', zh: '无限制' },
    pro: { en: 'Unlimited', zh: '无限制' },
  },
  {
    id: 'orders',
    label: { en: 'Orders a month', zh: '每月订单数' },
    basic: { en: 'Unlimited — no commission', zh: '无限制——不抽佣金' },
    pro: { en: 'Unlimited — no commission', zh: '无限制——不抽佣金' },
  },
  {
    id: 'languages',
    label: { en: 'Bilingual shop (English + Chinese)', zh: '双语店铺（中文＋英文）' },
    basic: { en: 'Included', zh: '包含' },
    pro: { en: 'Included', zh: '包含' },
  },
  {
    // NOT a Pro split. Distance pricing is `merchants.shipping_mode`, which carries no plan gate —
    // writing "by road distance" into the Pro column would sell a shop something Basic already has.
    id: 'delivery',
    label: { en: 'Delivery fees — flat, by region, or by road distance', zh: '运费——统一、按地区，或按实际路程' },
    basic: { en: 'Included', zh: '包含' },
    pro: { en: 'Included', zh: '包含' },
  },
  {
    id: 'tracking',
    label: { en: 'Customers look up their own order', zh: '顾客自助查询订单' },
    basic: { en: 'Included', zh: '包含' },
    pro: { en: 'Included', zh: '包含' },
  },
  {
    id: 'customers',
    label: { en: 'Your customer list', zh: '顾客名单' },
    basic: { en: 'Included', zh: '包含' },
    pro: { en: 'Included, plus sorting and tag filters', zh: '包含，另可排序与标签筛选' },
  },
  {
    id: 'telegram',
    label: { en: 'Instant Telegram order alerts', zh: 'Telegram 即时订单通知' },
    basic: { en: 'Not included', zh: '不包含' },
    pro: { en: 'Included', zh: '包含' },
  },
  {
    id: 'vouchers',
    label: { en: 'Vouchers', zh: '优惠券' },
    basic: { en: 'Not included', zh: '不包含' },
    pro: { en: 'Included', zh: '包含' },
  },
  {
    id: 'promos',
    label: { en: 'Sale prices on your products', zh: '产品促销价' },
    basic: { en: 'Not included', zh: '不包含' },
    pro: { en: 'Included', zh: '包含' },
  },
  {
    id: 'options',
    label: { en: 'Choices on an item (size, add-ons, notes)', zh: '商品选项（规格、加料、备注）' },
    basic: { en: 'Not included', zh: '不包含' },
    pro: { en: 'Included', zh: '包含' },
  },
  {
    id: 'export',
    label: { en: 'Download your orders as a spreadsheet', zh: '订单导出为表格' },
    basic: { en: 'Not included', zh: '不包含' },
    pro: { en: 'Included', zh: '包含' },
  },
  {
    id: 'notes',
    label: { en: 'Notes and tags on a customer', zh: '顾客备注与标签' },
    basic: { en: 'Not included', zh: '不包含' },
    pro: { en: 'Included', zh: '包含' },
  },
  {
    id: 'support',
    label: { en: 'Support', zh: '客户支持' },
    basic: { en: 'Standard', zh: '标准' },
    pro: { en: 'Priority — your questions jump the queue', zh: '优先——你的问题优先处理' },
  },
  {
    id: 'trial',
    label: { en: 'Free trial', zh: '免费试用' },
    basic: { en: '7 days, no card', zh: '7 天，无需信用卡' },
    pro: { en: 'Start free on Basic, upgrade anytime', zh: '先免费试用基础版，随时升级' },
  },
]
