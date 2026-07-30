import type { User } from '@supabase/supabase-js';
import { voucherFromRow, QUOTE_REFUSALS } from '@bitetime/shared';
import type { FeedbackDraft, FeedbackStatus, MerchantStats, OrderRefusal, QuoteRefusal } from '@bitetime/shared';
import { supabase } from './supabase';
import { RESERVED_SLUGS } from './slug';
import { SignupError, signupErrorCode } from './signupError'
import type { AddressParts, EarnedReward, FeedbackItem, Order, ReferredShop, ShopCustomer, ShopCustomerPage, ShopCustomerSort, Voucher } from './types';
import type { SavedDetails } from './savedDetails';
import { resetRedirectUrl } from './resetPassword';
import { pendingShopMetadata } from './merchant/pendingShop';
import type { PendingShop } from './merchant/pendingShop';
import { API_URL, apiGet, apiGetFile, apiSend, mapOk, toVoid } from './api'
import type { Result } from './api'
import type { CartLine } from '@bitetime/shared'

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

// Merchant sign-up. `shop` is what the form collected about the SHOP, parked on the auth user
// so it outlives the confirmation round trip: with confirmations on, the sign-in that follows
// this call fails and the shop is never created here. See pendingShop.ts.
export async function signUp(name: string, email: string, password: string, shop?: PendingShop) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, ...(shop ? pendingShopMetadata(shop) : {}) } },
  });
  if (error) throw error;
  if (data.user) {
    // If email confirmation is required, there is no session yet and RLS will
    // block this write — it succeeds once the user confirms and signs in, which
    // is handled in onAuthChange below.
    await ensureGlobalProfile({
      user_id: data.user.id,
      name,
      email,
      email_confirmed: !!data.user.email_confirmed_at,
    });
  }
  return data.user;
}

// Customer sign-up. Goes through the backend rather than supabase.auth.signUp because
// email confirmation is on project-wide (it protects merchants, who own shops and Stripe
// billing) — a client-side signUp would return no session and strand the customer in their
// inbox holding a cart. The backend creates the account pre-confirmed with the service role;
// signing in here is what puts the session in this tab, so the cart survives and the order
// they were placing is recorded against them.
export async function signUpCustomer(email: string, password: string) {
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/customer/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  } catch {
    throw new SignupError('network')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new SignupError(signupErrorCode(res.status, body))
  }
  try {
    return await signIn(email, password)
  } catch {
    // The account exists from here on, so a failure now is NOT a wrong password — telling
    // the customer it was would be a lie about credentials we just set for them. Distinct
    // code, so the panel can say what actually happened and offer sign-in.
    throw new SignupError('signin_failed')
  }
}

// Upserts the caller's GLOBAL profile (merchant_id null) via the backend, which forces
// user_id/merchant_id server-side and allowlists the rest (pickProfileFields in
// apps/backend/src/writes.ts) — see Global Constraint 1. Best-effort: returns the failure as a
// Result rather than throwing, because both callers below treat a failure as "try again later",
// not as a hard stop. In particular, during merchant signup there is no session yet (email
// confirmation is on project-wide) — the fetch 401s exactly as RLS used to block the equivalent
// browser write, and it's retried from onAuthChange once a session exists.
async function ensureGlobalProfile(fields: {
  user_id: string
  name: string
  email?: string | null
  email_confirmed: boolean
  referral_code?: string
}): Promise<Result<void>> {
  // user_id is forced to the caller server-side; send everything else.
  const { user_id: _user_id, ...rest } = fields
  return toVoid(await apiSend('/api/me/profile', 'PUT', rest, { auth: true }))
}

export async function fetchProfileByUserId(_userId: string): Promise<Result<any | null>> {
  return apiGet<any | null>('/api/me/profile', { auth: true })
}

/**
 * Save what a signed-in customer just typed at checkout, so they never type it again — at this
 * shop or any other. Silent: the customer asked for none of this and is shown no checkbox.
 *
 * Best-effort by design. It runs after an order is already placed, so a failure here must cost
 * the customer nothing but a retype next time; it must never surface as a failed order — which
 * is now the CALLER's choice: it returns a Result<void> and the storefront simply does not act
 * on `{ ok:false }` (the swallow is at the call site, not baked in here).
 *
 * Writes the GLOBAL profile (merchant_id null) — the same row `ensureGlobalProfile` maintains,
 * via the same `PUT /api/me/profile` upsert. An address belongs to the customer, not to a shop.
 */
export async function saveCustomerDetails(fields: SavedDetails): Promise<Result<void>> {
  if (Object.keys(fields).length === 0) return { ok: true, data: undefined }
  const user = await getCurrentUser()
  // a guest saves nothing, ever — that is what makes the gate's warning true
  if (!user) return { ok: true, data: undefined }
  return toVoid(await apiSend('/api/me/profile', 'PUT', fields, { auth: true }))
}

const MERCHANT_STATUSES = ['pending', 'active', 'suspended']

export async function fetchAllMerchants(): Promise<Result<any[]>> {
  return apiGet<any[]>('/api/merchants', { auth: true })
}

// Status is the billing enforcement boundary and is service_role-only at the DB
// layer (guard_merchant_status trigger). Direct PostgREST updates are blocked, so
// admin suspend/reject/reactivate goes through the superadmin backend endpoint.
export async function setMerchantStatus(id: string, status: string): Promise<Result<any>> {
  if (!MERCHANT_STATUSES.includes(status)) return { ok: false, error: { code: 'invalid_status', message: 'Invalid status' } }
  return apiSend<any>('/api/admin/set-merchant-status', 'POST', { merchantId: id, status }, { auth: 'required' })
}

