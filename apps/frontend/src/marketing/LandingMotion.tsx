/* eslint-disable react-refresh/only-export-components */
/* Landing-page motion + craft pieces. Isolated + memoised so the perpetual
   storefront ping never re-renders the page. All effects honour
   prefers-reduced-motion via `useReducedMotion`. */
import { memo, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence, useMotionValue, useSpring, useReducedMotion } from 'motion/react'
import { ReceiptText } from 'lucide-react'
import type { VerticalWord } from './verticals'

// Editorial ease — slightly springier than the app's UI ease, still calm.
const EASE = [0.16, 1, 0.3, 1] as const

// ── Scroll reveal: fade + small rise once in view ───────────────────────────
export function Reveal({
  children,
  className,
  delay = 0,
  y = 18,
}: {
  children: ReactNode
  className?: string
  delay?: number
  y?: number
}) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduced ? 0 : y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  )
}

// ── Hero stagger: container reveals children in a gentle waterfall ───────────
export const heroContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
}

export function useHeroItem() {
  const reduced = useReducedMotion()
  return {
    hidden: { opacity: 0, y: reduced ? 0 : 14 },
    show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
  }
}

export function HeroStagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={heroContainer} initial="hidden" animate="show">
      {children}
    </motion.div>
  )
}

export function HeroItem({ children, className }: { children: ReactNode; className?: string }) {
  const item = useHeroItem()
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  )
}

// ── Magnetic CTA: pulls toward the cursor via motion values (never useState) ─
const MotionLink = motion.create(Link)

export function MagneticButton({
  to,
  className,
  children,
  strength = 0.3,
}: {
  to: string
  className?: string
  children: ReactNode
  strength?: number
}) {
  const reduced = useReducedMotion()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 150, damping: 15, mass: 0.1 })
  const sy = useSpring(y, { stiffness: 150, damping: 15, mass: 0.1 })

  if (reduced) return <Link to={to} className={className}>{children}</Link>

  return (
    <MotionLink
      to={to}
      className={className}
      style={{ x: sx, y: sy }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        x.set((e.clientX - (r.left + r.width / 2)) * strength)
        y.set((e.clientY - (r.top + r.height / 2)) * strength)
      }}
      onMouseLeave={() => {
        x.set(0)
        y.set(0)
      }}
    >
      {children}
    </MotionLink>
  )
}

// ── Storefront preview: the craft anchor. A mock shop card with a live order
//    ping that surfaces every few seconds. Memoised + self-contained. ────────
type TFn = (en: string, zh: string) => string

export const StorefrontPreview = memo(function StorefrontPreview({ t }: { t: TFn }) {
  const reduced = useReducedMotion()
  const [ping, setPing] = useState(false)

  useEffect(() => {
    if (reduced) return
    let hide: ReturnType<typeof setTimeout>
    const show = () => {
      setPing(true)
      hide = setTimeout(() => setPing(false), 2600)
    }
    const first = setTimeout(show, 1400)
    const loop = setInterval(show, 4600)
    return () => {
      clearTimeout(first)
      clearTimeout(hide)
      clearInterval(loop)
    }
  }, [reduced])

  const products = [
    { name: t('Pandan Kaya Cake', '班兰咖椰蛋糕'), price: '$ 38' },
    { name: t('Kuih Lapis · box of 10', '娘惹千层糕 · 10 件装'), price: '$ 18' },
  ]

  return (
    <div className="relative mx-auto w-full max-w-[360px]">
      {/* Ping toast */}
      <AnimatePresence>
        {ping && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 420, damping: 18 } }}
            exit={{ opacity: 0, y: -6, scale: 0.96, transition: { duration: 0.18 } }}
            className="absolute -top-3 -right-2 z-10 flex items-center gap-2 rounded-pill border border-clay-border bg-surface-high py-1.5 px-3 shadow-[0_8px_24px_rgba(24,24,27,0.14)]"
          >
            <ReceiptText size={14} strokeWidth={1.5} className="text-oxblood" aria-hidden />
            <span className="text-[12px] font-medium text-ink">{t('New order · BT-0242', '新订单 · BT-0242')}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card */}
      <div className="rounded-2xl border-[0.5px] border-clay-border bg-surface-raised p-5 text-left shadow-[0_16px_40px_-18px_rgba(24,24,27,0.22)]">
        {/* Shop header */}
        <div className="flex items-center gap-3 pb-4 border-b border-divider">
          <span className="grid h-10 w-10 place-items-center rounded-round bg-oxblood-tint font-heading text-[15px] font-medium text-oxblood">
            NK
          </span>
          <div className="min-w-0">
            <p className="font-heading text-[15px] font-medium text-ink leading-tight">
              {t('Nyonya Kueh by Mei', '美的娘惹糕')}
            </p>
            <p className="text-[12px] text-rose-muted leading-tight">/s/nyonya-kueh</p>
          </div>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-success-strong">
            <span className="h-1.5 w-1.5 rounded-round bg-success-strong" aria-hidden />
            {t('Open', '营业中')}
          </span>
        </div>

        {/* Products */}
        <ul className="list-none m-0 p-0 flex flex-col divide-y divide-divider">
          {products.map((p) => (
            <li key={p.name} className="flex items-center justify-between gap-3 py-3">
              <span className="text-[13.5px] text-ink">{p.name}</span>
              <span className="font-heading text-[13.5px] font-medium text-oxblood shrink-0">{p.price}</span>
            </li>
          ))}
        </ul>

        {/* Order bar (static mock) */}
        <div className="mt-4 flex items-center justify-center rounded-md bg-oxblood py-2.5 text-[13px] font-medium text-cream">
          {t('Place order', '下单')}
        </div>
      </div>
    </div>
  )
})

