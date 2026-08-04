// The nav bar and footer every marketing page shares.
//
// Extracted from Landing.tsx when /pricing became a page of its own (#169). Two reasons, and the
// second is the one that matters for search:
//
//  1. The account menu is real logic — role-resolved portal target, click-catcher overlay, sign
//     out — and a second hand-copied version of it on each new marketing page is a second thing to
//     get wrong.
//  2. These are the site's INTERNAL LINKS. Google builds sitelinks out of pages it can reach from
//     the homepage with descriptive anchor text, so the nav and footer here are the mechanism, not
//     decoration. They must be plain `<a href>` in the markup — react-router's Link renders one —
//     and they must be in the PRERENDERED html, because a crawler that runs no JavaScript is the
//     entire reason that build step exists.

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../SessionContext'
import { signOut } from '../store'
import LanguageSelect from '../components/LanguageSelect'
import Wordmark from '../components/Wordmark'
import { Button } from '../components/ui/button'
import { REFUNDS_ANCHOR } from '../legal/anchors'
import { cn } from '../lib/utils'

// Shared nav-link style (Pricing + Merchant log in)
const navLink =
  'text-[13px] text-rose-muted no-underline font-medium [transition:color_0.15s] hover:text-oxblood'

// Account dropdown menu-item (Link or button)
const menuItem =
  'block w-full box-border text-left py-[9px] px-3 border-0 rounded-sm bg-transparent text-rose-muted text-[13px] font-sans font-medium no-underline cursor-pointer [transition:all_0.15s] hover:bg-oxblood-tint hover:text-oxblood'

const footerLink = 'hover:text-oxblood underline underline-offset-4'

const footerColumnHeading = 'text-[11px] font-medium uppercase tracking-[0.09em] text-ink-soft mb-3'
const footerColumnLink = 'block py-1 text-text-tertiary no-underline [transition:color_0.15s] hover:text-oxblood'

function FooterColumn({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="min-w-[120px]">
      <div className={footerColumnHeading}>{heading}</div>
      {children}
    </div>
  )
}

export function MarketingNav() {
  const { t, account, role, loading, merchantUnknown } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)

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

  return (
    <nav className="flex items-center justify-between px-8 py-5 border-b border-clay-border max-[600px]:px-5 max-[600px]:py-4">
      {/* The wordmark links home from every page except the home page, where it is the page you
          are on. Landing keeps it as a plain mark; here it is the way back. */}
      <Link to="/" aria-label={t('TinyOrder home', 'TinyOrder 首页')}>
        <Wordmark className="h-7 max-[600px]:h-6" />
      </Link>
      <div className="flex items-center gap-5">
        {/* Routes, not the landing page's own anchors: an anchor is one page to a crawler, and the
            whole point of splitting these off is being pages of their own (#169). Features and FAQ
            hide below 600px so the bar does not compete with the account menu on a phone; both
            still reach every visitor through the footer, which never hides a link. */}
        <Link to="/features" className={cn(navLink, 'max-[600px]:hidden')}>
          {t('Features', '功能')}
        </Link>
        <Link to="/pricing" className={navLink}>
          {t('Pricing', '价格')}
        </Link>
        <Link to="/faq" className={cn(navLink, 'max-[600px]:hidden')}>
          {t('FAQ', '常见问题')}
        </Link>
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
  )
}

export function MarketingFooter() {
  const { t } = useSession()

  return (
    <footer className="mt-auto border-t border-clay-border">
      {/* Grouped columns, not a single wrapped row: same links as before, same crawler-visible
          structure (still Link/`<a>` in the prerendered markup), just organised so a visitor
          scanning the footer can find "the legal stuff" or "the product stuff" at a glance. */}
      <div className="max-w-[900px] mx-auto px-8 py-10 flex flex-wrap gap-x-16 gap-y-8 text-[13px] max-[600px]:px-5 max-[600px]:py-8 max-[600px]:gap-x-10">
        <FooterColumn heading={t('Product', '产品')}>
          <Link to="/features" className={footerColumnLink}>
            {t('Features', '功能')}
          </Link>
          <Link to="/pricing" className={footerColumnLink}>
            {t('Pricing', '价格')}
          </Link>
          <Link to="/faq" className={footerColumnLink}>
            {t('FAQ', '常见问题')}
          </Link>
        </FooterColumn>
        <FooterColumn heading={t('Legal', '法律')}>
          <Link to="/terms" className={footerColumnLink}>
            {t('Terms', '服务条款')}
          </Link>
          {/* Straight to the anchor: a refund policy has to be findable without reading the
              whole document — Stripe expects that of a business taking subscription payments. */}
          <Link to={`/terms#${REFUNDS_ANCHOR}`} className={footerColumnLink}>
            {t('Refunds', '退款政策')}
          </Link>
          <Link to="/privacy" className={footerColumnLink}>
            {t('Privacy', '隐私政策')}
          </Link>
        </FooterColumn>
        <FooterColumn heading={t('Connect', '关注我们')}>
          <a
            href="https://www.facebook.com/profile.php?id=61592788340403"
            target="_blank"
            rel="noopener noreferrer"
            className={footerColumnLink}
          >
            {t('Facebook', '脸书')}
          </a>
        </FooterColumn>
      </div>
      <div className="px-8 py-5 border-t border-clay-border flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[13px] text-text-tertiary max-[600px]:px-5">
        <Wordmark className="h-[18px]" />
        <span className="text-clay-border">·</span>
        <span>{t('Built for small businesses', '专为小生意打造')}</span>
        {/* Maker's credit, not a policy link — separated by a dot so it doesn't read as one more
            legal page, and carrying ?ref=tinyorder so Praxor can attribute the visit. */}
        <span aria-hidden="true">·</span>
        <a
          href="https://www.praxor.dev?ref=tinyorder"
          target="_blank"
          rel="noopener noreferrer"
          className={footerLink}
        >
          {t('Built by Praxor', '由 Praxor 打造')}
        </a>
      </div>
    </footer>
  )
}
