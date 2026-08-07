// The Hono app, with no server attached.
//
// It is exported rather than served here so the suites in tests/api can drive the real
// routes in-process via `app.request()` — no listening port, no HTTP stack, but the actual
// routing, auth and error mapping under test. src/index.ts is the entry that binds it to a
// port.
//
// Importing this does no I/O, but it is not free of side effects: it pulls in env.ts, which
// THROWS on a missing required var. That fail-fast is deliberate (a backend that boots
// without a Stripe key is worse than one that refuses to), and it is why vitest.db.config.ts
// has to stub the Stripe keys before a test can import this module. Keep it to that — no
// connections, no timers, no reads at import time.
import { timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { env } from './env.js'
import { admin, getUserFromToken } from './supabase.js'
import { requireUser, requireSuperadmin, requireMerchantOwns, requireOwnsChild, requireOwnMerchant, requirePro, hasProAccess, REQUIRES_PRO, type AppEnv } from './mw.js'
import { stripe, priceFor, isValidPlan, isValidCycle, isStripeError } from './stripe.js'
import { upsertBilling, setMerchantStatus, billingFromSubscription, reconcileMerchantPlan, lapseMerchant, LIVE_STATUSES } from './billing.js'
import { downgradePhases, ScheduleError, type LivePhase } from './subscriptionSchedule.js'
import { canStartTrial, trialStartRefusal, buildTrialReminderEmail } from './billingLifecycle.js'
import { startCardlessTrial } from './trialSubscription.js'
import { runBillingSweep } from './billingSweep.js'
import { syncMerchantBilling } from './billingSync.js'
import { resendSend } from './email.js'
import { notifyOrderPlaced, telegramSend } from './notify.js'
import { emailOrderConfirmation, emailMerchantOrder } from './orderEmails.js'
import { signUpCustomer, isDuplicateEmailError } from './customerSignup.js'
import { createSlidingWindow } from './rateLimit.js'
import { clientIp } from './clientIp.js'
import { phoneKey } from './phone.js'
import {
  shopCustomers, isShopCustomerSort, pickShopCustomerFields, DEFAULT_SHOP_CUSTOMER_SORT,
} from './shopCustomers.js'
import { shopCustomerGroups, shopCustomerRecords, upsertShopCustomer } from './shopCustomersDb.js'
import { statsOrders, distinctCustomerCount } from './ordersDb.js'
import { parseOrderList } from './orderList.js'
import { resolveRoutedDistance } from './routedDistance.js'
import { liveDistanceDeps } from './distanceCache.js'
import { quoteIpWindow, quoteMerchantWindow, placesGlobalWindow } from './quotaWindows.js'
import { googlePlaceSuggest, googlePlaceDetail } from './maps.js'
import { detectCountry } from './region.js'
import { fetchBasePricing, createPricingCache, planFromPriceId, type PricingPayload } from './pricing.js'
import { estimateFor } from './fx.js'
import { listReferredShops, listEarnedRewards } from './referrals.js'
import { processReferralReward } from './referralRewardGrant.js'
import { placeOrder, OrderError, orderMerchantId, setOrderPaymentProof } from './orders.js'
import { insertFeedback, listFeedback, updateFeedbackStatus, updateFeedbackGithubIssue } from './feedback.js'
import {
  findDueTrials, claimSend, releaseSend,
  getOwnTrialFeedback, respondTrialFeedback, skipTrialFeedback, listTrialFeedbackForAdmin,
} from './trialFeedback.js'
import { buildTrialFeedbackEmail } from './trialFeedbackEmail.js'
import {
  createGithubIssue, closeGithubIssue, reopenGithubIssue, listGithubReleases,
  buildIssueTitle, buildIssueBody, categoryToLabel,
  type CreateGithubIssue, type GithubIssueAction, type ListGithubReleases,
} from './github.js'
import { humanizeRelease, type HumanizeRelease } from './releases.js'
import {
  listReleaseTags, insertDraftRelease, listAllReleases, getReleaseById,
  updateReleaseStatus, updateReleaseHumanization,
  listPublishedReleases, getPublishedReleaseByTag,
} from './releasesDb.js'
import { isCart, isBusinessNature, isCurrencyCode, DEFAULT_CURRENCY, validateOptionGroups, optionGroupsFromRow, validateFeedback, isFeedbackStatus, validateTrialFeedback, shopDistance, routedKm, distanceFee, REFUSAL_STATUS, QUOTE_REFUSAL_STATUS, DEFAULT_TIMEZONE, isTimezone, computeMerchantStats, ordersInWindow, windowTotals, todayInZone, isRevenueRange, granularityFor } from '@bitetime/shared'
import type { CartLine } from '@bitetime/shared'
import { buildRevenueWorkbook, reportFilename } from './report.js'
import { resolveSlug, orderPrefix, referralCodeOf, resolveReferredByCode, RESERVED_SLUGS } from './slug.js'
import { pickMerchantConfig, pickProfileFields, pickProductFields, promoChanged, optionGroupsChanged, pickOrderFields, ORDER_STATUSES } from './writes.js'

export const app = new Hono<AppEnv>()

// `exposeHeaders` is what lets the browser READ Content-Disposition on a cross-origin response,
// and the frontend and backend ARE different origins in production (Vercel ↔ Railway). Without
// it the revenue report download arrives with a body and no filename, and saves itself as the
// URL's last path segment.
app.use('/api/*', cors({
  origin: env.frontendUrl,
  allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['Content-Disposition'],
}))

const ORDER_HISTORY_LIMIT = 20

app.get('/health', (c) => c.json({ ok: true }))

/**
 * The server's clock, published.
 *
 * `priceOrder` runs on both sides of the wire and the promo window reads a clock, so the CLOCK is
 * a price input — and a browser minutes off ours, on the promo's last day, would quote the promo,
 * be refused (`price_changed`), re-quote with the same skewed clock, and be refused again: a
 * permanent refusal loop for a legitimate customer. The storefront syncs against this and prices
 * against the corrected time, so the clock it quotes with is the clock we charge with. See #69.
 */
app.get('/api/time', (c) => c.json({ now: new Date().toISOString() }))

// ── Platform subscription pricing ───────────────────────────────────────────────
// Everyone is charged MYR — the base prices are the same for every visitor, cached
// under one key. Country comes from a CDN header (or the `?country=` override for
// local dev/QA) and only picks the approximate local-currency estimate (fx.ts).
const pricingCache = createPricingCache<PricingPayload>({ ttlMs: 5 * 60_000, now: () => Date.now() })

app.get('/api/pricing', async (c) => {
  const country = detectCountry({
    explicitCountry: c.req.query('country') || undefined,
    getHeader: (name) => c.req.header(name),
  })
  try {
    // Base MYR prices are the same for everyone → cached under one key; the estimate
    // is a cheap pure lookup that varies by country, so it is not cached.
    const base = await pricingCache.get('base', () =>
      fetchBasePricing({
        prices: env.prices,
        retrievePrice: (id) =>
          stripe.prices
            .retrieve(id)
            .then((p) => ({ unit_amount: p.unit_amount, currency: p.currency })),
      }),
    )
    return c.json({ ...base, estimate: estimateFor(country) })
  } catch (err) {
    console.error('Pricing resolution failed:', err instanceof Error ? err.message : String(err))
    return c.json({ error: 'Pricing unavailable' }, 502)
  }
})

// ── Superadmin reads ──────────────────────────────────────────────────────────
app.get('/api/merchants', requireSuperadmin, async (c) => {
  const { data, error } = await admin
    .from('merchants').select('*').order('created_at', { ascending: false })
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  return c.json(data ?? [])
})

app.get('/api/billing', requireSuperadmin, async (c) => {
  const { data, error } = await admin.from('merchant_billing').select('*')
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  return c.json(data ?? [])
})

// ── Merchant creation (any authenticated user creates their own shop) ──────────
// The insert goes through `admin` (service_role), which bypasses guard_merchant_status —
// so `status: 'pending'`, `owner_id: user.id` and `billing_region: 'MY'` are forced here,
// never read from the body. Only name/plan/billing/referredByCode are accepted from the
// client (Global Constraint 1). Slug uniqueness resolution moved server-side now that the
// browser can no longer SELECT merchants.slug directly.
app.post('/api/merchants', requireUser, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({} as any))
  const name = String(body?.name ?? '').trim()
  if (!name) return c.json({ error: 'Missing name' }, 400)

  // Mandatory at signup and never editable afterwards (business_nature is no longer in
  // MERCHANT_CONFIG_FIELDS — see writes.ts). Shops that signed up before this was required keep
  // whatever they have (including null); this only gates NEW rows.
  const businessNature = body?.businessNature
  if (!isBusinessNature(businessNature)) {
    return c.json({ error: 'Missing or unknown business nature' }, 400)
  }

  // Chosen at signup, never editable afterwards (see writes.ts) — so unlike businessNature this
  // one has a sane default rather than forcing a choice: a caller that sends nothing gets the
  // column's own default, MYR.
  const currency = body?.currency === undefined ? DEFAULT_CURRENCY : body.currency
  if (!isCurrencyCode(currency)) {
    return c.json({ error: 'Unknown currency' }, 400)
  }

  const { data: rows } = await admin.from('merchants').select('slug')
  const slug = await resolveSlug(name, { taken: (rows ?? []).map((r) => r.slug), id: user.id })

  const { data, error } = await admin
    .from('merchants')
    .insert({
      name,
      slug,
      order_prefix: orderPrefix(slug),
      owner_id: user.id,
      status: 'pending',
      plan: body?.plan ?? 'basic',
      billing_cycle: body?.billing ?? 'monthly',
      billing_region: 'MY', // everyone is charged MYR
      business_nature: businessNature,
      currency,
      referred_by_code: resolveReferredByCode(body?.referredByCode, referralCodeOf(user.id)),
    })
    .select()
    .single()
  if (error) return c.json({ error: 'Create failed' }, 500)

  // Self-serve: the trial is provisioned HERE, not by an approval. Two things this must not do —
  // fail the signup because Stripe did (the account, the slug and the form's answers are worth
  // more than the retry), and return an `active` shop with no subscription behind it
  // (startCardlessTrial owns that ordering). A shop Stripe refused stays `pending` and the owner
  // retries from the dashboard via POST /api/merchants/:id/start-trial.
  if ((data.plan ?? 'basic') === 'pro') return c.json(data)

  // `null` billing is not a shortcut: a shop created milliseconds ago has no merchant_billing
  // row, so there is no customer id to reuse and nothing for canStartTrial to refuse.
  const outcome = await startCardlessTrial(data, null)
  if (!outcome.ok) {
    console.error('Trial provisioning failed at signup for', data.id, '—', outcome.error)
    return c.json({ ...data, trial: false })
  }
  // `data` was read back before the claim flipped it, so say what is true now rather than making
  // the client refetch to find out.
  return c.json({ ...data, status: 'active', trial: outcome.trial })
})

// Owner-editable shop config. The update goes through `admin` (service_role), which bypasses
// guard_merchant_status — so `pickMerchantConfig` is the ONLY thing stopping an owner from
// self-activating a suspended shop (or reassigning owner_id) via a crafted body. See
// writes.ts and Global Constraint 1.
app.patch('/api/merchants/:id', requireMerchantOwns, async (c) => {
  const id = c.req.param('id')
  const picked = pickMerchantConfig(await c.req.json().catch(() => ({})), id)
  if (!picked.ok) return c.json({ error: picked.error }, 400)
  const patch = picked.patch
  if (Object.keys(patch).length === 0) return c.json({ error: 'No updatable fields' }, 400)
  // These two rules must see the row's CURRENT flags as well as the patch's. A merchant who
  // turns delivery off in one save and pickup off in the next sends two bodies that are each
  // legal alone — and lands on a storefront no customer can order from. `c.get('merchant')` is
  // the row `requireMerchantOwns` already loaded (`select('*')`) for the ownership check above,
  // so this is a read of already-fetched data, not a second query.
  //
  // The columns' own CHECK constraints (`merchants_one_fulfilment_method`,
  // `merchants_express_requires_origin`) are the backstop. These are the checks that can say
  // WHY, in time for the merchant still looking at the form, instead of a bare 500 out of
  // PostgREST.
  const stored = c.get('merchant')
  const merged = {
    pickup: patch.pickup_enabled ?? stored.pickup_enabled,
    delivery: patch.delivery_enabled ?? stored.delivery_enabled,
    express: patch.express_enabled ?? stored.express_enabled,
  }
  if (!merged.pickup && !merged.delivery && !merged.express) {
    return c.json({ error: 'Your shop must offer at least one fulfilment method' }, 400)
  }
  if (merged.express) {
    const origin = patch.origin_place_id !== undefined ? patch.origin_place_id : stored.origin_place_id
    if (!origin) return c.json({ error: 'Set your delivery origin before switching on express delivery' }, 400)
  }
  const { data, error } = await admin.from('merchants').update(patch).eq('id', id).select().single()
  if (error) return c.json({ error: 'Update failed' }, 500)
  return c.json(data)
})

// Slug rename. Uniqueness resolution moves here now that the browser can no longer SELECT
// merchants.slug directly — the last browser read of merchants.
app.patch('/api/merchants/:id/slug', requireMerchantOwns, async (c) => {
  const id = c.req.param('id')
  const s = String((await c.req.json().catch(() => ({}))).slug ?? '').trim().toLowerCase()
  if (!s || RESERVED_SLUGS.includes(s)) return c.json({ error: 'Reserved or empty slug' }, 400)
  const { data: existing } = await admin.from('merchants').select('id').eq('slug', s).maybeSingle()
  if (existing && existing.id !== id) return c.json({ error: 'Slug already taken' }, 409)
  const { data, error } = await admin.from('merchants').update({ slug: s }).eq('id', id).select().single()
  if (error) return c.json({ error: 'Update failed' }, 500)
  return c.json(data)
})

