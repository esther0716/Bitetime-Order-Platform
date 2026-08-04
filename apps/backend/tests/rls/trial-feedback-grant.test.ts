// tests/rls/trial-feedback-grant.test.ts
// Belt on top of the code path: after the revoke, a browser (anon or authenticated) client
// cannot SELECT trial_feedback directly at all — mirrors billing-grant.test.ts. If this ever
// passes with rows, the grant crept back and the API is no longer the only door.
import { describe, it, expect } from 'vitest'
import { anonClient, makeUser, seedMerchant, serviceClient } from './helpers.js'

describe('trial_feedback is not directly readable by the browser', () => {
  it('denies an anonymous SELECT', async () => {
    const { data, error } = await anonClient().from('trial_feedback').select('*')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
    if (error) expect(error.message.toLowerCase()).toContain('permission denied')
  })

  it('denies an authenticated SELECT even for the merchant owner', async () => {
    const owner = await makeUser('trial-feedback-grant-owner@example.com', 'password123')
    const { data: session } = await owner.auth.getSession()
    const ownerId = session.session!.user.id
    const merchantId = await seedMerchant({ slug: 'trial-feedback-grant-shop', owner_id: ownerId })
    const { error: seedError } = await serviceClient().from('trial_feedback').insert({ merchant_id: merchantId })
    if (seedError) throw new Error(`seeding trial_feedback: ${seedError.message}`)

    const { data, error } = await owner.from('trial_feedback').select('*').eq('merchant_id', merchantId)

    expect(error).not.toBeNull()
    expect(error?.code === '42501' || error?.message.toLowerCase().includes('permission denied')).toBe(true)
    expect(data).toBeNull()
  })
})