// ── Rotating vertical word: the hero's "we are not food-only" signal ─────────
// Only the ACTIVE word is ever in the DOM, and that is a hard constraint, not a preference.
// scripts/prerender.tsx freezes this markup into dist/index.html for crawlers that do not run JS,
// so keeping all five words mounted — the obvious way to let the browser size the slot — would
// hand them `Sell your food bakes art clothes crafts`.
//
// That leaves the slot to be sized from the outside, and the two ways to do it are not equal:
//   · one fixed width for the widest word never moves, but leaves a permanent hole after the short
//     ones ("food" is 2.06em against "clothes" at 3.34em — ~78px of dead space at the desktop
//     size), which reads as broken spacing rather than as design;
//   · animating the width to each word keeps the line tight and slides the text that follows,
//     at the cost of a width that changes — which is why the hero splits the headline so this word
//     ends its own line and the static half can never be rewrapped by it.
// The second is what this does. Widths come from `VerticalWord.em`.
const WORD_SLACK_EM = 0.06
const WORD_INTERVAL_MS = 2600

// The rule that marks this word as the changing part of the sentence. It belongs to the SLOT, not
// to the word: the slot outlives the swap, so the rule stays put while the word above it leaves and
// the next arrives, and it widens with the slot — a blank the words drop into, rather than an
// underline that blinks out for a quarter-second between them.
//
// Painted as an ::after rather than a border-bottom, which would add its own height to the line box
// and push the rest of the headline down by 3px. Everything is in em: the h1 runs from 2rem to
// 3.5rem, and a px rule reads heavy at the small end. The 0.145em offset puts the rule 0.14em under
// the baseline — where the browser's own underline sits, measured against the h1's font.
const WORD_RULE =
  'relative after:content-[\'\'] after:pointer-events-none after:absolute after:inset-x-0 ' +
  'after:bottom-[0.145em] after:h-[0.055em] after:bg-oxblood/60'

export const RotatingWord = memo(function RotatingWord({
  words,
}: {
  words: readonly VerticalWord[]
}) {
  const reduced = useReducedMotion()
  const [i, setI] = useState(0)

  useEffect(() => {
    if (reduced) return
    const loop = setInterval(() => setI((n) => (n + 1) % words.length), WORD_INTERVAL_MS)
    return () => clearInterval(loop)
  }, [reduced, words.length])

  // Reduced motion gets the first word and no timer at all — not a timer whose animation is
  // suppressed. It keeps the rule, sized to the one word it will ever show: the rule says which
  // word varies, and for this reader it is the only cue that anything does.
  if (reduced) {
    return <span className={`inline-block whitespace-pre ${WORD_RULE}`}>{words[0].text}</span>
  }

  const word = words[i % words.length]

  return (
    <motion.span
      // text-left, against the hero's inherited centring: while the width animates, a centred word
      // would drift sideways inside its own slot on top of the slot's own resize. Anchoring the
      // left edge means only the tail of the line moves, which is the movement being animated.
      className={`inline-block whitespace-pre align-baseline text-left ${WORD_RULE}`}
      initial={false}
      animate={{ width: `${word.em + WORD_SLACK_EM}em` }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      {/* mode="wait" keeps exactly one word mounted: it fades the old one out before the new one
          arrives, so the width animation lands while the slot is empty and nothing is seen to
          overflow it. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={word.text}
          className="inline-block whitespace-pre"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25, ease: EASE }}
        >
          {word.text}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  )
})
