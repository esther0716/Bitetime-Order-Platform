# Business Use-Case Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four marketing pages at `/for/<slug>` — home bakers, home kitchens, makers, cafés and stalls — each with its own title, description, prerendered HTML file and FAQ structured data.

**Architecture:** One bilingual data module (`useCases.ts`) holds every string; one template component (`UseCasePage.tsx`) renders any entry; `ROUTE_META`, the router and the prerender list are all derived from the data, so three existing test suites cover the new pages automatically.

**Tech Stack:** React 19, React Router v7, TypeScript, Tailwind classes inline, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-10-business-use-case-pages-design.md`

**Branch:** `feat/use-case-pages` (already created, spec already committed).

## Global Constraints

- All work is in `apps/frontend/`. Run commands from the repo root; `pnpm --filter @bitetime/frontend test` runs the frontend suite.
- **Every user-facing string is bilingual**, passed as `t(english, chinese)` where `t` comes from `useSession()`. There is no i18n library.
- **Every claim in the copy must be true of the product as shipped.** The authoritative list is `apps/frontend/public/llms.txt`. Do not invent features, customer counts, testimonials or numbers.
- `ROUTE_META` titles must be ≤65 characters, descriptions ≤160 characters, and every title unique — `routeMeta.test.ts` enforces all three.
- Marketing pages that are prerendered are **imported eagerly** in `AppRouter.tsx`, never behind `lazy()`.
- Keep the `mm-land` class on each marketing page's outermost `<div>` — `body:has(.mm-land)` in `index.css` resets body padding.
- Commit after each task. Do not run any `supabase` command; this change touches no database.

---

### Task 1: The content module

Everything the four pages say, as data. Nothing renders it yet, so the suite stays green.

**Files:**
- Create: `apps/frontend/src/marketing/useCases.ts`
- Test: `apps/frontend/src/marketing/useCases.test.ts`

**Interfaces:**
- Consumes: `RouteMeta` from `../routeMeta` (an existing exported interface: `{ title: string; description: string }`).
- Produces: `Copy`, `UseCaseBlock`, `UseCaseFaqEntry`, `UseCase`, `USE_CASES: UseCase[]`, `pathForUseCase(slug: string): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/marketing/useCases.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { USE_CASES, pathForUseCase } from './useCases'
import { FAQ } from './faq'

// Same reason as verticals.test.ts and faq.test.ts: both language fields are strings, so an entry
// carrying English in its Chinese slot type-checks perfectly and ships inside a Chinese page.
// Nothing here renders anything — these are content pins.

/** Every bilingual pair in one entry, flattened, so one loop can check them all. */
function pairs(useCase: (typeof USE_CASES)[number]) {
  return [
    { field: 'label', copy: useCase.label },
    { field: 'h1', copy: useCase.h1 },
    { field: 'intro', copy: useCase.intro },
    { field: 'cardBlurb', copy: useCase.cardBlurb },
    ...useCase.blocks.flatMap((b, i) => [
      { field: `blocks[${i}].title`, copy: b.title },
      { field: `blocks[${i}].body`, copy: b.body },
    ]),
    ...useCase.faq.flatMap((f, i) => [
      { field: `faq[${i}].q`, copy: f.q },
      { field: `faq[${i}].a`, copy: f.a },
    ]),
  ]
}

