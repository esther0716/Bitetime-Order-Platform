// tests/api/trial-feedback-admin.test.ts
// GET /api/admin/trial-feedback — superadmin-only, ANSWERED responses only (#155).
import { describe, it, expect } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'

async function sessionOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function get(path: string, token?: string) {
  return app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
}

describe('GET /api/admin/trial-feedback', () => {
  it('refuses a non-superadmin', async () => {
    await resetMerchant('trial-feedback-admin-shop')
    const owner = await makeUser('trial-feedback-admin-owner@example.com', 'password123')
    const { token, userId } = await sessionOf(owner)
    await seedMerchant({ slug: 'trial-feedback-admin-shop', owner_id: userId })

    expect((await get('/api/admin/trial-feedback', token)).status).toBe(403)
  })

  it('lists an answered response joined with its shop, excluding a merely-sent or skipped one', async () => {
    await resetMerchant('trial-feedback-admin-answered-shop')
    await resetMerchant('trial-feedback-admin-pending-shop')
    await resetMerchant('trial-feedback-admin-skipped-shop')

    const answeredOwner = await makeUser('trial-feedback-admin-answered@example.com', 'password123')
    const { userId: answeredOwnerId } = await sessionOf(answeredOwner)
    const answeredId = await seedMerchant({ slug: 'trial-feedback-admin-answered-shop', owner_id: answeredOwnerId })
    await serviceClient().from('trial_feedback').insert({
      merchant_id: answeredId, rating: 5, comment: 'Great!', responded_at: new Date().toISOString(),
    })

    const pendingOwner = await makeUser('trial-feedback-admin-pending@example.com', 'password123')
    const { userId: pendingOwnerId } = await sessionOf(pendingOwner)
    const pendingId = await seedMerchant({ slug: 'trial-feedback-admin-pending-shop', owner_id: pendingOwnerId })
    await serviceClient().from('trial_feedback').insert({ merchant_id: pendingId })

    const skippedOwner = await makeUser('trial-feedback-admin-skipped@example.com', 'password123')
    const { userId: skippedOwnerId } = await sessionOf(skippedOwner)
    const skippedId = await seedMerchant({ slug: 'trial-feedback-admin-skipped-shop', owner_id: skippedOwnerId })
    await serviceClient().from('trial_feedback').insert({ merchant_id: skippedId, skipped_at: new Date().toISOString() })

    const superadmin = await makeUser('trial-feedback-admin-super@example.com', 'password123')
    const { data } = await superadmin.auth.getSession()
    await serviceClient().from('profiles').insert({
      user_id: data.session!.user.id, name: 'Super', app_role: 'superadmin',
    })
    const superToken = data.session!.access_token

    const res = await get('/api/admin/trial-feedback', superToken)
    expect(res.status).toBe(200)
    const items = await res.json() as Array<{ merchant_id: string; shop_name: string | null; rating: number | null }>

    expect(items.some(i =>
      i.merchant_id === answeredId && i.rating === 5 && i.shop_name === 'trial-feedback-admin-answered-shop',
    )).toBe(true)
    expect(items.some(i => i.merchant_id === pendingId)).toBe(false)
    expect(items.some(i => i.merchant_id === skippedId)).toBe(false)
  })
})