// ── Owner-scoped reads (tenant enforced by requireMerchantOwns) ────────────────

/**
 * The merchant's order list, one page at a time (#144).
 *
 * This used to be an unbounded `select *`. PostgREST caps a response at `max_rows` and says so
 * only in a `Content-Range` header nothing read, so a shop past its 1000th order was handed a
 * partial list that looked complete — its oldest orders simply unreachable, and its revenue
 * chart short by however much history fell off the end.
 *
 * The fix is not a bigger cap. It is that the caller now NAMES the window it wants and is told
 * what that window is a slice of: `total` is the exact matched count, so a page is a page rather
 * than a truncation wearing one's clothes. Paging, sorting and searching all happen in Postgres
 * for the same reason — a browser cannot search rows it was never sent.
 *
 * Still on the REST client rather than `ordersDb.ts`: these rows are RENDERED, and they must be
 * the same shape as the row a status PATCH hands back through the same client. Only the
 * aggregates, which need the whole history and read four columns of it, go through the driver.
 */
app.get('/api/merchants/:id/orders', requireMerchantOwns, async (c) => {
  const m = c.get('merchant')
  const parsed = parseOrderList(new URL(c.req.url).searchParams)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const { page, pageSize, sort, dir, search } = parsed.query

  let q = admin
    .from('orders').select('*', { count: 'exact' }).eq('merchant_id', m.id)

  // The three fields a merchant actually looks someone up by. `searchTerm` has already removed
  // everything that would change this filter's meaning rather than be searched for.
  if (search) {
    q = q.or(
      `order_number.ilike.%${search}%,customer_name.ilike.%${search}%,customer_wa.ilike.%${search}%`,
    )
  }

  const from = (page - 1) * pageSize
  const { data, error, count } = await q
    // The tiebreak is not decoration: without a total order, two orders sharing a sort value
    // come back in whatever order Postgres happens to yield, and page 2 can repeat a row page 1
    // already showed. `id` is unique, so this makes the paging honest.
    .order(sort, { ascending: dir === 'asc', nullsFirst: false })
    .order('id', { ascending: true })
    .range(from, from + pageSize - 1)
  if (error) return c.json({ error: 'Lookup failed' }, 500)

  return c.json({ orders: data ?? [], total: count ?? 0, page, pageSize })
})

/**
 * Every figure on the dashboard's Overview, computed HERE (#144).
 *
 * The browser used to fetch the shop's entire order table and aggregate it on the client, which
 * meant the revenue chart was only ever as complete as the row cap allowed — and a merchant has
 * no way to tell a wrong revenue figure from a right one. The orders now never leave the server:
 * `statsOrders` reads them uncapped through the driver, and `computeMerchantStats` is the SAME
 * shared module the XLSX export uses, so "booked excludes cancelled" stays stated once.
 *
 * Free, like the Overview it draws. The export beside it is the Pro capability, not the chart.
 */
app.get('/api/merchants/:id/stats', requireMerchantOwns, async (c) => {
  const days = Number(c.req.query('days') ?? 12)
  // Refused rather than clamped, exactly as the export refuses — same list, same reason.
  if (!isRevenueRange(days)) return c.json({ error: 'bad_range' }, 400)
  const granularity = c.req.query('granularity') ?? granularityFor(days)
  if (granularity !== 'day' && granularity !== 'week') return c.json({ error: 'bad_granularity' }, 400)

  const m = c.get('merchant')
  // Vouchers are per-shop promotions, a handful of rows — the row cap is not in play, and this
  // one stays on the REST client alongside the endpoint that serves the same rows to the
  // Vouchers tab.
  const [orders, customerCount, vouchers] = await Promise.all([
    statsOrders(m.id),
    distinctCustomerCount(m.id),
    admin.from('vouchers').select('used_by').eq('merchant_id', m.id)
      .then(r => (r.data ?? []).map(v => ({ usedBy: (v.used_by as unknown[]) ?? [] }))),
  ])

  // Resolved and validated once, like the export does: an unusable `merchants.timezone` would
  // otherwise bucket the chart in the server's zone while the merchant reads it in their own.
  const timeZone = isTimezone(m.timezone) ? m.timezone : DEFAULT_TIMEZONE
  return c.json(computeMerchantStats(orders, customerCount, vouchers, new Date(), {
    days, granularity, timeZone,
  }))
})

/**
 * The shop's customers (#143). See CONTEXT.md → Shop customer.
 *
 * Aggregated in SQL and folded in TypeScript, which is what keeps it clear of the PostgREST row
 * cap — a shop past its 1000th order still gets a complete customer list here. This was the
 * first escape from that cap; the orders endpoint above took its own in #144.
 *
 * The plan gate is CONDITIONAL, so it cannot be `requirePro` middleware: the list itself is free
 * (it shipped to basic shops before Pro existed and withdrawing it would be a regression), while
 * sorting and tag filtering are the Pro capability. Same shape as the product upsert's promo
 * gate — inside the handler, once we know what the request is actually asking for.
 */
app.get('/api/merchants/:id/customers', requireMerchantOwns, async (c) => {
  const m = c.get('merchant')
  const q = new URL(c.req.url).searchParams

  const sort = q.get('sort') ?? DEFAULT_SHOP_CUSTOMER_SORT
  if (!isShopCustomerSort(sort)) return c.json({ error: 'invalid_sort' }, 400)
  const tag = q.get('tag') ?? undefined

  if ((sort !== DEFAULT_SHOP_CUSTOMER_SORT || tag !== undefined) && !(await hasProAccess(c))) {
    return c.json({ error: REQUIRES_PRO }, 403)
  }

  const [groups, records] = await Promise.all([shopCustomerGroups(m.id), shopCustomerRecords(m.id)])
  return c.json(shopCustomers(groups, records, {
    now: new Date(),
    sort,
    tag,
    search: q.get('search') ?? undefined,
    page: Number(q.get('page')) || undefined,
    pageSize: Number(q.get('pageSize')) || undefined,
  }))
})

/**
 * One customer's orders, for the drawer. Free, like the list it opens from.
 *
 * A separate call rather than orders nested in the list above: the list is a table of hundreds
 * and the drawer opens for exactly one of them. Nesting would ship every customer's full order
 * history to draw a table that shows none of it — the row-cap mistake in a new costume.
 *
 * Cancelled orders are included. The badge is right there on each row, and a history that
 * silently omitted them would contradict the drawer's own header count.
 */
app.get('/api/merchants/:id/customers/:phoneKey/orders', requireMerchantOwns, async (c) => {
  const m = c.get('merchant')
  const key = phoneKey(c.req.param('phoneKey'))
  if (key === null || key !== c.req.param('phoneKey')) return c.json({ error: 'invalid_phone_key' }, 400)

  const { data, error } = await admin
    .from('orders').select('*')
    .eq('merchant_id', m.id).eq('customer_phone_key', key)
    .order('created_at', { ascending: false }).limit(ORDER_HISTORY_LIMIT)
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  return c.json(data ?? [])
})

// Writing is wholly Pro, so the gate is middleware here rather than a branch. `phoneKey` on the
// path parameter is a SHAPE check, not a lookup: a key with no orders behind it is a harmless
// row that never joins, but a path segment that is not a key at all is a caller bug.
app.put('/api/merchants/:id/customers/:phoneKey', requireMerchantOwns, requirePro, async (c) => {
  const m = c.get('merchant')
  const key = phoneKey(c.req.param('phoneKey'))
  if (key === null || key !== c.req.param('phoneKey')) return c.json({ error: 'invalid_phone_key' }, 400)

  const picked = pickShopCustomerFields(await c.req.json().catch(() => ({})))
  if (!picked.ok) return c.json({ error: 'invalid_body' }, 400)

  return c.json(await upsertShopCustomer(m.id, key, picked.fields))
})

/**
 * How many orders this shop has, optionally of one status.
 *
 * `head: true` with an exact count, so the answer is a number Postgres computed and never a
 * length the caller measured on a list it was handed — which is what the "new orders" badge used
 * to do, by fetching every order the shop had ever taken and filtering it in the browser. Past
 * the row cap that badge was simply wrong, and it was also the most expensive read in the
 * dashboard, running on a poll from every section.
 */
app.get('/api/merchants/:id/orders/count', requireMerchantOwns, async (c) => {
  const m = c.get('merchant')
  const status = c.req.query('status')
  // Refused, not ignored: a filter we silently drop answers a bigger question than the one asked.
  if (status !== undefined && !ORDER_STATUSES.includes(status)) {
    return c.json({ error: 'invalid_status' }, 400)
  }

  let q = admin
    .from('orders').select('id', { count: 'exact', head: true }).eq('merchant_id', m.id)
  // `status` is nullable and an absent status MEANS 'new' — the storefront writes the column, but
  // rows predating it do not have one, and the dashboard has always read them as new.
  if (status === 'new') q = q.or('status.is.null,status.eq.new')
  else if (status !== undefined) q = q.eq('status', status)

  const { count, error } = await q
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  return c.json({ count: count ?? 0 })
})

// The Pro-only revenue export (CONTEXT.md → Plan entitlement). The gate is HERE — the padlock in
// the dashboard is UX, and this refuses a crafted request from a basic shop's own owner. It sits
// ahead of the range check on purpose: a basic shop probing the endpoint learns that it needs
// Pro, not which ranges the paid feature accepts.
//
// Read-only and single-statement, so it goes through `admin` and not `db.ts`; there is nothing to
// keep atomic. Every sheet is confined to the window, which is why the orders are narrowed BEFORE
// the totals are taken: `MerchantStats`'s own KPI block is all-time by design, since on the
// dashboard those cards sit above the range pills.
/**
 * `YYYY-MM-DD HH:mm` in the shop's zone.
 *
 * Not an offset-bearing ISO instant: the Summary sheet names the zone in its own row, and what
 * has to be true is that this stamp and the file's date columns read off the same clock. A
 * locale-formatted string ("6:05 p.m.") would be neither sortable nor unambiguous in a
 * spreadsheet, so the parts are assembled explicitly.
 */
function stampInZone(timeZone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

app.get('/api/merchants/:id/report.xlsx', requireMerchantOwns, requirePro, async (c) => {
  const days = Number(c.req.query('days'))
  const granularity = c.req.query('granularity')
  // Refused, not clamped: a clamped request hands back a file that quietly answers a different
  // question than the one asked, over a merchant's own accounting. The list of ranges is
  // @bitetime/shared's, the same one the dashboard's pills are built from.
  if (!isRevenueRange(days)) return c.json({ error: 'bad_range' }, 400)
  if (granularity !== 'day' && granularity !== 'week') return c.json({ error: 'bad_granularity' }, 400)

  const m = c.get('merchant')
  // Through the driver, uncapped: a spreadsheet of a shop's accounting that quietly stopped at
  // its 1000th order would be worse than the chart doing it, because it gets filed (#144).
  const orders = await statsOrders(m.id)

  const now = new Date()
  // Resolved ONCE, here, and validated — not left to each helper's own fallback. `zoneClock`
  // falls back to the runtime's zone and `todayInZone` falls back to DEFAULT_TIMEZONE, so an
  // unusable `merchants.timezone` would otherwise bucket the sheets in UTC while dating the
  // filename in Kuala Lumpur: the file disagreeing with itself, which is the failure this
  // feature's time-zone work exists to prevent.
  const timeZone = isTimezone(m.timezone) ? m.timezone : DEFAULT_TIMEZONE
  const windowed = ordersInWindow(orders, now, days, timeZone)
  const totals = windowTotals(windowed)
  // `productTop: Infinity` — a spreadsheet lists every product, unlike the six-wedge donut.
  // The customer count is 0 because no sheet shows it; the export's KPI block is `windowTotals`.
  const stats = computeMerchantStats(windowed, 0, [], now, {
    days, granularity, timeZone, productTop: Infinity,
  })

  const today = todayInZone(timeZone, now)
  const buffer = await buildRevenueWorkbook(
    {
      totalOrders: totals.totalOrders,
      revenue: totals.revenue,
      avgOrder: totals.avgOrder,
      series: stats.series,
      products: stats.productRevenue,
      statuses: stats.statusBreakdown,
    },
    // `merchants.currency` is NOT NULL DEFAULT 'MYR' (20260701120000_merchant_currency.sql), so
    // there is nothing to fall back to — and a fallback here would silently relabel some other
    // shop's money as MYR rather than showing that something is wrong.
    { name: m.name, slug: m.slug, currency: m.currency, timeZone },
    {
      days,
      granularity,
      from: stats.series[0]?.start ?? today,
      to: stats.series[stats.series.length - 1]?.end ?? today,
      // Stamped in the SHOP's zone, like every other date in the file.
      generatedAt: stampInZone(timeZone, now),
    },
  )

  // A raw Response, not `c.body`: Hono's body type is string | ArrayBuffer | ReadableStream and
  // a Node Buffer is none of them, though it is a perfectly good BodyInit.
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${reportFilename(m.slug, today, days)}"`,
    },
  })
})

app.get('/api/merchants/:id/vouchers', requireMerchantOwns, async (c) => {
  const m = c.get('merchant')
  const { data, error } = await admin.from('vouchers').select('*').eq('merchant_id', m.id)
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  return c.json(data ?? [])
})

app.get('/api/merchants/:id/billing', requireMerchantOwns, async (c) => {
  const m = c.get('merchant')
  const { data, error } = await admin
    .from('merchant_billing').select('*').eq('merchant_id', m.id).maybeSingle()
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  return c.json(data ?? null)
})

app.get('/api/merchants/:id/secret', requireMerchantOwns, async (c) => {
  const m = c.get('merchant')
  const { data, error } = await admin
    .from('merchant_secrets').select('tg_token, tg_chat_id').eq('merchant_id', m.id).maybeSingle()
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  return c.json(data ?? null)
})

