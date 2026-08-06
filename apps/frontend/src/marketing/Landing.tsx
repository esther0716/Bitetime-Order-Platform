import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../SessionContext'
import { usePlatformPricing } from '../usePlatformPricing'
import { formatMoney } from '../currency'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../components/ui/accordion'
import { FAQ } from './faq'
import { FEATURES } from './features'
import { VERTICALS } from './verticals'
import { PRICING_TIERS } from './pricingTiers'
import { MarketingNav, MarketingFooter } from './MarketingChrome'
import { useTopOnRouteChange } from './useTopOnRouteChange'
import { ctaPrimary, ctaGhost, sectionTitle } from './ctaStyles'
import {
  Reveal,
  HeroStagger,
  HeroItem,
  MagneticButton,
  RotatingWord,
  StorefrontPreview,
} from './LandingMotion'

export default function Landing() {
  const { t, lang } = useSession()
  const { pricing } = usePlatformPricing()
  useTopOnRouteChange()

  // The hero's rotating word, resolved to the showing language. Memoised so a new array identity
  // does not defeat RotatingWord's memo on every Landing re-render (menu open…).
  const verticalWords = useMemo(
    () => VERTICALS.map((v) => (lang === 'zh' ? v.zh : v.en)),
    [lang]
  )

  return (
    // Keep mm-land class — body:has(.mm-land) in index.css resets body padding/alignment
    <div className="mm-land relative isolate flex flex-col items-stretch min-h-screen font-sans text-foreground bg-background">

      <MarketingNav />

      {/* ── Hero ── */}
      <section className="max-w-[700px] mx-auto px-8 pt-20 pb-16 text-center max-[600px]:px-5 max-[600px]:pt-12 max-[600px]:pb-10">
        <HeroStagger>
          <HeroItem>
            <p className="font-heading italic text-[15px] text-muted-foreground mb-5">
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
              className="font-heading text-[clamp(2rem,5vw,3.5rem)] font-medium text-foreground leading-[1.18] tracking-[-0.01em] mb-5"
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
            <p className="text-base leading-[1.7] text-ink-700 max-w-[560px] mx-auto mb-9">
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
              {/* Points at a dedicated preview page (/sample-shops), never at a live storefront —
                  the old version of this button linked straight into `/s/bitetime-co` and
                  customers placed real orders on it (fcd0a57). See SampleShopsPage.tsx. */}
              <Link to="/sample-shops" className={ctaGhost}>
                {t('See sample shops', '看看示例店铺')}
              </Link>
            </div>
          </HeroItem>
          <HeroItem>
            <p className="mt-6 mb-12 text-[13px] text-muted-foreground">
              {t('Made for home-run and small businesses.', '专为家庭与小型生意打造。')}
            </p>
          </HeroItem>
          <HeroItem>
            <StorefrontPreview t={t} />
          </HeroItem>
        </HeroStagger>
      </section>

      {/* ── How it works ── */}
      <section className="bg-card border-y border-border px-8 py-16 max-[600px]:px-5 max-[600px]:py-10">
        <Reveal>
        <h2 className={sectionTitle}>
          {t('Three steps to start your shop and take your first order', '三步开店，收到第一笔订单')}
        </h2>
        <ol className="list-none max-w-[620px] mx-auto flex flex-col gap-6 p-0 m-0">
          <li className="flex items-baseline gap-5 text-[15px] leading-[1.6] text-foreground">
            <span className="font-heading text-[28px] font-medium text-border leading-none shrink-0 w-9">01</span>
            <div>
              <strong className="text-primary font-semibold">{t('Create your shop', '创建你的店铺')}</strong>
              <span>{t(' — pick a name, describe what you make.', '——取个名字，介绍你的产品。')}</span>
            </div>
          </li>
          <li className="flex items-baseline gap-5 text-[15px] leading-[1.6] text-foreground">
            <span className="font-heading text-[28px] font-medium text-border leading-none shrink-0 w-9">02</span>
            <div>
              <strong className="text-primary font-semibold">{t('Add your products', '添加产品')}</strong>
              <span>{t(' — set names, prices and delivery windows.', '——设置名称、价格与交货时间。')}</span>
            </div>
          </li>
          <li className="flex items-baseline gap-5 text-[15px] leading-[1.6] text-foreground">
            <span className="font-heading text-[28px] font-medium text-border leading-none shrink-0 w-9">03</span>
            <div>
              <strong className="text-primary font-semibold">{t('Share your link', '分享专属链接')}</strong>
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
        <p className="-mt-6 mb-10 text-[15px] leading-[1.75] text-ink-700 text-center max-w-[560px] mx-auto">
          {t(
            'TinyOrder is for people who make and sell their own things — no website, designer or developer needed. If you can share a link, you can take orders online.',
            'TinyOrder 是为自己做、自己卖的人打造的——不需要网站、设计师或工程师，只要会分享链接，就能在线接单。',
          )}
        </p>
        <dl className="grid [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] gap-x-12 gap-y-10 max-[600px]:[grid-template-columns:1fr] max-[600px]:gap-8">
          <div>
            <dt className="font-heading text-[19px] font-semibold text-primary leading-[1.3] mb-2.5">{t('Keep what you earn', '赚的钱，都是你的')}</dt>
            <dd className="text-sm leading-[1.65] text-ink-700 m-0">{t('Your own link, your own customers — no marketplace cut, no competitor beside your listing.', '专属链接，专属顾客——没有平台抽成，也没有人在你旁边抢单。')}</dd>
          </div>
          <div>
            <dt className="font-heading text-[19px] font-semibold text-primary leading-[1.3] mb-2.5">{t('Nothing slips through', '一单都不会漏')}</dt>
            <dd className="text-sm leading-[1.65] text-ink-700 m-0">{t('Every order in one list. Mark it done in one tap — no scrolling through chats.', '所有订单集中一处。一键标记完成，不必再翻聊天记录。')}</dd>
          </div>
          <div>
            <dt className="font-heading text-[19px] font-semibold text-primary leading-[1.3] mb-2.5">{t('Your customers read it in their own language', '顾客用自己的语言下单')}</dt>
            <dd className="text-sm leading-[1.65] text-ink-700 m-0">{t('Your shop shows in English or Chinese, whichever your customer prefers — write it once.', '店铺自动以中文或英文呈现，你只需写一次。')}</dd>
          </div>
        </dl>
        </Reveal>
      </section>

      {/* ── What you get ── */}
      {/* A SUMMARY, and the full list now lives on /features (#169) — same argument as the pricing
          section below: two pages both listing every feature would be two URLs answering
          "what does TinyOrder do", competing for the same authority. The first three entries of
          FEATURES.ts stay here as the hook; the rest is one click away. Each uses its short
          `teaser`, not the full `body` /features renders — the hook is meant to be read at a
          glance, not to duplicate the detail page. */}
      <section className="border-t border-border px-8 py-16 max-w-[900px] mx-auto w-full max-[600px]:px-5 max-[600px]:py-10">
        <Reveal>
          <h2 className={sectionTitle}>
            {t('Everything you need to take orders online', '在线接单所需的一切')}
          </h2>
          <div className="grid [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))] gap-x-12 gap-y-9 max-[600px]:[grid-template-columns:1fr] max-[600px]:gap-7">
            {FEATURES.slice(0, 3).map(f => (
              <div key={f.id}>
                <h3 className="font-heading text-[17px] font-semibold text-primary leading-[1.35] mb-2">
                  {t(f.title.en, f.title.zh)}
                </h3>
                <p className="text-sm leading-[1.7] text-ink-700 m-0">
                  {t(f.teaser!.en, f.teaser!.zh)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-9 mb-0 text-center text-[13px] text-muted-foreground">
            <Link to="/features" className="underline underline-offset-4 hover:text-primary">
              {t('See all features', '查看全部功能')}
            </Link>
          </p>
        </Reveal>
      </section>

      {/* ── Pricing summary ── */}
      {/* A SUMMARY, and the cards it used to hold now live on /pricing (#169). Both pages showing
          the same tier cards would be two URLs answering "what does TinyOrder cost" — they compete
          with each other and split whatever authority either has, which is the argument
          canonicalPath() already makes about the four signup CTAs.

          The PRICES stay here even so. They are the objection this section exists to answer, and a
          pricing section that makes you click to see a number is the pattern every visitor has
          learned means "expensive". What moved is the detail: the feature lists, the comparison
          table and the billing rules. The FAQ below still says "the prices are in the table just
          above", and this is what keeps that true. */}
      <section id="pricing" className="px-8 py-16 max-w-[720px] mx-auto w-full text-center border-t border-border">
        <Reveal>
        <h2 className={sectionTitle}>
          {t('Simple, honest pricing — start free', '简单透明的价格——免费开始')}
        </h2>
        <p className="-mt-7 mb-9 text-[15px] leading-[1.6] text-ink-700">
          {t('Start free on Basic — 7 days, no card required. Move to Pro whenever your shop is ready.', '基础版 7 天免费试用，无需信用卡。店铺准备好了随时升级 Pro。')}
        </p>
        <dl className="grid [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))] gap-6 text-left">
          {PRICING_TIERS.map(tier => (
            <div
              key={tier.id}
              className="flex flex-col p-6 rounded-lg bg-card border border-border"
            >
              <dt className="font-heading text-lg font-medium text-foreground">
                {t(tier.name.en, tier.name.zh)}
              </dt>
              <dd className="m-0 mt-2 flex items-baseline gap-[0.35rem]">
                <span className="font-heading text-[30px] font-semibold text-primary leading-none">
                  {formatMoney(pricing.prices[tier.id].monthly, pricing.currency)}
                </span>
                <span className="text-sm text-muted-foreground">{t('/mo', '/月')}</span>
              </dd>
              <dd className="m-0 mt-3 text-sm leading-[1.6] text-ink-700">
                {t(tier.blurb.en, tier.blurb.zh)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-9 mb-0 text-[13px] text-muted-foreground">
          <Link to="/pricing" className="underline underline-offset-4 hover:text-primary">
            {t('Compare Basic and Pro', '比较基础版与 Pro')}
          </Link>
        </p>
        <p className="mt-2 mb-0 text-[13px] text-muted-foreground">
          {t(
            'Two months free on yearly · cancel anytime — no contracts, no lock-in.',
            '年付免费两个月 · 随时取消——无合约，不绑定。',
          )}
        </p>
        </Reveal>
      </section>

      {/* ── FAQ ── */}
      {/* After pricing and before the closing CTA: a reader who has just seen a price is
          exactly the reader with objections. The full accordion, same as /faq (#169) — a teaser
          with no answers on it wasn't doing its job of handling objections right where they come
          up. The FAQPage structured data stays exclusive to /faq (structuredData.ts) so this
          section carries the same words without a second, competing copy of the schema. */}
      <section id="faq" className="border-t border-border px-8 py-16 max-[600px]:px-5 max-[600px]:py-10">
        <Reveal>
          <h2 className="font-heading text-[26px] text-primary text-center mb-2 max-[600px]:text-[22px]">
            {t('Questions from shop owners, answered', '店主常见问题')}
          </h2>
          <p className="text-sm text-muted-foreground text-center mb-9 max-w-[460px] mx-auto">
            {t(
              'The things shop owners ask us before they sign up.',
              '店主在注册前最常问我们的问题。',
            )}
          </p>
          {/* First panel open by default. A collapsed accordion renders NO panel content at all —
              not hidden text, no text — so every answer here was invisible to a crawler and to the
              reader deciding whether to read on. Opening the first one puts a real answer on the
              page and shows the rest are openable.

              `hiddenUntilFound` is what gets the other eight into the HTML: the closed panels are
              rendered with `hidden="until-found"` instead of not being rendered, so the words are
              in the file a crawler downloads — which is the point on a page that is prerendered
              for exactly that reason — and find-in-page opens the panel it matched instead of
              scrolling past nothing. */}
          <Accordion className="max-w-[640px] mx-auto" defaultValue={[FAQ[0].id]} hiddenUntilFound>
            {FAQ.map(entry => (
              <AccordionItem key={entry.id} value={entry.id} className="border-border">
                <AccordionTrigger className="font-heading text-[15px] text-foreground text-left py-4">
                  {t(entry.q.en, entry.q.zh)}
                </AccordionTrigger>
                <AccordionContent className="text-[14px] leading-[1.7] text-muted-foreground pb-4">
                  {t(entry.a.en, entry.a.zh)}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </section>

      {/* ── Footer CTA ── */}
      <section className="border-t border-border px-8 py-16 text-center bg-brand-100 max-[600px]:px-5 max-[600px]:py-10">
        <Reveal>
        {/* The section's thesis line, so it is the section's heading — a closing CTA with no
            heading is a hole in the outline, not a style choice. Styling is unchanged. */}
        <h2 className="text-sm leading-[1.6] font-sans font-normal text-muted-foreground mb-3">
          {t('Every order lost in a chat thread is a sale you\'ll never see.', '每一笔淹没在聊天里的订单，都是流失的生意。')}
        </h2>
        <p className="font-heading italic text-[18px] text-foreground mb-6 max-w-[520px] mx-auto">
          {t('Become a real, professional business — orders in one place, more time to make.', '成为真正专业的生意——订单集中一处，专注做好产品。')}
        </p>
        <MagneticButton to="/merchant/signup" className={ctaPrimary}>
          {t('Start your shop', '开始建店')}
        </MagneticButton>
        </Reveal>
      </section>

      <MarketingFooter />
    </div>
  )
}
