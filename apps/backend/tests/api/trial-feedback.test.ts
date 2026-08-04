// tests/api/trial-feedback.test.ts
// GET/POST /api/trial-feedback[/respond|/skip] — the merchant's own view of the survey
// (#155). requireOwnMerchant scopes every route to the caller's own shop, so there is no
// :id to spoof; what matters here is the one-shot state machine (pending → answered XOR
// skipped, never both, never twice).
import { describe, it, expect } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function get(path: string, token?: string) {
  return app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
}

function post(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('trial feedback — own merchant', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await get('/api/trial-feedback')).status).toBe(401)
    expect((await post('/api/trial-feedback/respond', { rating: 5 })).status).toBe(401)
    expect((await post('/api/trial-feedback/skip', undefined)).status).toBe(401)
  })

  it('returns null when no survey has been sent yet', async () => {
    await resetMerchant('trial-feedback-none-shop')
    const owner = await makeUser('trial-feedback-none@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    await seedMerchant({ slug: 'trial-feedback-none-shop', owner_id: userId })

    const res = await get('/api/trial-feedback', token)
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it('refuses respond and skip when no survey has been sent', async () => {
    await resetMerchant('trial-feedback-unsent-shop')
    const owner = await makeUser('trial-feedback-unsent@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    await seedMerchant({ slug: 'trial-feedback-unsent-shop', owner_id: userId })

    expect((await post('/api/trial-feedback/respond', { rating: 5 }, token)).status).toBe(404)
    expect((await post('/api/trial-feedback/skip', undefined, token)).status).toBe(404)
  })

  it('lets the owner answer a pending survey, and refuses a second answer', async () => {
    await resetMerchant('trial-feedback-pending-shop')
    const owner = await makeUser('trial-feedback-pending@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'trial-feedback-pending-shop', owner_id: userId })
    await serviceClient().from('trial_feedback').insert({ merchant_id: merchantId })

    const getBefore = await get('/api/trial-feedback', token)
    const before = await getBefore.json() as { responded_at: string | null; skipped_at: string | null }
    expect(before.responded_at).toBeNull()
    expect(before.skipped_at).toBeNull()

    const res = await post('/api/trial-feedback/respond', { rating: 4, comment: 'Pretty good' }, token)
    expect(res.status).toBe(200)
    const row = await res.json() as { rating: number; comment: string; responded_at: string | null }
    expect(row.rating).toBe(4)
    expect(row.comment).toBe('Pretty good')
    expect(row.responded_at).not.toBeNull()

    const second = await post('/api/trial-feedback/respond', { rating: 1 }, token)
    expect(second.status).toBe(409)
  })

  it('rejects an out-of-range rating', async () => {
    await resetMerchant('trial-feedback-badrating-shop')
    const owner = await makeUser('trial-feedback-badrating@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'trial-feedback-badrating-shop', owner_id: userId })
    await serviceClient().from('trial_feedback').insert({ merchant_id: merchantId })

    const res = await post('/api/trial-feedback/respond', { rating: 9 }, token)
    expect(res.status).toBe(400)
  })

  it('lets the owner skip a pending survey, and refuses answering after skipping', async () => {
    await resetMerchant('trial-feedback-skip-shop')
    const owner = await makeUser('trial-feedback-skip@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const merchantId = await seedMerchant({ slug: 'trial-feedback-skip-shop', owner_id: userId })
    await serviceClient().from('trial_feedback').insert({ merchant_id: merchantId })

    const res = await post('/api/trial-feedback/skip', undefined, token)
    expect(res.status).toBe(200)
    const row = await res.json() as { skipped_at: string | null }
    expect(row.skipped_at).not.toBeNull()

    const after = await post('/api/trial-feedback/respond', { rating: 5 }, token)
    expect(after.status).toBe(409)
  })
})
