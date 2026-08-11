// The four business-type pages at /for/<slug>, as data rather than markup — same reason as faq.ts
// and features.ts: a copy change never touches layout, and a test can see every entry is
// translated.
//
// WHY THESE PAGES EXIST: the site says what TinyOrder does (/features), what it costs (/pricing)
// and what shop owners ask (/faq). It never said who it is FOR. A home baker reading "sell what
// you make" has to translate it into "take cake pre-orders" themselves, and the site owned no page
// that matched what such a visitor actually searches for. See
// docs/superpowers/specs/2026-08-10-business-use-case-pages-design.md and issue #214.
//
// EVERY CLAIM HERE MUST BE TRUE OF THE PRODUCT AS SHIPPED. public/llms.txt is the authoritative
// list of what a shop gets. These are pre-purchase pages; an aspirational sentence is a promise the
// software has to keep, and a visitor who signs up for a feature that does not exist churns on day
// one. Where a fact changes — the trial, what Pro adds, how delivery is priced — this file changes.
//
// AND NO CLAIM ABOUT WHO ALREADY SELLS HERE. No maker, café or meal-prep shop has been onboarded;
// verticals.ts carries the same note for the same reason. These pages position TinyOrder for a
// reader without asserting that reader is already a customer. There are no testimonials here, and
// inventing one is not an option.
//
// FOUR PAGES BUILT FROM ONE TEMPLATE EARN THEIR PLACE BY WHAT THEY SAY. The layout is shared; the
// sentences are not. useCases.test.ts pins that no question here re-asks one from faq.ts.

import type { RouteMeta } from '../routeMeta'

/** One string in both languages, in the order `t(en, zh)` takes them. */
export interface Copy {
  en: string
  zh: string
}

/** A story block: what this trade cares about, in that trade's words. */
export interface UseCaseBlock {
  /** Stable React key, unique within the vertical. */
  id: string
  title: Copy
  body: Copy
}

/** A question this trade asks, which /faq does not answer. */
export interface UseCaseFaqEntry {
  /** Stable React key, unique within the vertical. */
  id: string
  q: Copy
  a: Copy
}

export interface UseCase {
  /** The URL is `/for/${slug}`. Kebab-case, unique, and the keyword the page is written around. */
  slug: string
  /** Footer link and landing-card label. */
  label: Copy
  h1: Copy
  intro: Copy
  /** One line under the label on the landing page's strip. */
  cardBlurb: Copy
  blocks: UseCaseBlock[]
  faq: UseCaseFaqEntry[]
  /**
   * The page's `<title>` and `<meta name="description">`, spread into ROUTE_META (routeMeta.ts).
   * English only, like every other entry in that table: it is the one language the shell is
   * served in, and a title rewritten per visitor is not something a crawler ever sees.
   */
  meta: RouteMeta
}

/** The path a vertical is served at. One definition, used by the router, the prerender and the links. */
export function pathForUseCase(slug: string): string {
  return `/for/${slug}`
}