// Superadmin: grant a merchant free Pro (active + pro, no Stripe charge). Goes
// through the backend, which writes status/plan/billing with the service-role key.
export async function compMerchant(id: string): Promise<Result<any>> {
  return apiSend<any>('/api/admin/comp-merchant', 'POST', { merchantId: id }, { auth: 'required' })
}

// Superadmin: revoke a comp. Drops the shop to Basic and clears the flag; the shop's own
// status is untouched, because suspending is a separate decision.
export async function uncompMerchant(id: string): Promise<Result<any>> {
  return apiSend<any>('/api/admin/uncomp-merchant', 'POST', { merchantId: id }, { auth: 'required' })
}

// The "could not ask" vs "the answer is empty" distinction, now the shared Result:
// `{ ok: false }` means the request itself never landed (network/CORS/5xx) and a caller that
// would DROP something on that must not treat it as an answer; `{ ok: true, data: null }` is a
// real answer — the slug is reserved, or the backend answered 200 with a null body (no such
// shop). The null-collapsing `fetchMerchantBySlug` twin is gone: a display-only caller takes
// `r.ok ? r.data : null` itself, and `MerchantContext.refresh` reads `r.ok`/`r.data` directly so
// a dropped packet mid-checkout cannot blank an already-loaded storefront.
export async function lookupMerchantBySlug(slug: string | undefined): Promise<Result<any | null>> {
  const s = (slug || '').trim().toLowerCase()
  if (!s || RESERVED_SLUGS.includes(s)) return { ok: true, data: null }
  return apiGet<any | null>(`/api/merchants/${encodeURIComponent(s)}`)
}

// The signed-in user's own shop — same "could not ask" vs "the answer is empty" shape as
// `lookupMerchantBySlug` above, and for a sharper reason. `{ ok: true, data: null }` is a
// real answer: this user owns no shop, so they are a customer. `{ ok: false }` means the
// request never landed, and the caller knows NOTHING about what they own.
//
// There is deliberately no collapsing wrapper. Collapsing "could not ask" into "owns no shop"
// is what broke #98: `SessionContext` derives `role` from this row, so a backend it could not
// reach read as "owns no shop" → role `customer` → `RequireRole` bounced the merchant to the
// landing page. In production every /api/* call was CORS-blocked (the backend's FRONTEND_URL
// did not match the deployed origin), so every merchant login ended on the marketing page
// with no error shown anywhere.
export async function lookupMyMerchant(userId: string): Promise<Result<any | null>> {
  if (!userId) return { ok: true, data: null }
  return apiGet<any | null>('/api/me/merchant', { auth: true })
}

export async function createMerchant({ name, plan = 'basic', billing = 'monthly', referredByCode, businessNature }: { name: string; plan?: string; billing?: string; referredByCode?: string; businessNature?: string }): Promise<Result<any>> {
  return apiSend<any>('/api/merchants', 'POST', { name, plan, billing, referredByCode, businessNature }, { auth: true })
}

// ── Billing (Stripe via the Hono backend) ──────────────────────────────────────

// Create a Stripe Checkout Session for the current merchant and return its URL.
// Every subscription is charged in MYR; the backend no longer takes a region.
export async function startCheckout({ plan, billing }: { plan: string; billing: string }): Promise<Result<string>> {
  const r = await apiSend<{ url: string }>('/api/checkout', 'POST', { plan, billing }, { auth: 'required' })
  return mapOk(r, (d) => d.url)
}

// Platform subscription pricing from the backend, always in MYR. `country` is an
// optional override forwarded as `?country=` (used to preview an estimate locally / in QA).
export interface PlatformPricing {
  currency: string
  prices: {
    basic: { monthly: number; yearly: number }
    pro: { monthly: number; yearly: number }
  }
  estimate: { currency: string; rate: number } | null
}

export async function fetchPlatformPricing(country?: string): Promise<Result<PlatformPricing>> {
  const qs = country ? `?country=${encodeURIComponent(country)}` : ''
  return apiGet<PlatformPricing>(`/api/pricing${qs}`)
}

/**
 * The backend's clock, and the two browser timestamps that bracket it.
 *
 * `null` on any failure — the caller falls back to the browser's own clock, which is exactly
 * today's behaviour, degraded but no worse.
 */
export async function fetchServerNow(): Promise<{ now: number; sentAt: number; receivedAt: number } | null> {
  const sentAt = Date.now()
  try {
    const res = await fetch(`${API_URL}/api/time`)
    const receivedAt = Date.now()
    if (!res.ok) return null
    const body = await res.json()
    const now = Date.parse(body?.now)
    return Number.isFinite(now) ? { now, sentAt, receivedAt } : null
  } catch {
    return null
  }
}

export interface MerchantBilling {
  merchant_id: string
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  status?: string | null
  trial_ends_at?: string | null
  current_period_end?: string | null
  /** Complimentary tier — no Stripe subscription behind this shop. */
  comped?: boolean | null
}

// Superadmin: read every merchant's billing row (RLS grants superadmins read on all).
export async function fetchAllBilling(): Promise<Result<MerchantBilling[]>> {
  return apiGet<MerchantBilling[]>('/api/billing', { auth: true })
}

// Read the merchant's authoritative billing row (owner-readable via RLS).
export async function fetchMyBilling(merchantId: string): Promise<Result<any | null>> {
  if (!merchantId) return { ok: true, data: null }
  return apiGet<any | null>(`/api/merchants/${merchantId}/billing`, { auth: true })
}