// Secret upsert. The write goes through `admin` (service_role), which bypasses RLS and the
// restricted grants on merchant_secrets — so picking only tg_token/tg_chat_id off the body is
// the ONLY guard (Global Constraint 1). merchant_id is FORCED from :id, never read from the
// body, AND is the upsert's conflict target (merchant_secrets.merchant_id is the primary key —
// see 20260627120150_secure_merchant_secrets.sql), so the product-PUT hijack class (Global
// Constraint 2) does not apply here: there is no client-supplied child id to nest a foreign
// row under. No separate tenancy check is needed.
// Telegram alerts are a Pro feature, so `requirePro` chains after the ownership check (#110).
// Only the WRITE is gated: the send path (`notify`) carries no plan check, because a shop that
// already has a token configured must keep receiving its orders. See CONTEXT.md → Plan entitlement.
app.put('/api/merchants/:id/secret', requireMerchantOwns, requirePro, async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json().catch(() => ({}) as any)
  const row: Record<string, unknown> = { merchant_id: id }
  if (b?.tg_token !== undefined) row.tg_token = b.tg_token
  if (b?.tg_chat_id !== undefined) row.tg_chat_id = b.tg_chat_id
  const { error } = await admin.from('merchant_secrets').upsert(row)
  if (error) return c.json({ error: 'Upsert failed' }, 500)
  return c.json({ ok: true })
})

// ── User-scoped reads ─────────────────────────────────────────────────────────
app.get('/api/me/profile', requireUser, async (c) => {
  const user = c.get('user')
  const { data } = await admin
    .from('profiles')
    .select('id, name, email, app_role, merchant_id, whatsapp, delivery_address')
    .eq('user_id', user.id).is('merchant_id', null).maybeSingle()
  return c.json(data ?? null)
})

// Upsert the caller's GLOBAL profile (merchant_id IS NULL). The partial unique index
// (user_id WHERE merchant_id IS NULL) can't be an ON CONFLICT target, so this mirrors the old
// browser-side select-then-insert/update. Goes through `admin` (service_role), which BYPASSES
// guard_profile_privileges — so pickProfileFields + forcing user_id/merchant_id here is the
// ONLY guard against a caller granting themselves app_role or attaching to another merchant
// (Global Constraint 1). Never read user_id/merchant_id from the body.
app.put('/api/me/profile', requireUser, async (c) => {
  const user = c.get('user')
  const fields = pickProfileFields(await c.req.json().catch(() => ({})))
  const { data: existing } = await admin
    .from('profiles').select('id').eq('user_id', user.id).is('merchant_id', null).maybeSingle()
  if (existing) {
    const { error } = await admin.from('profiles').update(fields).eq('id', existing.id)
    if (error) return c.json({ error: 'Update failed' }, 500)
  } else {
    const { error } = await admin.from('profiles').insert({
      ...fields,
      user_id: user.id,
      email: fields.email ?? user.email,
      created_at: new Date().toISOString(),
    })
    if (error) return c.json({ error: 'Insert failed' }, 500)
  }
  return c.json({ ok: true })
})

app.get('/api/me/merchant', requireUser, async (c) => {
  const user = c.get('user')
  const { data } = await admin.from('merchants').select('*').eq('owner_id', user.id).maybeSingle()
  return c.json(data ?? null)
})

// Any signed-in customer's own history at a shop. NOT requireMerchantOwns — the uid filter,
// not merchant ownership, is what scopes it. A guest (no token) is 401 and has no history.
app.get('/api/merchants/:id/my-orders', requireUser, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { data, error } = await admin
    .from('orders').select('*')
    .eq('merchant_id', id).eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(ORDER_HISTORY_LIMIT)
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  return c.json(data ?? [])
})

// ── Public: landing-page sample-shops carousel (#107) ──────────────────────────────────────────
// Registered BEFORE /api/merchants/:slug so the literal path "samples" is never captured as a
// slug. Unauthenticated, like /api/merchants/:slug and /api/merchants/:id/products below — same
// trust level, no tenant scoping needed. Deliberately does NOT reuse productFromRow/PricedProduct
// from @bitetime/shared: this response has no promo/pricing-engine fields, because it prices
// nothing — see docs/superpowers/specs/2026-08-04-sample-shops-carousel-design.md.
app.get('/api/merchants/samples', async (c) => {
  const { data: merchants, error } = await admin
    .from('merchants')
    .select('id, slug, name, currency, sample_screenshot_path')
    .eq('is_sample', true)
    .eq('status', 'active')
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  if (!merchants?.length) return c.json([])

  const { data: products, error: pErr } = await admin
    .from('products')
    .select('id, merchant_id, name, name_zh, price, image_urls')
    .in('merchant_id', merchants.map((m) => m.id))
    .eq('active', true)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true })
  if (pErr) return c.json({ error: 'Lookup failed' }, 500)

  const byMerchant = new Map<string, typeof products>()
  for (const p of products ?? []) {
    const list = byMerchant.get(p.merchant_id) ?? []
    if (list.length < 3) list.push(p)
    byMerchant.set(p.merchant_id, list)
  }

  return c.json(merchants.map((m) => ({
    id: m.id,
    slug: m.slug,
    name: m.name,
    currency: m.currency,
    screenshotPath: m.sample_screenshot_path,
    products: (byMerchant.get(m.id) ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      nameZh: p.name_zh,
      price: p.price,
      imagePath: p.image_urls?.[0] ?? null,
    })),
  })))
})

// ── Public reads (no auth — storefront) ───────────────────────────────────────
// Shaped: strip internal columns before returning to an unauthenticated caller.
app.get('/api/merchants/:slug', async (c) => {
  const s = (c.req.param('slug') || '').trim().toLowerCase()
  if (!s) return c.json(null)
  const { data, error } = await admin.from('merchants').select('*').eq('slug', s).maybeSingle()
  if (error || !data) return c.json(null)
  const { owner_id: _owner_id, referred_by_code: _referred_by_code, ...pub } = data
  return c.json(pub)
})

app.get('/api/merchants/:id/products', async (c) => {
  const id = c.req.param('id')
  const { data, error } = await admin
    .from('products').select('*').eq('merchant_id', id)
    .order('sort', { ascending: true }).order('created_at', { ascending: true })
  // A 5xx here is the client's "could not ask" signal — do NOT return [] on error.
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  return c.json(data ?? [])
})

// Product upsert. The write goes through `admin` (service_role), so pickProductFields is the
// ONLY guard against a crafted body writing merchant_id (forced to :id here, never read from
// the body) or promo_sold (see writes.ts — the trigger that pins it for other roles does not
// run for service_role).
// requireMerchantOwns only proves the caller owns :id — it says nothing about productId, so an
// owner of shop A could otherwise take over shop B's product by nesting it under :id = A: .upsert()
// conflict-resolves on the primary key, so if a row with that id already exists it gets UPDATEd
// in place (including merchant_id reassigned to A) instead of a new row being inserted. Loading
// the product and checking merchant_id === :id before upserting is what closes that hole
// (Global Constraint 2), mirroring the DELETE handler below.
// Product promos are Pro-only, but this endpoint is NOT — basic shops legitimately edit their
// menu through it, so it cannot carry `requirePro` as a whole (#110). The gate is inside, and it
// asks whether the write CHANGES the promo, comparing the body against the row `requireOwnsChild`
// already loaded (#145). A change from a non-Pro shop is REFUSED, never silently stripped — a
// saved product whose sale price vanished without a word is exactly the "success toast, wrong
// data" failure pickMerchantConfig refuses elsewhere.
//
// CHANGE, not presence, and the difference is a bug this used to have. Presence (`fields[k] !=
// null`) refuses a body that merely CARRIES the promo it already has — so a shop that dropped from
// pro to basic could not rename its own product, because the dashboard resubmits the whole row.
// The workaround was for the client to omit the columns, which leaves a shop's live sale one
// payload mistake away from being cleared behind a success toast: precisely what the rule above
// exists to stop. Comparing against the stored row lets the unchanged resubmit through and still
// refuses every real edit, on all three columns — a body moving only `promo_limit`/`promo_end`
// would otherwise raise the cap or push back the end date on a live sale for free.
//
// Clearing a promo is a change like any other, so a basic shop cannot do that either: the promo it
// may no longer edit stays put until the shop is Pro again. See promoChanged in writes.ts, and
// note that `promo_price: 0` is a real promo (a free item) — it is compared for null, never for
// truthiness. #145 gives `option_groups` the same shape on this endpoint.
app.put('/api/merchants/:id/products/:productId', requireMerchantOwns, requireOwnsChild('products', 'productId', { mayCreate: true }), async (c) => {
  const id = c.req.param('id')
  const productId = c.req.param('productId')
  const fields = pickProductFields(await c.req.json().catch(() => ({})))
  if (promoChanged(fields, c.get('child')) && !(await hasProAccess(c))) {
    return c.json({ error: REQUIRES_PRO }, 403)
  }
  // Menu options are Pro, gated the same way and for the same reason (ADR 0010). Clearing counts
  // as a change, so a shop that stepped down to basic cannot delete the groups it can no longer
  // edit — a Pro feature must not be removable by the act of ceasing to pay for it.
  if (optionGroupsChanged(fields, c.get('child')) && !(await hasProAccess(c))) {
    return c.json({ error: REQUIRES_PRO }, 403)
  }
  // ADR 0008 traded every `check` constraint on these groups for atomic saves and a jsonb column
  // that both drivers parse identically. THIS is what stands in their place: Postgres will store
  // `minSelect: 9, maxSelect: 2` without complaint, and a customer would then meet a question no
  // answer can satisfy. Refused here, where the merchant is present to see it, rather than as a
  // storefront that silently cannot be ordered from.
  if (fields.option_groups !== undefined) {
    const bad = validateOptionGroups(optionGroupsFromRow(fields.option_groups))
    if (bad) return c.json({ error: bad }, 400)
  }
  const row = { ...fields, id: productId, merchant_id: id }
  const { data, error } = await admin.from('products').upsert(row).select().single()
  if (error) return c.json({ error: 'Upsert failed' }, 500)
  return c.json(data)
})

// Product delete. requireMerchantOwns only proves the caller owns :id — it says nothing about
// productId, so an owner of shop A could otherwise delete shop B's product by nesting it under
// :id = A. Loading the product and checking merchant_id === :id before deleting is what closes
// that hole (Global Constraint 2).
app.delete('/api/merchants/:id/products/:productId', requireMerchantOwns, requireOwnsChild('products', 'productId'), async (c) => {
  const productId = c.req.param('productId')
  const { error } = await admin.from('products').delete().eq('id', productId)
  if (error) return c.json({ error: 'Delete failed' }, 500)
  return c.json({ ok: true })
})

app.get('/api/merchants/:id/vouchers/:code', async (c) => {
  const id = c.req.param('id')
  const code = c.req.param('code')
  // `active` is filtered here, not just at redemption, so a customer typing a code from a shop
  // that has stepped down to Basic is told it is not a code rather than being quoted a discount
  // the order transaction will then refuse. Same answer, one screen earlier.
  const { data, error } = await admin
    .from('vouchers').select('*').eq('merchant_id', id).eq('code', code)
    .eq('active', true).maybeSingle()
  // Same contract: 5xx = could-not-ask; 200 null = shop has no such voucher.
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  return c.json(data ?? null)
})

// Voucher create. The insert goes through `admin` (service_role), so forcing merchant_id
// from :id (never read from the body) is what stops a crafted body from creating a voucher
// under someone else's shop. This is an INSERT, not an upsert, so the product-PUT hijack
// class (conflict-resolving onto a stranger's row) does not apply here — there is no
// client-supplied id to collide on. `code` is uppercased/trimmed server-side, matching the
// old client-side `input.code.trim().toUpperCase()`.
// Vouchers are a Pro feature (#110). Only the merchant's MUTATIONS are gated — the customer's
// code lookup above stays public and redemption inside the order transaction stays plan-blind,
// so the gate can never break the ordering hot path.
app.post('/api/merchants/:id/vouchers', requireMerchantOwns, requirePro, async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json().catch(() => ({} as any))
  const code = String(b?.code ?? '').trim().toUpperCase()
  if (!code) return c.json({ error: 'Missing code' }, 400)
  const { data, error } = await admin.from('vouchers').insert({
    merchant_id: id,
    code,
    kind: b?.kind,
    amount: b?.amount,
    max_uses: b?.maxUses ?? null,
  }).select().single()
  if (error) return c.json({ error: 'Create failed' }, 500)
  return c.json(data)
})

// Voucher delete. requireMerchantOwns only proves the caller owns :id — it says nothing
// about voucherId, so an owner of shop A could otherwise delete shop B's voucher by nesting
// it under :id = A. Loading the voucher and checking merchant_id === :id before deleting is
// what closes that hole (Global Constraint 2), mirroring the product DELETE handler above.
app.delete('/api/merchants/:id/vouchers/:voucherId', requireMerchantOwns, requirePro, requireOwnsChild('vouchers', 'voucherId'), async (c) => {
  const voucherId = c.req.param('voucherId')
  const { error } = await admin.from('vouchers').delete().eq('id', voucherId)
  if (error) return c.json({ error: 'Delete failed' }, 500)
  return c.json({ ok: true })
})

