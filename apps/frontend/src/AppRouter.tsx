import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { PageTransition } from './motion'
import { SessionProvider, useSession } from './SessionContext'
import { TooltipProvider } from './components/ui/tooltip'
import { MerchantProvider, useMerchant } from './MerchantContext'
import RequireRole from './RequireRole'
import { useCanonical } from './canonical'
import { useDocumentMeta } from './documentMeta'
import { Spinner } from './components/Loaders'
import Wordmark from './components/Wordmark'
// STATICALLY IMPORTED, and it is the one route that must be. `/` is prerendered into the HTML
// (scripts/prerender.tsx) so the page is on screen before any script runs — and behind a lazy()
// boundary React threw that page away on boot and put the route spinner in its place until the
// chunk arrived. Measured in a Lighthouse trace: #root went from the full 1350×940 viewport to an
// 86×470 spinner at t+254ms and back at t+595ms, two layout shifts of 0.468 each, a cumulative
// 0.934 and the entire desktop performance gap. Splitting a chunk the entry HTML already contains
// buys nothing and costs the paint we prerendered it for.
import Landing from './marketing/Landing'
// STATICALLY IMPORTED for the same reason and by the same rule: /pricing is prerendered too
// (dist/pricing.html), so a lazy() boundary would throw its markup away on boot and hand the
// visitor a spinner where a finished page already was. It shares nearly all of Landing's imports,
// so the entry chunk grows by this file and not by a second copy of the marketing chrome.
import Pricing from './marketing/Pricing'
// Same rule again: /features and /faq are prerendered (dist/features.html, dist/faq.html), so
// they stay out of the lazy() boundary too. See scripts/prerender.tsx.
import FeaturesPage from './marketing/FeaturesPage'
import FaqPage from './marketing/FaqPage'

// Route-level code splitting: every OTHER surface ships its own chunk, so a storefront
// customer never downloads merchant/admin/signup code (signup pulls in the heavy
// pinyin-pro dictionary — kept out of the customer path).
const AdminHome = lazy(() => import('./admin/AdminHome'))
const SignupScreen = lazy(() => import('./merchant/SignupScreen'))
const LoginScreen = lazy(() => import('./merchant/LoginScreen'))
const MerchantHome = lazy(() => import('./merchant/MerchantHome'))
const Storefront = lazy(() => import('./store/Storefront'))
const OrderHistory = lazy(() => import('./store/OrderHistory'))
const ResetPasswordPage = lazy(() => import('./ResetPasswordPage'))
const SampleShopsPage = lazy(() => import('./marketing/SampleShopsPage'))
const TermsPage = lazy(() => import('./legal/TermsPage'))
const PrivacyPage = lazy(() => import('./legal/PrivacyPage'))
const Toaster = lazy(() => import('./components/ui/sonner').then(m => ({ default: m.Toaster })))

function RouteFallback() {
  return (
    <div className="w-full min-h-[50vh] flex items-center justify-center">
      <Spinner label="Loading…" />
    </div>
  )
}

function StorefrontShell() {
  const { merchant, loading, notFound } = useMerchant()
  const { t } = useSession()

  if (loading) return (
    <div className="w-full min-h-[50vh] flex items-center justify-center">
      <Spinner label="Loading shop…" />
    </div>
  )

  if (notFound) return (
    <div className="form-wrap text-center pt-8 pb-12">
      <div className="text-center mb-10">
        <h1><Wordmark className="h-8 mx-auto" /></h1>
        <p className="font-heading text-[13px] italic text-rose-muted mt-[5px]">Shop not found</p>
      </div>
      <div className="bg-surface-raised border-[1.5px] border-rose-border rounded-2xl p-5 mb-8 w-full box-border text-left">
        <p className="text-rose-muted text-[14px] leading-[1.6] mt-1.5">
          This shop doesn't exist or may have moved.
        </p>
      </div>
    </div>
  )

  if (!merchant) return null

  if (merchant.status !== 'active') return (
    <div className="form-wrap text-center pt-8 pb-12">
      <div className="text-center mb-10">
        <h1><Wordmark className="h-8 mx-auto" /></h1>
        <p className="font-heading text-[13px] italic text-rose-muted mt-[5px]">{merchant.name}</p>
      </div>
      <div className="bg-surface-raised border-[1.5px] border-rose-border rounded-2xl p-5 mb-8 w-full box-border text-left">
        <p className="text-rose-muted text-[14px] leading-[1.6] mt-1.5">
          {t('This shop is temporarily closed. Please check back later.', '本店暂时休息，请稍后再来。')}
        </p>
      </div>
    </div>
  )

  return (
    <Routes>
      <Route index element={<Storefront />} />
      {/* A destination, not a dialog: deep-linkable and shareable. Signed out it renders the
          auth panel in place — deliberately NOT behind RequireRole, which bounces to the
          merchant login: wrong framing, wrong bundle, wrong destination for a customer. */}
      <Route path="orders" element={<OrderHistory />} />
    </Routes>
  )
}

