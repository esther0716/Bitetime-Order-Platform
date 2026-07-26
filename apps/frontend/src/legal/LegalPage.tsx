// The shell both legal documents render in: nav, title, date, prose, footer. Content lives in
// documents.ts, so a wording change never touches this file and a layout change never touches
// the wording.
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../SessionContext'
import Wordmark from '../components/Wordmark'
import type { LegalDocument } from './documents'
import { LEGAL_ENTITY, hasUnfilledEntityDetails } from './entity'

export default function LegalPage({ doc }: { doc: LegalDocument }) {
  const { t } = useSession()

  // Where this page starts, which is NOT a detail the browser gets right on its own.
  //
  // With a fragment: land on that section. The footer links the refund policy directly, and
  // React Router renders only after the browser has already tried and failed to resolve the
  // fragment against a page that did not exist yet, so the scroll has to be redone here.
  //
  // WITHOUT one: go to the top. A single-page app does not reset the scroll on navigation, and
  // every link into these documents lives in a FOOTER — so the reader is by definition scrolled
  // to the bottom of wherever they came from, and arrives halfway down the terms with no idea
  // they are in the middle of a document.
  //
  // `instant` throughout, NOT `auto`. `auto` does not mean "immediately", it means "defer to the
  // CSS", and `index.css` sets `html { scroll-behavior: smooth }`. That made this silently
  // dependent on a smooth animation, which never completes in a backgrounded tab and would make
  // a reader following a link watch the whole document fly past instead of simply being there.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    const target = id ? document.getElementById(id) : null
    if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' })
    else window.scrollTo({ top: 0, behavior: 'instant' })
  }, [doc])

  return (
    <div className="mm-land flex flex-col min-h-screen bg-cream text-ink font-sans">
      <nav className="flex items-center justify-between px-8 py-5 border-b border-clay-border max-[600px]:px-5 max-[600px]:py-4">
        <Link to="/" aria-label={t('TinyOrder home', 'TinyOrder 首页')}>
          <Wordmark className="h-7 max-[600px]:h-6" />
        </Link>
        <Link to="/" className="text-[13px] text-rose-muted hover:text-oxblood underline underline-offset-4">
          {t('Back to home', '返回首页')}
        </Link>
      </nav>

      {/* Measure, not width: at the 16px body floor this holds running copy near the 65–75ch
          DESIGN.md asks for. A wider column would be a longer line, not a better page. */}
      <main className="flex-1 w-full max-w-[620px] mx-auto px-8 py-12 max-[600px]:px-5 max-[600px]:py-8">
        <h1 className="font-heading text-[26px] leading-tight text-oxblood mb-1.5 max-[600px]:text-[22px]">
          {doc.title}
        </h1>
        <p className="text-[13px] text-text-tertiary mb-10">
          {t('Last updated', '最后更新')} {doc.lastUpdated}
        </p>

        {/* Visible while the company details are still placeholders. This is deliberate: the
            page should look unfinished until it IS finished, rather than quietly reading
            "[COMPANY NAME]" to a customer who assumes we meant it. */}
        {hasUnfilledEntityDetails(LEGAL_ENTITY) && (
          <p
            role="note"
            className="mb-10 rounded-xl border-[1.5px] border-dashed border-clay-border bg-oxblood-tint px-4 py-3 text-sm leading-[1.6] text-rose-muted"
          >
            <strong className="text-oxblood">{t('Draft.', '草稿。')}</strong>{' '}
            {t(
              'This document is not yet complete: the company details in square brackets below have still to be filled in, and it has not been reviewed by a lawyer.',
              '本文件尚未完成：下方方括号中的公司资料仍待填写，并且尚未经过律师审阅。',
            )}
          </p>
        )}

        {doc.sections.map(section => (
          <section key={section.id} id={section.id} className="mb-8 scroll-mt-24">
            <h2 className="font-heading text-[18px] text-ink mb-2.5">{section.heading}</h2>
            {section.body.map((para, i) => (
              // Keyed by index: paragraphs are a fixed ordered list with no identity of their
              // own, and nothing reorders them.
              <p key={i} className="text-sm leading-[1.7] text-rose-muted mb-2.5 last:mb-0">
                {para}
              </p>
            ))}
          </section>
        ))}
      </main>

      <footer className="mt-auto px-8 py-6 border-t border-clay-border flex items-center justify-center gap-3 text-[13px] text-text-tertiary">
        <Wordmark className="h-[18px]" />
        {/* Decorative separator: aria-hidden so a screen reader is not read a bullet between two
            links, and NOT set in clay-border — DESIGN.md keeps that colour for strokes because it
            fails AA on cream at 1.98:1. */}
        <span aria-hidden="true">·</span>
        <Link to="/terms" className="hover:text-oxblood underline underline-offset-4">
          {t('Terms', '服务条款')}
        </Link>
        <Link to="/privacy" className="hover:text-oxblood underline underline-offset-4">
          {t('Privacy', '隐私政策')}
        </Link>
      </footer>
    </div>
  )
}
