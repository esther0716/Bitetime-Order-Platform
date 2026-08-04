// tests/api/trial-feedback-sweep.test.ts
// POST /api/internal/trial-feedback-sweep — the daily cron's entry point (#155). Not
// user-authenticated: a shared secret header is the only gate, so what matters here is that
// the gate actually holds, and that the sweep only ever touches a merchant once.
import { describe, it, expect, afterEach } from 'vitest'
import { app, trialFeedbackDeps } from '../../src/app.js'
import { env } from '../../src/env.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'

function sweep(secret?: string) {
  return app.request('/api/internal/trial-feedback-sweep', {
    method: 'POST',
    headers: secret !== undefined ? { 'x-sweep-secret': secret } : {},
  })
}

async function ownerIdOf(email: string) {
  const user = await makeUser(email, 'password123')
  const { data } = await user.auth.getSession()
  return data.session!.user.id
}

describe('POST /api/internal/trial-feedback-sweep', () => {
  afterEach(() => {
    trialFeedbackDeps.email = async () => {}
  })

  it('refuses with no secret configured', async () => {
    const saved = env.trialFeedbackSweepSecret
    env.trialFeedbackSweepSecret = ''
    try {
      expect((await sweep('anything')).status).toBe(503)
    } finally {
      env.trialFeedbackSweepSecret = saved
    }
  })

  it('refuses a missing or wrong header', async () => {
    expect((await sweep()).status).toBe(403)
    expect((await sweep('wrong-secret')).status).toBe(403)
  })

  it('emails a merchant whose trial ended and has never been surveyed, then never again', async () => {
    await resetMerchant('sweep-due-shop')
    const ownerId = await ownerIdOf('sweep-due-owner@example.com')
    const merchantId = await seedMerchant({ slug: 'sweep-due-shop', owner_id: ownerId })
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId, status: 'trialing', trial_ends_at: new Date(Date.now() - 60_000).toISOString(),
    })

    const sent: Array<{ to: string; subject: string }> = []
    trialFeedbackDeps.email = async (to, subject) => { sent.push({ to, subject }) }

    const res = await sweep(env.trialFeedbackSweepSecret)
    expect(res.status).toBe(200)
    const body = await res.json() as { due: number; sent: number }
    expect(body.sent).toBeGreaterThanOrEqual(1)
    expect(sent.some(m => m.to === 'sweep-due-owner@example.com')).toBe(true)

    const { data: row } = await serviceClient()
      .from('trial_feedback').select('*').eq('merchant_id', merchantId).maybeSingle()
    expect(row).toBeTruthy()
    expect(row!.responded_at).toBeNull()
    expect(row!.skipped_at).toBeNull()

    // A second sweep must not email this merchant again — the claim already exists.
    sent.length = 0
    await sweep(env.trialFeedbackSweepSecret)
    expect(sent.some(m => m.to === 'sweep-due-owner@example.com')).toBe(false)
  })

  it('never surveys a shop still inside its trial', async () => {
    await resetMerchant('sweep-not-due-shop')
    const ownerId = await ownerIdOf('sweep-not-due-owner@example.com')
    const merchantId = await seedMerchant({ slug: 'sweep-not-due-shop', owner_id: ownerId })
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId, status: 'trialing', trial_ends_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    })

    const sent: string[] = []
    trialFeedbackDeps.email = async (to) => { sent.push(to) }
    await sweep(env.trialFeedbackSweepSecret)
    expect(sent.includes('sweep-not-due-owner@example.com')).toBe(false)

    const { data: row } = await serviceClient()
      .from('trial_feedback').select('*').eq('merchant_id', merchantId).maybeSingle()
    expect(row).toBeNull()
  })

  it('releases the claim when the send fails, so the next sweep retries', async () => {
    await resetMerchant('sweep-retry-shop')
    const ownerId = await ownerIdOf('sweep-retry-owner@example.com')
    const merchantId = await seedMerchant({ slug: 'sweep-retry-shop', owner_id: ownerId })
    await serviceClient().from('merchant_billing').upsert({
      merchant_id: merchantId, status: 'trialing', trial_ends_at: new Date(Date.now() - 60_000).toISOString(),
    })

    trialFeedbackDeps.email = async () => { throw new Error('Resend outage') }
    await sweep(env.trialFeedbackSweepSecret)

    const { data: rowAfterFailure } = await serviceClient()
      .from('trial_feedback').select('*').eq('merchant_id', merchantId).maybeSingle()
    expect(rowAfterFailure).toBeNull() // claim released — not stuck as permanently "sent"

    trialFeedbackDeps.email = async () => {}
    const res = await sweep(env.trialFeedbackSweepSecret)
    const body = await res.json() as { sent: number }
    expect(body.sent).toBeGreaterThanOrEqual(1)
  })
})
