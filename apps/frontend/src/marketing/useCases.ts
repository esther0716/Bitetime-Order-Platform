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
      en: 'Every order carries the date the customer wants it, so tomorrow\'s bake list is one screen, not five days of chats. Add a special or pull a sold-out item yourself, in seconds.',
      zh: '每笔订单都会带上顾客指定的日期，周五要做什么一个画面看完，不必翻五天聊天记录。明天的特选或卖完的品项，自己几秒钟就能调整。',
    },
  },
  {
    id: 'drops',
    title: {
      en: 'Weekly drops and limited runs',
      zh: '每周上新与限量发售',
    },
    body: {
      en: 'Set a promo price with a unit cap and end date. The cap locks as orders commit, so a run of ten sells ten — never quietly oversold. Promotional pricing is on Pro.',
      zh: '设定促销价，加上数量上限与结束日期。上限会随订单成立扣除，十件就是十件——绝不超卖。促销定价为 Pro 版功能。',
    },
  },
  {
    id: 'fulfilment',
    title: {
      en: 'Pickup only, delivery only, or both',
      zh: '只自取、只配送，或两者兼有',
    },
    body: {
      en: 'Turn pickup and delivery on independently — at least one stays on. Pickup is free at your address; delivery charges a flat rate that can differ by region.',
      zh: '自取与配送可独立开关，至少保留一项。自取免费，显示你填写的地址；配送收统一运费，且可按地区分级。',
    },
  },
  {
    id: 'distance',
    title: {
      en: 'Delivery priced by the road, not by guesswork',
      zh: '按实际路程计费，不靠估算',
    },
    body: {
      en: 'Charge a base fee plus a rate per kilometre, worked out from the real road distance to the customer\'s address. Out-of-range or unreachable addresses are refused outright — never a fee that loses you money.',
      zh: '设定基本费加每公里费率，依实际路程计算到顾客地址的运费。超出范围或无法送达的地址会直接拒绝——不会给出让你亏本的运费。',
    },
  },
  {
    id: 'options',
    title: {
      en: 'Boxes the customer fills, drinks the customer picks',
      zh: '顾客自选的组合与配料',
    },
    body: {
      en: 'Ask a question on any product — six flavours to a box, one milk on a coffee. Each answer can add to the price and prints on the order. Menu options are on Pro.',
      zh: '任何产品都能附加问题——一盒六种口味，或一杯咖啡选奶。每个选项可加价，并印在订单上。菜单选项为 Pro 版功能。',
    },
  },
]
