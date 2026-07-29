// The landing page's "ways to sell" section, as data — same reasoning as faq.ts and features.ts: a
// copy change never touches layout, and a test can see that every entry is really translated.
//
// MERCHANT-FACING, and every line must be TRUE OF THE PRODUCT AS SHIPPED. This section is the page's
// answer to thin content: a marketing page that says "take orders online" five different ways has
// nothing for a reader deciding whether their particular way of selling fits. Each entry therefore
// describes a real mechanism (fulfilment date, promo cap, fulfilment methods, express distance,
// option groups) in the words a shop owner would use, and names the plan when the mechanism is Pro.
//
// PHRASED AS "IF YOU…", never "our shops do". Like verticals.ts, this is positioning: it must not
// read as a claim about who already sells here. Where a fact here changes, this file changes with it.

export interface UseCaseEntry {
  /** Stable key for the list. */
  id: string
  title: { en: string; zh: string }
  body: { en: string; zh: string }
}

export const USE_CASES: UseCaseEntry[] = [
  {
    id: 'preorders',
    title: {
      en: 'Pre-orders for a date later this week',
      zh: '预订本周稍后的日期',
    },
    body: {
      en: 'If you take orders now and make them later, every order carries the date the customer wants it — so your bake list for Friday is one screen, not a scroll back through five days of chats. Add tomorrow\'s special or take a sold-out item down yourself, in seconds, without asking anyone.',
      zh: '如果你是先接单、之后才做，每一笔订单都会带上顾客指定的日期——周五要做什么，一个画面就看完，不必回头翻五天的聊天记录。明天的特选自己加，卖完的品项自己下架，几秒钟搞定，不必等任何人。',
    },
  },
  {
    id: 'drops',
    title: {
      en: 'Weekly drops and limited runs',
      zh: '每周上新与限量发售',
    },
    body: {
      en: 'If you sell a fixed number and then stop, put a promotional price on the item with a unit cap and an end date. The cap is claimed as each order commits, so a run of ten sells ten — the eleventh order is priced at your normal price rather than quietly oversold at the promo one. Promotional pricing is on Pro.',
      zh: '如果你每次只卖固定数量，卖完就收，可以为该品项设定促销价，并加上数量上限与结束日期。上限会在每笔订单成立时扣除，因此十件就是十件——第十一笔按原价计算，不会在你不知情的情况下超卖。促销定价为 Pro 版功能。',
    },
  },
  {
    id: 'fulfilment',
    title: {
      en: 'Pickup only, delivery only, or both',
      zh: '只自取、只配送，或两者兼有',
    },
    body: {
      en: 'Turn pickup and delivery on and off independently, and at least one is always on. Pickup costs the customer nothing and shows the address you wrote for it. Delivery charges a flat rate that can differ by region, so posting a parcel across the country is not priced like dropping one down the road.',
      zh: '自取与配送可以各自独立开关，并且至少保留一项。自取不收费，页面上会显示你自行填写的取货地址。配送收取统一运费，且可依地区分级——寄到外地和送到街尾，不必是同一个价钱。',
    },
  },
  {
    id: 'distance',
    title: {
      en: 'Delivery priced by the road, not by guesswork',
      zh: '按实际路程计费，不靠估算',
    },
    body: {
      en: 'If you run the deliveries yourself, charge a base fee plus a rate per kilometre, worked out from the real road distance between your shop and the address the customer picks at checkout. The kilometres appear on the order line that charged for them. An address your route cannot reach, or one past the limit you set, is refused outright — you are never quoted a fee that loses you money.',
      zh: '如果配送是你自己跑，可以设定基本费加每公里费率，依据你的店址到顾客结账时选定地址之间的实际路程计算。收费的那一行会写明公里数。若地址无法送达，或超出你设定的距离上限，系统会直接拒绝——不会给出一个让你亏本的运费。',
    },
  },
  {
    id: 'options',
    title: {
      en: 'Boxes the customer fills, drinks the customer picks',
      zh: '顾客自选的组合与配料',
    },
    body: {
      en: 'Ask a question on any product: six flavours to a box, or one milk on a coffee. Each answer can add to the price, and what the customer chose is printed on the order along with what it added — so a line still adds up months later, after you have changed the menu. Menu options are on Pro.',
      zh: '任何产品都能附上一道问题：一盒六个口味自由搭配，或一杯咖啡选一种奶。每个选项都能加价，顾客选了什么、加了多少钱，都会写在订单上——即使几个月后你改了菜单，那一行依然算得清楚。菜单选项为 Pro 版功能。',
    },
  },
]