// Superadmin fallback for a shop stuck at `pending` — signup provisions its own trial now, so
// nobody waits on this. Creates the Stripe customer + cardless trialing subscription and
// activates the shop in one step.
export async function approveMerchant(merchantId: string): Promise<Result<any>> {
  return apiSend<any>('/api/admin/approve-merchant', 'POST', { merchantId }, { auth: 'required' })
}

// The owner's own retry when trial provisioning failed during signup. Same rule as the admin
// fallback above, asked for by the merchant — who is the one actually looking at the screen.
export async function startShopTrial(merchantId: string): Promise<Result<{ ok: true; trial: boolean }>> {
  return apiSend<{ ok: true; trial: boolean }>(`/api/merchants/${merchantId}/start-trial`, 'POST', undefined, { auth: 'required' })
}

// Open the Stripe billing portal for the signed-in merchant (add/update card).
export async function openBillingPortal(): Promise<Result<string>> {
  const r = await apiSend<{ url: string }>('/api/billing/portal', 'POST', undefined, { auth: 'required' })
  return mapOk(r, (d) => d.url)
}

/**
 * The three wind-down actions, which unlike the portal stay inside the dashboard: cancelling and
 * downgrading both land on a period boundary, so no money moves and there is nothing a payment
 * screen needs to explain. See CONTEXT.md → Plan entitlement.
 *
 * Each returns `Result<void>` and carries the backend's error code in `error.code` on failure —
 * the caller decides what `no_live_subscription` should say, because it means "the subscription
 * changed under this tab", not "something broke".
 */
async function billingAction(path: 'cancel' | 'resume' | 'downgrade'): Promise<Result<void>> {
  return toVoid(await apiSend(`/api/billing/${path}`, 'POST', undefined, { auth: 'required' }))
}

/** Step down to Basic when the paid-for period ends. Pro features stay until then. */
export const downgradeToBasic = () => billingAction('downgrade')
/** End the subscription when the paid-for period ends. The shop is suspended at that point. */
export const cancelSubscription = () => billingAction('cancel')
/** Undo whichever wind-down is pending — a cancellation, a scheduled downgrade, or both. */
export const resumeSubscription = () => billingAction('resume')

export async function updateMerchantSlug(id: string, slug: string): Promise<Result<any>> {
  const s = (slug || '').trim().toLowerCase()
  if (!s || RESERVED_SLUGS.includes(s)) return { ok: false, error: { code: 'reserved_slug', message: 'Reserved or empty slug' } }
  return apiSend<any>(`/api/merchants/${id}/slug`, 'PATCH', { slug: s }, { auth: true })
}

/**
 * Ask Supabase to email a recovery link. Deliberately NOT mirrored on the custom signup endpoint:
 * going through Supabase buys two things for free that a custom endpoint would force us to rebuild
 * — its own rate limiting, and NON-ENUMERATION (the call succeeds whether or not the address has an
 * account, so the caller can only ever show the neutral message).
 *
 * Note the asymmetry with signup, which DOES disclose that an email already has an account. That
 * was accepted knowingly there. Do not "fix" reset to match it: the leak exists once already, and
 * there is no reason to open a second.
 */
export async function requestPasswordReset(email: string, shopSlug: string | null): Promise<void> {
  // NEVER throws, and never reports the outcome. That is the whole guarantee, and it lives here so
  // that no caller can leak it by accident: Supabase's per-email cooldown only fires when a mail is
  // actually SENT — i.e. only for an address that has an account — so an error surfaced to the UI
  // would tell an attacker which addresses are registered. Two requests a minute apart is the whole
  // attack. Callers show the neutral message unconditionally because there is nothing else to show.
  //
  // The cost is real and accepted: a genuine failure (network down) looks like success to the
  // customer, who waits for a mail that never comes. Enumeration is the worse of the two.
  try {
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: resetRedirectUrl(window.location.origin, shopSlug),
    })
  } catch { /* swallowed on purpose — see above */ }
}

/** Set the new password for the session the recovery link just established. */
export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

export function onAuthChange(callback: (user: User | null, event?: string) => void) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null;
    if (user && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
      // Ensure profile exists and email_confirmed is up to date.
      // This handles the case where email confirmation was required at signUp
      // and the profile insert was blocked by RLS (no session at that point).
      // Deferred via setTimeout: awaiting a Supabase call inside onAuthStateChange
      // deadlocks the client's internal auth lock and hangs all later requests.
      setTimeout(() => {
        ensureGlobalProfile({
          user_id: user.id,
          name: user.user_metadata?.name || user.email?.split('@')[0] || '',
          email: user.email,
          email_confirmed: !!user.email_confirmed_at,
          referral_code: referralCodeOf(user.id),
        }).then((r) => {
          if (!r.ok) console.error('Profile upsert failed:', r.error.message);
        });
      }, 0);
    }
    callback(user, event);
  });
  return () => subscription.unsubscribe();
}

// ── Vouchers ──────────────────────────────────────────────────────────────────

// Uses left on a voucher. Infinity = no total cap (still capped to 1 per customer).
export function voucherUsesLeft(v: Voucher) {
  const count = Array.isArray(v.usedBy) ? v.usedBy.length : 0;
  if (v.maxUses == null || v.maxUses === '') return Infinity;
  return Math.max(0, Number(v.maxUses) - count);
}

// True when the voucher can no longer be redeemed by anyone.
export function voucherFullyUsed(v: Voucher) {
  // Legacy single-use vouchers: `used:true` with no usedBy list.
  if (v.used && !Array.isArray(v.usedBy)) return true;
  return voucherUsesLeft(v) <= 0;
}