// A merchant who is already signed in has no business on the login screen, and Back is exactly how
// they get there. Renders the form while the session is still resolving — `role` reads 'customer'
// until the shop lookup lands — so a signed-out visitor never waits behind a spinner; on a
// client-side Back the session is already resolved above this tree, so the bounce is immediate.
//
// Login only, NOT signup: the signup flow signs the merchant in halfway through and then hands a
// Pro shop off to Stripe Checkout. A bounce there would hijack the redirect and strand a shop that
// has never paid.
//
// Superadmins are left alone: /merchant is not their dashboard (MerchantHome sends them to /admin),
// so sending them there is a round trip through a screen that only redirects again.
function RedirectSignedInMerchant({ children }: { children: ReactNode }) {
  const { role } = useSession()
  if (role === 'merchant') return <Navigate to="/merchant" replace />
  return children
}

export default function AppRouter() {
  return (
    <SessionProvider>
      {/* One provider for every tooltip in the app, so they share a delay instead of each
          usage inventing one. `delay={200}` is long enough that a pointer crossing the
          dashboard on its way somewhere else does not trail popups behind it. */}
      <TooltipProvider delay={200}>
        <AnimatedRoutes />
      </TooltipProvider>
      <RouteToaster />
    </SessionProvider>
  )
}

// Sonner mounts by writing ~15kB of CSS into <head>, and on the landing route that one injection
// is the largest single difference between the HTML the server sends and the DOM the browser ends
// up with — larger than the whole body. That difference is measured: `/` is prerendered
// (scripts/prerender.tsx) precisely so crawlers that do not execute JavaScript can read the page
// out of the raw HTML, and a page that rewrites its own head on boot is scored as heavily rendered
// however complete its body is.
//
// The landing page fires no toasts — it has no action that can fail — so it mounts no toaster.
// Every other route keeps one. Lazy for the mirror-image reason: sonner leaves the entry chunk, so
// the marketing page no longer downloads a toast library it never uses.
//
// If a marketing route ever needs a toast, mount one there rather than deleting this gate — a
// `toast()` with no Toaster mounted is silent, and that failure is invisible in review.
const NO_TOASTER = new Set(['/'])

function RouteToaster() {
  const { pathname } = useLocation()
  if (NO_TOASTER.has(pathname)) return null
  return (
    <Suspense fallback={null}>
      <Toaster position="bottom-center" />
    </Suspense>
  )
}

function AnimatedRoutes() {
  const location = useLocation()
  // Written per route, not in index.html: one HTML file serves every path, so a static tag would
  // declare every storefront to be the homepage. See canonical.ts.
  useCanonical()
  // Same argument, same place, for the title and description — a route with no entry of its own
  // gets the served document's back rather than keeping the last route's. See documentMeta.ts.
  useDocumentMeta(location.pathname)
  return (
    <Suspense fallback={<RouteFallback />}>
      {/* Keyed on the path so each route fades in, and NOT wrapped in AnimatePresence: an
          exit-gated swap never completes in a backgrounded tab, which froze the app on
          whatever route it was showing. See the rule at the top of motion.tsx. */}
      <PageTransition key={location.pathname}>
        <Routes location={location}>
          <Route path="/" element={<Landing />} />
          {/* A route, not the landing page's `#pricing` anchor. An anchor is the same URL to a
              crawler; this is a second page with its own <title> and description, which is what
              Google draws a sitelink label from (#169). Prerendered — see scripts/prerender.tsx. */}
          <Route path="/pricing" element={<Pricing />} />
          {/* Same argument as /pricing: real pages of their own, not landing anchors, each with
              its own <title> and description for Google to draw a sitelink from (#169).
              Prerendered — see scripts/prerender.tsx. */}
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/faq" element={<FaqPage />} />
          {/* NOT prerendered, unlike the three routes above — the shop list is fetched
              client-side with no fallback data, so a prerendered shell would just be empty
              markup. See SampleShopsPage.tsx. */}
          <Route path="/sample-shops" element={<SampleShopsPage />} />
          {/* Top-level on purpose, NOT nested under /s/:slug: the storefront shell's status gate
              would swallow it, and a suspended shop must never lock a customer out of their own
              account. Role-blind — `?shop=` decides where they land afterwards. */}
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {/* Top-level for the same reason, and it matters for the same kind of person: a
              customer of a SUSPENDED shop must still be able to read the notice describing data
              we already hold about them. A shop's status can never gate that. */}
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/s/:slug/*" element={<MerchantProvider><StorefrontShell /></MerchantProvider>} />
          {/* The optional segments are the plan and billing cycle the pricing cards preselect —
              `/merchant/signup/pro/yearly` rather than `?plan=pro&billing=yearly`, because a query
              string is what a link auditor and a human both read as unfriendly. Optional, so the
              bare URL in sitemap.xml and a half-typed one still land on the form; collapsed to
              that bare URL by canonicalPath, so the four CTAs are one indexed page. */}
          <Route path="/merchant/signup/:plan?/:billing?" element={<SignupScreen />} />
          <Route path="/merchant/login" element={<RedirectSignedInMerchant><LoginScreen /></RedirectSignedInMerchant>} />
          <Route path="/merchant" element={<RequireRole role="merchant"><MerchantHome /></RequireRole>} />
          <Route path="/merchant/:slug" element={<RequireRole role="superadmin"><MerchantHome /></RequireRole>} />
          <Route path="/admin/merchants" element={<RequireRole role="superadmin"><AdminHome /></RequireRole>} />
          <Route path="/admin" element={<RequireRole role="superadmin"><AdminHome /></RequireRole>} />
        </Routes>
      </PageTransition>
    </Suspense>
  )
}