// Order patch (status/note/tracking). The update goes through `admin` (service_role), so
// pickOrderFields is the ONLY guard against a crafted body writing e.g. total/user_id/
// order_number (Global Constraint 1) — status is additionally re-validated against
// ORDER_STATUSES here since the client-side check in store.ts is not a security boundary.
// requireMerchantOwns only proves the caller owns :id — it says nothing about orderId, so an
// owner of shop A could otherwise patch shop B's order by nesting it under :id = A. Loading the
// order and checking merchant_id === :id before updating is what closes that hole (Global
// Constraint 2), mirroring the product/voucher handlers above.
app.patch('/api/merchants/:id/orders/:orderId', requireMerchantOwns, requireOwnsChild('orders', 'orderId'), async (c) => {
  const orderId = c.req.param('orderId')
  const patch = pickOrderFields(await c.req.json().catch(() => ({})))
  if ('status' in patch && !ORDER_STATUSES.includes(patch.status as string)) {
    return c.json({ error: 'Invalid status' }, 400)
  }
  if (Object.keys(patch).length === 0) return c.json({ error: 'No updatable fields' }, 400)
  const { data, error } = await admin.from('orders').update(patch).eq('id', orderId).select().single()
  if (error) return c.json({ error: 'Update failed' }, 500)
  return c.json(data)
})

// The image itself, for the merchant dashboard. Same ownership chain as the PATCH above — see
// its own comment for why requireOwnsChild is what actually proves :orderId belongs to :id, not
// just requireMerchantOwns. `child` here is the order row requireOwnsChild already loaded; no
// second query.
app.get(
  '/api/merchants/:id/orders/:orderId/payment-proof',
  requireMerchantOwns,
  requireOwnsChild('orders', 'orderId'),
  async (c) => {
    const order = c.get('child')
    const path = order?.payment_proof as string | null | undefined
    if (!path) return c.json({ error: 'not_found' }, 404)

    const { data, error } = await admin.storage.from('payment-proof').download(path)
    if (error || !data) return c.json({ error: 'download_failed' }, 500)

    const buffer = await data.arrayBuffer()
    return new Response(buffer, {
      status: 200,
      headers: { 'Content-Type': data.type || 'application/octet-stream' },
    })
  },
)

// The customer-facing twin of the route above — same bytes, scoped by the order's user_id
// instead of merchant ownership. No requireOwnsChild here: that middleware proves MERCHANT
// ownership of a child row, which is the wrong question for a customer — so the check is
// inline, same 404-for-both shape as requireOwnsChild uses (a stranger's guess and a missing
// order must look identical, or the 404 itself becomes an oracle).
app.get('/api/orders/:orderId/payment-proof', requireUser, async (c) => {
  const user = c.get('user')
  const orderId = c.req.param('orderId')
  const { data: order, error } = await admin
    .from('orders').select('user_id, payment_proof').eq('id', orderId).maybeSingle()
  if (error) return c.json({ error: 'lookup_failed' }, 500)
  if (!order || order.user_id !== user.id) return c.json({ error: 'not_found' }, 404)
  const path = order.payment_proof as string | null
  if (!path) return c.json({ error: 'not_found' }, 404)

  const { data, error: downloadError } = await admin.storage.from('payment-proof').download(path)
  if (downloadError || !data) return c.json({ error: 'download_failed' }, 500)

  const buffer = await data.arrayBuffer()
  return new Response(buffer, {
    status: 200,
    headers: { 'Content-Type': data.type || 'application/octet-stream' },
  })
})

// ── Create a Stripe Checkout Session for the signed-in merchant ────────────────
app.post('/api/checkout', requireOwnMerchant, async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { plan, billing } = body
  if (!isValidPlan(plan) || !isValidCycle(billing)) {
    return c.json({ error: 'Invalid plan or billing cycle' }, 400)
  }
  // Caller and their own shop both resolved by `requireOwnMerchant` — one merchant per owner.
  const user = c.get('user')
  const merchant = c.get('merchant')

  // Reuse an existing Stripe customer if we have one, else create and store it.
  const { data: existing } = await admin
    .from('merchant_billing')
    .select('stripe_customer_id, status, comped')
    .eq('merchant_id', merchant.id)
    .maybeSingle()

  // Comp is terminal until a superadmin revokes it. Ahead of the live-subscription check on
  // purpose: a comped row carries status 'active', so that check would fire first and tell the
  // merchant they already have a subscription — which is the one thing they do not have.
  if (existing?.comped) return c.json({ error: 'shop_is_comped' }, 409)

  // A live subscription means there is nothing to buy here — refuse rather
  // than create a second subscription (double-billing), e.g. for a shop an
  // admin suspended while its Stripe subscription is still running.
  if (existing && LIVE_STATUSES.includes(existing.status ?? '')) {
    return c.json({ error: 'This shop already has an active subscription' }, 409)
  }

  let customerId = existing?.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: merchant.name,
      metadata: { merchant_id: merchant.id },
    })
    customerId = customer.id
    await upsertBilling(merchant.id, { stripe_customer_id: customerId })
  }

  const metadata = { merchant_id: merchant.id, plan, billing, region: 'MY' }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceFor(plan, billing), quantity: 1 }],
    client_reference_id: merchant.id,
    metadata,
    // Stripe hides the promo-code field unless asked, so a coupon we hand a merchant is
    // unredeemable without this. It only surfaces the input — the code still has to exist
    // as a promotion code in Stripe (a bare coupon has nothing customer-facing to type).
    allow_promotion_codes: true,
    // No trial here: trials are granted only by superadmin approval (cardless).
    // Checkout is the paid path — pro signup and suspended-shop reactivation.
    subscription_data: { metadata },
    // `checkout=success` (query) drives MerchantHome's poll-until-active; the hash lands the new
    // subscriber on the Subscription tab once it clears. Query before hash — MerchantHome reads
    // the query, the hash survives the param clear and deep-links the tab.
    success_url: `${env.frontendUrl}/merchant?checkout=success#settings/subscription`,
    cancel_url: `${env.frontendUrl}/merchant/signup?plan=${plan}&billing=${billing}&canceled=1`,
  })

  return c.json({ url: session.url })
})

// ── Reconcile the signed-in merchant's own subscription from Stripe ────────────
// The recovery path for the route above. Checkout redirects to `?checkout=success`, and until
// this existed the only thing that could open the shop behind that redirect was one delivery of
// `checkout.session.completed` — so a webhook that never arrived left a merchant who had just
// been charged staring at "Setting up your subscription…" with nothing on either side able to
// move it. billingSync.ts holds the rule; see its header for why the sweep does not cover this.
//
// Rate-limited per SHOP rather than per IP: it costs a Stripe API call and its only legitimate
// caller is one dashboard retrying for a few seconds. Ten a minute is far above that and far
// below anything worth Stripe's notice.
const billingSyncWindow = createSlidingWindow({ limit: 10, windowMs: 60_000, now: () => Date.now() })

app.post('/api/billing/sync', requireOwnMerchant, async (c) => {
  const merchant = c.get('merchant')
  if (!billingSyncWindow.allow(merchant.id)) return c.json({ error: 'rate_limited' }, 429)
  try {
    return c.json(await syncMerchantBilling(merchant.id, merchant.status))
  } catch (err) {
    if (isStripeError(err)) return stripeFailed(c, `billing sync for merchant ${merchant.id}`, err)
    console.error(`Billing sync failed for merchant ${merchant.id}:`, err instanceof Error ? err.message : String(err))
    return c.json({ error: 'sync_failed' }, 500)
  }
})

// ── Superadmin: push a stuck merchant through to active ────────────────────────
// Signup provisions its own trial now (POST /api/merchants), so this is no longer a gate
// anybody waits at — it is the admin-side fallback for a shop parked at `pending` because
// Stripe refused during signup and the merchant never retried. Same rule, different caller:
// trialSubscription.ts holds it.
//
// Unlike the owner's retry below, this ACTIVATES a shop it cannot re-trial (`canStartTrial`
// false → `{ ok: true, trial: false }`): an admin pushing a shop through means "open this shop",
// and the one-trial-ever rule limits the trial, not the activation.
app.post('/api/admin/approve-merchant', requireSuperadmin, async (c) => {
  const { merchantId } = await c.req.json().catch(() => ({}))
  if (!merchantId) return c.json({ error: 'Missing merchantId' }, 400)

  // These reads are independent — the target merchant + its billing load in parallel.
  // merchant_billing keys on the merchants PK, so both use merchantId directly. Run them
  // concurrently to save cross-network round-trips (Railway → Supabase); requireSuperadmin
  // has already gated the caller before this handler runs.
  const [merchantRes, billingRes] = await Promise.all([
    admin
      .from('merchants')
      .select('id, name, status, plan, billing_cycle, owner_id')
      .eq('id', merchantId)
      .maybeSingle(),
    admin.from('merchant_billing').select('*').eq('merchant_id', merchantId).maybeSingle(),
  ])

  const { data: merchant, error } = merchantRes
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  if (!merchant) return c.json({ error: 'Merchant not found' }, 404)

  const refusal = trialStartRefusal(merchant)
  if (refusal) return c.json({ error: refusal }, 409)

  const outcome = await startCardlessTrial(merchant, billingRes.data)
  if (!outcome.ok) return c.json({ error: outcome.error }, outcome.http)
  return c.json({ ok: true, trial: outcome.trial })
})

// ── Owner: retry trial provisioning for a shop parked at `pending` ─────────────
// The self-serve twin of approve-merchant above. `pending` means "provisioning did not finish"
// now, which is a Stripe failure during signup — so the merchant, not an admin, is who should
// be able to push it through.
//
// Every guard runs BEFORE the first Stripe call. That is what makes them assertable in
// tests/api, which is network-free, and it is why one-trial-ever is checked HERE rather than
// left to startCardlessTrial: that function deliberately activates a shop it cannot re-trial
// (approval's semantics), which is not what an owner asking for a trial should be handed.
app.post('/api/merchants/:id/start-trial', requireMerchantOwns, async (c) => {
  const merchant = c.get('merchant') // loaded by the guard with select('*')

  const refusal = trialStartRefusal(merchant)
  if (refusal) return c.json({ error: refusal }, 409)

  const { data: billing } = await admin
    .from('merchant_billing').select('*').eq('merchant_id', merchant.id).maybeSingle()
  if (!canStartTrial(billing)) {
    return c.json({ error: 'This shop has already used its free trial — subscribe to reopen it.' }, 409)
  }

  // Named rather than spread: `c.get('merchant')` is the whole row as `Record<string, any>`, and
  // listing the five columns the provisioning actually reads is what keeps that untyped bag from
  // reaching it.
  const outcome = await startCardlessTrial({
    id: merchant.id,
    name: merchant.name,
    owner_id: merchant.owner_id,
    plan: merchant.plan,
    billing_cycle: merchant.billing_cycle,
  }, billing)
  if (!outcome.ok) return c.json({ error: outcome.error }, outcome.http)
  return c.json({ ok: true, trial: outcome.trial })
})

// ── Superadmin: manual suspend / reject / reactivate ───────────────────────────
// merchants.status is service_role-only at the DB layer (guard_merchant_status),
// so the admin console can no longer flip it through PostgREST — these writes must
// come through here. Covers Reject (pending→suspended), Suspend (active→suspended),
// and Reactivate (suspended→active). Trial-granting stays in approve-merchant and its
// owner-side twin.
app.post('/api/admin/set-merchant-status', requireSuperadmin, async (c) => {
  const { merchantId, status } = await c.req.json().catch(() => ({}))
  if (!merchantId) return c.json({ error: 'Missing merchantId' }, 400)
  // 'pending' is never a manual target — it is reached only by revert paths.
  if (status !== 'active' && status !== 'suspended') {
    return c.json({ error: 'status must be active or suspended' }, 400)
  }

  const { data: merchant } = await admin
    .from('merchants').select('id').eq('id', merchantId).maybeSingle()
  if (!merchant) return c.json({ error: 'Merchant not found' }, 404)

  try {
    await setMerchantStatus(merchantId, status)
  } catch (err) {
    console.error('set-merchant-status failed:', err instanceof Error ? err.message : String(err))
    return c.json({ error: 'Status update failed' }, 500)
  }
  return c.json({ ok: true, status })
})

// ── Superadmin: flag/unflag a merchant for the landing-page sample-shops carousel (#107) ──────
// Pure flag flip — no billing/status side effects, unlike comp/uncomp. GET /api/merchants/samples
// is what actually reads it.
app.post('/api/admin/set-merchant-sample', requireSuperadmin, async (c) => {
  const { merchantId, isSample } = await c.req.json().catch(() => ({}))
  if (!merchantId || typeof isSample !== 'boolean') {
    return c.json({ error: 'Missing merchantId or isSample' }, 400)
  }

  const { data: merchant } = await admin
    .from('merchants').select('id').eq('id', merchantId).maybeSingle()
  if (!merchant) return c.json({ error: 'Merchant not found' }, 404)

  const { error } = await admin.from('merchants').update({ is_sample: isSample }).eq('id', merchantId)
  if (error) {
    console.error('set-merchant-sample failed:', error.message)
    return c.json({ error: 'Update failed' }, 500)
  }
  return c.json({ ok: true, isSample })
})

