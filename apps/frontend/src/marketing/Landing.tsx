import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../SessionContext'
import { signOut } from '../store'
import { usePlatformPricing } from '../usePlatformPricing'
import { formatMoney } from '../currency'
import LanguageSelect from '../components/LanguageSelect'
import Wordmark from '../components/Wordmark'
import { Button } from '../components/ui/button'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../components/ui/accordion'
import { REFUNDS_ANCHOR } from '../legal/anchors'
import { FAQ } from './faq'
import { FEATURES } from './features'
import { USE_CASES } from './useCases'
import { VERTICALS } from './verticals'
import { useLandingStructuredData } from './structuredData'
import { cn } from '../lib/utils'
import {
  GrainOverlay,
  Reveal,
  HeroStagger,
  HeroItem,
  MagneticButton,
  RotatingWord,
  StorefrontPreview,
} from './LandingMotion'

// Transitional (low-commitment) CTA target: a real storefront a hesitant
// merchant can preview before signing up. Swap the slug to change the demo shop.
const SAMPLE_SHOP_SLUG = 'bitetime-co'

// ── CTA class strings (reused across hero, pricing cards, footer) ─────────
const ctaPrimary =
  'inline-block py-[13px] px-7 bg-oxblood text-cream rounded-md text-[15px] font-medium font-sans no-underline [transition:background_0.15s,transform_0.15s] hover:bg-oxblood-deep hover:-translate-y-px'

const ctaGhost =
  'inline-block py-3 px-[26px] border-[1.5px] border-clay-border rounded-md text-[15px] font-medium font-sans text-ink-soft no-underline [transition:border-color_0.15s,color_0.15s] hover:border-oxblood hover:text-oxblood'

// Inside a flex-col card: push to bottom and centre text
const cardCtaPrimary = cn(ctaPrimary, 'mt-auto text-center')
const cardCtaGhost   = cn(ctaGhost,   'mt-auto text-center')

// Shared nav-link style (Pricing anchor + Merchant log in)
const navLink =
  'text-[13px] text-rose-muted no-underline font-medium [transition:color_0.15s] hover:text-oxblood'

// Account dropdown menu-item (Link or button)
const menuItem =
  'block w-full box-border text-left py-[9px] px-3 border-0 rounded-sm bg-transparent text-rose-muted text-[13px] font-sans font-medium no-underline cursor-pointer [transition:all_0.15s] hover:bg-oxblood-tint hover:text-oxblood'

// Section-heading (Steps + Pricing share the same style)
const sectionTitle =
  'font-heading text-2xl font-medium text-ink text-center mb-10'