// ── Multi-tenant vouchers (per-merchant `vouchers` table) ─────────────────────
// Reads the merchant-scoped `vouchers` table and maps its columns onto the
// Voucher shape the pricing module expects.

// The row → domain mapping now lives in @bitetime/shared: the backend prices orders from the
// same voucher rows, and a second copy of this mapping is a second way for the two sides to
// disagree about what a voucher is worth.
export { voucherFromRow } from '@bitetime/shared'

export async function fetchMerchantVouchers(merchantId: string): Promise<Result<Voucher[]>> {
  if (!merchantId) return { ok: true, data: [] }
  const r = await apiGet<any[]>(`/api/merchants/${merchantId}/vouchers`, { auth: true })
  return mapOk(r, (rows) => rows.map(voucherFromRow))
}

/**
 * The answer to "does this shop still have this voucher?", with "I could not ask" as its own
 * answer and not a `null` shaped like "no".
 *
 * `{ ok: true, data: null }` means we ASKED and the shop no longer has it — safe to drop.
 * `{ ok: false }` means the request never landed (network/CORS/non-2xx), and a caller that
 * would DROP the voucher on that must change nothing: confiscating a valid voucher the moment
 * the connection flickers — while telling the customer it "is no longer available" — is a lie
 * about their money. That distinction is now the shared `Result` shape, not a bespoke type.
 */
export async function lookupMerchantVoucher(merchantId: string, code: string): Promise<Result<Voucher | null>> {
  if (!merchantId || !code) return { ok: true, data: null }
  const r = await apiGet<any>(`/api/merchants/${merchantId}/vouchers/${encodeURIComponent(code)}`)
  return mapOk(r, (row) => (row ? voucherFromRow(row) : null))
}

// `fetchMerchantVoucher` (the null-collapsing convenience twin of `lookupMerchantVoucher`) is
// gone with the null contract: a caller that wants "a miss reads as no voucher, carry on" now
// says so at the call site by taking `r.ok ? r.data : null` itself, so the choice to discard a
// could-not-ask is visible where it is made rather than hidden in a wrapper.

// `redeemVoucher` is gone, and its absence is the fix. Redemption was a SECOND call made
// after the order was already committed, so a failure left the customer holding a discount on
// a voucher that was never marked used — reusable forever. The claim now happens inside
// placeOrder's transaction, server-side. There is no longer a second call to swallow.

// Merchant-facing voucher management (writes the merchant's own rows — allowed
// by vouchers_write_own).
export async function createMerchantVoucher(input: {
  merchantId: string; code: string; kind: string; amount: number; maxUses?: number | null;
}): Promise<Result<Voucher>> {
  const r = await apiSend<any>(`/api/merchants/${input.merchantId}/vouchers`, 'POST', {
    code: input.code,
    kind: input.kind,
    amount: input.amount,
    maxUses: input.maxUses ?? null,
  }, { auth: true })
  return mapOk(r, voucherFromRow)
}

export async function deleteMerchantVoucher(id: string, merchantId: string): Promise<Result<void>> {
  return toVoid(await apiSend(`/api/merchants/${merchantId}/vouchers/${id}`, 'DELETE', undefined, { auth: true }))
}

// ── Referral program ─────────────────────────────────────────────────────────
// A member's referral code is the first 8 hex chars of their profile UUID,
// so the code itself identifies the referrer. Also stored in
// profiles.referral_code for lookup.
export function referralCodeOf(userId: string) {
  return (userId || '').replace(/-/g, '').slice(0, 8).toUpperCase();
}

// Shops that signed up with the current user's referral code.
//
// The code is never sent — the backend derives it from the bearer token, exactly as the
// my_referred_shops RPC this replaces derived it from auth.uid(). Sending it would turn the
// endpoint into a cross-tenant read of any referrer's shops.
export async function fetchReferredShops(): Promise<Result<ReferredShop[]>> {
  return apiGet<ReferredShop[]>('/api/referrals/shops', { auth: 'required' })
}

// The referral rewards the current user has earned — free months for shops they brought in
// that started paying. Like fetchReferredShops, the code is never sent: the backend scopes
// to the caller's own merchant from the bearer token.
export async function fetchEarnedRewards(): Promise<Result<EarnedReward[]>> {
  return apiGet<EarnedReward[]>('/api/referrals/rewards', { auth: 'required' })
}

// ── Multi-tenant order placement ─────────────────────────────────────────────

const ORDER_STATUSES = ['new', 'preparing', 'ready', 'completed', 'cancelled']

/**
 * A refusal the customer can act on, as opposed to a bug.
 *
 * The codes come from `@bitetime/shared` (`refusal.ts`). They used to be declared here as a
 * hand-copied twin of the backend's own union, and they drifted: `method_not_offered` was
 * thrown by the backend and handled in `Storefront.tsx` as a bare string, but was never added
 * here, so the compiler could not see the gap. `network` is the browser's own and has no
 * backend twin — a fetch that never landed.
 *
 * What each code SAYS to the customer, and what the checkout does about it, lives in
 * `store/orderRefusal.ts`.
 */
export class OrderError extends Error {
  constructor(
    readonly code: OrderRefusal | 'network',
    /**
     * The server's own clock, present only on `price_changed` (`app.ts`'s OrderError handler).
     * This is what lets `price_changed` recovery fix a persistently-unreachable `/api/time`
     * (I-3, #69): the refusal that proves the connection works also states the time, so
     * `serverClock.ts`'s `adopt()` can correct the offset without a second request that could
     * fail the same way. See serverClock.ts for the failure this closes.
     */
    readonly now?: string,
  ) {
    super(code)
    this.name = 'OrderError'
  }
}