// ── Superadmin: comp a merchant to free Pro (no Stripe payment) ────────────────
// Grants active + pro without any Stripe subscription — for partners, staff, and
// promo shops. Writes an 'active' billing row with a far-future period end and no
// trial, so the trial/past-due banners stay silent and nothing expires the shop.
// The shop is decoupled from Stripe: it has no real subscription, so the
// webhook-driven suspension path never touches it. Revoke with
// `/api/admin/uncomp-merchant`, which clears the flag and drops the shop to Basic
// without touching its status — suspension is a separate decision.
app.post('/api/admin/comp-merchant', requireSuperadmin, async (c) => {
  const { merchantId } = await c.req.json().catch(() => ({}))
  if (!merchantId) return c.json({ error: 'Missing merchantId' }, 400)

  const { data: merchant } = await admin
    .from('merchants').select('id').eq('id', merchantId).maybeSingle()
  if (!merchant) return c.json({ error: 'Merchant not found' }, 404)

  // Refuse a shop that is actually paying. Comping it would leave Stripe billing a card while
  // the local row claims the shop is free — and the customer id this route clears is the only
  // pointer back to that subscription. Cancel in Stripe first, then comp.
  const { data: existingBilling } = await admin
    .from('merchant_billing')
    .select('stripe_subscription_id, status')
    .eq('merchant_id', merchantId)
    .maybeSingle()
  if (existingBilling?.stripe_subscription_id
      && LIVE_STATUSES.includes(existingBilling.status ?? '')) {
    return c.json({ error: 'has_live_subscription' }, 409)
  }

  // Activate + mark pro. Service role bypasses the guard_merchant_status trigger.
  const { error: mErr } = await admin
    .from('merchants').update({ status: 'active', plan: 'pro' }).eq('id', merchantId)
  if (mErr) {
    console.error('comp-merchant merchants update failed:', mErr.message)
    return c.json({ error: 'Comp failed' }, 500)
  }

  // Mark the comp and silence the billing banners: active status, far-future period end, no
  // trial. `stripe_customer_id` is cleared — on a comped shop it points at nothing we will ever
  // call, and a stale one is exactly what sent a dead id to Stripe and answered 502.
  // `stripe_subscription_id` is deliberately KEPT: canStartTrial reads it as the one-trial-ever
  // record, and clearing it would hand a previously-subscribed shop a fresh trial.
  try {
    const farFuture = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString()
    await upsertBilling(merchantId, {
      comped: true,
      stripe_customer_id: null,
      status: 'active',
      trial_ends_at: null,
      current_period_end: farFuture,
    })
  } catch (err) {
    console.error('comp-merchant billing upsert failed:', err instanceof Error ? err.message : String(err))
    return c.json({ error: 'Comp failed' }, 500)
  }

  return c.json({ ok: true })
})

// ── Superadmin: revoke a comp ──────────────────────────────────────────────────
// Clears the flag and drops the shop to Basic. Deliberately does not touch `merchants.status`:
// suspension is a separate decision, and conflating the two is what makes a temporary suspension
// silently end a comp — or a later reactivation silently hand free Pro back.
//
// The billing row is wound back to "no subscription" (`status` and `current_period_end` null),
// which is what leaves the shop ABLE TO PAY. Those two are comp's own writes, not Stripe's: a
// comped row has no subscription behind it, so `status: 'active'` is a claim only this endpoint
// ever made. Leaving it strands the shop twice over — `/api/checkout` refuses anything in
// LIVE_STATUSES with "this shop already has an active subscription", naming a subscription that
// does not exist, and a re-comp trips the has_live_subscription precondition whenever a dead
// `stripe_subscription_id` survived the first comp.
app.post('/api/admin/uncomp-merchant', requireSuperadmin, async (c) => {
  const { merchantId } = await c.req.json().catch(() => ({}))
  if (!merchantId) return c.json({ error: 'Missing merchantId' }, 400)

  const { data: merchant } = await admin
    .from('merchants').select('id').eq('id', merchantId).maybeSingle()
  if (!merchant) return c.json({ error: 'Merchant not found' }, 404)

  const { error: mErr } = await admin
    .from('merchants').update({ plan: 'basic' }).eq('id', merchantId)
  if (mErr) {
    console.error('uncomp-merchant merchants update failed:', mErr.message)
    return c.json({ error: 'Un-comp failed' }, 500)
  }

  try {
    await upsertBilling(merchantId, { comped: false, status: null, current_period_end: null })
  } catch (err) {
    console.error('uncomp-merchant billing upsert failed:', err instanceof Error ? err.message : String(err))
    return c.json({ error: 'Un-comp failed' }, 500)
  }

  return c.json({ ok: true })
})

/**
 * The one shape a failed Stripe call takes across the billing routes.
 *
 * Left unwrapped, a Stripe rejection throws past Hono and reaches the dashboard as a bare
 * `Internal Server Error` with an empty server log — indistinguishable from a bug in our own
 * code, which is exactly why a stale `stripe_customer_id` in a local database cost a session to
 * identify. 502 rather than 500: the request was well-formed and the caller can retry; it was
 * the upstream that refused.
 *
 * Only ever reached via `isStripeError`, so "the payment provider is down" is never said about
 * one of our own exceptions.
 */
function stripeFailed(c: Context<AppEnv>, where: string, err: unknown) {
  console.error(`Stripe ${where} failed:`, err instanceof Error ? err.message : String(err))
  return c.json({ error: 'stripe_unavailable' }, 502)
}

// ── Stripe billing portal for the signed-in merchant ───────────────────────────
// Where a trialing merchant adds their card, and a past_due one updates it.
// Requires the portal to be enabled once in the Stripe Dashboard.
app.post('/api/billing/portal', requireOwnMerchant, async (c) => {
  const merchant = c.get('merchant')
  const { data: billing } = await admin
    .from('merchant_billing').select('stripe_customer_id, comped').eq('merchant_id', merchant.id).maybeSingle()
  // The bug this whole change exists for. A comped shop has no Stripe customer to open a portal
  // against; before the flag existed it had a stale one, and this route sent it to Stripe.
  if (billing?.comped) return c.json({ error: 'shop_is_comped' }, 409)
  if (!billing?.stripe_customer_id) return c.json({ error: 'No billing account yet' }, 404)
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: billing.stripe_customer_id,
      // Back to the Subscription tab the merchant left from, not the dashboard root — the portal is
      // only ever opened from there, so Overview is a lost-your-place jump. The hash deep-links via
      // useDashboardSection/Subsection (`#settings/subscription`).
      return_url: `${env.frontendUrl}/merchant#settings/subscription`,
    })
    return c.json({ url: session.url })
  } catch (err) {
    // The two live ones: a `stripe_customer_id` Stripe has never heard of (seed data, or a key
    // rotated to a different account), and the portal not being enabled in the Dashboard.
    if (isStripeError(err)) return stripeFailed(c, `portal session for merchant ${merchant.id}`, err)
    throw err
  }
})

// ── Downgrade and cancellation ─────────────────────────────────────────────────
// ADR 0004 chose the Customer Portal over calling Stripe ourselves, and that still holds for the
// UPGRADE: a mid-period tier increase is a proration argument, and the portal is a screen built
// to have it. These three are the exception, for one reason — they all land on a period
// boundary. `cancel_at_period_end` is a flag, and the downgrade is scheduled with
// `proration_behavior: 'none'`, so no money moves and there is nothing for a payment screen to
// explain. What is gained is the thing the portal cannot give: telling a merchant, in their own
// dashboard and in their own language, that cancelling suspends their shop on a named date.
//
// Stripe remains authoritative. Each route writes the outcome back to `merchant_billing`
// immediately so the tab does not lie for the seconds before the webhook lands, but
// `customer.subscription.updated` is what confirms it, and the tier itself moves only through
// `reconcileMerchantPlan`.

/** The signed-in merchant's live subscription, or the response explaining why there isn't one. */
async function liveSubscription(c: Context<AppEnv>) {
  // Caller and shop are `requireOwnMerchant`'s job — every route that calls this chains it.
  const merchant = c.get('merchant')
  const { data: billing } = await admin
    .from('merchant_billing')
    .select('stripe_subscription_id, status, comped')
    .eq('merchant_id', merchant.id).maybeSingle()
  // Ahead of the gate below, which a comped row passes on both terms: comp keeps
  // stripe_subscription_id (canStartTrial's one-trial-ever record) and leaves status 'active'.
  // Without this, cancel/downgrade/resume would act on an id that is dead or belongs to a real
  // cancelled subscription.
  if (billing?.comped) return { res: c.json({ error: 'shop_is_comped' }, 409) }
  // 409 rather than 404: the shop is fine, the request just does not apply to it. The
  // Subscription tab hides these buttons in that state, so this is the long-open-tab case.
  if (!billing?.stripe_subscription_id || !LIVE_STATUSES.includes(billing.status ?? '')) {
    return { res: c.json({ error: 'no_live_subscription' }, 409) }
  }
  return { merchantId: merchant.id, subscriptionId: billing.stripe_subscription_id }
}

/**
 * Drop any scheduled phase change and hand the subscription back to itself.
 *
 * Releasing rather than cancelling is load-bearing: `subscriptionSchedules.cancel()` cancels the
 * SUBSCRIPTION the schedule drives, which would end the shop's billing outright. `release()`
 * detaches the schedule and leaves the subscription running exactly as it is.
 */
async function releaseSchedule(subscriptionId: string) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId)
  const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id
  if (!scheduleId) return
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId)
  // A schedule that already ran (or was released) cannot be released again, and saying so would
  // turn "undo my downgrade" into an error for a merchant whose downgrade has already happened.
  if (schedule.status === 'active' || schedule.status === 'not_started') {
    await stripe.subscriptionSchedules.release(scheduleId)
  }
}

// Step down to Basic at the end of the period already paid for. Never immediate: the merchant
// has been charged for Pro through this period, and taking the features now would drop live
// vouchers under customers mid-checkout.
app.post('/api/billing/downgrade', requireOwnMerchant, async (c) => {
  const found = await liveSubscription(c)
  if ('res' in found) return found.res
  const { merchantId, subscriptionId } = found

  // The whole exchange with Stripe under one guard. The 409s below are ordinary returns, not
  // throws, so wrapping the body does not swallow them, and `isStripeError` in the catch keeps
  // our own exceptions (a ScheduleError re-thrown, a bug in downgradePhases) propagating as the
  // 500s they are.
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId)
    if (sub.cancel_at_period_end) {
      // The subscription is already ending. Scheduling a tier for a period that will never be
      // billed is meaningless, and doing it silently would read as having un-cancelled.
      return c.json({ error: 'subscription_ending' }, 409)
    }

    const currentPriceId = sub.items?.data?.[0]?.price?.id ?? ''
    const tier = planFromPriceId(env.prices, currentPriceId)
    // An unrecognised price is the same no-op it is in reconcileMerchantPlan — we cannot say what
    // the Basic equivalent of a price we did not configure is, and guessing moves real money.
    if (!tier) return c.json({ error: 'unknown_price' }, 409)
    if (tier.plan === 'basic') return c.json({ error: 'already_basic' }, 409)

    // Wrapping the live subscription in a schedule copies its current phase verbatim; reusing an
    // existing schedule matters because `from_subscription` errors on a subscription that already
    // has one (a second downgrade request, or a retry after a failed write below).
    const existingId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id
    const schedule = existingId
      ? await stripe.subscriptionSchedules.retrieve(existingId)
      : await stripe.subscriptionSchedules.create({ from_subscription: subscriptionId })

    let phases
    try {
      phases = downgradePhases(schedule.phases[0] as unknown as LivePhase, priceFor('basic', tier.cycle))
    } catch (err) {
      if (err instanceof ScheduleError) {
        console.warn(`Downgrade refused for merchant ${merchantId}: ${err.message}`)
        return c.json({ error: 'cannot_schedule' }, 409)
      }
      throw err
    }

    await stripe.subscriptionSchedules.update(schedule.id, {
      phases,
      // Once the Basic period has been billed the schedule lets go, leaving an ordinary
      // subscription at the new price rather than one permanently driven by a schedule.
      end_behavior: 'release',
    })
  } catch (err) {
    if (isStripeError(err)) return stripeFailed(c, `downgrade for merchant ${merchantId}`, err)
    throw err
  }

  // Intent only. `merchants.plan` is untouched — the shop keeps the Pro it paid for until
  // `reconcileMerchantPlan` sees the price actually change.
  await upsertBilling(merchantId, { pending_plan: 'basic' })
  return c.json({ ok: true, pendingPlan: 'basic' })
})

// End the subscription when the current period runs out. The shop stays open and fully
// functional until then; `customer.subscription.deleted` is what suspends it.
app.post('/api/billing/cancel', requireOwnMerchant, async (c) => {
  const found = await liveSubscription(c)
  if ('res' in found) return found.res
  const { merchantId, subscriptionId } = found

  let sub
  try {
    // Cancelling supersedes a scheduled downgrade — there is no period after this one for a new
    // tier to apply to, and Stripe refuses to set the flag while a schedule drives the
    // subscription. Released first so the two intents can never both be pending.
    await releaseSchedule(subscriptionId)
    sub = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true })
  } catch (err) {
    if (isStripeError(err)) return stripeFailed(c, `cancel for merchant ${merchantId}`, err)
    throw err
  }

  await upsertBilling(merchantId, { ...billingFromSubscription(sub), pending_plan: null })
  return c.json({ ok: true, endsAt: billingFromSubscription(sub).current_period_end })
})

// Undo whichever wind-down is pending — a cancellation, a scheduled downgrade, or both. One
// route because it answers one question ("keep things as they are"), and because leaving a
// merchant to undo two pending changes in two clicks is how one of them gets forgotten.
app.post('/api/billing/resume', requireOwnMerchant, async (c) => {
  const found = await liveSubscription(c)
  if ('res' in found) return found.res
  const { merchantId, subscriptionId } = found

  let sub
  try {
    await releaseSchedule(subscriptionId)
    sub = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false })
  } catch (err) {
    if (isStripeError(err)) return stripeFailed(c, `resume for merchant ${merchantId}`, err)
    throw err
  }

  await upsertBilling(merchantId, { ...billingFromSubscription(sub), pending_plan: null })
  return c.json({ ok: true })
})