export const USE_CASES: UseCase[] = [
  {
    slug: 'home-bakers',
    label: { en: 'Home bakers', zh: '烘焙店主' },
    h1: {
      en: 'Take cake and bake orders without the back-and-forth',
      zh: '接烘焙订单，不必来回追问',
    },
    intro: {
      en: 'You bake to order, so every order needs a day, a size and a count. TinyOrder gives you a page that asks for all three, and puts what comes back in one numbered list instead of eleven chat threads.',
      zh: '你是接单才烘焙的，所以每一笔订单都需要日期、尺寸和数量。TinyOrder 给你一个会问齐这三样的页面，并把订单收进一份编号清单，而不是十一条聊天记录。',
    },
    cardBlurb: {
      en: 'Pre-orders with the day they are wanted, priced by the piece, box or dozen.',
      zh: '预订单附带指定日期，可按件、按盒或按打定价。',
    },
    blocks: [
      {
        id: 'wanted-date',
        title: {
          en: 'Every order arrives with the day it is wanted',
          zh: '每笔订单都带着指定日期送到你面前',
        },
        body: {
          en: 'The customer picks the day when they order, and that day sits beside the order in your list. You bake Saturday\'s orders on Saturday instead of scrolling back through a chat to work out who wanted what, and when.',
          zh: '顾客下单时就选好日期，日期会显示在订单清单里。你在星期六做星期六的订单，不必回头翻聊天记录，确认谁要什么、什么时候要。',
        },
      },
      {
        id: 'open-days',
        title: {
          en: 'Close the days you are already full',
          zh: '排满的日子可以关掉',
        },
        body: {
          en: 'Set the notice you need, how far ahead you take orders, and the weekdays you never bake. Or pick the exact dates instead, so a customer books a Sunday only when you opened it.',
          zh: '设定你需要提前几天、最远接单到多久之后，以及固定不开炉的星期几。也可以改为指定确切日期，顾客只能预订你开放的星期日。',
        },
      },
      {
        id: 'units',
        title: {
          en: 'Priced by the piece, the box, the dozen or the tray',
          zh: '按件、按盒、按打或按盘定价',
        },
        body: {
          en: 'A cake sells by the piece and a cookie by the dozen, so each product carries its own unit and quantity. The customer sees what they are buying in the same words you use, and the total is worked out for them.',
          zh: '蛋糕按件卖，饼干按打卖，所以每件产品都有自己的单位和数量。顾客看到的说法和你平时用的一样，总额也会自动算好。',
        },
      },
      {
        id: 'no-commission',
        title: {
          en: 'No commission on a price you worked out by hand',
          zh: '你一分一毫算出的价格，我们不抽成',
        },
        body: {
          en: 'Festive weeks are when a commission bites hardest — the more you bake, the more it takes. Your subscription does not move: a December of cake orders costs what a quiet February costs, and customers keep paying you the way they already do.',
          zh: '节庆旺季正是抽成最伤的时候——做得越多，被抽走的越多。你的订阅费不会变：接满蛋糕订单的十二月，和冷清的二月一样多少钱；顾客也照原本的方式付款给你。',
        },
      },
    ],
    faq: [
      {
        id: 'ahead',
        q: {
          en: 'Can someone order a cake for three weeks from now?',
          zh: '顾客可以预订三个星期后的蛋糕吗？',
        },
        a: {
          en: 'That is your setting. You choose how much notice you need and how far ahead your page takes orders — up to three months — and the customer picks a day inside that. The order then sits in your list with that date on it.',
          zh: '这由你设定。你决定需要提前几天，以及页面最远接单到多久之后——最长三个月——顾客在这个范围内选日期。订单会带着那个日期留在清单里。',
        },
      },
      {
        id: 'full-day',
        q: {
          en: 'What if I am already full on a Saturday?',
          zh: '如果某个星期六已经排满了怎么办？',
        },
        a: {
          en: 'A weekday you never bake can be closed outright. For one particular Saturday, pick the exact dates you take orders for instead, and your page offers nothing else — so you never cancel a cake you cannot bake.',
          zh: '固定不开炉的星期几可以直接关闭。若只是某一个星期六，改为指定接单的确切日期，页面不会显示其他日子——你也就不必取消做不了的蛋糕。',
        },
      },
      {
        id: 'mixed-units',
        q: {
          en: 'Can I sell a cake by size and cookies by the dozen on the same page?',
          zh: '同一个页面可以按尺寸卖蛋糕、按打卖饼干吗？',
        },
        a: {
          en: 'Yes. Every product carries its own unit and quantity — per piece, box, set, pack, dozen, bottle, jar, tray, slice, kg or g — so a page can mix them freely.',
          zh: '可以。每件产品都有自己的单位和数量——件、盒、套、包、打、瓶、罐、盘、片、公斤或克——同一个页面可以自由混用。',
        },
      },
      {
        id: 'lookup',
        q: {
          en: 'Can a customer check their own order without messaging me?',
          zh: '顾客可以自己查订单，不必来问我吗？',
        },
        a: {
          en: 'Yes. Every order gets a number, and a customer who has it can look the order up on your page and see whether it is preparing, ready or done.',
          zh: '可以。每笔订单都有编号，顾客用编号就能在你的页面上查询，看到订单是准备中、已完成待取，还是已完成。',
        },
      },
    ],
    meta: {
      title: 'Order Page for Home Bakers — Take Cake Orders | TinyOrder',
      description:
        'Take cake, cookie and bread pre-orders on your own page. Customers pick the day they want, orders arrive numbered, and you pay no commission on a sale.',
    },
  },
  {
    slug: 'home-kitchens',
    label: { en: 'Home kitchens & meal prep', zh: '家厨与备餐' },
    h1: {
      en: 'Take this week\'s food orders on one page',
      zh: '在同一个页面收齐本周的餐点订单',
    },
    intro: {
      en: 'Cooking for the same people every week means the same questions every week. TinyOrder gives your kitchen an order page that already knows what you sell, what you charge to deliver, and when you stop taking orders.',
      zh: '每周为同一批人做饭，就得每周回答同样的问题。TinyOrder 给你的厨房一个订单页面，它已经知道你卖什么、配送怎么收费，以及什么时候截单。',
    },
    cardBlurb: {
      en: 'Weekly orders, delivery priced by real road distance, regulars who come back.',
      zh: '每周订单、按实际路程计算的运费，以及回头的熟客。',
    },
    blocks: [
      {
        id: 'regulars',
        title: {
          en: 'The customer list builds itself',
          zh: '顾客名单会自己累积',
        },
        body: {
          en: 'Every order adds its customer to your list, with their name, their WhatsApp number and what they have ordered before. You stop keeping the regulars in your head, and stop losing them when a phone is replaced.',
          zh: '每笔订单都会把顾客加进名单，包含姓名、WhatsApp 号码和过往订购内容。你不必再把熟客记在脑子里，换手机也不会把他们弄丢。',
        },
      },
      {
        id: 'distance',
        title: {
          en: 'Delivery priced by how far you actually drive',
          zh: '运费按你真正要开的路程计算',
        },
        body: {
          en: 'Charge a flat fee, a fee by region, or a base fee plus a rate for every kilometre of real road distance from your kitchen to the customer\'s address. The fee is worked out before the order is placed, so nobody argues about it afterwards.',
          zh: '你可以收统一运费、按区域收费，或收基本费加上从厨房到顾客地址每公里的费率，路程按实际道路距离计算。运费在下单前就算好，事后没人需要争论。',
        },
      },
      {
        id: 'cutoff',
        title: {
          en: 'Orders close when you stop cooking',
          zh: '你不煮了，订单就关上',
        },
        body: {
          en: 'Every order names the day it is for, and you set which days can be named: the notice you need, how far ahead your page takes orders, and the weekdays you are closed. Pro adds picking the exact dates instead.',
          zh: '每笔订单都注明是哪一天的，而哪些日子可选由你决定：需要提前几天、页面最远接单到多久之后，以及每周固定休息的日子。Pro 版还能改为指定确切日期。',
        },
      },
      {
        id: 'status',
        title: {
          en: 'Preparing, ready, done',
          zh: '准备中、可取、已完成',
        },
        body: {
          en: 'You move an order along as you cook it, and a customer holding the order number can check it themselves. We email you the moment an order lands, and a Telegram alert reaches everyone helping you at once.',
          zh: '你一边做一边更新订单状态，拿着订单编号的顾客可以自己查询。订单一进来我们就发电邮给你，Telegram 通知则一次通知所有帮手。',
        },
      },
    ],
    faq: [
      {
        id: 'cutoff-day',
        q: {
          en: 'Can I take orders until Thursday for a Sunday delivery?',
          zh: '我可以收到星期四为止，星期日才配送吗？',
        },
        a: {
          en: 'Yes. Set how much notice you need and how far ahead your page takes orders, so Sunday stays open until it falls inside that notice. Or pick the exact dates instead, and open Sunday alone.',
          zh: '可以。设定你需要提前几天，以及页面最远接单到多久之后，星期日会一直开放，直到进入你设定的提前期。也可以改为指定确切日期，只开放星期日。',
        },
      },
      {
        id: 'fee-worked-out',
        q: {
          en: 'How is the delivery fee worked out?',
          zh: '运费是怎么算的？',
        },
        a: {
          en: 'However you already charge it. A flat fee for everyone, a different fee per region, or a base fee plus a rate per kilometre of road distance from your kitchen — the customer sees the fee before they confirm.',
          zh: '按你原本的收法。可以是统一收费、按区域不同收费，或基本费加上从你厨房算起的每公里费率，路程按道路距离计算——顾客在确认前就看得到。',
        },
      },
      {
        id: 'who-orders',
        q: {
          en: 'Can I see who orders from me every week?',
          zh: '我可以看到每周向我订购的是哪些人吗？',
        },
        a: {
          en: 'Yes. Your customer list is built from your own orders — name, WhatsApp number and what they have ordered — and it grows on its own as people order.',
          zh: '可以。顾客名单由你自己的订单累积而成——姓名、WhatsApp 号码和订购内容——顾客一下单它就自动增加。',
        },
      },
      {
        id: 'guest',
        q: {
          en: 'Do my customers have to create an account?',
          zh: '顾客一定要注册账号吗？',
        },
        a: {
          en: 'No. A customer can order as a guest with just their name and WhatsApp number. Making an account is optional and only saves their details for next time.',
          zh: '不必。顾客可以用姓名和 WhatsApp 号码以访客身份下单。注册账号是可选的，只是方便下次自动带出资料。',
        },
      },
    ],
    meta: {
      title: 'Take Meal Prep & Home Kitchen Orders Online | TinyOrder',
      description:
        'Take weekly meal prep and home-cooked food orders on one page. Price delivery by real road distance, close orders when you stop cooking, keep your regulars.',
    },
  },
  {
    slug: 'makers',
    label: { en: 'Makers & crafts', zh: '手作与工艺' },
    h1: {
      en: 'Sell what you make, without giving away a cut of it',
      zh: '卖你亲手做的东西，不必被抽成',
    },
    intro: {
      en: 'Handmade work is priced by hand — the materials, the hours, and what the piece is worth. TinyOrder gives you an order page for it and charges a flat subscription, so nothing comes off the price you decided on.',
      zh: '手作的价格是一件一件算出来的——材料、工时，还有作品本身的价值。TinyOrder 给你一个卖它的订单页面，只收固定订阅费，你定下的价格不会被扣掉任何一分。',
    },
    cardBlurb: {
      en: 'Made-to-order pieces, photographed, priced per piece, set or pack.',
      zh: '接单制作的作品，配上照片，按件、按套或按包定价。',
    },
    blocks: [
      {
        id: 'storefront',
        title: {
          en: 'Your work, photographed and orderable',
          zh: '你的作品，配上照片，可以直接下单',
        },
        body: {
          en: 'Each piece gets a photo, a price and a description, in English, Chinese or both. The page is yours at its own link — share it in an Instagram bio or a WhatsApp status and it is the whole shop, with no website to build.',
          zh: '每件作品都有照片、价格和说明，可用英文、中文或两者。这个页面有自己的链接，属于你——放进 Instagram 简介或 WhatsApp 状态，它就是整间店，不必另外做网站。',
        },
      },
      {
        id: 'units',
        title: {
          en: 'Priced per piece, per set or per pack',
          zh: '按件、按套或按包定价',
        },
        body: {
          en: 'A print sells by the piece, a card set by the set, stickers by the pack. Each product carries its own unit and quantity, so a customer reads the price the same way you quote it.',
          zh: '版画按件卖，卡片按套卖，贴纸按包卖。每件产品都有自己的单位和数量，顾客看到的价格和你报价的方式一样。',
        },
      },
      {
        id: 'margin',
        title: {
          en: 'A commission is a bite out of a margin you calculated',
          zh: '抽成，就是从你算好的利润里咬一口',
        },
        body: {
          en: 'TinyOrder takes none. You pay a flat subscription, monthly or yearly, and your customers pay you directly — the platform never touches the money. Ten sales and a hundred sales cost you exactly the same.',
          zh: 'TinyOrder 一分不抽。你付固定订阅费，月付或年付都行，顾客直接付款给你——平台不经手货款。卖十件和卖一百件，费用完全一样。',
        },
      },
      {
        id: 'lead-time',
        title: {
          en: 'Made to order, with the date in the order',
          zh: '接单才做，日期就写在订单里',
        },
        body: {
          en: 'Every order carries the day the customer wants it, and moves through preparing, ready and done as you work. A customer with the order number can check it themselves instead of asking you how it is coming along.',
          zh: '每笔订单都带着顾客希望拿到的日期，并随你的进度在准备中、可取和已完成之间移动。拿着订单编号的顾客可以自己查询，不必再问你做得怎么样了。',
        },
      },
    ],
    faq: [
      {
        id: 'food-only',
        q: {
          en: 'Is TinyOrder only for food?',
          zh: 'TinyOrder 只能卖食物吗？',
        },
        a: {
          en: 'No. Most shops here started with food, and nothing in the product is food-only — a maker selling craft, art, clothing or any other small-batch goods uses the same storefront, the same delivery pricing and the same order list.',
          zh: '不是。这里多数店铺是从食物开始的，但产品本身并不限于食物——卖手作、艺术品、服饰或其他小批量商品的创作者，用的是同一个店面、同一套运费设定和同一份订单清单。',
        },
      },
      {
        id: 'weeks',
        q: {
          en: 'What if a piece takes two weeks to make?',
          zh: '如果一件作品要做两个星期呢？',
        },
        a: {
          en: 'Set two weeks as the notice you need, and your page stops offering anything sooner. Put the lead time in the product description too, and the customer picks a day beyond it. The date sits on the order in your list.',
          zh: '把需要提前的天数设为两个星期，页面就不会显示更早的日期。同时把所需时间写在产品说明里，顾客只能选之后的日子。日期会显示在订单清单上。',
        },
      },
      {
        id: 'instagram',
        q: {
          en: 'Can I take orders from Instagram?',
          zh: '我可以从 Instagram 接单吗？',
        },
        a: {
          en: 'Yes — that is what the link is for. Put your shop link in your bio or a story, and the person who taps it lands on your products and orders there instead of sending you a DM you have to answer.',
          zh: '可以——链接就是为此而设。把店铺链接放进简介或限时动态，点进来的人会直接看到产品并下单，而不是发一条你还得回复的私讯。',
        },
      },
      {
        id: 'small-batch',
        q: {
          en: 'Is it worth it if I only sell a few pieces a month?',
          zh: '如果我一个月只卖几件，值得吗？',
        },
        a: {
          en: 'That is your call, and the trial is there to answer it — seven days without a card. The subscription is flat either way, so a few pieces cost the same to sell as many.',
          zh: '这由你决定，试用期正是为此而设——七天，无需信用卡。订阅费是固定的，卖几件和卖很多件的费用相同。',
        },
      },
    ],
    meta: {
      title: 'Sell Handmade Crafts and Art to Order | TinyOrder',
      description:
        'Take made-to-order craft, art and clothing orders on your own page. Photos, per-piece and per-set prices, and no commission on anything you make by hand.',
    },
  },
  {
    slug: 'cafes-and-stalls',
    label: { en: 'Cafés & market stalls', zh: '咖啡店与市集摊位' },
    h1: {
      en: 'Let them order before they get to you',
      zh: '让顾客还没到，就已经下好单',
    },
    intro: {
      en: 'A queue at the counter is a customer you can serve. A queue in your messages is not. TinyOrder gives your café or stall a pickup page, so the orders are in one numbered list before you open.',
      zh: '柜台前的队伍你能招呼，讯息里的队伍不行。TinyOrder 给你的咖啡店或摊位一个自取页面，开门前订单就已经收进一份编号清单。',
    },
    cardBlurb: {
      en: 'Pickup pre-orders, collected at the counter or the stall.',
      zh: '预订自取，到柜台或摊位取货。',
    },
    blocks: [
      {
        id: 'pickup-only',
        title: {
          en: 'Pickup only, if that is all you do',
          zh: '只做自取也可以',
        },
        body: {
          en: 'Turn delivery off and your page offers collection alone, with your address on it. Or keep both and let the customer choose. Nothing on the page offers a service you do not run.',
          zh: '关掉配送，页面就只提供自取，并显示你的地址。也可以两者都保留，让顾客自己选。页面不会出现你没有提供的服务。',
        },
      },
      {
        id: 'before-open',
        title: {
          en: 'The morning\'s orders are in before the morning is',
          zh: '早上的订单，在早上到来之前就到了',
        },
        body: {
          en: 'Each order names the day it is for and arrives numbered, with the customer, their number and what they want. You prepare against a list instead of reading back through messages while a queue forms.',
          zh: '每笔订单都注明日期，送达时已编号，附上顾客、联络号码和所要的东西。你照着清单准备，而不是在排队人潮中回头翻讯息。',
        },
      },
      {
        id: 'counter',
        title: {
          en: 'Read the order number off your phone',
          zh: '在手机上读出订单编号',
        },
        body: {
          en: 'Every order has a number, and you mark it preparing, ready or done as you go. A customer who has the number can check it on your page, so "is mine ready" stops being a message you answer with both hands full.',
          zh: '每笔订单都有编号，你可以随时标记为准备中、可取或已完成。拿着编号的顾客可以在页面上自行查询，你不必在双手都忙时回覆「我的好了吗」。',
        },
      },
      {
        id: 'one-link',
        title: {
          en: 'One link, and a QR code for the sign',
          zh: '一条链接，加一个可以贴在招牌上的二维码',
        },
        body: {
          en: 'Your dashboard gives you the shop link and a QR code for it. Print the code for the stall front or the counter, and a customer standing there can order the next batch without queueing twice.',
          zh: '仪表板会给你店铺链接和对应的二维码。把二维码印出来贴在摊位前或柜台上，站在那里的顾客就能预订下一批，不必排两次队。',
        },
      },
    ],
    faq: [
      {
        id: 'no-delivery',
        q: {
          en: 'Can I turn delivery off completely?',
          zh: '可以完全关掉配送吗？',
        },
        a: {
          en: 'Yes. A shop can offer pickup only, delivery only, or both. With pickup only, your page shows your collection address and never asks for a delivery address.',
          zh: '可以。店铺可以只提供自取、只提供配送，或两者都有。只做自取时，页面会显示取货地址，也不会要求顾客填写配送地址。',
        },
      },
      {
        id: 'arrive',
        q: {
          en: 'How does a customer find their order when they arrive?',
          zh: '顾客到了以后怎么对上自己的订单？',
        },
        a: {
          en: 'By the order number. Every order gets one, the customer sees it when they order, and you find the same number in your list — no name-spelling at a busy counter.',
          zh: '用订单编号。每笔订单都有编号，顾客下单时就看得到，你在清单里找同一个编号——柜台忙的时候不必再核对姓名。',
        },
      },
      {
        id: 'today-only',
        q: {
          en: 'Can I take pre-orders only for the days I am at the market?',
          zh: '我可以只在摆摊的日子接受预订吗？',
        },
        a: {
          en: 'Yes — pick the exact dates you take orders for, and your page offers only those. Or set a rolling window instead: the notice you need, how far ahead to take orders, and the weekdays you are closed.',
          zh: '可以——你指定接单的确切日期，页面只会显示这些日子。也可以改为设定一个滚动范围：需要提前几天、最远接单到多久之后，以及每周固定休息的日子。',
        },
      },
      {
        id: 'hardware',
        q: {
          en: 'Do I need a printer or a tablet?',
          zh: '需要打印机或平板吗？',
        },
        a: {
          en: 'No. The order list is a web page, so the phone in your apron works. An email arrives on every plan when an order lands, and Pro adds a Telegram alert for everyone working the stall.',
          zh: '不需要。订单清单就是一个网页，围裙口袋里的手机就够用。所有方案都会在订单进来时寄电邮，Pro 版另加 Telegram 通知，摊位上的每个人都收得到。',
        },
      },
    ],
    meta: {
      title: 'Pickup Pre-Orders for Small Cafés and Stalls | TinyOrder',
      description:
        'Let customers pre-order and collect. Set pickup only, take the morning\'s orders before you open, and read numbered orders off your phone at the counter.',
    },
  },
]
