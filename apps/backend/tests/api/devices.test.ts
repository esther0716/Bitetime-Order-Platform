// tests/api/devices.test.ts
// The merchant device limit, end to end against real GoTrue and real Postgres.
//
// The load-bearing assertions are that a third sign-in really removes the least recently used
// session, and that the removed session's UNEXPIRED access token stops working at once. Neither
// can be proven with a mock: they are properties of GoTrue and of `auth.sessions`, which is why
// this suite is here and not in tests/unit.
import { describe, it, expect, beforeEach } from 'vitest'
import { app } from '../../src/app.js'
import { sql } from '../../src/db.js'
import { makeUser, seedMerchant, resetMerchant, SUPABASE_URL, ANON_KEY } from '../rls/helpers.js'
import { MERCHANT_DEVICE_LIMIT } from '../../src/quotaWindows.js'

/** A fresh sign-in for an existing account. Each call creates one more GoTrue session. */
async function signInAgain(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json() as { access_token?: string }
  if (!body.access_token) throw new Error(`sign-in failed: ${JSON.stringify(body)}`)
  return body.access_token
}

function call(path: string, method: 'GET' | 'POST' | 'DELETE', token?: string) {
  return app.request(path, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

async function sessionCount(userId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`select count(*)::int as n from auth.sessions where user_id = ${userId}`
  return rows[0].n
}

async function sessionIdOf(userId: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`select id from auth.sessions where user_id = ${userId} limit 1`
  return rows[0].id
}

const PASSWORD = 'password123'

/** A merchant who owns an active shop, plus one signed-in session. */
async function merchantOwner(slug: string) {
  await resetMerchant(slug)
  const email = `${slug}@example.com`
  const client = await makeUser(email, PASSWORD)
  const { data } = await client.auth.getSession()
  const userId = data.session!.user.id
  await seedMerchant({ slug, owner_id: userId, status: 'active' })
  return { email, userId, token: data.session!.access_token }
}

beforeEach(async () => {
  // Sessions outlive a test unless they are cleared, and this suite counts them.
  await sql`delete from auth.sessions where user_id in (select id from auth.users where email like 'devices-%@example.com')`
})

describe('POST /api/me/devices/enforce', () => {
  it('evicts the least recently used session when a merchant signs in a third time', async () => {
    const owner = await merchantOwner('devices-lru')
    await signInAgain(owner.email, PASSWORD)
    const third = await signInAgain(owner.email, PASSWORD)
    expect(await sessionCount(owner.userId)).toBe(3)

    const res = await call('/api/me/devices/enforce', 'POST', third)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ evicted: 1 })
    expect(await sessionCount(owner.userId)).toBe(2)

    // The FIRST session is the one that went: it is the least recently used.
    const stillWorks = await call('/api/me/devices', 'GET', owner.token)
    expect(stillWorks.status).toBe(401)
  })

  it('leaves the calling session working after it evicts another', async () => {
    const owner = await merchantOwner('devices-keeps-current')
    await signInAgain(owner.email, PASSWORD)
    const third = await signInAgain(owner.email, PASSWORD)

    await call('/api/me/devices/enforce', 'POST', third)

    const res = await call('/api/me/devices', 'GET', third)
    expect(res.status).toBe(200)
  })

  it('evicts nothing when the merchant holds two sessions', async () => {
    const owner = await merchantOwner('devices-under-limit')
    const second = await signInAgain(owner.email, PASSWORD)

    const res = await call('/api/me/devices/enforce', 'POST', second)
    expect(await res.json()).toEqual({ evicted: 0 })
    expect(await sessionCount(owner.userId)).toBe(2)
  })

  it('leaves a customer account alone', async () => {
    // No merchants row. The limit is a merchant rule and a customer must pass through untouched.
    const email = 'devices-customer@example.com'
    const client = await makeUser(email, PASSWORD)
    const { data } = await client.auth.getSession()
    const userId = data.session!.user.id
    await signInAgain(email, PASSWORD)
    const third = await signInAgain(email, PASSWORD)

    const res = await call('/api/me/devices/enforce', 'POST', third)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ evicted: 0 })
    expect(await sessionCount(userId)).toBe(3)
  })

  it('refuses a caller with no token', async () => {
    const res = await call('/api/me/devices/enforce', 'POST')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/me/devices', () => {
  it('lists the caller’s own sessions and marks the current one', async () => {
    const owner = await merchantOwner('devices-list')
    const second = await signInAgain(owner.email, PASSWORD)

    const res = await call('/api/me/devices', 'GET', second)
    expect(res.status).toBe(200)
    const body = await res.json() as {
      devices: { id: string; browser: string | null; platform: string | null; current: boolean; lastSeen: string }[]
      limit: number
    }
    expect(body.devices).toHaveLength(2)
    expect(body.devices.filter(d => d.current)).toHaveLength(1)
    expect(new Date(body.devices[0].lastSeen).toString()).not.toBe('Invalid Date')
    // The ceiling is quoted to the browser rather than restated there, so the screen cannot go on
    // saying "2" the day MERCHANT_DEVICE_LIMIT changes.
    expect(body.limit).toBe(MERCHANT_DEVICE_LIMIT)
  })

  it('sends the device name as PARTS, never as a joined English phrase', async () => {
    // The join is prose and belongs to t(en, zh) in the browser. A finished "Chrome on macOS" from
    // the backend is untranslatable, and a Chinese merchant would read English here.
    const owner = await merchantOwner('devices-parts')
    const res = await call('/api/me/devices', 'GET', owner.token)
    const body = await res.json() as { devices: Record<string, unknown>[] }
    expect(body.devices[0]).not.toHaveProperty('label')
    expect(body.devices[0]).toHaveProperty('browser')
    expect(body.devices[0]).toHaveProperty('platform')
  })

  it('refuses an account that owns no shop', async () => {
    const client = await makeUser('devices-nolist@example.com', PASSWORD)
    const { data } = await client.auth.getSession()
    const res = await call('/api/me/devices', 'GET', data.session!.access_token)
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/me/devices/:sessionId', () => {
  it('signs the named device out', async () => {
    const owner = await merchantOwner('devices-remove')
    const second = await signInAgain(owner.email, PASSWORD)

    const list = await (await call('/api/me/devices', 'GET', second)).json() as {
      devices: { id: string; current: boolean }[]
    }
    const other = list.devices.find(d => !d.current)!

    const res = await call(`/api/me/devices/${other.id}`, 'DELETE', second)
    expect(res.status).toBe(200)
    expect(await sessionCount(owner.userId)).toBe(1)

    // The signed-out device's own token is dead immediately, not at the next refresh.
    expect((await call('/api/me/devices', 'GET', owner.token)).status).toBe(401)
  })

  it('refuses a session id belonging to another account', async () => {
    // `db.ts` runs no policy, so this refusal IS the tenancy boundary.
    const a = await merchantOwner('devices-owner-a')
    const b = await merchantOwner('devices-owner-b')

    const res = await call(`/api/me/devices/${await sessionIdOf(b.userId)}`, 'DELETE', a.token)
    expect(res.status).toBe(404)
    expect(await sessionCount(b.userId)).toBe(1)
  })

  it('refuses a session id that is not a uuid without a 500', async () => {
    const owner = await merchantOwner('devices-bad-id')
    const res = await call('/api/me/devices/not-a-uuid', 'DELETE', owner.token)
    expect(res.status).toBe(400)
  })
})