// ── Customer sign-up — creates the account pre-confirmed ───────────────────────
// Email confirmation stays ON project-wide (it is shared with merchants, who own shops
// and Stripe billing), so a client-side signUp returns no session and strands a customer
// in their inbox holding a cart. Created here with the service role instead, pre-confirmed,
// and the client signs in normally. See src/customerSignup.ts for what that costs.
//
// RATE LIMITING — read before touching the deploy shape:
// The window below lives in this process's memory. That works only because the backend is
// a long-lived Node process (`node dist/server.js` + @hono/node-server), and it comes with
// two consequences:
//   • it resets on redeploy — harmless;
//   • it SILENTLY STOPS PROTECTING ANYTHING if the backend is ever scaled past one
//     instance, or moved to serverless. Each instance would count its own hits, and this
//     endpoint goes around Supabase's own sign-up rate limits by design. If that day comes,
//     move the counter to a shared store (or put a captcha in front).
// CORS is not the guard: /api/* is pinned to env.frontendUrl, but that only constrains
// browsers — any server can POST here. The rate limit is the control.
// Escalation, if abuse ever actually happens, is a captcha — deliberately not now, because
// a captcha widget in the checkout path costs orders.
const signupIpWindow = createSlidingWindow({ limit: 10, windowMs: 60 * 60_000, now: () => Date.now() })
const signupEmailWindow = createSlidingWindow({ limit: 3, windowMs: 60 * 60_000, now: () => Date.now() })

// quoteIpWindow and quoteMerchantWindow moved to quotaWindows.ts — order intake shares
// quoteMerchantWindow, see that module's header.

// Bounds the Places proxy by caller IP. BOTH routes draw on this one bucket.
//
// 300/hour, deliberately five times `quoteIpWindow` above, because the two endpoints are called
// nothing alike: a quote happens ONCE per address the customer selects, while suggest fires per
// burst of typing — one address entry is realistically four to eight suggests plus one detail.
// At 60 this would be about six address entries per hour per IP, and behind carrier-grade NAT or
// a mall's wifi (most Malaysian mobile traffic, and this is a Malaysian platform) dozens of
// unrelated customers share one address. They would exhaust it in minutes, and the failure is
// silent and fatal: the address box returns nothing and the customer cannot place a delivery
// order at all.
//
// Raising a REQUEST ceiling does not raise the bill proportionally, because the billable unit is
// the SESSION: a burst of keystrokes carrying one session token, ending in a details call, bills
// as one lookup. Same in-memory limiter weaknesses as everything else here, inherited knowingly.
const placesIpWindow = createSlidingWindow({ limit: 300, windowMs: 60 * 60_000, now: () => Date.now() })

/** The caller's IP, from the proxy headers with the socket as the local-dev fallback. */
function ipOf(c: { req: { header: (n: string) => string | undefined }; env: unknown }): string {
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming
  return clientIp(
    { 'x-forwarded-for': c.req.header('x-forwarded-for'), 'cf-connecting-ip': c.req.header('cf-connecting-ip') },
    incoming?.socket?.remoteAddress,
  )
}

// ── Referred shops ────────────────────────────────────────────────────────────
// Replaces the my_referred_shops SECURITY DEFINER function. That function could read
// across tenants — it had to, since a referrer's shops are not their own — and was safe
// only because it filtered on a code derived from auth.uid(), which the caller could not
// choose. The same property holds here: the code comes from the verified JWT and from
// nothing else. Do not add a code parameter to this route.
app.get('/api/referrals/shops', requireUser, async (c) => {
  const user = c.get('user')

  return c.json(await listReferredShops(user.id))
})

// The referral rewards this member has earned. Same JWT-derived scoping as /shops — the
// caller's merchant comes from the verified token, never the request.
app.get('/api/referrals/rewards', requireUser, async (c) => {
  const user = c.get('user')

  return c.json(await listEarnedRewards(user.id))
})

// The GitHub adapter, held mutable so tests can capture what would be sent without a live
// network — same pattern as notifyDeps below. Production uses the real fetch adapters.
export const githubDeps: {
  createIssue: CreateGithubIssue
  closeIssue: GithubIssueAction
  reopenIssue: GithubIssueAction
} = {
  createIssue: createGithubIssue,
  closeIssue: closeGithubIssue,
  reopenIssue: reopenGithubIssue,
}

// ── Merchant platform feedback (#89) ────────────────────────────────────────────
// Per-user, not per-IP: the route is authenticated, so the user id is the real actor and
// is not spoofable behind a shared NAT the way an IP is. The check runs BEFORE validation
// so a script cannot hammer the write path with malformed bodies for free; a merchant
// cannot realistically hit twenty submissions an hour by accident, and the form enforces
// both rules client-side, so a 400 arriving here is already the abnormal case.
//
// EXPORTED for tests/api/feedback.test.ts, which fills the bucket by calling `allow()`
// directly rather than by paying for twenty real HTTP round-trips against Postgres. That
// loop had no wall-clock headroom and flaked as the DB suite grew (#147); what the test is
// actually about is that THIS ROUTE consults THIS window under the caller's user id, which
// one real submission proves as well as twenty. Nothing else may import it.
export const feedbackWindow = createSlidingWindow({ limit: 20, windowMs: 60 * 60_000, now: () => Date.now() })

app.post('/api/merchants/:id/feedback', requireMerchantOwns, async (c) => {
  const user = c.get('user')
  const merchant = c.get('merchant')

  if (!feedbackWindow.allow(user.id)) {
    return c.json({ error: 'Too many feedback submissions. Please try again later.' }, 429)
  }

  const parsed = validateFeedback(await c.req.json().catch(() => ({})))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  // merchant.id comes from the route the middleware already verified; user.id from the
  // JWT. Neither is ever read from the body — see tests/api/feedback.test.ts.
  const row = await insertFeedback({ merchantId: merchant.id, userId: user.id, draft: parsed.value })

  // Best-effort (github.ts). Never changes what the merchant gets back — the row below is
  // the same whether or not this succeeds.
  const issue = await githubDeps.createIssue(env.githubToken, {
    title: buildIssueTitle(parsed.value.category, merchant.name),
    body: buildIssueBody({
      message: parsed.value.message,
      shopName: merchant.name,
      shopSlug: merchant.slug,
      feedbackId: row.id,
      createdAt: row.created_at,
    }),
    labels: ['needs-triage', categoryToLabel(parsed.value.category)],
  })
  if (issue) await updateFeedbackGithubIssue(row.id, issue)

  return c.json(row, 201)
})

app.get('/api/admin/feedback', requireSuperadmin, async (c) => {
  const status = c.req.query('status')
  if (status !== undefined && !isFeedbackStatus(status)) {
    return c.json({ error: 'Unknown feedback status' }, 400)
  }
  return c.json(await listFeedback(status))
})

app.patch('/api/admin/feedback/:feedbackId', requireSuperadmin, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { status?: unknown }
  if (!isFeedbackStatus(body.status)) return c.json({ error: 'Unknown feedback status' }, 400)

  const row = await updateFeedbackStatus(c.req.param('feedbackId'), body.status)
  if (!row) return c.json({ error: 'Feedback not found' }, 404)

  // Best-effort keep-in-sync (github.ts). The dashboard's status is authoritative either way.
  if (row.github_issue_number) {
    const action = body.status === 'resolved' ? githubDeps.closeIssue : githubDeps.reopenIssue
    await action(env.githubToken, row.github_issue_number)
  }

  return c.json(row)
})

// Same pattern as githubDeps: held mutable so tests can capture what would be sent to GitHub
// and Claude without a live network call. Production uses the real fetch/SDK adapters.
export const releaseDeps: {
  listReleases: ListGithubReleases
  humanize: HumanizeRelease
} = {
  listReleases: listGithubReleases,
  humanize: humanizeRelease,
}

// ── Release notes (#163) ────────────────────────────────────────────────────
// Superadmin-triggered pull, not a live fetch or a cron sweep — pulling humanizes via Claude and
// stores drafts; a release only reaches merchants once explicitly published. See
// docs/superpowers/specs/2026-08-05-github-release-notes-design.md.

// Shared by /pull and /regenerate: best-effort, like every other call through releaseDeps.humanize
// — a missing key or a Claude outage is recorded as humanize_error, never a failed request.
async function humanizeAndStore(row: { id: string; tag: string; name: string; raw_body: string }) {
  const humanized = await releaseDeps.humanize(env.anthropicApiKey, {
    tag: row.tag,
    name: row.name,
    body: row.raw_body,
  })
  if (humanized) await updateReleaseHumanization(row.id, humanized)
  else await updateReleaseHumanization(row.id, { error: 'Claude could not summarize this release' })
}

app.post('/api/admin/releases/pull', requireSuperadmin, async (c) => {
  const fetched = await releaseDeps.listReleases(env.githubToken, 10)
  if (fetched === null) return c.json({ error: 'Could not reach GitHub' }, 502)

  const existingTags = new Set(await listReleaseTags())
  const toPull = fetched.filter((r) => !existingTags.has(r.tag_name))

  let pulled = 0
  for (const release of toPull) {
    const row = await insertDraftRelease({
      tag: release.tag_name,
      name: release.name,
      htmlUrl: release.html_url,
      rawBody: release.body,
      publishedAt: release.published_at,
    })
    await humanizeAndStore(row)
    pulled++
  }

  return c.json({ pulled })
})

app.get('/api/admin/releases', requireSuperadmin, async (c) => {
  return c.json(await listAllReleases())
})

app.patch('/api/admin/releases/:id', requireSuperadmin, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { status?: unknown }
  if (body.status !== 'draft' && body.status !== 'published') {
    return c.json({ error: 'Unknown release status' }, 400)
  }
  const row = await updateReleaseStatus(c.req.param('id'), body.status)
  if (!row) return c.json({ error: 'Release not found' }, 404)
  return c.json(row)
})

app.post('/api/admin/releases/:id/regenerate', requireSuperadmin, async (c) => {
  const row = await getReleaseById(c.req.param('id'))
  if (!row) return c.json({ error: 'Release not found' }, 404)

  await humanizeAndStore(row)

  return c.json(await getReleaseById(row.id))
})

app.get('/api/releases', async (c) => {
  return c.json(await listPublishedReleases(10))
})

app.get('/api/releases/:tag', async (c) => {
  const row = await getPublishedReleaseByTag(c.req.param('tag'))
  if (!row) return c.json({ error: 'Release not found' }, 404)
  return c.json(row)
})

// ── Trial feedback (#155) ───────────────────────────────────────────────────────
// One-time, platform-initiated survey — see CONTEXT.md → Trial feedback. requireOwnMerchant
// scopes every route to the caller's own shop; there is no :id to name a different one.

app.get('/api/trial-feedback', requireOwnMerchant, async (c) => {
  const merchant = c.get('merchant')
  return c.json(await getOwnTrialFeedback(merchant.id))
})

app.post('/api/trial-feedback/respond', requireOwnMerchant, async (c) => {
  const merchant = c.get('merchant')
  const parsed = validateTrialFeedback(await c.req.json().catch(() => ({})))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  const result = await respondTrialFeedback(merchant.id, parsed.value)
  if (!result.ok) return c.json({ error: result.reason }, result.reason === 'not_found' ? 404 : 409)
  return c.json(result.row)
})

app.post('/api/trial-feedback/skip', requireOwnMerchant, async (c) => {
  const merchant = c.get('merchant')
  const result = await skipTrialFeedback(merchant.id)
  if (!result.ok) return c.json({ error: result.reason }, result.reason === 'not_found' ? 404 : 409)
  return c.json(result.row)
})

app.get('/api/admin/trial-feedback', requireSuperadmin, async (c) => {
  return c.json(await listTrialFeedbackForAdmin())
})