describe('USE_CASES content', () => {
  it('has the four verticals the design names', () => {
    expect(USE_CASES.map(u => u.slug)).toEqual([
      'home-bakers',
      'home-kitchens',
      'makers',
      'cafes-and-stalls',
    ])
  })

  it('never leaves a string blank in either language', () => {
    for (const useCase of USE_CASES) {
      for (const { field, copy } of pairs(useCase)) {
        expect(copy.en.trim(), `${useCase.slug} ${field}.en`).not.toBe('')
        expect(copy.zh.trim(), `${useCase.slug} ${field}.zh`).not.toBe('')
      }
    }
  })

  it('never repeats the English as the Chinese — what a forgotten translation looks like', () => {
    for (const useCase of USE_CASES) {
      for (const { field, copy } of pairs(useCase)) {
        expect(copy.zh, `${useCase.slug} ${field} is untranslated`).not.toBe(copy.en)
      }
    }
  })

  it('gives every Chinese string a Han character — a distinct string is not proof of translation', () => {
    for (const useCase of USE_CASES) {
      for (const { field, copy } of pairs(useCase)) {
        expect(copy.zh, `${useCase.slug} ${field}.zh`).toMatch(/[一-鿿]/)
      }
    }
  })

  it('keys every vertical on a unique kebab-case slug — the slug IS the URL', () => {
    const slugs = USE_CASES.map(u => u.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) {
      expect(slug, `${slug} is not kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('serves every vertical under /for', () => {
    expect(pathForUseCase('home-bakers')).toBe('/for/home-bakers')
  })

  // Fewer than three and the page is a stub; more than four and it stops being a page written for
  // one reader and becomes /features again.
  it('gives every vertical three or four story blocks and three or four questions', () => {
    for (const useCase of USE_CASES) {
      expect(useCase.blocks.length, `${useCase.slug} blocks`).toBeGreaterThanOrEqual(3)
      expect(useCase.blocks.length, `${useCase.slug} blocks`).toBeLessThanOrEqual(4)
      expect(useCase.faq.length, `${useCase.slug} faq`).toBeGreaterThanOrEqual(3)
      expect(useCase.faq.length, `${useCase.slug} faq`).toBeLessThanOrEqual(4)
    }
  })

  it('keys blocks and questions uniquely within a vertical, so React has stable keys', () => {
    for (const useCase of USE_CASES) {
      const blockIds = useCase.blocks.map(b => b.id)
      expect(new Set(blockIds).size, `${useCase.slug} block ids`).toBe(blockIds.length)
      const faqIds = useCase.faq.map(f => f.id)
      expect(new Set(faqIds).size, `${useCase.slug} faq ids`).toBe(faqIds.length)
    }
  })

  // THE thin-content pin. Four pages built from one template earn their place by what they say;
  // a page that re-asks /faq's questions is a fourth copy of /faq wearing a different title.
  it('never re-asks a question /faq already answers', () => {
    const asked = new Set(FAQ.flatMap(e => [e.q.en, e.q.zh]))
    for (const useCase of USE_CASES) {
      for (const entry of useCase.faq) {
        expect(asked.has(entry.q.en), `${useCase.slug} ${entry.id} duplicates /faq`).toBe(false)
        expect(asked.has(entry.q.zh), `${useCase.slug} ${entry.id} duplicates /faq`).toBe(false)
      }
    }
  })

  it('never re-asks the same question on two verticals', () => {
    const questions = USE_CASES.flatMap(u => u.faq.map(f => f.q.en))
    expect(new Set(questions).size).toBe(questions.length)
  })

  // ROUTE_META's own suite checks these once they are spread in (Task 4). Checking them here is
  // what makes Task 1 self-contained: a title written 20 characters too long is caught where it
  // is written, not three commits later.
  it('gives every vertical a title and description search results can show whole', () => {
    for (const useCase of USE_CASES) {
      expect(useCase.meta.title.length, `${useCase.slug} title`).toBeLessThanOrEqual(65)
      expect(useCase.meta.description.length, `${useCase.slug} description`).toBeLessThanOrEqual(160)
      expect(useCase.meta.title, `${useCase.slug} title`).toContain('TinyOrder')
    }
  })

  it('gives no two verticals the same title — a duplicate is one sitelink candidate, not two', () => {
    const titles = USE_CASES.map(u => u.meta.title)
    expect(new Set(titles).size).toBe(titles.length)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bitetime/frontend test -- useCases`
Expected: FAIL — `Failed to resolve import "./useCases"`.

- [ ] **Step 3: Write the content module**

Create `apps/frontend/src/marketing/useCases.ts`:

```ts
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
          en: 'On Pro you choose the exact days you take orders for, and the calendar on your page offers only those. A customer cannot book a Sunday you are not baking, so you stop turning people down after the fact.',
          zh: 'Pro 版可以指定你接单的日期，页面上的日历只会显示这些日子。顾客无法预订你不开炉的星期日，你也就不必事后回绝。',
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
          en: 'You pay a flat subscription and nothing else. Your customers pay you directly, the way they always have — TinyOrder never handles the money and takes no cut, so a busy December costs you the same as a quiet February.',
          zh: '你只付固定订阅费，没有其他费用。顾客照旧直接付款给你——TinyOrder 不经手货款，也不抽成，所以繁忙的十二月和冷清的二月费用一样。',
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
          en: 'Yes. The customer picks the day they want when they order, however far ahead that is, and the order sits in your list with that date on it until you get to it.',
          zh: '可以。顾客下单时自行选择想要的日期，多远都行；订单会带着那个日期留在清单里，直到你处理它。',
        },
      },
      {
        id: 'full-day',
        q: {
          en: 'What if I am already full on a Saturday?',
          zh: '如果某个星期六已经排满了怎么办？',
        },
        a: {
          en: 'On Pro you pick the days you take orders for, and only those days appear on your page. A customer cannot choose a day you have closed, so you never have to cancel a cake you cannot bake.',
          zh: 'Pro 版可以指定接单日期，页面上只会显示这些日子。顾客无法选择你关闭的日期，你也就不必取消做不了的蛋糕。',
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
          en: 'Every order names the day it is for, and on Pro you decide which days are open at all. A Sunday menu stops taking orders when you say so, instead of one more message arriving while you are already packing.',
          zh: '每笔订单都注明是哪一天的，Pro 版还能由你决定哪些日子开放接单。星期日的菜单可以按你的时间截单，而不是在你打包时又跳出一条讯息。',
        },
      },
      {
        id: 'status',
        title: {
          en: 'Preparing, ready, done',
          zh: '准备中、可取、已完成',
        },
        body: {
          en: 'You move an order along as you cook it, and a customer holding the order number can check it themselves. Every plan emails you the moment an order lands; Pro adds a Telegram alert that reaches everyone helping you at once.',
          zh: '你一边做一边更新订单状态，拿着订单编号的顾客可以自己查询。所有方案都会在订单进来时发电邮给你；Pro 版另加 Telegram 通知，一次通知所有帮手。',
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
          en: 'Yes. The customer picks the day they want the food, so a Sunday order can be placed any time before you close orders. On Pro you choose exactly which days can be picked at all.',
          zh: '可以。顾客自己选要哪一天的餐点，所以在你截单之前随时可以下星期日的订单。Pro 版还能由你指定哪些日期可选。',
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
          en: 'Put the lead time in the product description, and let the customer pick the day they want it when they order. The date sits on the order in your list, so you can work in the order the dates fall.',
          zh: '把所需时间写在产品说明里，让顾客下单时选择希望拿到的日期。日期会显示在订单清单上，你可以按日期先后安排制作。',
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
          en: 'That is your call, and the trial is there to answer it — seven days on Basic without a card. The subscription is flat either way, so a few pieces cost the same to sell as many.',
          zh: '这由你决定，试用期正是为此而设——基础版七天，无需信用卡。订阅费是固定的，卖几件和卖很多件的费用相同。',
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
          en: 'On Pro, yes — you pick the days you take orders for, and your page offers only those. On Basic every day is open and the customer picks the one they want.',
          zh: 'Pro 版可以——你指定接单的日期，页面只显示这些日子。基础版则每天开放，由顾客自行选择。',
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bitetime/frontend test -- useCases`
Expected: PASS, all cases.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/marketing/useCases.ts apps/frontend/src/marketing/useCases.test.ts
git commit -m "feat(marketing): add the four business use-case entries as data

The copy for /for/home-bakers, /for/home-kitchens, /for/makers and
/for/cafes-and-stalls, bilingual, in the shape faq.ts and features.ts
use. Nothing renders it yet.

Every claim is checked against public/llms.txt: no feature the product
does not have, and no statement about who already sells here. The tests
pin both languages, the slug format, and that no question here re-asks
one from /faq — which is what would make four templated pages read as
four copies of one page."
```

---

### Task 2: The page template and its routes

The four pages render in the dev server. `ROUTE_META` is deliberately untouched — it drives three other suites, and they are cut over in one piece in Task 4.

**Files:**
- Create: `apps/frontend/src/marketing/UseCasePage.tsx`
- Modify: `apps/frontend/src/AppRouter.tsx` (imports near line 29, routes near line 186)

**Interfaces:**
- Consumes: `USE_CASES`, `pathForUseCase`, `UseCase` from `./useCases`; `MarketingNav`, `MarketingFooter` from `./MarketingChrome`; `Reveal` from `./LandingMotion`; `ctaPrimary`, `sectionTitle` from `./ctaStyles`; `useTopOnRouteChange` from `./useTopOnRouteChange`.
- Produces: `UseCasePage` (default export), taking `{ useCase }: { useCase: UseCase }`.

- [ ] **Step 1: Write the page component**

There is no unit test for this file — per CLAUDE.md, UI is verified by running the app, and every marketing page in this directory is verified the same way. The content it renders is already pinned by Task 1.

Create `apps/frontend/src/marketing/UseCasePage.tsx`:

```tsx
// /for/<slug> — one business type, written for one reader.
//
// ONE component for all four verticals: the layout is shared, the sentences are not (useCases.ts).
// Four hand-written pages would be four places to fix a heading level and four chances for one of
// them to drift out of the language toggle.
//
// Its `<title>` and `<meta name="description">` come from ROUTE_META — the entries are spread in
// from useCases.ts — and are baked into dist/for/<slug>.html by scripts/prerender.tsx.

import { Link } from 'react-router-dom'
import { useSession } from '../SessionContext'
import { MarketingNav, MarketingFooter } from './MarketingChrome'
import { useTopOnRouteChange } from './useTopOnRouteChange'
import { useUseCaseStructuredData } from './structuredData'
import type { UseCase } from './useCases'
import { ctaPrimary } from './ctaStyles'
import { Reveal } from './LandingMotion'

export default function UseCasePage({ useCase }: { useCase: UseCase }) {
  const { t } = useSession()
  useTopOnRouteChange()
  // No useCanonical / useDocumentMeta here: both are mounted once in AppRouter and keyed on the
  // pathname, so every route gets them and none can be forgotten. See canonical.ts, documentMeta.ts.

  return (
    // Keep mm-land class — body:has(.mm-land) in index.css resets body padding/alignment
    <div className="mm-land relative isolate flex flex-col items-stretch min-h-screen font-sans text-foreground bg-background">
      <MarketingNav />

      {/* ── Header ── */}
      <section className="max-w-[720px] mx-auto px-8 pt-16 pb-4 text-center max-[600px]:px-5 max-[600px]:pt-10">
        <h1 className="font-heading text-[clamp(1.9rem,4vw,2.75rem)] font-medium text-foreground leading-[1.2] tracking-[-0.01em] mb-5">
          {t(useCase.h1.en, useCase.h1.zh)}
        </h1>
        <p className="text-base leading-[1.75] text-ink-700 max-w-[580px] mx-auto mb-4">
          {t(useCase.intro.en, useCase.intro.zh)}
        </p>
      </section>

      {/* ── The trade's own story ── */}
      <section className="px-8 pb-16 max-w-[760px] mx-auto w-full max-[600px]:px-5 max-[600px]:pb-10">
        <Reveal>
          <div className="flex flex-col gap-10 max-[600px]:gap-8">
            {useCase.blocks.map(block => (
              <div key={block.id}>
                <h2 className="font-heading text-[19px] font-semibold text-primary leading-[1.35] mb-2 max-[600px]:text-[17px]">
                  {t(block.title.en, block.title.zh)}
                </h2>
                <p className="text-[15px] leading-[1.75] text-ink-700 m-0">
                  {t(block.body.en, block.body.zh)}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── Questions this trade asks ── */}
      {/* A plain list, not the /faq accordion. A collapsed accordion renders no panel content at
          all, and these pages are prerendered precisely so the words are in the file a crawler
          downloads — the same argument FaqPage.tsx answers with `hiddenUntilFound`, answered here
          by there being nothing to open. Four questions do not need a control. */}
      <section className="border-t border-border px-8 py-14 max-w-[760px] mx-auto w-full max-[600px]:px-5 max-[600px]:py-10">
        <Reveal>
          <h2 className="font-heading text-2xl font-medium text-foreground mb-8 max-[600px]:text-xl">
            {t('Questions we get asked', '常被问到的问题')}
          </h2>
          <dl className="flex flex-col gap-7 m-0">
            {useCase.faq.map(entry => (
              <div key={entry.id}>
                <dt className="font-heading text-[16px] font-semibold text-foreground mb-2">
                  {t(entry.q.en, entry.q.zh)}
                </dt>
                <dd className="text-[14px] leading-[1.7] text-muted-foreground m-0">
                  {t(entry.a.en, entry.a.zh)}
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </section>

      {/* ── Closing CTA ── */}
      <section className="border-t border-border px-8 py-16 text-center bg-brand-100 max-[600px]:px-5 max-[600px]:py-10">
        <Reveal>
          <h2 className="font-heading italic text-[18px] text-foreground mb-6 max-w-[520px] mx-auto">
            {t('Seven days on Basic, no card, and your own shop at the end of it.', '基础版七天，无需信用卡，结束时你已经有了自己的店。')}
          </h2>
          <Link to="/merchant/signup" className={ctaPrimary}>
            {t('Start your shop', '开始建店')}
          </Link>
          {/* Back up the tree: a page whose only outbound links point deeper is a dead end to a
              crawler working out which pages belong to which. */}
          <p className="mt-6 mb-0 text-[13px] text-muted-foreground flex flex-wrap justify-center gap-x-4 gap-y-2">
            <Link to="/features" className="underline underline-offset-4 hover:text-primary">
              {t('See everything TinyOrder does', '查看 TinyOrder 的所有功能')}
            </Link>
            <Link to="/pricing" className="underline underline-offset-4 hover:text-primary">
              {t('See Basic and Pro pricing', '查看基础版与 Pro 版价格')}
            </Link>
          </p>
        </Reveal>
      </section>

      <MarketingFooter />
    </div>
  )
}
```

> The `useUseCaseStructuredData` import above does not exist yet — Task 3 creates it. Leave the
> import and the call OUT until then: add the file exactly as written but **delete the import line
> and do not call the hook** in this task, then restore both in Task 3. This keeps each task's
> build green on its own.

To be explicit, in this task the file's imports and body start:

```tsx
import { Link } from 'react-router-dom'
import { useSession } from '../SessionContext'
import { MarketingNav, MarketingFooter } from './MarketingChrome'
import { useTopOnRouteChange } from './useTopOnRouteChange'
import type { UseCase } from './useCases'
import { ctaPrimary } from './ctaStyles'
import { Reveal } from './LandingMotion'

export default function UseCasePage({ useCase }: { useCase: UseCase }) {
  const { t } = useSession()
  useTopOnRouteChange()
```

- [ ] **Step 2: Add the eager import to AppRouter**

In `apps/frontend/src/AppRouter.tsx`, directly after the `import FaqPage from './marketing/FaqPage'` line (near line 29), add:

```tsx
// Same rule a fourth time: every /for/<slug> page is prerendered (dist/for/<slug>.html), so the
// template stays out of the lazy() boundary too. One component serves all four — see useCases.ts.
import UseCasePage from './marketing/UseCasePage'
import { USE_CASES, pathForUseCase } from './marketing/useCases'
```

- [ ] **Step 3: Add the routes**

In the same file, directly after the `<Route path="/faq" element={<FaqPage />} />` line (near line 186), add:

```tsx
          {/* One route per business type, all rendered by one template. Same argument as /pricing
              and /features: real pages of their own with their own <title> and description, and
              the page a visitor searching for their own trade actually lands on (#214).
              Prerendered — see scripts/prerender.tsx. */}
          {USE_CASES.map(useCase => (
            <Route
              key={useCase.slug}
              path={pathForUseCase(useCase.slug)}
              element={<UseCasePage useCase={useCase} />}
            />
          ))}
```

- [ ] **Step 4: Verify the whole suite is still green**

Run: `pnpm --filter @bitetime/frontend test && pnpm typecheck && pnpm lint`
Expected: PASS. `ROUTE_META` is untouched, so `routeMeta.test.ts`, `vercelRewrites.test.ts` and `llmsTxt.test.ts` still describe the four routes that already existed.

- [ ] **Step 5: Look at the pages in the browser**

Run: `pnpm dev`, then open `http://localhost:5173/for/home-bakers` and the other three paths.
Expected: each page renders its own heading, blocks, questions and CTA; the language toggle in the nav switches every string on the page; the tab title still says the homepage's title (that is Task 4's job).

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/marketing/UseCasePage.tsx apps/frontend/src/AppRouter.tsx
git commit -m "feat(marketing): render the use-case pages at /for/<slug>

One template for all four verticals, taking a USE_CASES entry. Eagerly
imported like every other prerendered marketing page: a lazy boundary
throws the baked markup away on boot and shows a spinner where a
finished page already was.

The FAQ is a plain <dl>, not the /faq accordion — a collapsed panel
renders no text at all, and these pages exist to put words in the file a
crawler downloads.

Routes only. ROUTE_META, the prerender list and vercel.json move
together in a later commit, because three suites key off that table."
```

---

### Task 3: FAQ structured data per page

**Files:**
- Modify: `apps/frontend/src/marketing/structuredData.ts`
- Modify: `apps/frontend/src/marketing/UseCasePage.tsx` (restore the import and the hook call from Task 2)
- Modify: `apps/frontend/src/marketing/FaqPage.tsx:22` (the `useFaqStructuredData(lang)` call site)
- Test: `apps/frontend/src/marketing/structuredData.test.ts`

**Interfaces:**
- Consumes: `UseCase` from `./useCases`, `SITE_URL` from `../site`, `Lang` from `../types`.
- Produces:
  - `faqStructuredDataForUseCase(useCase: UseCase, lang: Lang): object`
  - `useStructuredData(data: object): void` — the generalised hook that adopts, writes and removes the single `script[data-structured-data="faq"]`.
  - `useFaqStructuredData(lang: Lang): void` — unchanged signature, now a wrapper.
  - `useUseCaseStructuredData(useCase: UseCase, lang: Lang): void`

- [ ] **Step 1: Write the failing tests**

Append to `apps/frontend/src/marketing/structuredData.test.ts` (and add the two imports at the top of the file: `import { faqStructuredDataForUseCase } from './structuredData'` merged into the existing import, and `import { USE_CASES } from './useCases'`):

```ts
describe('faqStructuredDataForUseCase', () => {
  const bakers = USE_CASES[0]

  it('is a FAQPage — identity lives in index.html, not here', () => {
    const data = faqStructuredDataForUseCase(bakers, 'en') as Record<string, any>
    expect(data['@type']).toBe('FAQPage')
    expect(JSON.stringify(data)).not.toContain('"Organization"')
  })

  it('names the use-case page it actually describes, not /faq', () => {
    for (const useCase of USE_CASES) {
      const data = faqStructuredDataForUseCase(useCase, 'en') as Record<string, any>
      expect(data.url).toBe(`${SITE_URL}/for/${useCase.slug}`)
      expect(data['@id']).toBe(`${SITE_URL}/for/${useCase.slug}#faq`)
    }
  })

  it('gives every vertical a distinct @id — one id on four pages is one page to a crawler', () => {
    const ids = USE_CASES.map(u => (faqStructuredDataForUseCase(u, 'en') as Record<string, any>)['@id'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('hangs off the identity nodes index.html declares', () => {
    const data = faqStructuredDataForUseCase(bakers, 'en') as Record<string, any>
    expect(data.publisher['@id']).toBe(`${SITE_URL}/#organization`)
    expect(data.isPartOf['@id']).toBe(`${SITE_URL}/#website`)
  })

  it('carries every question, in the order the page renders them', () => {
    const data = faqStructuredDataForUseCase(bakers, 'en') as Record<string, any>
    expect(data.mainEntity).toHaveLength(bakers.faq.length)
    expect(data.mainEntity.map((q: any) => q.name)).toEqual(bakers.faq.map(e => e.q.en))
    expect(data.mainEntity[0].acceptedAnswer.text).toBe(bakers.faq[0].a.en)
  })

  it('marks up the Chinese page in Chinese — markup that disagrees with the page is worse than none', () => {
    const data = faqStructuredDataForUseCase(bakers, 'zh') as Record<string, any>
    expect(data.inLanguage).toBe('zh')
    expect(data.mainEntity.map((q: any) => q.name)).toEqual(bakers.faq.map(e => e.q.zh))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bitetime/frontend test -- structuredData`
Expected: FAIL — `faqStructuredDataForUseCase is not a function`.

- [ ] **Step 3: Generalise the hook and add the builder**

In `apps/frontend/src/marketing/structuredData.ts`, add the import:

```ts
import type { UseCase } from './useCases'
```

Then replace the section from `/** The prerendered block, or the one a previous run of this effect left behind. */` to the end of the file with:

```ts
/**
 * The /for/<slug> page's questions, as a Schema.org `FAQPage`.
 *
 * A SEPARATE `@id` PER PAGE is the point. Four pages publishing one id is one page as far as a
 * crawler is concerned, which would undo the reason these are four URLs (#214). Identified against
 * `SITE_URL` for the same reason `faqStructuredData` is: so it hangs off the Organization node
 * index.html declares rather than inventing a second one on a preview deployment.
 */
export function faqStructuredDataForUseCase(useCase: UseCase, lang: Lang): object {
  const pick = <T>(en: T, zh: T) => (lang === 'zh' ? zh : en)
  const url = `${SITE_URL}/for/${useCase.slug}`

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    url,
    inLanguage: pick('en', 'zh'),
    isPartOf: { '@id': `${SITE_URL}/#website` },
    publisher: { '@id': `${SITE_URL}/#organization` },
    mainEntity: useCase.faq.map(entry => ({
      '@type': 'Question',
      name: pick(entry.q.en, entry.q.zh),
      acceptedAnswer: {
        '@type': 'Answer',
        text: pick(entry.a.en, entry.a.zh),
      },
    })),
  }
}

/** The prerendered block, or the one a previous run of this effect left behind. */
const SELECTOR = 'script[data-structured-data="faq"]'

/**
 * Keeps exactly one `<script type="application/ld+json">` in `<head>` while the page is mounted.
 *
 * One element and one selector for every page that has an FAQPage block, because only one such
 * page is ever mounted at a time — and because leaving a second element behind is the failure this
 * function exists to prevent, not one to solve twice.
 */
function useStructuredData(data: object): void {
  const json = JSON.stringify(data)
  useEffect(() => {
    // ADOPT, do not append: the build prerenders this block into the page's own file (see
    // scripts/prerender.tsx) so a crawler that runs no JavaScript still gets the questions.
    // Appending a second one would publish the same @id twice — and on a Chinese page, twice in
    // two languages.
    const script =
      document.head.querySelector<HTMLScriptElement>(SELECTOR) ?? document.createElement('script')
    script.type = 'application/ld+json'
    script.dataset.structuredData = 'faq'
    script.textContent = json
    if (!script.isConnected) document.head.appendChild(script)
    // Removed on unmount — including when it was the prerendered one — so navigating to a
    // storefront does not leave this page's FAQ behind claiming to describe that shop.
    return () => script.remove()
    // Keyed on the serialised markup, not the object: a fresh object every render would re-run
    // this effect every render.
  }, [json])
}

/** Keeps the /faq page's FAQPage markup in `<head>`, in the language the page is showing. */
export function useFaqStructuredData(lang: Lang): void {
  useStructuredData(faqStructuredData(lang))
}

/** The same, for one /for/<slug> page. */
export function useUseCaseStructuredData(useCase: UseCase, lang: Lang): void {
  useStructuredData(faqStructuredDataForUseCase(useCase, lang))
}
```

`FaqPage.tsx` needs no change — `useFaqStructuredData(lang)` keeps its signature.

- [ ] **Step 4: Wire the hook into the page**

In `apps/frontend/src/marketing/UseCasePage.tsx`, restore the two lines held back in Task 2. Add the import after the `useTopOnRouteChange` import:

```tsx
import { useUseCaseStructuredData } from './structuredData'
```

and change the top of the component body to:

```tsx
  const { t, lang } = useSession()
  // Schema.org markup for this page only, in the language it is currently showing. A distinct @id
  // per vertical — see structuredData.ts.
  useUseCaseStructuredData(useCase, lang)
  useTopOnRouteChange()
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @bitetime/frontend test -- structuredData && pnpm typecheck && pnpm lint`
Expected: PASS, both the existing `faqStructuredData` cases and the new ones.

- [ ] **Step 6: Verify in the browser**

Run: `pnpm dev`, open `http://localhost:5173/for/makers`, and in the browser console run
`document.querySelectorAll('script[data-structured-data="faq"]').length`.
Expected: `1`, and its text contains `"/for/makers#faq"`. Navigate to `/faq` and back: still `1`, and its `@id` changes with the page. Navigate to `/` and it is `0`.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/marketing/structuredData.ts apps/frontend/src/marketing/structuredData.test.ts apps/frontend/src/marketing/UseCasePage.tsx
git commit -m "feat(marketing): publish FAQPage markup per use-case page

Each /for/<slug> page gets its own FAQPage block, with its own @id and
url. One id across four pages would be one page to a crawler, which is
the opposite of why these are four URLs.

The element handling — adopt the prerendered script rather than append a
second, and remove it on unmount so a storefront does not inherit it —
is lifted into one hook both callers share."
```

---

### Task 4: Registration — meta, prerender, rewrites, sitemap, llms.txt

One commit, because `ROUTE_META` is what `routeMeta.test.ts`, `vercelRewrites.test.ts` and `llmsTxt.test.ts` all read: adding the entries without the rewrites and the llms.txt links leaves the suite red, and adding them separately means a commit that fails CI.

**Files:**
- Modify: `apps/frontend/src/routeMeta.ts`
- Modify: `apps/frontend/scripts/prerender.tsx`
- Modify: `apps/frontend/vercel.json`
- Modify: `apps/frontend/public/sitemap.xml`
- Modify: `apps/frontend/public/llms.txt`

**Interfaces:**
- Consumes: `USE_CASES`, `pathForUseCase` from `./marketing/useCases`; `UseCasePage` from `./marketing/UseCasePage`; `faqStructuredDataForUseCase` from `./marketing/structuredData`.
- Produces: four new `ROUTE_META` keys — `/for/home-bakers`, `/for/home-kitchens`, `/for/makers`, `/for/cafes-and-stalls` — and four files at `dist/for/<slug>.html`.

- [ ] **Step 1: Run the three suites first, to see them pass on the current four routes**

Run: `pnpm --filter @bitetime/frontend test -- routeMeta vercelRewrites llmsTxt`
Expected: PASS. This is the baseline; the next step is what turns them red.

- [ ] **Step 2: Spread the use-case entries into ROUTE_META**

In `apps/frontend/src/routeMeta.ts`, add the import below the existing header comment:

```ts
import { USE_CASES, pathForUseCase } from './marketing/useCases'
```

and add this as the last entry of the `ROUTE_META` object, after the `'/faq'` entry:

```ts
  // The four business-type pages, spread in from the module that holds their copy. Written there
  // rather than here because a page's title and its first paragraph are one piece of writing, and
  // splitting them across two files is how they drift. Everything this table's consumers need is
  // still here: prerender.tsx, useDocumentMeta, vercelRewrites.test.ts and llmsTxt.test.ts all read
  // ROUTE_META and none of them can tell the difference.
  ...Object.fromEntries(USE_CASES.map(useCase => [pathForUseCase(useCase.slug), useCase.meta])),
```

- [ ] **Step 3: Run the three suites to verify they now fail**

Run: `pnpm --filter @bitetime/frontend test -- routeMeta vercelRewrites llmsTxt`
Expected: FAIL — `vercelRewrites.test.ts` reports `/for/home-bakers has no rewrite — it would be served app.html, the empty shell`, and `llmsTxt.test.ts` reports the same routes are never linked. `routeMeta.test.ts` passes (Task 1 already pinned the lengths).

- [ ] **Step 4: Add the rewrites**

In `apps/frontend/vercel.json`, add the four rules **above** the catch-all:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/pricing", "destination": "/pricing.html" },
    { "source": "/features", "destination": "/features.html" },
    { "source": "/faq", "destination": "/faq.html" },
    { "source": "/for/home-bakers", "destination": "/for/home-bakers.html" },
    { "source": "/for/home-kitchens", "destination": "/for/home-kitchens.html" },
    { "source": "/for/makers", "destination": "/for/makers.html" },
    { "source": "/for/cafes-and-stalls", "destination": "/for/cafes-and-stalls.html" },
    { "source": "/(.*)", "destination": "/app.html" }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/fonts/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    }
  ]
}
```

- [ ] **Step 5: Add the four links to llms.txt**

In `apps/frontend/public/llms.txt`, under `## Pages`, after the existing `[FAQ]` line, add:

```markdown

## Who it is for

- [Home bakers](https://tinyorder.shop/for/home-bakers): taking cake, cookie and bread pre-orders — the wanted date on every order, prices by the piece, box or dozen
- [Home kitchens and meal prep](https://tinyorder.shop/for/home-kitchens): weekly cooked-food orders — delivery priced by road distance, a customer list that builds itself
- [Makers and crafts](https://tinyorder.shop/for/makers): made-to-order craft, art and clothing — photos, per-piece and per-set prices, no commission
- [Cafés and market stalls](https://tinyorder.shop/for/cafes-and-stalls): pickup pre-orders collected at the counter — pickup-only shops, numbered orders, a QR code for the sign
```

- [ ] **Step 6: Run the three suites to verify they pass again**

Run: `pnpm --filter @bitetime/frontend test -- routeMeta vercelRewrites llmsTxt`
Expected: PASS.

- [ ] **Step 7: Add the routes to the prerender list**

In `apps/frontend/scripts/prerender.tsx`:

Add to the imports, after `import FaqPage from '../src/marketing/FaqPage'`:

```tsx
import UseCasePage from '../src/marketing/UseCasePage'
import { USE_CASES, pathForUseCase } from '../src/marketing/useCases'
import { faqStructuredData, faqStructuredDataForUseCase } from '../src/marketing/structuredData'
```

(replacing the existing `import { faqStructuredData } from '../src/marketing/structuredData'` line), and add `mkdirSync` to the `node:fs` import:

```tsx
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
```

Replace the `ROUTES` declaration with:

```tsx
const ROUTES: PrerenderRoute[] = [
  { path: '/', file: 'index.html', element: <Landing /> },
  { path: '/pricing', file: 'pricing.html', element: <Pricing /> },
  { path: '/features', file: 'features.html', element: <FeaturesPage /> },
  { path: '/faq', file: 'faq.html', element: <FaqPage />, head: faqLd },
  // The business-type pages, one file each under dist/for/. Their questions are baked in the same
  // way and for the same reason as /faq's — English, rewritten by the effect for a Chinese reader —
  // and each one carries its own @id, so four pages are four pages to a crawler (#214).
  ...USE_CASES.map(useCase => ({
    path: pathForUseCase(useCase.slug),
    file: `for/${useCase.slug}.html`,
    element: <UseCasePage useCase={useCase} />,
    head:
      `<script type="application/ld+json" data-structured-data="faq">` +
      `${JSON.stringify(faqStructuredDataForUseCase(useCase, 'en'))}</script>`,
  })),
]
```

And in the write loop at the end of the file, replace:

```tsx
  writeFileSync(path.join(dist, route.file), html)
```

with:

```tsx
  // `dist/for/` does not exist — Vite writes flat and `public/` has no such directory. Without
  // this the build throws ENOENT, which is the safe failure; shipping the page to a path Vercel
  // rewrites to a missing file would not be.
  const target = path.join(dist, route.file)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, html)
```

- [ ] **Step 8: Add the sitemap rows**

In `apps/frontend/public/sitemap.xml`, after the `/faq` `<url>` block and before `</urlset>`, add:

```xml
  <url>
    <loc>https://tinyorder.shop/for/home-bakers</loc>
    <lastmod>2026-08-10</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://tinyorder.shop/for/home-kitchens</loc>
    <lastmod>2026-08-10</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://tinyorder.shop/for/makers</loc>
    <lastmod>2026-08-10</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://tinyorder.shop/for/cafes-and-stalls</loc>
    <lastmod>2026-08-10</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
```

- [ ] **Step 9: Build and check the emitted bytes**

Run: `pnpm build`
Expected: the prerender log lists four new lines, e.g. `prerender: dist/for/home-bakers.html ← /for/home-bakers, NNkB of markup`.

Then verify the words and the markup really are in the file — this is the entire point of the prerender, and a browser cannot show you when it is missing:

```bash
grep -c "Every order arrives with the day it is wanted" apps/frontend/dist/for/home-bakers.html
grep -c '"/for/home-bakers#faq"' apps/frontend/dist/for/home-bakers.html
grep -o '<title>[^<]*</title>' apps/frontend/dist/for/home-bakers.html
grep -o 'rel="canonical" href="[^"]*"' apps/frontend/dist/for/makers.html
```

Expected: `1`, `1`, `<title>Order Page for Home Bakers — Take Cake Orders | TinyOrder</title>`, and `rel="canonical" href="https://tinyorder.shop/for/makers"`.

- [ ] **Step 10: Run the full suite**

Run: `pnpm --filter @bitetime/frontend test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/frontend/src/routeMeta.ts apps/frontend/scripts/prerender.tsx apps/frontend/vercel.json apps/frontend/public/sitemap.xml apps/frontend/public/llms.txt
git commit -m "feat(marketing): prerender and register the use-case pages

ROUTE_META, the prerender list, the rewrites, the sitemap and llms.txt
in one commit, because ROUTE_META is what three suites read: adding the
entries without the rewrites leaves the build red by design.

Each page is written to dist/for/<slug>.html with its own title,
description, canonical, og:url and FAQPage block, and gets its own
rewrite above the catch-all — Vercel does not try <path>.html for an
extensionless request, so without one the empty shell wins and a
JS-less crawler reads a blank document (#169).

The prerender now creates the directory it writes into; dist/for/ has
never existed before."
```

---

### Task 5: Links in — footer column and landing strip

Without this the four pages are orphans: reachable by URL, linked from nothing, and crawled last if at all.

**Files:**
- Modify: `apps/frontend/src/marketing/MarketingChrome.tsx` (the `MarketingFooter` columns, near line 160)
- Modify: `apps/frontend/src/marketing/Landing.tsx` (imports near line 9, and a new section before the footer CTA near line 303)

**Interfaces:**
- Consumes: `USE_CASES`, `pathForUseCase` from `./useCases`.
- Produces: nothing new — links only.

- [ ] **Step 1: Add the footer column**

In `apps/frontend/src/marketing/MarketingChrome.tsx`, add to the imports:

```tsx
import { USE_CASES, pathForUseCase } from './useCases'
```

and insert a new `FooterColumn` directly after the `Product` column's closing `</FooterColumn>`:

```tsx
        {/* Sitewide, so no /for/<slug> page is an orphan: every page on the site links to all four,
            which is what gets them crawled at all. See useCases.ts. */}
        <FooterColumn heading={t('Who it\'s for', '适合谁用')}>
          {USE_CASES.map(useCase => (
            <Link key={useCase.slug} to={pathForUseCase(useCase.slug)} className={footerColumnLink}>
              {t(useCase.label.en, useCase.label.zh)}
            </Link>
          ))}
        </FooterColumn>
```

- [ ] **Step 2: Add the landing strip**

In `apps/frontend/src/marketing/Landing.tsx`, add to the imports after `import { VERTICALS } from './verticals'`:

```tsx
import { USE_CASES, pathForUseCase } from './useCases'
```

and insert this section immediately before the `{/* ── Footer CTA ── */}` comment:

```tsx
      {/* ── Who it's for ── */}
      {/* Four links out, not four more sections: each of these is a page written for one reader
          (#214), and the argument against restating them here is the same one that moved the
          feature list to /features — two pages answering one question are two URLs competing. */}
      <section className="border-t border-border px-8 py-16 max-w-[900px] mx-auto w-full max-[600px]:px-5 max-[600px]:py-10">
        <Reveal>
          <h2 className={sectionTitle}>
            {t('Built for the way you already sell', '为你现有的销售方式而做')}
          </h2>
          <div className="grid [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] gap-4 max-[600px]:[grid-template-columns:1fr]">
            {USE_CASES.map(useCase => (
              <Link
                key={useCase.slug}
                to={pathForUseCase(useCase.slug)}
                className="block rounded-2xl border-[0.5px] border-border bg-card p-5 no-underline [transition:border-color_0.15s,transform_0.15s] hover:border-primary hover:-translate-y-px"
              >
                <span className="block font-heading text-[16px] font-semibold text-primary mb-1.5">
                  {t(useCase.label.en, useCase.label.zh)}
                </span>
                <span className="block text-[13px] leading-[1.6] text-ink-700">
                  {t(useCase.cardBlurb.en, useCase.cardBlurb.zh)}
                </span>
              </Link>
            ))}
          </div>
        </Reveal>
      </section>
```

- [ ] **Step 3: Run the suite**

Run: `pnpm --filter @bitetime/frontend test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Verify in the browser**

Run: `pnpm dev`, open `http://localhost:5173/`.
Expected: the four cards appear above the closing CTA and each navigates to its page; the footer shows a "Who it's for" column on every marketing page and on a storefront's footer if it renders one; the language toggle switches the card labels, the blurbs and the column heading.

- [ ] **Step 5: Rebuild and check the landing page's own bytes**

Run: `pnpm build && grep -c 'href="/for/home-bakers"' apps/frontend/dist/index.html`
Expected: at least `2` — once in the strip, once in the footer. This is what a JS-less crawler follows to find the new pages.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/marketing/MarketingChrome.tsx apps/frontend/src/marketing/Landing.tsx
git commit -m "feat(marketing): link the use-case pages from the footer and the landing page

A sitewide footer column, so every page links to all four and none of
them is an orphan, plus a four-card strip above the landing page's
closing CTA. The cards link out rather than restating the pages: two
URLs answering one question compete with each other, which is the same
argument that moved the feature list to /features."
```

---

### Task 6: Run-and-verify pass and the pull request

**Files:** none changed unless the pass finds something.

- [ ] **Step 1: Full check from a clean build**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all pass; the prerender log lists `index.html`, `pricing.html`, `features.html`, `faq.html` and the four `for/*.html`.

- [ ] **Step 2: Serve the built output and read the pages as a visitor**

Run: `pnpm --filter @bitetime/frontend preview`, then open `/for/home-bakers`, `/for/home-kitchens`, `/for/makers`, `/for/cafes-and-stalls`.

Check on each:
- the tab title is that page's title, not the homepage's
- switching to Chinese changes every visible string on the page, including the nav, the FAQ and the footer column
- the CTA reaches `/merchant/signup`, and both closing links reach `/features` and `/pricing`
- at 375px wide nothing overflows horizontally and the cards stack

- [ ] **Step 3: Confirm the crawler's view one more time**

```bash
for slug in home-bakers home-kitchens makers cafes-and-stalls; do
  echo "== $slug"
  grep -o '<title>[^<]*</title>' apps/frontend/dist/for/$slug.html
  grep -o '<meta name="description" content="[^"]*"' apps/frontend/dist/for/$slug.html
  grep -c 'application/ld+json' apps/frontend/dist/for/$slug.html
done
```

Expected: four distinct titles and descriptions, and `2` JSON-LD blocks per page (the identity block from `index.html`, plus this page's FAQPage).

- [ ] **Step 4: Open the pull request**

```bash
git push -u origin feat/use-case-pages
gh pr create --base dev --title "feat(marketing): business use-case pages at /for/<slug>" --body "$(cat <<'EOF'
Closes #214.

The site said what TinyOrder does, what it costs and what shop owners
ask. It never said who it is for. This adds four pages that do:

- `/for/home-bakers`
- `/for/home-kitchens`
- `/for/makers`
- `/for/cafes-and-stalls`

One template renders all four; every string lives in
`src/marketing/useCases.ts`, bilingual, in the shape `faq.ts` and
`features.ts` use. `ROUTE_META`, the router and the prerender list are
derived from that data, so `routeMeta.test.ts`, `vercelRewrites.test.ts`
and `llmsTxt.test.ts` cover the new pages without being told about them.

Each page is prerendered to its own file with its own title,
description, canonical, `og:url` and `FAQPage` block, and has its own
rewrite above the catch-all — Vercel does not try `<path>.html` for an
extensionless request, so a missing rewrite hands a JS-less crawler a
blank document (#169).

The copy claims nothing the product does not do, and there are no
testimonials: no maker, café or meal-prep shop has been onboarded, so
the pages position TinyOrder for those readers without saying they are
already customers. `useCases.test.ts` also pins that no question on
these pages re-asks one from `/faq`.

Design: `docs/superpowers/specs/2026-08-10-business-use-case-pages-design.md`
Plan: `docs/superpowers/plans/2026-08-10-business-use-case-pages.md`

Verified by running the built output: four distinct titles, both
languages on every page, the cards and the footer column navigating, and
the words and JSON-LD present in the emitted HTML.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Content model, `UseCase` shape, truth constraint | 1 |
| Per-vertical block topics | 1 (blocks written per the spec's list) |
| `UseCasePage.tsx`, eager import, layout | 2 |
| Structured data, `faqStructuredDataForUseCase`, generalised hook | 3 |
| Six registration points | 4 (`routeMeta`, `AppRouter` in Task 2, prerender, `vercel.json`, `sitemap.xml`, `llms.txt`) |
| `mkdirSync` for `dist/for/` | 4, Step 7 |
| Footer column and landing strip | 5 |
| `useCases.test.ts` content pins, no-duplicate-question | 1 |
| `structuredData.test.ts` extension | 3 |
| Run-and-verify instead of component tests | 2, 3, 5, 6 |

**Placeholders:** none — every code step carries the code, every copy string is written out in both languages.

**Type consistency:** `Copy`, `UseCaseBlock`, `UseCaseFaqEntry`, `UseCase`, `USE_CASES`, `pathForUseCase` are defined in Task 1 and used with the same names in Tasks 2–5. `faqStructuredDataForUseCase(useCase, lang)` and `useUseCaseStructuredData(useCase, lang)` are defined in Task 3 and called with that argument order in Task 3 (page) and Task 4 (prerender). `RouteMeta` is the existing exported interface from `routeMeta.ts`; importing it into `useCases.ts` and spreading back into `ROUTE_META` in the same file is a cycle at the module level but not at the value level — `routeMeta.ts` imports `useCases.ts`, and `useCases.ts` imports only the *type* from `routeMeta.ts` (`import type`), which is erased at compile time. Task 1 uses `import type` for exactly that reason.
