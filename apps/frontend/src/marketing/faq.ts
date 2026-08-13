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
      en: 'A flat subscription — monthly or yearly, with two months free if you pay yearly. See our pricing page for the full breakdown. We take no commission on your sales, so a busy month costs you exactly the same as a quiet one.',
      zh: '固定订阅费——可选月付或年付，年付相当于免费两个月。完整价格请见我们的价格页面。我们不抽取任何销售佣金，因此生意旺季与淡季的费用完全相同。',
    },
  },
  {
    id: 'trial',
    q: {
      en: 'Is there a free trial?',
      zh: '有免费试用吗？',
    },
    a: {
      en: 'Yes — seven days, and you do not need a card to start it. We will remind you before it ends, and if you decide not to continue it simply stops and you are never charged.',
      zh: '有——七天，开始时无需绑定信用卡。结束前我们会提醒你；若不想继续，试用期结束即自动停止，不会产生任何费用。',
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
      en: 'No. Every shop gets its own order page with its own link, ready the moment you sign up. Share that link on WhatsApp, Instagram or anywhere else — that is your storefront.',
      zh: '不需要。每家店都有专属订单页面和专属链接，注册后即刻可用。把链接分享到 WhatsApp、Instagram 或任何地方——那就是你的店面。',
    },
  },
  {
    id: 'alerts',
    q: {
      en: 'How will I know an order came in?',
      zh: '订单进来了我怎么知道？',
    },
    a: {
      en: 'Every shop gets an email the moment an order lands — with the customer, their number, what they ordered and the total. Your dashboard also updates on its own while it is open. Set up Telegram and you get an instant alert too, which is the one that buzzes your phone and reaches everyone in your shop group at once.',
      zh: '每家店铺在订单一进来时都会收到电邮——包含顾客、联络号码、订购内容和总额。仪表板开着时也会自动更新。设置 Telegram 后还会收到即时通知，会震动你的手机，并同时通知店里群组的所有人。',
    },
  },
  {
    id: 'included',
    q: {
      en: 'What is included?',
      zh: '包含哪些功能？',
    },
    a: {
      en: 'Everything: your order page, your full product list, delivery fees, order emails, instant Telegram alerts, discount vouchers, promotional pricing on individual items, the option to take orders only on specific dates you pick, your own ad pixel, and priority support. There is one plan and it holds all of it.',
      zh: '全部：订单页面、完整产品列表、配送费、订单电邮、Telegram 即时通知、优惠券、单品促销价、只在你指定日期接单的选项、自有广告像素，以及优先支持。只有一个方案，功能全包含。',
    },
  },
  {
    // The objection that keeps a shop with a real menu from ever finishing setup. It belongs in
    // the FAQ rather than only on /features because it is asked BEFORE signing up, and because
    // the honest answer contains the reassurance ("you check every price") that the question is
    // really asking for.
    id: 'menuimport',
    q: {
      en: 'Do I have to type my whole menu in by hand?',
      zh: '我必须把整份菜单手动输入吗？',
    },
    a: {
      en: 'No. Photograph the menu you already have and TinyOrder reads it into draft products — names, prices, units and sections, and the Chinese names too where your menu prints them. You check every line before anything is saved, and a price it could not read is left blank rather than guessed. You can still add products by hand whenever you prefer.',
      zh: '不需要。拍下你现有的菜单，TinyOrder 会读成产品草稿——名称、价格、单位与分类，菜单上有中文名称时也会一并读取。保存之前每一行都由你核对，读不出的价格会留空而不是猜测。你也可以随时手动新增产品。',
    },
  },
  {
    id: 'assistant',
    q: {
      en: 'Can I ask questions about how my shop is doing?',
      zh: '可以询问店铺经营状况吗？',
    },
    a: {
      en: 'Yes. Your dashboard takes a question in plain English or Chinese — which product made the least money, how the last 30 days compared with the 30 before — and answers from your own order figures, saying underneath which period it used. It reads your shop only, and it cannot change anything.',
      zh: '可以。仪表板可接受中文或英文的日常提问——哪个产品营收最低、最近 30 天与之前 30 天相比如何——并依你自己的订单数据作答，下方注明所采用的时间范围。它只读取你的店铺，且无法更改任何内容。',
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
      en: 'Straight away. Your shop and its order page go live the moment you sign up, and your seven free days start there — nothing to wait for. Add your products and share your link. We suspend shops that misuse the platform, but nothing holds you up on the way in.',
      zh: '马上就能开始。注册完成的那一刻，店铺和订单页面即刻上线，七天免费期同时开始——无需等待。添加产品、分享链接即可。若有店铺滥用平台，我们会将其暂停，但开店过程不会让你等。',
    },
  },
]