// Constant-time compare, guarding the length check first (a mismatched length would
// otherwise throw inside timingSafeEqual rather than answer false).
function safeEqualSecret(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Not user-authenticated — called by a GitHub Actions schedule (see
// .github/workflows/trial-feedback-sweep.yml), gated by a shared secret header instead.
// Fails CLOSED (503) when the secret is unset, matching the house rule that an optional,
// unset credential means a refusal, never an open door.
app.post('/api/internal/trial-feedback-sweep', async (c) => {
  if (!env.trialFeedbackSweepSecret) return c.json({ error: 'Sweep disabled' }, 503)
  const provided = c.req.header('x-sweep-secret') || ''
  if (!safeEqualSecret(provided, env.trialFeedbackSweepSecret)) return c.json({ error: 'Forbidden' }, 403)

  const due = await findDueTrials(new Date())
  let sentCount = 0
  for (const trial of due) {
    const claimed = await claimSend(trial.merchantId)
    if (!claimed) continue // a concurrent run already has it

    const { data: ownerUser } = await admin.auth.admin.getUserById(trial.ownerId)
    const ownerEmail = ownerUser?.user?.email
    if (!ownerEmail) {
      console.error(`trial-feedback sweep: no email for merchant ${trial.merchantId}, releasing claim`)
      await releaseSend(trial.merchantId)
      continue
    }

    try {
      const { subject, text } = buildTrialFeedbackEmail({
        shopName: trial.shopName,
        dashboardUrl: `${env.frontendUrl}/merchant`,
      })
      await trialFeedbackDeps.email(ownerEmail, subject, { text })
      sentCount++
    } catch (err) {
      console.error(
        `trial-feedback sweep: send failed for merchant ${trial.merchantId}, releasing claim:`,
        err instanceof Error ? err.message : String(err),
      )
      await releaseSend(trial.merchantId)
    }
  }

  return c.json({ due: due.length, sent: sentCount })
})

// Not user-authenticated — called by a GitHub Actions schedule (see
// .github/workflows/billing-sweep.yml), gated by a shared secret header instead. Fails CLOSED
// (503) when the secret is unset, matching trial-feedback-sweep's house rule.
//
// This is the backstop for a lost `customer.subscription.deleted`: see billingSweep.ts for why
// push-only subscription state was not survivable. Hourly rather than daily, because the thing it
// repairs is a shop that should be shut and is not.
app.post('/api/internal/billing-sweep', async (c) => {
  if (!env.billingSweepSecret) return c.json({ error: 'Sweep disabled' }, 503)
  const provided = c.req.header('x-sweep-secret') || ''
  if (!safeEqualSecret(provided, env.billingSweepSecret)) return c.json({ error: 'Forbidden' }, 403)

  return c.json(await runBillingSweep(new Date()))
})

const SAMPLE_SCREENSHOT_BUCKET = 'sample-shop-screenshots'
const MAX_SAMPLE_SCREENSHOT_BYTES = 3 * 1024 * 1024 // 3 MiB — same ceiling as the migration's file_size_limit

// Not user-authenticated — called by a GitHub Actions schedule (see
// .github/workflows/sample-shop-screenshot-sweep.yml), gated by a shared secret header instead.
// Fails CLOSED (503) when the secret is unset, matching trial-feedback-sweep's house rule.
app.post('/api/internal/sample-shop-screenshot/:merchantId', async (c) => {
  if (!env.sampleShopScreenshotSweepSecret) return c.json({ error: 'Sweep disabled' }, 503)
  const provided = c.req.header('x-sweep-secret') || ''
  if (!safeEqualSecret(provided, env.sampleShopScreenshotSweepSecret)) return c.json({ error: 'Forbidden' }, 403)

  const merchantId = c.req.param('merchantId')
  if (c.req.header('Content-Type') !== 'image/png') return c.json({ error: 'unsupported_type' }, 400)

  const buffer = await c.req.arrayBuffer()
  if (buffer.byteLength === 0) return c.json({ error: 'invalid_body' }, 400)
  if (buffer.byteLength > MAX_SAMPLE_SCREENSHOT_BYTES) return c.json({ error: 'too_large' }, 400)

  const { data: merchant } = await admin.from('merchants').select('id').eq('id', merchantId).maybeSingle()
  if (!merchant) return c.json({ error: 'Merchant not found' }, 404)

  const path = `${merchantId}.png`
  const { error } = await admin.storage
    .from(SAMPLE_SCREENSHOT_BUCKET)
    .upload(path, buffer, { contentType: 'image/png', upsert: true })
  if (error) {
    console.error('Sample shot upload failed:', error.message)
    return c.json({ error: 'upload_failed' }, 500)
  }

  await admin.from('merchants').update({ sample_screenshot_path: path }).eq('id', merchantId)
  return c.json({ ok: true })
})

app.post('/api/customer/signup', async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}))
  // Anything else the body carries — a role, a merchant_id — is ignored: only email and
  // password are read, createUser mints a plain auth user, and the profile row below pins
  // app_role itself. So this endpoint cannot manufacture a merchant or a superadmin.
  // @hono/node-server hangs the raw Node request off `c.env`, but types it as {} — the
  // socket address is the fallback when no proxy header is present (i.e. local dev).
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming
  const ip = clientIp(
    { 'x-forwarded-for': c.req.header('x-forwarded-for'), 'cf-connecting-ip': c.req.header('cf-connecting-ip') },
    incoming?.socket?.remoteAddress,
  )

  const result = await signUpCustomer(
    {
      allow: (kind, value) => (kind === 'ip' ? signupIpWindow : signupEmailWindow).allow(value),
      logError: (message) => console.error(message),
      createUser: async ({ email, password }) => {
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true, // pre-confirmed — regressing this reintroduces the mid-checkout dead end
        })
        if (error || !data?.user) {
          if (isDuplicateEmailError(error)) return { ok: false, reason: 'duplicate_email' }
          console.error('Customer createUser failed:', error?.message ?? 'no user returned')
          return { ok: false, reason: 'error' }
        }
        return { ok: true, userId: data.user.id }
      },
      writeProfile: async ({ userId, email }) => {
        // Mirrors the client's ensureGlobalProfile: the global profile is the row with a null
        // merchant_id, and the only unique index on user_id alone is partial, so upsert can't
        // target it — select, then insert if absent. Idempotent by design; the client repeats
        // this on SIGNED_IN as a safety net, and that repeat is also what fills referral_code
        // (derived client-side from the uid).
        //
        // app_role is written explicitly rather than left to the column default: this insert
        // runs as service_role, which guard_profile_privileges deliberately exempts
        // (20260627120300_guard_profile_privileges.sql), so the trigger that would otherwise
        // force 'customer' never fires here. Naming it keeps a future extra field from
        // silently minting a superadmin.
        const { data: existing } = await admin
          .from('profiles').select('id').eq('user_id', userId).is('merchant_id', null).maybeSingle()
        if (existing) return
        const { error } = await admin.from('profiles').insert({
          user_id: userId,
          name: email.split('@')[0],
          email,
          email_confirmed: true,
          app_role: 'customer',
          created_at: new Date().toISOString(),
        })
        if (error) throw new Error(error.message)
      },
    },
    { email, password, ip },
  )

  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ ok: true })
})

// ── Order intake — counter, voucher, PRICE and order in ONE transaction ───────
// The JWT is OPTIONAL: guest checkout is a first-class path and must keep working.
//
// The body carries a cart and the total the customer saw. It carries NO prices: every number
// on the order is derived from Postgres inside placeOrder. It used to carry `total`, which
// meant any client could POST total: 0 and have the order commit at zero.
//
// Attribution comes from the token and from nowhere else. `user_id` is never read from the
// body — see placeOrder's contract for why that is a security property rather than a tidiness
// one.
app.post('/api/orders', async (c) => {
  const bodyJson = await c.req.json().catch(() => null)
  if (!bodyJson || typeof bodyJson !== 'object') return c.json({ error: 'invalid_body' }, 400)

  const token = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '')
  // No token is a guest, not a rejection. A token that is present but bad is also a guest:
  // the alternative is a checkout that dies on an expired session the customer cannot see.
  const user = token ? await getUserFromToken(token) : null

  const b = bodyJson as Record<string, unknown>

  // A cart is ids → positive whole quantities, within the caps — `isCart` from @bitetime/shared
  // is the rule, and it is shared for the same reason the pricing is: the storefront stops the
  // customer AT those caps, so the UI cannot build a cart this door then refuses. A local copy
  // of the numbers here is a copy that can drift, and a drifted cap is a dead checkout — the
  // customer sees `invalid_body` with nothing to do about it.
  const quotedTotal = typeof b.quotedTotal === 'number' && Number.isFinite(b.quotedTotal)
    ? b.quotedTotal
    : null

  // An ALLOWLIST, not a string check: `mode` SELECTS THE SHIPPING FEE. Any unrecognised value
  // prices shipping at 0, so a free string is a client-chosen value that zeroes a fee — the same
  // hole as a client-supplied `total`, and `mode: 'sameday'` walked straight through it with an
  // address attached.
  //
  // Whether the SHOP offers the method it names is `placeOrder`'s call, not HTTP's — the same
  // split as the delivery region, allowlisted for shape here and refused there.
  const mode = b.mode === 'pickup' || b.mode === 'delivery' || b.mode === 'express' ? b.mode : null

  // A string or nothing. The SHAPE is checked here; whether the shop is actually taking that
  // date is `placeOrder`'s call, because the window is the shop's rule and not HTTP's — the
  // same split as `mode` (allowlisted here) versus the delivery region (refused there).
  const fulfilDate = typeof b.fulfilDate === 'string' ? b.fulfilDate : null

  if (
    typeof b.merchantId !== 'string' || !b.merchantId ||
    typeof b.customerName !== 'string' ||
    typeof b.customerWa !== 'string' ||
    // A number with no digits in it is not a number. The submit gate has always required one
    // and this door only checked the TYPE, so `customerWa: ''` placed a real order — a rule
    // the form enforced and the door did not. It matters more since #143: the phone is what
    // identifies a shop customer, so an order with no usable number belongs to nobody and
    // shows up only as an unattributed count. Refuse it where it is cheap to refuse.
    phoneKey(b.customerWa) === null ||
    mode === null ||
    !isCart(b.cart) ||
    quotedTotal === null
  ) {
    return c.json({ error: 'invalid_body' }, 400)
  }

  try {
    const result = await placeOrder({
      merchantId: b.merchantId,
      userId: user?.id ?? null,
      // The voucher's one-per-customer key. From the token, exactly like `userId`, and for
      // exactly the same reason: a body-supplied key is one the customer can simply change.
      userEmail: user?.email ?? null,
      customerName: b.customerName,
      customerWa: b.customerWa,
      mode,
      address: b.address ?? null,
      cart: b.cart as CartLine[],
      quotedTotal,
      voucherCode: typeof b.voucherCode === 'string' ? b.voucherCode : null,
      fulfilDate,
      // Lifted off the ADDRESS, not a sibling body field: it is a property of where the parcel
      // goes, and keeping the two together is what stops an address and a place id from
      // disagreeing. The distance itself is never read from the body — see placeOrder.
      destinationPlaceId: typeof (b.address as Record<string, unknown> | null)?.place_id === 'string'
        ? ((b.address as Record<string, unknown>).place_id as string)
        : null,
      // For the miss-path spend bound only (Finding 2, fix wave 2) — see PlaceOrderInput.
      callerIp: ipOf(c),
    })
    return c.json(result)
  } catch (err) {
    // A refusal the customer can act on — a closed shop, a spent voucher, a price that moved —
    // carries its code so the storefront can say which, and can offer the right retry. Anything
    // else is a bug, and must not be dressed up as a domain error the customer can "fix".
    if (err instanceof OrderError) {
      // `price_changed` carries the server's own clock alongside the refusal. This is what
      // actually closes the recovery loop (see /api/time above and serverClock.ts): a browser
      // whose sync fetch is persistently unreachable can still recover here, because the SAME
      // response that refuses the order also timestamps itself — no second endpoint to fail.
      // Scoped to this one code (not every OrderError) so the exact-body assertions the other
      // refusals already have in tests/api stay exact.
      const body: Record<string, unknown> = { error: err.code }
      if (err.code === 'price_changed') body.now = new Date().toISOString()
      // The status is a property of the code, and it lives with the code (`REFUSAL_STATUS` is a
      // TOTAL Record, so a new refusal cannot reach here without someone deciding its status).
      return c.json(body, REFUSAL_STATUS[err.code])
    }
    console.error('Order intake failed:', err instanceof Error ? err.message : String(err))
    return c.json({ error: 'order_failed' }, 500)
  }
})

// ── Payment proof — the customer's own screenshot of a completed transfer ─────────────────────
// Unauthenticated, exactly like POST /api/orders itself: guest checkout has no token to scope an
// RLS write against, and an order id is not a secret a client-side policy could gate on either —
// so this goes through the service-role client, the same shape order intake already uses. See
// docs/superpowers/specs/2026-08-04-payment-proof-upload-design.md.
const PAYMENT_PROOF_BUCKET = 'payment-proof'
// Same ceiling as MAX_PAYMENT_PROOF_BYTES/PAYMENT_PROOF_TYPES in store.ts and the migration's
// bucket config (20260804160000) — three copies by CLAUDE.md's rule (no shared build step across
// browser/server), one number.
const MAX_PAYMENT_PROOF_BYTES = 2 * 1024 * 1024
const PAYMENT_PROOF_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

app.post('/api/orders/:orderId/payment-proof', async (c) => {
  const orderId = c.req.param('orderId')
  const contentType = c.req.header('Content-Type') ?? ''
  const ext = PAYMENT_PROOF_EXT[contentType]
  if (!ext) return c.json({ error: 'unsupported_type' }, 400)

  const buffer = await c.req.arrayBuffer()
  if (buffer.byteLength === 0) return c.json({ error: 'invalid_body' }, 400)
  if (buffer.byteLength > MAX_PAYMENT_PROOF_BYTES) return c.json({ error: 'too_large' }, 400)

  let merchantId: string | null
  try {
    merchantId = await orderMerchantId(orderId)
  } catch (err) {
    console.error('Payment proof lookup failed:', err instanceof Error ? err.message : String(err))
    return c.json({ error: 'lookup_failed' }, 500)
  }
  if (!merchantId) return c.json({ error: 'not_found' }, 404)

  const path = `${merchantId}/${orderId}.${ext}`
  const { error } = await admin.storage
    .from(PAYMENT_PROOF_BUCKET)
    .upload(path, buffer, { contentType, upsert: true })
  if (error) {
    console.error('Payment proof upload failed:', error.message)
    return c.json({ error: 'upload_failed' }, 500)
  }

  await setOrderPaymentProof(orderId, path)
  return c.json({ ok: true })
})

// The two outbound adapters, held in a mutable object so tests can capture what
// would be sent without a live network. Production uses the real fetch adapters.
export const notifyDeps: { telegram: typeof telegramSend; email: typeof resendSend } = {
  telegram: telegramSend,
  email: resendSend,
}

// Same seam as notifyDeps/githubDeps: production sends real email, tests capture what would
// have been sent.
export const trialFeedbackDeps: { email: typeof resendSend } = { email: resendSend }