/**
 * Place an order: ONE call, which commits the order number, the order row, the voucher claim
 * and THE PRICE in a single transaction server-side.
 *
 * This used to be three trips from the browser with no transaction around them — take a
 * number, insert the order, then record the redemption — and the storefront threw the third
 * one's error away. A failed redemption therefore left the order committed with the discount
 * applied and the voucher never marked used, so the customer kept the discount and could
 * reuse the voucher forever. The three trips are now one, and a failed claim rolls the order
 * back rather than gifting it.
 *
 * The browser no longer has INSERT on `orders` at all (the grant is revoked), so there is no
 * path back to the old shape even by accident. `user_id` is not sent: the backend takes it
 * from this request's JWT, and sending it would be ignored.
 *
 * We send what the customer WANTS (the cart) and what they SAW (`quotedTotal`) — never what it
 * costs. The backend derives every number from its own rows; sending a total would mean any
 * client could name its own. If the backend's price disagrees with our quote it refuses with
 * `price_changed` rather than charging a number the customer never confirmed.
 */
export async function placeOrder({ merchantId, customerName, customerWa, mode, address, cart, quotedTotal, voucherCode, fulfilDate }: {
  merchantId: string
  customerName: string
  customerWa: string
  // The wire contract, not a string: the backend allowlists exactly these three and 400s on
  // anything else, because `mode` selects the shipping fee. Mirrors PlaceOrderInput's union.
  mode: 'pickup' | 'delivery' | 'express'
  address?: AddressParts | string
  cart: CartLine[]
  quotedTotal: number
  voucherCode?: string | null
  /** `YYYY-MM-DD` on the shop's clock. The backend re-checks it against the shop's window. */
  fulfilDate: string | null
}): Promise<Result<{ orderNumber: string }, OrderError>> {
  // Optional: a guest has no session, and guest checkout is a first-class path.
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  // `fetch` REJECTS on a network or CORS failure rather than returning a non-ok response, so
  // an offline customer would otherwise get a raw "Failed to fetch" on the checkout screen.
  // The Result's error is a full OrderError (not the generic ApiError): the storefront branches
  // on `error.code` (the refusal union) and adopts `error.now` — the server clock the refusal
  // carried — to close the #69 offset loop. That domain payload is why `E` is parameterised.
  const res = await fetch(`${API_URL}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      merchantId, customerName, customerWa, mode, address,
      cart, quotedTotal, voucherCode, fulfilDate,
    }),
  }).catch(() => null)
  if (!res) return { ok: false, error: new OrderError('network') }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    return { ok: false, error: new OrderError(payload?.error ?? 'order_failed', typeof payload?.now === 'string' ? payload.now : undefined) }
  }
  return { ok: true, data: (await res.json()) as { orderNumber: string } }
}

/**
 * Why a delivery could not be quoted. Every code the endpoint can return survives to the caller:
 * this used to narrow eight into five, folding `merchant_not_found`, `merchant_inactive` and
 * `quota_exceeded` into `lookup_failed` — so a closed shop, and a shop out of daily lookup
 * budget, both told the customer to try again. The budget does not clear for up to 24 hours.
 *
 * See `store/orderRefusal.ts` for what each one now says.
 */
export class DeliveryQuoteError extends Error {
  constructor(readonly code: QuoteRefusal | 'network') {
    super(code)
    this.name = 'DeliveryQuoteError'
  }
}

/**
 * Ask what this delivery costs. Sends a PLACE ID and never a typed address: free text would let
 * a caller mint unlimited billable lookups on the platform's Maps account (docs/adr/0001).
 *
 * The row this writes is the same row order intake reads a moment later, which is what makes the
 * quote and the charge the same number.
 */
export async function quoteDelivery(merchantId: string, placeId: string): Promise<Result<{ km: number; fee: number }, DeliveryQuoteError>> {
  const res = await fetch(`${API_URL}/api/shipping/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchantId, placeId }),
  }).catch(() => null)
  if (!res) return { ok: false, error: new DeliveryQuoteError('network') }
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    const code = payload.error
    // Recognised codes pass through untouched; anything else is a body we do not understand,
    // which is a lookup failure as far as the customer is concerned.
    return { ok: false, error: new DeliveryQuoteError(
      code && (QUOTE_REFUSALS as readonly string[]).includes(code) ? (code as QuoteRefusal) : 'lookup_failed',
    ) }
  }
  return { ok: true, data: (await res.json()) as { km: number; fee: number } }
}

// Trigger the server-side order notification fan-out: the merchant's Telegram and
// the signed-in customer's confirmation email. The bot token and the recipient
// address both stay on the backend — the browser sends only the order reference
// and `lang`, which selects the email's language (never who receives it).
//
// Best-effort: returns Result<void> and the storefront ignores it — a notify failure must never
// surface as a failed order, and the order is already committed by the time this runs.
export async function notifyOrderPlacedRemote(merchantId: string, orderNumber: string, lang: 'en' | 'zh'): Promise<Result<void>> {
  return toVoid(await apiSend('/api/notify/order', 'POST', { merchantId, orderNumber, lang }))
}

/**
 * How far back a customer's per-shop history goes. Stated on screen, never applied silently:
 * a truncated list with nothing said reads as "this is everything" when it isn't.
 */
export const ORDER_HISTORY_LIMIT = 20

/**
 * The orders *this* customer placed at *this* shop, newest first.
 *
 * The `user_id` filter is not belt-and-braces on top of RLS — it is the whole point. The select
 * policy grants a row to the ordering user OR the shop that owns it, so a merchant opening their
 * own storefront's history would be handed every customer's order at that shop. Filtering by the
 * signed-in uid is what makes "your orders" mean yours.
 */
