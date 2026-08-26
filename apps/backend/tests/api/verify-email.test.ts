// tests/api/verify-email.test.ts
// The merchant address check: GET /api/me/verify-email, GET /api/merchant/verify-email and
// POST /api/me/verify-email/resend.
//
// This exists because merchant accounts are created PRE-CONFIRMED, so nothing else in the system
// ever proves the address is real. The properties worth holding are all about who can flip that
// flag: a token this backend did not sign must not, an expired one must not, and a link minted
// for an address the account no longer has must not — that last one being the exact case the
// feature was built for, a merchant correcting a typo.
//
// No mail leaves the process: RESEND_API_KEY is unset under this config, so resendSend logs and
// returns. What is asserted is the COLUMN, never a send.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { app } from '../../src/app.js'
import { makeEmailVerifyToken } from '../../src/emailVerifyToken.js'
import { EMAIL_VERIFY_TEST_SECRET } from '../../vitest.db.config.js'
import { anonClient, serviceClient, findUserByEmail } from '../rls/helpers.js'

const PASSWORD = 'hunter2hunter2'
const SHOP = { name: 'Verify Suite Bakes', businessNature: 'bakery', currency: 'MYR', billing: 'monthly' }

const TAGS = ['owner', 'stale', 'resend', 'flood']
const email = (tag: string) => `verify-email-${tag}@example.com`

async function drop(address: string) {
  const svc = serviceClient()
  const id = await findUserByEmail(address)
  if (!id) return
  const { error: profileErr } = await svc.from('profiles').delete().eq('user_id', id)
  if (profileErr) throw new Error(`clearing profile for ${address}: ${profileErr.message}`)
  const { error } = await svc.auth.admin.deleteUser(id)
  if (error) throw new Error(`deleting ${address}: ${error.message}`)
}

beforeAll(async () => { for (const tag of TAGS) await drop(email(tag)) })
afterAll(async () => { for (const tag of TAGS) await drop(email(tag)) })

/** Sign one merchant up through the real door, which is the only way to get an unverified one. */
async function signUp(tag: string, ip: string): Promise<{ address: string; userId: string }> {
  const address = email(tag)
  const res = await app.request('/api/merchant/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email: address, password: PASSWORD, name: 'Fai', shop: SHOP }),
  })
  if (res.status !== 200) throw new Error(`signup for ${address} returned ${res.status}`)
  return { address, userId: (await findUserByEmail(address))! }
}

async function tokenOf(address: string) {
  const { data } = await anonClient().auth.signInWithPassword({ email: address, password: PASSWORD })
  return data.session!.access_token
}

async function verifiedAt(userId: string): Promise<string | null> {
  const { data } = await serviceClient()
    .from('profiles').select('email_verified_at').eq('user_id', userId).is('merchant_id', null).single()
  return data?.email_verified_at ?? null
}

function click(token: string) {
  return app.request(`/api/merchant/verify-email?token=${encodeURIComponent(token)}`)
}

describe('the merchant address check', () => {
  it('reports a fresh merchant as configured but not yet verified', async () => {
    const { address } = await signUp('owner', '10.1.0.1')
    const res = await app.request('/api/me/verify-email', {
      headers: { Authorization: `Bearer ${await tokenOf(address)}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ configured: true, verified: false, email: address })
  })

  it('flips the column when the link is clicked, with no session on that device', async () => {
    const userId = (await findUserByEmail(email('owner')))!
    expect(await verifiedAt(userId)).toBeNull()

    // No Authorization header: the link is opened in a mail app, routinely on another phone.
    const res = await click(makeEmailVerifyToken(
      { userId, email: email('owner') }, EMAIL_VERIFY_TEST_SECRET, Date.now(),
    ))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('email_verified=1')
    expect(await verifiedAt(userId)).not.toBeNull()
  })

  it('refuses a token this backend did not sign, and changes nothing', async () => {
    const { address, userId } = await signUp('stale', '10.1.0.2')
    const forged = makeEmailVerifyToken({ userId, email: address }, 'not-our-secret', Date.now())

    const res = await click(forged)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('email_verified=0')
    expect(await verifiedAt(userId)).toBeNull()
  })

  it('refuses an expired link', async () => {
    const userId = (await findUserByEmail(email('stale')))!
    const longAgo = Date.now() - 8 * 24 * 60 * 60 * 1000
    const res = await click(makeEmailVerifyToken(
      { userId, email: email('stale') }, EMAIL_VERIFY_TEST_SECRET, longAgo,
    ))
    expect(res.headers.get('location')).toContain('email_verified=0')
    expect(await verifiedAt(userId)).toBeNull()
  })

  it('refuses a link minted for an address the account no longer has — the typo case', async () => {
    const userId = (await findUserByEmail(email('stale')))!
    // Signed correctly, but for the address they mistyped and have since corrected.
    const res = await click(makeEmailVerifyToken(
      { userId, email: 'the-typo@example.com' }, EMAIL_VERIFY_TEST_SECRET, Date.now(),
    ))
    expect(res.headers.get('location')).toContain('email_verified=0')
    expect(await verifiedAt(userId)).toBeNull()
  })

  it('refuses an unauthenticated resend', async () => {
    expect((await app.request('/api/me/verify-email/resend', { method: 'POST' })).status).toBe(401)
  })

  it('resends for a merchant who has not verified yet', async () => {
    const { address } = await signUp('resend', '10.1.0.3')
    const res = await app.request('/api/me/verify-email/resend', {
      method: 'POST', headers: { Authorization: `Bearer ${await tokenOf(address)}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, alreadyVerified: false })
  })

  it('answers an already-verified merchant with success, not an error', async () => {
    const res = await app.request('/api/me/verify-email/resend', {
      method: 'POST', headers: { Authorization: `Bearer ${await tokenOf(email('owner'))}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, alreadyVerified: true })
  })

  it('rate-limits resends per account', async () => {
    const { address } = await signUp('flood', '10.1.0.4')
    const auth = { Authorization: `Bearer ${await tokenOf(address)}` }
    for (let i = 0; i < 3; i++) {
      await app.request('/api/me/verify-email/resend', { method: 'POST', headers: auth })
    }
    const res = await app.request('/api/me/verify-email/resend', { method: 'POST', headers: auth })
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
  })
})