export default function Landing() {
  const { t, lang, account, role, loading, merchantUnknown } = useSession()
  const { pricing } = usePlatformPricing()
  // Schema.org markup for this page only, in the language it is currently showing. See
  // structuredData.ts for why it is not a static block in index.html.
  useLandingStructuredData(lang)
  const [menuOpen, setMenuOpen] = useState(false)
  const [billing, setBilling] = useState('monthly') // 'monthly' | 'yearly'

  // The hero's rotating word, resolved to the showing language. Memoised so a new array identity
  // does not defeat RotatingWord's memo on every Landing re-render (billing toggle, menu open…).
  const verticalWords = useMemo(
    () => VERTICALS.map((v) => (lang === 'zh' ? v.zh : v.en)),
    [lang]
  )

  // Where the signed-in user's portal lives, by role. Customers have no portal — with one
  // exception: someone who is signed in and owns NO shop is where merchant signup leaves you
  // when email confirmation splits it in half (see pendingShop.ts). Confirming the email lands
  // them HERE, and until this case existed the account menu offered them nothing but Sign out —
  // no dashboard, and no way to reach the half of signup that was never finished.
  // `merchantUnknown` is the "we could not read your shop" case (#98), which also reads as role
  // 'customer'. Offering THAT user a shop to set up would state, as fact, that they have none.
  const shopless = !!account && role === 'customer' && !merchantUnknown
  const portal = role === 'superadmin'
    ? { to: '/admin', label: t('Admin', '管理后台') }
    : role === 'merchant'
      ? { to: '/merchant', label: t('My dashboard', '我的后台') }
      : shopless
        ? { to: '/merchant', label: t('Set up my shop', '设置我的店铺') }
        : null

  // Pricing tiers. Amounts come from the region-resolved backend pricing (`pricing`);
  // yearly is billed at 10× monthly (2 months free) and shown as an effective /mo.
  const tiers = [
    {
      id: 'basic',
      name: t('Basic', '基础版'),
      blurb: t(
        'Get your orders out of the chat group.',
        '把订单从聊天群组里解放出来。',
      ),
      features: [
        t('Your own order page, ready to share', '专属订单页面，随时分享'),
        t('Full control of your products — add, edit, or remove items anytime', '产品完全自主管理——随时增加、修改、删除商品'),
        t('Custom delivery fees by region', '配送费可依地区自定义'),
        t('Orders auto-calculated', '订单自动算总价'),
      ],
      cta: t('Start your shop', '开始建店'),
      // The trial is Basic-only: signing up Basic is cardless and the 7 days start at
      // approval. Pro goes straight to Checkout and is charged on day one, so the two
      // tiers cannot share one risk-reversal line without the Pro card lying.
      note: t('Free for 7 days · no card', '免费试用 7 天 · 无需信用卡'),
      to: '/merchant/signup',
      highlight: false,
    },
    {
      id: 'pro',
      name: 'Pro',
      blurb: t(
        'The moment your orders start piling up, you need to know first.',
        '订单开始堆积的那一刻，你要第一个知道。',
      ),
      inherits: t('Everything in Basic, plus', '包含 Basic 所有功能，再加'),
      features: [
        t('Instant Telegram alerts the second an order comes in', '订单一进来，Telegram 即时通知你'),
        t('Bring customers back with built-in vouchers', '内建优惠券，让客人主动回购'),
        t('Priority support — your questions jump the queue', '优先支持——你的问题优先处理'),
      ],
      cta: t('Start your shop', '开始建店'),
      note: t('Start free on Basic · upgrade anytime', '先免费试用基础版 · 随时升级'),
      to: '/merchant/signup',
      highlight: true,
      badge: t('Most popular', '最受欢迎'),
    },
  ]

  return (
    // Keep mm-land class — body:has(.mm-land) in index.css resets body padding/alignment
    <div className="mm-land relative isolate flex flex-col items-stretch min-h-screen font-sans text-ink bg-cream">
      <GrainOverlay />

      {/* ── Nav bar ── */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-clay-border max-[600px]:px-5 max-[600px]:py-4">
        <Wordmark className="h-7 max-[600px]:h-6" />
        <div className="flex items-center gap-5">
          <a href="#pricing" className={navLink}>
            {t('Pricing', '价格')}
          </a>
          <div className="flex justify-end gap-1.5">
            <LanguageSelect />
          </div>
          {loading ? null : account ? (
            <div className="relative">
              <Button
                type="button"
                variant="outline"
                size="pill"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(o => !o)}
              >
                {account.email}
              </Button>
              {menuOpen && (
                <>
                  {/* Transparent click-catcher overlay */}
                  <div
                    className="fixed inset-0 z-[var(--z-dropdown)]"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    className="absolute top-[calc(100%+8px)] right-0 z-[var(--z-modal-popover)] min-w-[160px] bg-surface-high border-[1.5px] border-clay-border rounded-lg shadow-[0_8px_24px_rgba(43,10,16,0.16)] overflow-hidden p-1"
                    role="menu"
                  >
                    {portal && (
                      <Link
                        to={portal.to}
                        className={menuItem}
                        role="menuitem"
                        onClick={() => setMenuOpen(false)}
                      >
                        {portal.label}
                      </Link>
                    )}
                    <button
                      type="button"
                      className={menuItem}
                      role="menuitem"
                      onClick={async () => { setMenuOpen(false); await signOut() }}
                    >
                      {t('Sign out', '退出登录')}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <Link to="/merchant/login" className={navLink}>
              {t('Merchant log in', '商家登录')}
            </Link>
          )}
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="max-w-[700px] mx-auto px-8 pt-20 pb-16 text-center max-[600px]:px-5 max-[600px]:pt-12 max-[600px]:pb-10">
        <HeroStagger>
          <HeroItem>
            <p className="font-heading italic text-[15px] text-rose-muted mb-5">
              {t('We know what it\'s like to run a business out of your DMs.', '我们懂，用聊天窗口接单有多累。')}
            </p>
          </HeroItem>
          <HeroItem>
            {/* aria-label carries the sentence as one static string: the visible word changes every
                2.6s, and a screen reader re-announcing the h1 that often is noise. It also
                overrides descendant content for the accessible name, so nothing inside needs
                aria-hidden. Keep it in sync with the visible halves below. */}
            <h1
              aria-label={t(
                'Sell your food online — your own shop, without the DM chaos.',
                '把美食搬到线上——你的专属店铺，告别聊天接单的混乱。'
              )}
              className="font-heading text-[clamp(2rem,5vw,3.5rem)] font-medium text-ink leading-[1.18] tracking-[-0.01em] mb-5"
            >
              {/* Two blocks, not one flowing sentence: the rotating word's width changes as it
                  cycles, and confining it to its own line is what keeps that from rewrapping the
                  static half every 2.6 seconds. Each clause is short enough to hold one line down
                  to 375px. English needs nothing after the word; Chinese needs its verb phrase. */}
              <span className="block">
                {t('Sell your ', '把')}
                <RotatingWord words={verticalWords} />
                {t('', '搬到线上——')}
              </span>
              <span className="block">
                {/* The English half opens with a space that renders as nothing — a block start
                    collapses it — but survives into the markup, so a crawler concatenating the two
                    blocks reads "Sell your food online", not "foodonline". Chinese needs no space
                    and must not get one. */}
                {t(' online — your own shop, without the DM chaos.', '你的专属店铺，告别聊天接单的混乱。')}
              </span>
            </h1>
          </HeroItem>
          <HeroItem>
            <p className="text-base leading-[1.7] text-ink-soft max-w-[560px] mx-auto mb-9">
              {t(
                'Orders get lost across chats and screenshots. TinyOrder gives you one branded storefront link — so every order lands in one place and you look the part.',
                '订单散落在各种聊天和截图里。TinyOrder 给你一个专属店面链接——所有订单集中一处，让你更专业。'
              )}
            </p>
          </HeroItem>
          <HeroItem>
            <div className="flex gap-4 justify-center flex-wrap max-[600px]:flex-col max-[600px]:items-center">
              <MagneticButton to="/merchant/signup" className={ctaPrimary}>
                {t('Start your shop', '开始建店')}
              </MagneticButton>
              <Link to={`/s/${SAMPLE_SHOP_SLUG}`} className={ctaGhost}>
                {t('See a sample shop', '看看示例店铺')}
              </Link>
            </div>
          </HeroItem>
          <HeroItem>
            <p className="mt-6 mb-12 text-[13px] text-rose-muted">
              {t('Made for home-run and small businesses.', '专为家庭与小型生意打造。')}
            </p>
          </HeroItem>
          <HeroItem>
            <StorefrontPreview t={t} />
          </HeroItem>
        </HeroStagger>
      </section>

      {/* ── How it works ── */}
      <section className="bg-surface-raised border-y border-clay-border px-8 py-16 max-[600px]:px-5 max-[600px]:py-10">
        <Reveal>
        <h2 className={sectionTitle}>
          {t('Three steps to start your shop and take your first order', '三步开店，收到第一笔订单')}
        </h2>
        <ol className="list-none max-w-[620px] mx-auto flex flex-col gap-6 p-0 m-0">
          <li className="flex items-baseline gap-5 text-[15px] leading-[1.6] text-ink">
            <span className="font-heading text-[28px] font-medium text-clay-border leading-none shrink-0 w-9">01</span>
            <div>
              <strong className="text-oxblood font-semibold">{t('Create your shop', '创建你的店铺')}</strong>
              <span>{t(' — pick a name, describe what you make.', '——取个名字，介绍你的产品。')}</span>
            </div>
          </li>
          <li className="flex items-baseline gap-5 text-[15px] leading-[1.6] text-ink">
            <span className="font-heading text-[28px] font-medium text-clay-border leading-none shrink-0 w-9">02</span>
            <div>
              <strong className="text-oxblood font-semibold">{t('Add your products', '添加产品')}</strong>
              <span>{t(' — set names, prices and delivery windows.', '——设置名称、价格与交货时间。')}</span>
            </div>
          </li>
          <li className="flex items-baseline gap-5 text-[15px] leading-[1.6] text-ink">
            <span className="font-heading text-[28px] font-medium text-clay-border leading-none shrink-0 w-9">03</span>
            <div>
              <strong className="text-oxblood font-semibold">{t('Share your link', '分享专属链接')}</strong>
              <span>{t(' — send /s/yourshop to customers; orders come straight to you.', '——将 /s/yourshop 发给顾客，订单直达你。')}</span>
            </div>
          </li>
        </ol>
        </Reveal>
      </section>

      {/* ── Value props ── */}
      <section className="px-8 py-16 max-w-[860px] mx-auto w-full max-[600px]:px-5 max-[600px]:py-10">
        <Reveal>
        <h2 className={sectionTitle}>
          {t('Built for small businesses that sell direct', '专为直接面向顾客的小生意打造')}
        </h2>
        <p className="-mt-6 mb-10 text-[15px] leading-[1.75] text-ink-soft text-center max-w-[620px] mx-auto">
          {t(
            'TinyOrder is for people who make and sell their own things: home bakers taking weekend pre-orders, makers running a weekly drop, small shops that have outgrown a spreadsheet and a chat group. You do not need a website, a designer or a developer — if you can share a link, you can take orders online.',
            'TinyOrder 是为自己做、自己卖的人打造的：接周末预订的家庭烘焙师、每周上新的手作卖家，以及已经用不下去表格和聊天群的小店。你不需要网站、设计师或工程师——只要会分享链接，就能在线接单。',
          )}
        </p>
        <dl className="grid [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] gap-x-12 gap-y-10 max-[600px]:[grid-template-columns:1fr] max-[600px]:gap-8">
          <div>
            <dt className="font-heading text-[19px] font-semibold text-oxblood leading-[1.3] mb-2.5">{t('Keep what you earn', '赚的钱，都是你的')}</dt>
            <dd className="text-sm leading-[1.65] text-ink-soft m-0">{t('Your own link, your own customers — no marketplace cut, nobody undercutting you next to your listing.', '专属链接，专属顾客——没有平台抽成，也没有人在你旁边抢单。')}</dd>
          </div>
          <div>
            <dt className="font-heading text-[19px] font-semibold text-oxblood leading-[1.3] mb-2.5">{t('Nothing slips through', '一单都不会漏')}</dt>
            <dd className="text-sm leading-[1.65] text-ink-soft m-0">{t('Every order in one list. Mark it done or send a tracking number in one tap — no scrolling back through chats.', '所有订单集中一处。一键标记完成或发送物流号，不必再翻聊天记录。')}</dd>
          </div>
          <div>
            <dt className="font-heading text-[19px] font-semibold text-oxblood leading-[1.3] mb-2.5">{t('Your customers read it in their own language', '顾客用自己的语言下单')}</dt>
            <dd className="text-sm leading-[1.65] text-ink-soft m-0">{t('Your shop shows up in English or Chinese, whichever your customer prefers. You only write it once.', '店铺自动以中文或英文呈现，顾客看得懂，你只需写一次。')}</dd>
          </div>
        </dl>
        </Reveal>
      </section>

      {/* ── What you get ── */}
      {/* Copy lives in features.ts as data, for the same reasons the FAQ does — and under the same
          rule: every line has to be true of the product as shipped. */}
      <section className="border-t border-clay-border px-8 py-16 max-w-[900px] mx-auto w-full max-[600px]:px-5 max-[600px]:py-10">
        <Reveal>
          <h2 className={sectionTitle}>
            {t('Everything you need to take orders online', '在线接单所需的一切')}
          </h2>
          <div className="grid [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))] gap-x-12 gap-y-9 max-[600px]:[grid-template-columns:1fr] max-[600px]:gap-7">
            {FEATURES.map(f => (
              <div key={f.id}>
                <h3 className="font-heading text-[17px] font-semibold text-oxblood leading-[1.35] mb-2">
                  {t(f.title.en, f.title.zh)}
                </h3>
                <p className="text-sm leading-[1.7] text-ink-soft m-0">
                  {t(f.body.en, f.body.zh)}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── Ways to sell ── */}
      {/* Copy lives in useCases.ts as data, same as the FAQ and the feature list, and under the same
          rule: every line has to be true of the product as shipped. This section answers the question
          "does it fit the way *I* sell", which the feature list above deliberately does not — and it
          is the page's main body of real, indexable prose, so it renders open rather than behind a
          disclosure. */}
      <section className="border-t border-clay-border px-8 py-16 max-w-[900px] mx-auto w-full max-[600px]:px-5 max-[600px]:py-10">
        <Reveal>
          <h2 className={sectionTitle}>
            {t(
              'Pre-orders, weekly drops, pickup or delivery — set it up your way',
              '预订、每周上新、自取或配送——按你的方式设定',
            )}
          </h2>
          <p className="-mt-6 mb-10 text-[15px] leading-[1.75] text-ink-soft text-center max-w-[620px] mx-auto">
            {t(
              'No two small businesses take orders the same way, so nothing here is fixed for you. Here is how the usual ones are set up — pick the parts that match how you already work.',
              '没有两家小生意的接单方式是一样的，所以这里没有一条是替你决定好的。以下是几种常见的设定方式——挑出与你现有做法相符的部分即可。',
            )}
          </p>
          <div className="grid [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))] gap-x-12 gap-y-9 max-[600px]:[grid-template-columns:1fr] max-[600px]:gap-7">
            {USE_CASES.map(u => (
              <div key={u.id}>
                <h3 className="font-heading text-[17px] font-semibold text-oxblood leading-[1.35] mb-2">
                  {t(u.title.en, u.title.zh)}
                </h3>
                <p className="text-sm leading-[1.7] text-ink-soft m-0">
                  {t(u.body.en, u.body.zh)}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── What it replaces ── */}
      {/* Prose, not data: this is one argument in three moves, and splitting it into title/body cards
          would break the sequence that makes it read. Every claim about TinyOrder here is stated
          elsewhere on the page too; nothing about a named competitor is stated at all. */}
      <section className="border-t border-clay-border px-8 py-16 max-w-[720px] mx-auto w-full max-[600px]:px-5 max-[600px]:py-10">
        <Reveal>
          <h2 className={sectionTitle}>
            {t(
              'What it replaces: the chat group, the spreadsheet, the marketplace',
              '它取代了什么：聊天群、表格、外卖平台',
            )}
          </h2>
          <div className="flex flex-col gap-5 text-[15px] leading-[1.75] text-ink-soft">
            <p className="m-0">
              {t(
                'Most small shops start in a chat group, because it costs nothing and it works — until it does not. Orders arrive in the middle of conversations, half of them missing a quantity or a date. You add the total up by hand, twice, because the first one was wrong. Someone asks where their order is and you scroll back through three days to find out. Nothing is lost dramatically; it leaks, one order at a time.',
                '大多数小生意都是从聊天群开始的，因为不花钱、而且有用——直到有一天不再管用。订单夹在对话中间陆续进来，有一半没写数量或日期。总价你要手算，还得算两次，因为第一次算错了。有人问「我的单到哪了」，你就得往回翻三天的记录。订单不会一次全丢，而是一笔一笔慢慢漏掉。',
              )}
            </p>
            <p className="m-0">
              {t(
                'A form and a spreadsheet fix the collecting and stop there. A form does not know your delivery rates, so shipping is still worked out by hand. It does not number an order, so you and your customer have nothing to call it. It does not tell anyone the order is ready. TinyOrder gives every order its own number, prices the delivery from the address the customer picked, and lets them look the order up themselves — which is most of the messages you answer today.',
                '表单加试算表只解决了「收集」这一段，然后就没有了。表单不知道你的运费规则，所以运费还是要自己算。它不会给订单编号，你和顾客之间就没有一个共同的称呼。它也不会通知谁订单已经好了。TinyOrder 会为每笔订单生成专属编号，依顾客选定的地址计算运费，顾客还能自己查询进度——那正是你今天要回覆的大部分讯息。',
              )}
            </p>
            <p className="m-0">
              {t(
                'A marketplace brings you traffic and charges for it, on every order, forever — and it lists a competitor beside you while doing it. The customer belongs to the platform, not to you. TinyOrder is the other trade: you bring your own customers, from the places you already post, and you keep the whole of what they spend. We charge one flat subscription and take no commission, so the month your shop does well is the month you keep the difference.',
                '外卖平台替你带来流量，代价是每一笔订单都要抽成，永远如此——而且在你旁边同时列出竞争对手。顾客属于平台，不属于你。TinyOrder 是另一种交换：顾客由你自己从既有的社群管道带来，他们花的每一分钱都是你的。我们只收固定订阅费，不抽任何佣金——生意好的那个月，多出来的部分全归你。',
              )}
            </p>
          </div>
        </Reveal>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="px-8 py-16 max-w-[1000px] mx-auto w-full text-center border-t border-clay-border">
        <Reveal>
        <h2 className={sectionTitle}>
          {t('Simple, honest pricing — start free', '简单透明的价格——免费开始')}
        </h2>
        <p className="-mt-7 mb-8 text-[15px] leading-[1.6] text-ink-soft">
          {t('Start free on Basic — 7 days, no card required. Move to Pro whenever your shop is ready.', '基础版 7 天免费试用，无需信用卡。店铺准备好了随时升级 Pro。')}
        </p>
        </Reveal>

        {/* Billing toggle */}
        <div
          className="inline-flex gap-1 p-1 border-[1.5px] border-clay-border rounded-pill bg-surface-raised"
          role="group"
          aria-label={t('Billing period', '付费周期')}
        >
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-2 py-2 px-[18px] border-0 rounded-pill font-sans text-sm font-medium cursor-pointer [transition:background_0.15s,color_0.15s]',
              billing === 'monthly' ? 'bg-oxblood text-cream' : 'bg-transparent text-ink-soft'
            )}
            aria-pressed={billing === 'monthly'}
            onClick={() => setBilling('monthly')}
          >
            {t('Monthly', '按月')}
          </button>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-2 py-2 px-[18px] border-0 rounded-pill font-sans text-sm font-medium cursor-pointer [transition:background_0.15s,color_0.15s]',
              billing === 'yearly' ? 'bg-oxblood text-cream' : 'bg-transparent text-ink-soft'
            )}
            aria-pressed={billing === 'yearly'}
            onClick={() => setBilling('yearly')}
          >
            {t('Yearly', '按年')}
            <span
              className={cn(
                'text-[11px] font-medium py-[2px] px-2 rounded-pill',
                billing === 'yearly'
                  ? 'bg-[rgba(255,255,255,0.2)] text-cream'
                  : 'bg-oxblood-tint text-oxblood'
              )}
            >
              {t('Save ~17%', '省约17%')}
            </span>
          </button>
        </div>

        {/* Pricing cards */}
        <Reveal>
        {/* Cards stretch to a shared height; cardCta* pins each CTA to the bottom edge */}
        <div className="grid [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))] gap-6 mt-10 text-left">
          {tiers.map(tier => {
            const tierPrices = pricing.prices[tier.id as 'basic' | 'pro']
            const amount = billing === 'yearly' ? tierPrices.yearly / 12 : tierPrices.monthly
            return (
              <div
                key={tier.id}
                className={cn(
                  'flex flex-col p-7 rounded-lg bg-surface-raised',
                  tier.highlight
                    ? 'border-[1.5px] border-oxblood shadow-[0_6px_24px_rgba(122,16,40,0.12)]'
                    : 'border border-clay-border'
                )}
              >
                {tier.badge && (
                  <span className="self-start text-[11px] font-semibold py-[3px] px-[10px] mb-3 rounded-pill bg-oxblood text-cream">
                    {tier.badge}
                  </span>
                )}
                <h3 className="font-heading text-xl font-medium text-ink m-0">{tier.name}</h3>
                <div className="flex items-baseline gap-[0.35rem] mt-3">
                  <span className="font-heading text-[34px] font-semibold text-oxblood leading-none">{formatMoney(amount, pricing.currency)}</span>
                  <span className="text-sm text-rose-muted">{t('/mo', '/月')}</span>
                </div>
                {pricing.estimate && amount > 0 && (
                  <p className="text-xs text-rose-muted mt-1 mb-0">
                    ≈ {formatMoney(amount * pricing.estimate.rate, pricing.estimate.currency)}{t('/mo', '/月')}
                  </p>
                )}
                <p className="min-h-[1.1em] text-xs text-rose-muted mt-[0.35rem] mb-0">
                  {billing === 'yearly' && amount > 0
                    ? t('billed yearly', '按年付费')
                    : ' '}
                </p>
                <p className="text-sm leading-[1.6] text-ink-soft mt-3 mb-5">{tier.blurb}</p>
                {/* Inherited-tier label — a heading for the list, not a feature, so no ✓ */}
                {tier.inherits && (
                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-rose-muted mt-0 mb-3">
                    {tier.inherits}
                  </p>
                )}
                <ul className="list-none m-0 mb-7 p-0 flex flex-col gap-[0.6rem]">
                  {tier.features.map((f, i) => (
                    <li
                      key={i}
                      className="relative pl-6 text-sm leading-[1.5] text-ink before:content-['✓'] before:absolute before:left-0 before:text-oxblood before:font-semibold"
                    >
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  to={`${tier.to}?plan=${tier.id}&billing=${billing}`}
                  className={tier.highlight ? cardCtaPrimary : cardCtaGhost}
                >
                  {tier.cta}
                </Link>
                {/* Risk reversal sits at the click, not at the foot of the section — and it is
                    per-tier, because only Basic has a trial to reverse the risk with */}
                <p className="mt-2.5 mb-0 text-center text-xs text-rose-muted">
                  {tier.note}
                </p>
              </div>
            )
          })}
        </div>
        <p className="mt-8 text-[13px] text-rose-muted">
          {t('Cancel anytime — no contracts, no lock-in.', '随时取消——无合约，不绑定。')}
        </p>
        </Reveal>
      </section>

      {/* ── FAQ ── */}
      {/* After pricing and before the closing CTA: a reader who has just seen a price is
          exactly the reader with objections. Answers live in faq.ts as data — every one of
          them has to be true of the product as shipped, since these are pre-purchase promises. */}
      <section id="faq" className="border-t border-clay-border px-8 py-16 max-[600px]:px-5 max-[600px]:py-10">
        <Reveal>
          <h2 className="font-heading text-[26px] text-oxblood text-center mb-2 max-[600px]:text-[22px]">
            {t('Questions from shop owners, answered', '店主常见问题')}
          </h2>
          <p className="text-sm text-rose-muted text-center mb-9 max-w-[460px] mx-auto">
            {t(
              'The things shop owners ask us before they sign up.',
              '店主在注册前最常问我们的问题。',
            )}
          </p>
          {/* First panel open by default. A collapsed accordion renders NO panel content at all —
              not hidden text, no text — so every answer here was invisible to a crawler and to the
              reader deciding whether to read on. Opening the first one puts a real answer on the
              page and shows the rest are openable. The others stay closed: the FAQPage markup in
              structuredData.ts carries all nine to search engines regardless. */}
          <Accordion className="max-w-[640px] mx-auto" defaultValue={[FAQ[0].id]}>
            {FAQ.map(entry => (
              <AccordionItem key={entry.id} value={entry.id} className="border-clay-border">
                <AccordionTrigger className="font-heading text-[15px] text-ink text-left py-4">
                  {t(entry.q.en, entry.q.zh)}
                </AccordionTrigger>
                <AccordionContent className="text-[14px] leading-[1.7] text-rose-muted pb-4">
                  {t(entry.a.en, entry.a.zh)}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </section>

      {/* ── Footer CTA ── */}
      <section className="border-t border-clay-border px-8 py-16 text-center bg-oxblood-tint max-[600px]:px-5 max-[600px]:py-10">
        <Reveal>
        {/* The section's thesis line, so it is the section's heading — a closing CTA with no
            heading is a hole in the outline, not a style choice. Styling is unchanged. */}
        <h2 className="text-sm leading-[1.6] font-sans font-normal text-rose-muted mb-3">
          {t('Every order lost in a chat thread is a sale you\'ll never see.', '每一笔淹没在聊天里的订单，都是流失的生意。')}
        </h2>
        <p className="font-heading italic text-[18px] text-ink mb-6 max-w-[520px] mx-auto">
          {t('Become a real, professional business — orders in one place, more time to make.', '成为真正专业的生意——订单集中一处，专注做好产品。')}
        </p>
        <MagneticButton to="/merchant/signup" className={ctaPrimary}>
          {t('Start your shop', '开始建店')}
        </MagneticButton>
        </Reveal>
      </section>

      {/* ── Footer ── */}
      <footer className="mt-auto px-8 py-6 border-t border-clay-border flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[13px] text-text-tertiary">
        <Wordmark className="h-[18px]" />
        <span className="text-clay-border">·</span>
        <span>{t('Built for small businesses', '专为小生意打造')}</span>
        {/* aria-hidden, and not clay-border: that colour fails AA on cream (DESIGN.md), so it is
            a stroke colour rather than a text one. */}
        <span aria-hidden="true">·</span>
        <Link to="/terms" className="hover:text-oxblood underline underline-offset-4">
          {t('Terms', '服务条款')}
        </Link>
        {/* Straight to the anchor: a refund policy has to be findable without reading the whole
            document — Stripe expects that of a business taking subscription payments. */}
        <Link to={`/terms#${REFUNDS_ANCHOR}`} className="hover:text-oxblood underline underline-offset-4">
          {t('Refunds', '退款政策')}
        </Link>
        <Link to="/privacy" className="hover:text-oxblood underline underline-offset-4">
          {t('Privacy', '隐私政策')}
        </Link>
        {/* Maker's credit, not a policy link — separated by a dot so it doesn't read as one more
            legal page, and carrying ?ref=tinyorder so Praxor can attribute the visit. */}
        <span aria-hidden="true">·</span>
        <a
          href="https://www.praxor.dev?ref=tinyorder"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-oxblood underline underline-offset-4"
        >
          {t('Built by Praxor', '由 Praxor 打造')}
        </a>
      </footer>
    </div>
  )
}