export async function fetchMyOrdersAtShop(merchantId: string): Promise<Result<Order[]>> {
  if (!merchantId) return { ok: true, data: [] }
  const user = await getCurrentUser()
  if (!user) return { ok: true, data: [] } // a guest has no history — by design, and permanently
  return apiGet<Order[]>(`/api/merchants/${merchantId}/my-orders`, { auth: true })
}

/** 1-based, and always a slice: the whole list is not something this endpoint offers. */
export interface OrderPage {
  orders: any[]
  /** Orders matching the search, before paging — what the pager is a slice of. */
  total: number
  page: number
  pageSize: number
}

export interface OrderListQuery {
  page?: number
  pageSize?: number
  sort?: 'created_at' | 'order_number' | 'fulfil_date' | 'total'
  dir?: 'asc' | 'desc'
  search?: string
}

/**
 * One page of the merchant's orders, sorted and searched by the BACKEND (#144).
 *
 * This used to ask for every order the shop had ever taken and sort, search and page them here.
 * That silently stopped working at the shop's 1000th order — PostgREST caps a response and says
 * so only in a header nothing read — so the oldest orders became unreachable and the merchant
 * had no way to tell. Nothing here can page past what it was sent, which is why the paging moved
 * to where the rows are.
 */
export async function fetchMerchantOrders(
  merchantId: string,
  opts: OrderListQuery = {},
): Promise<Result<OrderPage>> {
  const empty = { orders: [], total: 0, page: 1, pageSize: 0 }
  if (!merchantId) return { ok: true, data: empty }
  const q = new URLSearchParams()
  if (opts.page) q.set('page', String(opts.page))
  if (opts.pageSize) q.set('pageSize', String(opts.pageSize))
  if (opts.sort) q.set('sort', opts.sort)
  if (opts.dir) q.set('dir', opts.dir)
  if (opts.search?.trim()) q.set('search', opts.search.trim())
  const qs = q.toString()
  return apiGet<OrderPage>(`/api/merchants/${merchantId}/orders${qs ? `?${qs}` : ''}`, { auth: true })
}

/**
 * Everything the Overview draws, computed by the backend from the shop's WHOLE history.
 *
 * The range and granularity are the panel's own pills, so switching one is a refetch rather than
 * a recompute — the browser no longer holds the orders to recompute from, which is the point.
 * A shop past the row cap used to be shown a revenue figure that was simply short, and trusted
 * it because nothing suggested otherwise (#144).
 */
export async function fetchMerchantStats(
  merchantId: string,
  window: { days: number; granularity: 'day' | 'week' },
): Promise<Result<MerchantStats>> {
  return apiGet<MerchantStats>(
    `/api/merchants/${merchantId}/stats?days=${window.days}&granularity=${window.granularity}`,
    { auth: true },
  )
}

/**
 * How many orders this shop has, optionally of one status — counted by Postgres.
 *
 * The "new orders" badge used to be `orders.filter(…).length` over the full list, which made the
 * most expensive read in the dashboard run on a poll from every section, and made the badge
 * wrong past the row cap besides.
 */
export async function fetchOrderCount(
  merchantId: string,
  status?: string,
): Promise<Result<number>> {
  if (!merchantId) return { ok: true, data: 0 }
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''
  const r = await apiGet<{ count: number }>(`/api/merchants/${merchantId}/orders/count${qs}`, { auth: true })
  return mapOk(r, d => d.count)
}

/**
 * The Pro-only revenue export. Hands back the workbook and the name the server chose for it.
 *
 * The range and granularity are the ones the merchant is looking at on the Overview chart — the
 * file is that panel's contents, not a second range concept in the dashboard. `auth: 'required'`
 * because a signed-out caller has no shop to report on, and the backend would only 401.
 */
export async function downloadRevenueReport(
  merchantId: string,
  window: { days: number; granularity: 'day' | 'week' },
): Promise<Result<{ blob: Blob; filename: string | null }>> {
  return apiGetFile(
    `/api/merchants/${merchantId}/report.xlsx?days=${window.days}&granularity=${window.granularity}`,
    { auth: 'required' },
  )
}

// True once the merchant has ≥1 order — used to lock the currency selector so
// past orders and dashboard aggregates never silently re-denominate.
export async function merchantHasOrders(merchantId: string): Promise<Result<boolean>> {
  return mapOk(await fetchOrderCount(merchantId), (n) => n > 0)
}

export async function setOrderStatus(orderId: string, status: string, merchantId: string): Promise<Result<any>> {
  if (!ORDER_STATUSES.includes(status)) return { ok: false, error: { code: 'invalid_status', message: 'Invalid status' } }
  return apiSend<any>(`/api/merchants/${merchantId}/orders/${orderId}`, 'PATCH', { status }, { auth: true })
}

export async function setOrderNote(orderId: string, note: string, merchantId: string): Promise<Result<any>> {
  return apiSend<any>(`/api/merchants/${merchantId}/orders/${orderId}`, 'PATCH', { note }, { auth: true })
}

export async function setOrderTracking(orderId: string, courier: string | null, awb: string, merchantId: string): Promise<Result<any>> {
  return apiSend<any>(`/api/merchants/${merchantId}/orders/${orderId}`, 'PATCH', { courier, awb }, { auth: true })
}

/**
 * The guest's only way back to an order. Costs the order number AND the phone that placed it:
 * order numbers are a per-shop daily counter, so the number alone is guessable and the endpoint
 * behind this is unauthenticated. The phone is what makes a guess cost ~10^8 tries instead of one.
 *
 * A wrong phone, a wrong number and a failed request are all the same `null` — and the caller
 * must keep showing one message for all of them. Telling them apart would hand back the oracle
 * the phone exists to remove. That is also why nothing here reads a status code or an error body:
 * there is nothing in either to read.
 */