// ── Order notification — fans out to three recipients ──────────────────────────
// The customer is anonymous; abuse is bounded by requiring a real order and by the
// one-shot stamp each email arm claims. One post-commit event produces three
// independent, best-effort notices: the merchant's Telegram, the signed-in
// customer's confirmation email, and the shop owner's new-order email. None blocks
// or suppresses the others, and none touches the already-committed order.
//
// The three are NOT interchangeable, and the differences are deliberate:
//   * Telegram is Pro-only and undeduplicated — a repeat ping is merchant noise.
//   * The customer receipt is signed-in-only (a guest has no account, so no
//     recipient) and one-shot.
//   * The merchant email sends on EVERY plan and is one-shot. It exists because a
//     basic shop, having no Telegram, otherwise learned of an order by refreshing.
//
// `lang` selects the CUSTOMER email's presentation only (never identity or money),
// so a body-supplied value is acceptable; absent/invalid ⇒ English in the builder.
// It never reaches the merchant arm, whose surface is English by rule. No recipient
// is ever taken from the body — each is read from the order or the shop.
app.post('/api/notify/order', async (c) => {
  const { merchantId, orderNumber, lang } = await c.req.json().catch(() => ({}))
  const emailCfg = { frontendUrl: env.frontendUrl, emailFrom: env.emailFrom }
  // Concurrent, not sequential: the three are independent best-effort sends and a slow Telegram
  // call must not delay either email. Each returns its own result and never throws, so
  // Promise.all cannot reject — no channel blocks or suppresses another.
  const [telegram, email, merchantEmail] = await Promise.all([
    notifyOrderPlaced(admin, notifyDeps.telegram, { merchantId, orderNumber }),
    emailOrderConfirmation(admin, admin, notifyDeps.email, { merchantId, orderNumber, lang }, emailCfg),
    emailMerchantOrder(admin, admin, notifyDeps.email, { merchantId, orderNumber }, emailCfg),
  ])
  // 404 only when the order genuinely does not exist — which every arm agrees on, since each
  // looks the same row up. Otherwise 200 with the combined result: any channel skipping or
  // erroring is normal and the fire-and-forget caller ignores the body.
  if (
    telegram.error === 'order not found' &&
    email.error === 'order not found' &&
    merchantEmail.error === 'order not found'
  ) {
    return c.json({ telegram, email, merchantEmail }, 404)
  }
  return c.json({ telegram, email, merchantEmail })
})

// ── Distance delivery quote ───────────────────────────────────────────────────
// Unauthenticated on purpose: a guest checkout must be able to see its delivery fee, and guest
// checkout is a first-class path.
//
// It takes a PLACE ID rather than an address, and that is an API-shape decision with a cost
// behind it: a free-text field invites a caller to mint unlimited distinct destinations, and
// every distinct destination is a billable lookup on the platform's own Maps account. Note the
// shape is the deterrent, not a validation — any non-empty string is accepted, because place ids
// have no stable public format and a shape check would refuse legitimate addresses. What
// actually bounds the spend is the pair of limits below. (docs/adr/0001)
//
// A hit on `distance_quotes` is the normal case and costs nothing; the same row is what order
// intake reads a moment later, which is what makes the quote and the charge the same number.
app.post('/api/shipping/quote', async (c) => {
  const body = await c.req.json().catch(() => null)
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.merchantId !== 'string' || !b.merchantId || typeof b.placeId !== 'string' || !b.placeId) {
    return c.json({ error: 'invalid_body' }, QUOTE_REFUSAL_STATUS.invalid_body)
  }

  if (!quoteIpWindow.allow(ipOf(c))) return c.json({ error: 'rate_limited' }, QUOTE_REFUSAL_STATUS.rate_limited)

  const { data: merchant } = await admin
    .from('merchants')
    .select('id, currency, status, express_enabled, delivery_base_fee, delivery_rate_per_km, delivery_max_km, origin_place_id')
    .eq('id', b.merchantId)
    .maybeSingle()
  if (!merchant) return c.json({ error: 'merchant_not_found' }, QUOTE_REFUSAL_STATUS.merchant_not_found)
  if (merchant.status !== 'active') return c.json({ error: 'merchant_inactive' }, QUOTE_REFUSAL_STATUS.merchant_inactive)

  // `shopDistance`, not a local read of these columns: the storefront quotes from this exact
  // function and order intake charges from it, and a third reading here is a third rule the
  // customer meets as a `price_changed` refusal.
  const policy = shopDistance(merchant)
  // `not_distance_priced` keeps its wire name — the storefront already branches on it, and
  // renaming a refusal code is a separate, customer-visible change.
  if (!policy.enabled || !policy.usable) return c.json({ error: 'not_distance_priced' }, QUOTE_REFUSAL_STATUS.not_distance_priced)

  // The peek, the per-shop daily ceiling and the no-route / beyond-max-km mapping all live in
  // `resolveRoutedDistance`, shared with order intake so the number quoted here and the number
  // charged there cannot drift apart (#119). What is quote-specific stays here: the per-IP request
  // bound checked up front above (hits and misses alike — this endpoint spends money on a miss, so
  // it is bounded twice over), and the mapping of the wire-agnostic outcome to this endpoint's
  // refusal codes.
  const outcome = await resolveRoutedDistance(policy, b.placeId, liveDistanceDeps, new Date(), {
    merchantKey: merchant.id,
    merchantWindow: quoteMerchantWindow,
    // No `onMiss`: the per-IP bound is handled up front, not on the miss path.
  })

  // NO ROUTE AND OUT-OF-RANGE ARE THE SAME ANSWER to the customer — "this shop does not deliver
  // there" — because they are the same fact. Only `failed` invites a retry; `quota_exceeded` is
  // the shop's ceiling, which the storefront branches on separately.
  if (outcome.status === 'out_of_range') return c.json({ error: 'out_of_range' }, QUOTE_REFUSAL_STATUS.out_of_range)
  if (outcome.status === 'quota_exceeded') return c.json({ error: 'quota_exceeded' }, QUOTE_REFUSAL_STATUS.quota_exceeded)
  if (outcome.status === 'failed') return c.json({ error: 'lookup_failed' }, QUOTE_REFUSAL_STATUS.lookup_failed)

  const km = routedKm(outcome.metres)
  return c.json({ km, fee: distanceFee(policy, km), currency: merchant.currency ?? 'MYR' })
})

// ── Address autocomplete proxy ────────────────────────────────────────────────
// Proxied for ONE reason above all: the Maps credential must never reach the browser, where a
// key can be lifted off a page and spent elsewhere (#101, story 49).
//
// `session` is money, not hygiene: a burst of keystrokes carrying one token bills as a single
// lookup when it ends in a details call. The browser mints it and passes the SAME one to
// /api/places/detail.
//
// Unauthenticated, because a guest picking a delivery address has no session. Bounded by IP for
// the same reason the quote endpoint is: these calls cost the platform money.
app.get('/api/places/suggest', async (c) => {
  if (!placesIpWindow.allow(ipOf(c))) return c.json({ error: 'rate_limited' }, 429)
  // The per-IP window rotates away with a spoofed header (see the module comment on
  // `placesGlobalWindow`); this is the ceiling that actually holds.
  if (!placesGlobalWindow.allow('global')) {
    console.error('Places global quota exceeded on /api/places/suggest — investigate for abuse')
    return c.json({ error: 'rate_limited' }, 429)
  }
  const input = c.req.query('input') ?? ''
  const session = c.req.query('session') ?? ''
  // A short prefix is noise that still bills. Empty results, no call.
  if (input.trim().length < 3) return c.json({ suggestions: [] })
  return c.json({ suggestions: await googlePlaceSuggest(input, session) })
})

app.get('/api/places/detail/:placeId', async (c) => {
  if (!placesIpWindow.allow(ipOf(c))) return c.json({ error: 'rate_limited' }, 429)
  if (!placesGlobalWindow.allow('global')) {
    console.error('Places global quota exceeded on /api/places/detail — investigate for abuse')
    return c.json({ error: 'rate_limited' }, 429)
  }
  const placeId = c.req.param('placeId')
  // Same floor as `suggest`'s input check, missing here until now: place ids have no stable
  // public format, so this is a sanity guard against an empty or absurdly long value, not a
  // validation of shape.
  if (!placeId || placeId.length > 512) return c.json({ error: 'place_not_found' }, 404)
  const detail = await googlePlaceDetail(placeId, c.req.query('session') ?? '')
  if (!detail) return c.json({ error: 'place_not_found' }, 404)
  return c.json(detail)
})

// ── Stripe webhook — authoritative subscription state ──────────────────────────
app.post('/api/stripe/webhook', async (c) => {
  const sig = c.req.header('stripe-signature') || ''
  const raw = await c.req.text() // raw body required for signature verification

  let event
  try {
    event = stripe.webhooks.constructEvent(raw, sig, env.stripeWebhookSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err instanceof Error ? err.message : String(err))
    return c.json({ error: 'Invalid signature' }, 400)
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const merchantId = session.metadata?.merchant_id || session.client_reference_id
        if (merchantId && session.subscription) {
          const subscriptionId =
            typeof session.subscription === 'string' ? session.subscription : session.subscription.id
          const sub = await stripe.subscriptions.retrieve(subscriptionId)
          await upsertBilling(merchantId, billingFromSubscription(sub))
          // The tier comes from the price they just paid, not from what signup wrote (#112).
          // A body claiming `plan: 'pro'` that checked out at the basic price lands on basic.
          await reconcileMerchantPlan(merchantId, sub)
          await setMerchantStatus(merchantId, 'active')
        }
        break
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object
        const merchantId = sub.metadata?.merchant_id
        if (merchantId) {
          const fields = billingFromSubscription(sub)
          // The Customer Portal often stores an added card as the customer default
          // rather than on the subscription, leaving sub.default_payment_method null.
          // Resolve that so a merchant who added a card stops seeing the nag banner.
          if (!fields.has_payment_method) {
            const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
            const customer = await stripe.customers.retrieve(customerId)
            if (!('deleted' in customer) && customer.invoice_settings?.default_payment_method) {
              fields.has_payment_method = true
            }
          }
          await upsertBilling(merchantId, fields)
          // This is the plan-switch path: the Customer Portal swaps the price and Stripe fires
          // this event, so the tier follows the money (#112). Also repairs `billing_cycle`,
          // which a monthly↔yearly switch in the portal used to leave stale.
          await reconcileMerchantPlan(merchantId, sub)
        }
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object
        const merchantId = sub.metadata?.merchant_id
        if (merchantId) {
          // Only the CURRENT subscription's cancellation suspends the shop — a
          // stale or replaced subscription (e.g. the old trial after the shop
          // reactivated via Checkout) must not re-suspend a paying merchant or
          // clobber the billing row.
          const { data: current } = await admin
            .from('merchant_billing')
            .select('stripe_subscription_id')
            .eq('merchant_id', merchantId)
            .maybeSingle()
          if (current?.stripe_subscription_id && current.stripe_subscription_id !== sub.id) break
          await upsertBilling(merchantId, billingFromSubscription(sub))
          // Suspends AND returns the shop to basic — see lapseMerchant. Shared with the
          // reconciliation sweep so a shop closed by either road is closed the same way.
          await lapseMerchant(merchantId)
        }
        break
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object
        // Stripe moved `subscription_details` under `invoice.parent` (API
        // version 2025-03-31+). The payload shape follows the ENDPOINT's
        // registered API version, so read the new location with a legacy
        // fallback (same drift-hardening as billingFromSubscription).
        const parent = (inv as { parent?: { subscription_details?: { metadata?: Record<string, string> } } }).parent
        const merchantId =
          (inv as { subscription_details?: { metadata?: Record<string, string> } }).subscription_details?.metadata?.merchant_id ||
          parent?.subscription_details?.metadata?.merchant_id ||
          inv.metadata?.merchant_id
        if (merchantId) await upsertBilling(merchantId, { status: 'past_due' })
        break
      }
      case 'invoice.paid': {
        const inv = event.data.object
        // The referred merchant's FIRST real payment is the referral-reward trigger.
        // `amount_paid > 0` excludes the $0 trial-start invoice; the billing_reason
        // allowlist keeps it to a subscription's own invoices (create = paid signup /
        // reactivation, cycle = trial converting or renewing). The reward is granted at
        // most once per referred shop (referral_rewards PK), so a later renewal cycle
        // finds the row and no-ops — only the first qualifying paid invoice pays out.
        const reason = (inv as { billing_reason?: string }).billing_reason
        const firstPaid =
          (inv.amount_paid ?? 0) > 0 &&
          (reason === 'subscription_create' || reason === 'subscription_cycle')
        if (!firstPaid) break

        // Same metadata drift-hardening as invoice.payment_failed above.
        const parent = (inv as { parent?: { subscription_details?: { metadata?: Record<string, string> } } }).parent
        const merchantId =
          (inv as { subscription_details?: { metadata?: Record<string, string> } }).subscription_details?.metadata?.merchant_id ||
          parent?.subscription_details?.metadata?.merchant_id ||
          inv.metadata?.merchant_id
        if (merchantId) {
          const decision = await processReferralReward(merchantId)
          if (!decision.grant && decision.reason !== 'not_referred' && decision.reason !== 'already_rewarded') {
            console.log(`Referral reward skipped for referred merchant ${merchantId}: ${decision.reason}`)
          }
        }
        break
      }
      case 'customer.subscription.trial_will_end': {
        // Fires 72h before trial end — the out-of-app reminder. A thrown send
        // error 500s the webhook so Stripe retries delivery.
        const sub = event.data.object
        const merchantId = sub.metadata?.merchant_id
        if (merchantId && sub.trial_end) {
          const { data: merchant } = await admin
            .from('merchants').select('name, owner_id').eq('id', merchantId).maybeSingle()
          // Owner email from Auth, not profiles — the profiles row may not exist
          // (client-side profile upsert is currently RLS-blocked for new signups).
          const { data: ownerUser } = merchant?.owner_id
            ? await admin.auth.admin.getUserById(merchant.owner_id)
            : { data: { user: null } }
          const ownerEmail = ownerUser?.user?.email
          if (ownerEmail) {
            const { subject, text } = buildTrialReminderEmail({
              shopName: merchant?.name || 'your shop',
              trialEndsAt: new Date(sub.trial_end * 1000).toISOString(),
              dashboardUrl: `${env.frontendUrl}/merchant`,
            })
            await resendSend(ownerEmail, subject, { text })
          }
        }
        break
      }
      default:
        break // ignore unhandled event types
    }
  } catch (err) {
    console.error(`Error handling ${event.type}:`, err instanceof Error ? err.message : String(err))
    return c.json({ error: 'Handler error' }, 500)
  }

  return c.json({ received: true })
})
