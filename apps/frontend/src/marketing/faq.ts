// The landing page's FAQ, as data rather than markup — so a copy change never touches layout,
// and so a test can see that every entry is actually translated.
//
// MERCHANT-FACING. The landing page sells the subscription, so these are a prospective shop
// owner's questions, not a customer's.
//
// Every answer must be TRUE OF THE PRODUCT AS SHIPPED. These are pre-purchase answers; an
// aspirational one is a promise the software has to keep. Where a fact here changes — the trial
// length, what the paid tier includes, how a merchant is notified — this file changes with it.

export interface FaqEntry {
  /** Stable key for the accordion panel. */
  id: string
  q: { en: string; zh: string }
  a: { en: string; zh: string }
}

export const FAQ: FaqEntry[] = [
  {
    id: 'cost',
    q: {
      en: 'What does it cost?',
      zh: '费用是多少？',
    },
    a: {
      en: 'A flat subscription — monthly or yearly, with two months free if you pay yearly. The prices are in the table just above. We take no commission on your sales, so a busy month costs you exactly the same as a quiet one.',
      zh: '固定订阅费——可选月付或年付，年付相当于免费两个月。价格见上方表格。我们不抽取任何销售佣金，因此生意旺季与淡季的费用完全相同。',
    },
  },
  {
    id: 'trial',
    q: {
      en: 'Is there a free trial?',
      zh: '有免费试用吗？',
    },
    a: {
      en: 'Yes — seven days on Basic, and you do not need a card to start it. We will remind you before it ends, and if you decide not to continue it simply stops and you are never charged. Starting on Pro goes through payment up front.',
      zh: '有——基础版七天，开始时无需绑定信用卡。结束前我们会提醒你；若不想继续，试用期结束即自动停止，不会产生任何费用。直接选择 Pro 版则需先行付款。',
    },
  },
  {
    id: 'payment',
    q: {
      en: 'How do my customers pay me?',
      zh: '顾客怎么付款给我？',
    },
    a: {
      en: 'Directly to you. You show your bank details or payment instructions on your storefront, and the money goes straight into your account — TinyOrder never touches it and takes no cut of your sales. The only thing you pay us is your subscription.',
      zh: '直接付给你。你在店面页面上展示银行账号或付款说明，货款直接进你的账户——TinyOrder 不经手，也不抽成。你只需支付订阅费。',
    },
  },
  {
    id: 'website',
    q: {
      en: 'Do I need my own website?',
      zh: '我需要自己的网站吗？',
    },
    a: {
      en: 'No. Every shop gets its own order page with its own link, ready as soon as your shop is approved. Share that link on WhatsApp, Instagram or anywhere else — that is your storefront.',
      zh: '不需要。每家店都有专属订单页面和专属链接，店铺通过审核后即可使用。把链接分享到 WhatsApp、Instagram 或任何地方——那就是你的店面。',
    },
  },
  {
    id: 'alerts',
    q: {
      en: 'How will I know an order came in?',
      zh: '订单进来了我怎么知道？',
    },
    a: {
      en: 'Every shop, on every plan, gets an email the moment an order lands — with the customer, their number, what they ordered and the total. Your dashboard also updates on its own while it is open. Pro adds an instant Telegram alert, which is the one that buzzes your phone and reaches everyone in your shop group at once.',
      zh: '所有店铺、所有方案，订单一进来就会收到电邮——包含顾客、联络号码、订购内容和总额。仪表板开着时也会自动更新。Pro 版另加 Telegram 即时通知，会震动你的手机，并同时通知店里群组的所有人。',
    },
  },
  {
    id: 'pro',
    q: {
      en: 'What does Pro add?',
      zh: 'Pro 版多了什么？',
    },
    a: {
      en: 'Instant Telegram alerts, discount vouchers, promotional pricing on individual items, and priority support. Everything else — your order page, your full product list, delivery fees, order emails — is on Basic.',
      zh: 'Telegram 即时通知、优惠券、单品促销价，以及优先支持。其余功能——订单页面、完整产品列表、配送费、订单电邮——基础版都有。',
    },
  },
  {
    id: 'cancel',
    q: {
      en: 'Can I cancel?',
      zh: '可以取消吗？',
    },
    a: {
      en: 'Any time, from your dashboard. Your shop keeps working until the end of the period you have already paid for, and you are not billed again. We do not refund part of a period, so cancel when it suits your billing date.',
      zh: '随时可以，在仪表板操作。已付费的周期内店铺照常运作，之后不再扣款。我们不退还周期内的部分费用，请配合你的扣款日选择取消时间。',
    },
  },
  {
    id: 'chinese',
    q: {
      en: 'Does it work in Chinese?',
      zh: '支持中文吗？',
    },
    a: {
      en: 'Fully. Your dashboard and your customers\' order page both switch between English and Chinese, and you can give every product a name and description in both. Your customers pick whichever they prefer.',
      zh: '完全支持。仪表板和顾客的订单页面都可在中英文之间切换，每件产品也能同时设定中英文名称与说明。顾客自行选择惯用语言。',
    },
  },
  {
    id: 'approval',
    q: {
      en: 'How soon can I start taking orders?',
      zh: '多快可以开始接单？',
    },
    a: {
      en: 'Sign up, add your products, and we review your shop before it goes live — this is what keeps the platform clean for everyone on it. Once approved, your order page is open and your free trial starts.',
      zh: '注册、添加产品，我们会先审核你的店铺再让它上线——这是为了维持平台对所有商家的品质。审核通过后，订单页面即开放，免费试用同时开始。',
    },
  },
]