export async function fetchOrderTracking(merchantId: string, orderNumber: string, phone: string) {
  const trimmed = orderNumber.trim()
  const trimmedPhone = phone.trim()
  if (!merchantId || !trimmed || !trimmedPhone) return null
  // `fetch` REJECTS on a network or CORS failure rather than returning a non-ok response, so
  // without this catch the promised null becomes a throw the moment the backend is unreachable.
  const res = await fetch(`${API_URL}/api/orders/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchantId, orderNumber: trimmed, phone: trimmedPhone }),
  }).catch(() => null)
  if (!res || !res.ok) return null
  return (await res.json()) as {
    status: string
    mode: string
    courier: string | null
    awb: string | null
    created_at: string
    fulfil_date: string | null
  } | null
}

/**
 * The shop's customers (#143), aggregated by the BACKEND.
 *
 * This used to fetch every order and group them here, on the raw `customer_wa` string. That was
 * wrong three ways at once — two spellings of one number were two customers, cancelled orders
 * counted as business, and every order with no number collapsed into one fake row called `—` —
 * and it sat on top of an orders endpoint that truncated at 1000 rows without saying so (fixed
 * separately in #144). All of it now happens in SQL and one pure module; see CONTEXT.md → Shop
 * customer.
 *
 * `sort` other than `recent`, and `tag`, are Pro: the backend answers `403 requires_pro`, which
 * `isRequiresPro` turns into an upgrade prompt rather than a bare error.
 */
export async function fetchShopCustomers(
  merchantId: string,
  opts: { sort?: ShopCustomerSort; tag?: string; search?: string; page?: number; pageSize?: number } = {},
): Promise<Result<ShopCustomerPage>> {
  if (!merchantId) return { ok: true, data: { customers: [], shopTags: [], total: 0, unattributedOrders: 0 } }
  const q = new URLSearchParams()
  if (opts.sort) q.set('sort', opts.sort)
  if (opts.tag) q.set('tag', opts.tag)
  if (opts.search?.trim()) q.set('search', opts.search.trim())
  if (opts.page) q.set('page', String(opts.page))
  if (opts.pageSize) q.set('pageSize', String(opts.pageSize))
  const qs = q.toString()
  const r = await apiGet<ShopCustomerPage>(`/api/merchants/${merchantId}/customers${qs ? `?${qs}` : ''}`, { auth: true })

  // `shopTags` is made true HERE rather than trusted from the wire, because the two halves of
  // this app deploy independently — the frontend to Vercel, the backend to Railway — so a
  // browser running this code can be talking to a backend that has never heard of the field
  // (#150). `ShopCustomerPage` promises callers an array; this is the one place that can keep
  // that promise. Without it the drawer throws on `undefined.filter` and takes the whole notes
  // panel down to avoid drawing one row of chips.
  if (!r.ok) return r
  return { ok: true, data: { ...r.data, shopTags: r.data.shopTags ?? [] } }
}

/** One customer's orders, newest-first — what the drawer opens. Cancelled orders included. */
export async function fetchShopCustomerOrders(merchantId: string, phoneKey: string): Promise<Result<Order[]>> {
  return apiGet<Order[]>(`/api/merchants/${merchantId}/customers/${phoneKey}/orders`, { auth: true })
}

/**
 * Save what the merchant wrote about one customer. Pro-only, and the row is created on the
 * first write — most customers never have one.
 *
 * Sends BOTH fields every time rather than patching one: the dashboard edits them in one panel
 * with one save, and a partial write would need the server to distinguish "cleared the note"
 * from "did not mention the note", which is a distinction nothing on screen offers.
 */
export async function saveShopCustomer(
  merchantId: string,
  phoneKey: string,
  fields: { note: string | null; tags: string[] },
): Promise<Result<{ phoneKey: string; note: string | null; tags: string[] }>> {
  return apiSend(`/api/merchants/${merchantId}/customers/${phoneKey}`, 'PUT', fields, { auth: true })
}

// ── Products ──────────────────────────────────────────────────────────────────

/**
 * The shop's menu, on the one Result convention: `{ ok:true, data:[] }` is a real answer (the
 * shop genuinely sells nothing, so pruning the cart against it is CORRECT), while `{ ok:false }`
 * means WE COULD NOT ASK and a caller that PRUNES the cart against the menu (Storefront's
 * `adoptProducts`) must change nothing — answering a flaky connection by deleting every line the
 * customer chose is a destroyed order, not a retry. That is the whole reason this stays a Result
 * and there is no `[]`-on-failure twin: a display-only caller collapses `r.ok ? r.data : []`
 * itself, so the choice to treat a could-not-ask as "empty menu" is visible where it is made.
 */
export async function lookupProducts(merchantId: string): Promise<Result<any[]>> {
  if (!merchantId) return { ok: true, data: [] }
  return apiGet<any[]>(`/api/merchants/${merchantId}/products`)
}

// merchant_id and id are both threaded from `product` — ProductsManager's callers always set
// both (merchant_id from `merchant!.id`, id from the row or a client-generated draftId) — so
// the URL carries the same tenant/row identity the backend then forces server-side anyway.
export async function upsertProduct(product: any): Promise<Result<any>> {
  return apiSend<any>(`/api/merchants/${product.merchant_id}/products/${product.id}`, 'PUT', product, { auth: true })
}

// Signature change: `merchantId` now threads the URL's tenant segment — the backend nests
// product deletes under /api/merchants/:id/products/:productId (see writes.ts /
// requireMerchantOwns) so it can verify tenancy before deleting. Callers must pass it.
export async function deleteProduct(id: string, merchantId: string): Promise<Result<void>> {
  return toVoid(await apiSend(`/api/merchants/${merchantId}/products/${id}`, 'DELETE', undefined, { auth: true }))
}

// ── Product images (Supabase Storage: public `product-images` bucket) ──────────

export const PRODUCT_IMAGE_BUCKET = 'product-images'
export const MAX_PRODUCT_IMAGES = 5
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024
export const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Resolve a stored path to a public URL for rendering.
export function productImageUrl(path: string): string {
  return supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}

// Validate + upload files under {merchantId}/{productId}/…; returns stored paths.
export async function uploadProductImages(
  merchantId: string,
  productId: string,
  files: File[],
): Promise<string[]> {
  const paths: string[] = []
  for (const file of files) {
    if (!PRODUCT_IMAGE_TYPES.includes(file.type)) {
      throw new Error(`Unsupported image type: ${file.name}`)
    }
    if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
      throw new Error(`Image too large (max 5MB): ${file.name}`)
    }
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${merchantId}/${productId}/${crypto.randomUUID()}-${safe}`
    const { error } = await supabase.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: true })
    if (error) throw error
    paths.push(path)
  }
  return paths
}

