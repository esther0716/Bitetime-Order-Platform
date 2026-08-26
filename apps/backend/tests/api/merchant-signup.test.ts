// tests/api/merchant-signup.test.ts
// POST /api/merchant/signup — the door that replaced the client-side auth.signUp.
//
// The property this suite exists to hold is ONE: the account it creates is usable IMMEDIATELY.
// Email confirmation is on project-wide, so a merchant created any other way has no session, the
// sign-in the browser makes next fails, and the shop is never built. That is what the endpoint
// was written to end, and a regression would look exactly like a working endpoint from the
// outside — the account exists either way. So the test signs in with the real anon client.
//
// Every request carries its own `x-forwarded-for`. The rate-limit windows are module-level and
// in-memory, so without distinct IPs the whole FILE shares one ten-request bucket and the tests
// start failing each other rather than the code.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { app } from '../../src/app.js'
import { anonClient, serviceClient, findUserByEmail } from '../rls/helpers.js'

const PASSWORD = 'hunter2hunter2'

const SHOP = {
  name: 'Signup Suite Bakes',
  businessNature: 'bakery',
  currency: 'MYR',
  billing: 'yearly',
}

function post(body: unknown, ip: string) {
  return app.request('/api/merchant/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

const TAGS = ['happy', 'metadata', 'profile', 'blank', 'weak', 'dupe', 'flood', 'noshop']

function email(tag: string): string {
  return `merchant-signup-${tag}@example.com`
}

/**
 * Remove an account this suite made, PROFILE FIRST.
 *
 * `profiles.user_id` is ON DELETE NO ACTION, so the profile row this endpoint writes blocks the
 * auth user's delete outright. Skipping it leaves every address behind, and the run after this
 * one meets its own leftovers as `duplicate_email` — the endpoint reported as broken by the
 * cleanup rather than by the code. CHECKED for the same reason resetMerchant's delete is.
 */
async function drop(address: string) {
  const svc = serviceClient()
  const id = await findUserByEmail(address)
  if (!id) return
  const { error: profileErr } = await svc.from('profiles').delete().eq('user_id', id)
  if (profileErr) throw new Error(`clearing profile for ${address}: ${profileErr.message}`)
  const { error } = await svc.auth.admin.deleteUser(id)
  if (error) throw new Error(`deleting ${address}: ${error.message}`)
}

// Both ends, not just the end: a run killed part-way leaves accounts behind, and a suite that
// only cleaned up afterwards would then fail on the next run for a reason that is not the code.
beforeAll(async () => { for (const tag of TAGS) await drop(email(tag)) })
afterAll(async () => { for (const tag of TAGS) await drop(email(tag)) })

describe('POST /api/merchant/signup', () => {
  it('creates an account that can sign in AT ONCE — no confirmation round trip', async () => {
    const address = email('happy')
    const res = await post({ email: address, password: PASSWORD, name: 'Fai', shop: SHOP }, '10.0.0.1')
    expect(res.status).toBe(200)

    // The whole point. A confirmation-gated account returns no session here.
    const { data, error } = await anonClient().auth.signInWithPassword({ email: address, password: PASSWORD })
    expect(error).toBeNull()
    expect(data.session).not.toBeNull()
  })

  it('parks the shop on the auth user in the spelling @bitetime/shared defines', async () => {
    const address = email('metadata')
    await post({ email: address, password: PASSWORD, name: 'Fai', shop: SHOP }, '10.0.0.2')

    const id = await findUserByEmail(address)
    const { data } = await serviceClient().auth.admin.getUserById(id!)
    expect(data.user?.user_metadata).toMatchObject({
      name: 'Fai',
      shop_name: SHOP.name,
      shop_business_nature: 'bakery',
      shop_currency: 'MYR',
      shop_billing: 'yearly',
    })
  })

  it('writes a global profile that is NOT a merchant — the role comes from owning a shop', async () => {
    const address = email('profile')
    await post({ email: address, password: PASSWORD, name: 'Fai', shop: SHOP }, '10.0.0.3')

    const id = await findUserByEmail(address)
    const { data } = await serviceClient()
      .from('profiles').select('name, app_role, merchant_id').eq('user_id', id!).is('merchant_id', null).single()
    expect(data).toMatchObject({ name: 'Fai', app_role: 'customer', merchant_id: null })
  })

  it('refuses a request with no shop, and creates no orphan account for it', async () => {
    const address = email('noshop')
    const res = await post({ email: address, password: PASSWORD, name: 'Fai' }, '10.0.0.4')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_shop' })
    expect(await findUserByEmail(address)).toBeNull()
  })

  it('refuses a shop whose name is only whitespace', async () => {
    const res = await post({ email: email('blank'), password: PASSWORD, shop: { ...SHOP, name: '   ' } }, '10.0.0.5')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_shop' })
  })

  it('holds the platform password floor, which is above Supabase’s own', async () => {
    const res = await post({ email: email('weak'), password: 'short', name: 'Fai', shop: SHOP }, '10.0.0.6')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'weak_password' })
  })

  it('refuses a malformed email before spending any rate-limit budget on it', async () => {
    const res = await post({ email: 'not-an-email', password: PASSWORD, name: 'Fai', shop: SHOP }, '10.0.0.7')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_email' })
  })

  it('says plainly that the address is taken, so a returning owner is told to log in', async () => {
    const address = email('dupe')
    expect((await post({ email: address, password: PASSWORD, name: 'Fai', shop: SHOP }, '10.0.0.8')).status).toBe(200)

    const again = await post({ email: address, password: PASSWORD, name: 'Fai', shop: SHOP }, '10.0.0.9')
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'duplicate_email' })
  })

  it('rate-limits one address, and reports it as 429 rather than as a refusal', async () => {
    const address = email('flood')
    // Three per address per hour. The fourth is the one under test; the first three are
    // deliberately allowed to succeed-or-conflict, because what is limited is ATTEMPTS.
    for (let i = 0; i < 3; i++) {
      await post({ email: address, password: PASSWORD, name: 'Fai', shop: SHOP }, `10.0.1.${i}`)
    }
    const res = await post({ email: address, password: PASSWORD, name: 'Fai', shop: SHOP }, '10.0.1.9')
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
  })
})
