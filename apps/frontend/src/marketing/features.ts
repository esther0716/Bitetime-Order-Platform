// The landing page's "what you actually get" section, as data — same reasoning as faq.ts: a copy
// change never touches layout, and a test can see that every entry is really translated.
//
// MERCHANT-FACING, and every line must be TRUE OF THE PRODUCT AS SHIPPED. This section exists
// partly to give the page the volume of real text a thin marketing page lacks, and padding it with
// things the software does not do would be the expensive kind of SEO: a prospect signs up for the
// sentence, not the feature list. Where a fact here changes, this file changes with it.

export interface FeatureEntry {
  /** Stable key for the list. */
  id: string
  title: { en: string; zh: string }
  body: { en: string; zh: string }
  /** Short landing-page-only blurb. Optional: only the entries the landing page's hook section
      shows (its first three) need one — /features always renders the full `body`. */
  teaser?: { en: string; zh: string }
}

export const FEATURES: FeatureEntry[] = [
  {
    id: 'menu',
    title: {
      en: 'A shop page you control yourself',
      zh: '完全由你掌控的店铺页面',
    },
    body: {
      en: 'Add each product with photos, a price and the unit you actually sell in — per box, per kilo, per tray — plus a name and description in English, Chinese or both. Change a price, reorder your products or add tomorrow\'s special yourself, in seconds, without waiting on anyone.',
      zh: '每件产品都可上传照片、设定价格，并选择你真正的销售单位——每盒、每公斤、每盘——再加上中英文名称与说明。改价格、调整产品顺序、加上明天的特选，几秒钟自己就能完成，不必等任何人。',
    },
    teaser: {
      en: 'Add products with photos, prices and your own units — edit anytime, no waiting.',
      zh: '上传照片、设定价格与单位——随时修改，无需等待。',
    },
  },
  {
    id: 'delivery',
    title: {
      en: 'Delivery fees that match how you deliver',
      zh: '贴合你配送方式的运费',
    },
    body: {
      en: 'Charge one flat fee, a different fee by region, or a fee that follows the real road distance from your address — a base fee plus a rate per kilometre, worked out from the address the customer picks at checkout. Offer pickup, delivery or both.',
      zh: '可收取统一运费、按地区分级的运费，或依据从你所在地址出发的实际路程计费——基本费加每公里费率，按顾客结账时选定的地址计算。自取、配送，或两者兼有，由你决定。',
    },
    teaser: {
      en: 'Flat, regional or by-the-kilometre — priced however you actually deliver.',
      zh: '统一、分区或按公里计费——依你实际配送方式定价。',
    },
  },
  {
    id: 'orders',
    title: {
      en: 'Orders arrive numbered and complete',
      zh: '订单送达时已编号且资料齐全',
    },
    body: {
      en: 'Every order gets its own number and lands in one list with the customer\'s name and WhatsApp number, what they ordered, the date they want it and the total. Mark it preparing, ready or done as you work. Customers can look up their own order by its number, so nobody has to message you to ask where it is.',
      zh: '每笔订单都有专属编号，集中显示在同一份列表中，包含顾客姓名与 WhatsApp 号码、订购内容、指定日期和总额。处理过程中可标记为准备中、可取货或已完成。顾客也能凭编号自行查询订单，不必再私讯问你进度。',
    },
    teaser: {
      en: 'Every order numbered, in one list, trackable by your customer without messaging you.',
      zh: '订单编号齐全、集中列表，顾客免讯息即可自行查询。',
    },
  },
  {
    id: 'alerts',
    title: {
      en: 'You know the second an order comes in',
      zh: '订单一进来你立刻知道',
    },
    body: {
      en: 'An email reaches you the moment an order lands, and your dashboard updates itself while it is open. Set up Telegram and an instant alert buzzes your phone too — and everyone else in your shop\'s group at the same time.',
      zh: '订单进来的当下就会发送电邮通知，仪表板开着时也会自动更新。设置 Telegram 后还会收到即时通知，会震动你的手机，并同时通知店里群组的所有人。',
    },
  },
  {
    id: 'regulars',
    title: {
      en: 'Your regulars, where you can see them',
      zh: '看得见的熟客',
    },
    body: {
      en: 'Your shop builds its own customer list as orders come in: who orders from you, how often, what they have spent and how long it has been since the last time. Bring them back with discount vouchers and promotional prices on individual items.',
      zh: '随着订单累积，店铺会自动建立专属顾客名单：谁在下单、下单频率、累计消费金额，以及距离上次下单多久。可用优惠券和单品促销价，把他们带回来。',
    },
  },
  {
    // Appended rather than placed near `menu`, which it belongs with by subject: the landing page
    // renders FEATURES.slice(0, 3) as its hook, so a new entry higher up would silently drop
    // "Orders arrive numbered and complete" from the front page. Moving the hook is a decision
    // about what the landing sells, not a side effect of documenting a feature.
    id: 'menuimport',
    title: {
      en: 'Photograph your menu, get your product list',
      zh: '拍下菜单，直接生成产品列表',
    },
    body: {
      en: 'Take a photo of the menu you already have — printed, or the board on your wall — and TinyOrder reads it into draft products: the name, the price, the unit and the section it sits under, with the Chinese name too where your menu prints one. You check every line and fix anything it misread, and nothing is saved until you press add. A price it could not read is left blank for you to fill in, never guessed. One page at a time.',
      zh: '拍下你现有的菜单——印刷版，或墙上的菜单板——TinyOrder 会读成产品草稿：名称、价格、单位，以及所属分类；菜单上有中文名称时也会一并读取。每一行都由你核对、更正，按下新增之前不会保存任何内容。读不出的价格会留空让你自己填写，绝不猜测。每次处理一页。',
    },
  },
  {
    id: 'assistant',
    title: {
      en: 'Ask your dashboard a question',
      zh: '直接向仪表板提问',
    },
    body: {
      en: 'Type a question about your own orders in plain English or Chinese — which product made the least money, how the last 30 days compared with the 30 before — and get a short answer worked out from your own figures, with the period it used written underneath it. It reads your shop and only your shop, it never changes anything, and cancelled orders stay out of the revenue exactly as they do on your charts.',
      zh: '用日常中文或英文询问你自己的订单——哪个产品营收最低、最近 30 天与之前 30 天相比如何——即可获得依你自己的数据算出的简短回答，下方并注明所采用的时间范围。它只读取你的店铺，不会读取别人的，也不会更改任何内容；营收同样不计入已取消的订单，与图表一致。',
    },
  },
  {
    id: 'money',
    title: {
      en: 'The money is yours',
      zh: '钱是你的',
    },
    body: {
      en: 'No commission, ever. Customers pay you directly, into your own account, and TinyOrder charges one flat subscription whether you take five orders this month or five hundred. Prices show in your shop\'s own currency, with tax added at your rate if you charge it.',
      zh: '永不抽成。顾客直接付款到你自己的账户，而 TinyOrder 只收固定订阅费——这个月接五单或五百单，费用都一样。价格以店铺自选货币显示；如果你需要收税，也会按你设定的税率计算。',
    },
  },
]