export async function deleteProductImages(paths: string[]): Promise<void> {
  if (!paths?.length) return
  const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove(paths)
  if (error) throw error
}

// ── Payment QR (Supabase Storage: public `payment-qr` bucket) ─────────────────
// One image per shop, shown to the customer on the order-placed screen (#156). Stored as a
// PATH under {merchantId}/…; the column is `merchants.payment_qr`, and the backend refuses a
// path that is not inside this merchant's own folder (writes.ts).

export const PAYMENT_QR_BUCKET = 'payment-qr'
export const MAX_PAYMENT_QR_BYTES = 2 * 1024 * 1024
export const PAYMENT_QR_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function paymentQrUrl(path: string): string {
  return supabase.storage.from(PAYMENT_QR_BUCKET).getPublicUrl(path).data.publicUrl
}

// Validate + upload; returns the stored path. Same shape as uploadProductImages, one file: the
// limits are stated here so the merchant gets a readable message before a 2MB body crosses the
// wire, and again on the bucket (20260729130000) so they hold for any client.
export async function uploadPaymentQr(merchantId: string, file: File): Promise<string> {
  if (!PAYMENT_QR_TYPES.includes(file.type)) {
    throw new Error(`Unsupported image type: ${file.name}`)
  }
  if (file.size > MAX_PAYMENT_QR_BYTES) {
    throw new Error(`Image too large (max 2MB): ${file.name}`)
  }
  // Flattened to a single path segment: the backend only accepts {merchantId}/{file}, and the
  // file name is sanitised to the characters that check allows.
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${merchantId}/${crypto.randomUUID()}-${safe}`
  const { error } = await supabase.storage
    .from(PAYMENT_QR_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true })
  if (error) throw error
  return path
}

export async function deletePaymentQr(path: string): Promise<void> {
  if (!path) return
  const { error } = await supabase.storage.from(PAYMENT_QR_BUCKET).remove([path])
  if (error) throw error
}

// ── Merchant config & secrets ─────────────────────────────────────────────────

export async function updateMerchantConfig(id: string, patch: any): Promise<Result<any>> {
  return apiSend<any>(`/api/merchants/${id}`, 'PATCH', patch, { auth: true })
}

export async function fetchMerchantSecret(merchantId: string): Promise<Result<{ tg_token: string | null; tg_chat_id: string | null } | null>> {
  if (!merchantId) return { ok: true, data: null }
  return apiGet<{ tg_token: string | null; tg_chat_id: string | null } | null>(`/api/merchants/${merchantId}/secret`, { auth: true })
}

export async function upsertMerchantSecret(merchantId: string, secret: any): Promise<Result<void>> {
  return toVoid(await apiSend(`/api/merchants/${merchantId}/secret`, 'PUT', secret, { auth: true }))
}

// ── Merchant platform feedback (#89) ────────────────────────────────────────────
// merchantId scopes the route; the backend re-derives ownership from the bearer token
// and ignores anything else in the body, so there is nothing else to send.
//
// Returns no data: the POST responds with a bare merchant_feedback row, which is NOT a
// FeedbackItem — it carries no shop_name / shop_slug, and only the admin list joins those
// in. Claiming the richer type here would be a cast the compiler cannot check, so the success
// carries `void`; the form renders `error` on failure.
export async function submitFeedback(merchantId: string, draft: FeedbackDraft): Promise<Result<void>> {
  return toVoid(await apiSend<unknown>(`/api/merchants/${merchantId}/feedback`, 'POST', draft, { auth: true }))
}

export async function fetchAdminFeedback(status?: FeedbackStatus): Promise<Result<FeedbackItem[]>> {
  const qs = status ? `?status=${status}` : ''
  return apiGet<FeedbackItem[]>(`/api/admin/feedback${qs}`, { auth: true })
}

// The PATCH route now joins the shop the same way the admin list does (see
// updateFeedbackStatus in apps/backend/src/feedback.ts), so this genuinely returns a full
// FeedbackItem — the spread in AdminFeedback is correct, not merely harmless.
export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<Result<FeedbackItem>> {
  return apiSend<FeedbackItem>(`/api/admin/feedback/${id}`, 'PATCH', { status }, { auth: true })
}
