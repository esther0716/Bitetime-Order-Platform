// Shared auth/tenant middleware. Resolves caller identity (and, for owner routes, the
// owned merchant) once against the service-role `admin` client, then stashes it on the
// context. admin is RLS-EXEMPT, so these functions ARE the tenant boundary on the backend
// path — nothing downstream re-checks. See CLAUDE.md → Backend.
import type { MiddlewareHandler } from 'hono'
import { admin, getUserFromToken } from './supabase.js'

type AuthedUser = NonNullable<Awaited<ReturnType<typeof getUserFromToken>>>

export type AppEnv = {
  Variables: {
    user: AuthedUser
    merchant: Record<string, any>
    /** The child row `requireOwnsChild` loaded — null on its `mayCreate` path. */
    child: Record<string, any> | null
  }
}

// Exported for the ONE route that must read a caller's identity without requiring it: the public
// voucher lookup, which answers "have you already used this?" only when a JWT is present.
export function bearer(c: Parameters<MiddlewareHandler>[0]): string {
  return (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '')
}

// The DB role, and nothing else. There was a transitional fallback here that also granted
// superadmin to one hardcoded address, for the window before the role was seeded anywhere; the
// role is now seeded in production, so the fallback is gone.
//
// Do not reintroduce it. An email is not a credential: it is a value Auth lets an account set
// and change, so making it a privilege means anyone who gets that address onto an account holds
// the platform — every shop's orders, billing and merchant status. `app_role` is written by
// service_role alone (guard_profile_privileges), which is the property this gate rests on.
// tests/api/reads-admin.test.ts pins the absence.
async function isSuperadmin(user: AuthedUser): Promise<boolean> {
  const { data } = await admin.from('profiles').select('app_role').eq('user_id', user.id).maybeSingle()
  return data?.app_role === 'superadmin'
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await getUserFromToken(bearer(c))
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  c.set('user', user)
  await next()
}

export const requireSuperadmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await getUserFromToken(bearer(c))
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isSuperadmin(user))) return c.json({ error: 'Forbidden' }, 403)
  c.set('user', user)
  await next()
}

// For routes carrying `:id`. Loads the merchant, then requires the caller to own it —
// unless they are a superadmin, who passes any tenant guard (mirrors RequireRole in the app).
export const requireMerchantOwns: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await getUserFromToken(bearer(c))
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const id = c.req.param('id')
  if (!id) return c.json({ error: 'Missing merchant id' }, 400)
  const { data: merchant } = await admin.from('merchants').select('*').eq('id', id).maybeSingle()
  if (!merchant) return c.json({ error: 'Merchant not found' }, 404)
  if (merchant.owner_id !== user.id && !(await isSuperadmin(user))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  c.set('user', user)
  c.set('merchant', merchant)
  await next()
}

/**
 * The tables that hang off a merchant and can therefore be nested under `:id` in a route.
 *
 * A closed union, not a string, and that is not fastidiousness: `admin` is RLS-EXEMPT, so this
 * guard is not defence in depth over a database rule — it IS the rule. A typo that compiles
 * would aim the check at a table nobody vetted, on a connection where no policy would catch it.
 */
type ChildTable = 'products' | 'vouchers' | 'orders'

/**
 * Chain AFTER `requireMerchantOwns` on any route carrying a SECOND id below `:id`.
 *
 * `requireMerchantOwns` proves the caller owns `:id` and says NOTHING about a child id nested
 * under it — so an owner of shop A could otherwise reach shop B's product, voucher or order by
 * nesting its id under `:id = A`. This loads the child row and refuses unless it belongs to the
 * shop the caller was just proven to own (Global Constraint 2).
 *
 * The refusal is a 404, deliberately, and not a 403: a "forbidden" would confirm to the caller
 * that the row exists in somebody else's shop.
 *
 * `mayCreate` is for the ONE route where a missing row is legitimate — the product upsert, which
 * creates when `:productId` is new. Everywhere else a missing row is a 404. That difference used
 * to be carried by `existing &&` versus `!existing ||` inside four otherwise identical lines,
 * which is a poor place to keep the decision that separates "creates a product" from "cannot
 * create a product". It is a named mode now, read at the route.
 *
 * The loaded row IS stashed, under `child` — and it is the WHOLE row, not just the `merchant_id`
 * this guard reads, so a handler that needs to compare a write against the stored values does not
 * have to re-query for a row the guard has already fetched. `null` on the `mayCreate` path means "no such row yet", which is a real answer and
 * not an absence — a handler must be able to tell it from "guard did not run".
 */
export const requireOwnsChild = (
  table: ChildTable,
  param: string,
  opts: { mayCreate?: boolean } = {},
): MiddlewareHandler<AppEnv> => async (c, next) => {
  // The shop `requireMerchantOwns` PROVED the caller owns — deliberately not `c.req.param('id')`,
  // which is only the shop they NAMED. The two are the same string on every route today, and
  // reading the proven one is what keeps them the same: chained without that guard there is
  // nothing proven to compare against, and the honest answer is that the route is misconfigured,
  // not that the child row is fine.
  const merchant = c.get('merchant')
  if (!merchant) return c.json({ error: 'Lookup failed' }, 500)
  const childId = c.req.param(param)
  if (!childId) return c.json({ error: 'Not found' }, 404)
  const { data: existing, error } = await admin.from(table).select('*').eq('id', childId).maybeSingle()
  // A FAILED QUERY IS NOT "no such row", and the difference is the whole guard. Read as one, a
  // transient database error would send `mayCreate` down the create path against a row this never
  // cleared — and that route's upsert forces `merchant_id` to the caller's shop, which is exactly
  // the cross-tenant takeover this exists to stop. Fail closed; the caller retries.
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  if (!existing) {
    if (!opts.mayCreate) return c.json({ error: 'Not found' }, 404)
    c.set('child', null)
    return await next()
  }
  if (existing.merchant_id !== merchant.id) return c.json({ error: 'Not found' }, 404)
  c.set('child', existing)
  await next()
}

/**
 * For routes that act on THE CALLER'S OWN shop — no `:id` in the path to name one. Resolves the
 * caller, loads the single merchant they own, and stashes it under the same key
 * `requireMerchantOwns` uses, so handlers downstream cannot tell which guard ran.
 *
 * NO SUPERADMIN BYPASS, unlike `requireMerchantOwns`, and the asymmetry is the point: there is no
 * `:id` here to stand in for. A superadmin who owns no shop has no shop of their own, and handing
 * them somebody else's would be a guess. They get the same "no merchant for this account" answer
 * anyone else in that position gets.
 */
export const requireOwnMerchant: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await getUserFromToken(bearer(c))
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const { data: merchant, error } = await admin
    .from('merchants').select('*').eq('owner_id', user.id).maybeSingle()
  // A failed lookup is a server fault, not an answer. Reading it as "you have no shop" (which two
  // of these routes used to do) tells a merchant their shop is gone because a query blipped.
  if (error) return c.json({ error: 'Lookup failed' }, 500)
  if (!merchant) return c.json({ error: 'No merchant for this account' }, 404)
  c.set('user', user)
  c.set('merchant', merchant)
  await next()
}
