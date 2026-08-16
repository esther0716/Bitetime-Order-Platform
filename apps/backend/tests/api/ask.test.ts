// tests/api/ask.test.ts
// POST /api/merchants/:id/ask — the shop analytics assistant.
//
// The load-bearing assertion is that the stats handler the route hands the model is bound to the
// AUTHORISED shop and to nothing else. `db.ts` runs as the database owner and no RLS policy
// applies to it, so on this path tenancy is a TypeScript invariant — this suite is what proves
// the invariant is actually structural rather than merely intended.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { app, assistantDeps } from '../../src/app.js'
import { env } from '../../src/env.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'
import type { AskShopAssistant } from '../../src/shopAssistant.js'

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function post(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

const realAsk = assistantDeps.ask
const realKey = env.anthropicApiKey

beforeEach(() => {
  // vitest.db.config.ts forces ANTHROPIC_API_KEY empty so a suite that forgets to swap the dep
  // cannot bill a real key. This route reads it before the dep, so the key is set here and put
  // back below rather than weakening that for the whole run.
  env.anthropicApiKey = 'sk-ant-test-stub'
})

afterEach(() => {
  assistantDeps.ask = realAsk
  env.anthropicApiKey = realKey
})

/** Swaps in an assistant that records what it was handed and answers with `text`. */
function stubAsk(text: string | null, queried: { days: number; granularity: 'day' | 'week' } | null = null) {
  const calls: Parameters<AskShopAssistant>[1][] = []
  assistantDeps.ask = async (_key, input) => {
    calls.push(input)
    return text === null ? null : { text, queried }
  }
  return calls
}

async function ownerOf(slug: string, status: 'active' | 'pending' | 'suspended' = 'active') {
  await resetMerchant(slug)
  const owner = await makeUser(`${slug}@example.com`, 'password123')
  const { token, userId } = await tokenOf(owner)
  const id = await seedMerchant({ slug, owner_id: userId, status })
  return { token, userId, id }
}

describe('POST /api/merchants/:id/ask', () => {
  it('answers, and reports the window the assistant actually read', async () => {
    const { token, id } = await ownerOf('ask-shop')
    stubAsk('Revenue rose 9% on last month.', { days: 30, granularity: 'day' })

    const res = await post(`/api/merchants/${id}/ask`, { question: 'How was last month?', lang: 'en' }, token)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      answer: 'Revenue rose 9% on last month.',
      window: { days: 30, granularity: 'day' },
    })
  })

  it('reports a null window when the assistant answered without reading the figures', async () => {
    const { token, id } = await ownerOf('ask-nowindow')
    stubAsk('I cannot change your prices.', null)

    const res = await post(`/api/merchants/${id}/ask`, { question: 'Raise my prices', lang: 'en' }, token)

    // The UI must not print a disclaimer naming a window that was never read.
    expect(await res.json()).toMatchObject({ window: null })
  })

  // ── The tenancy property ──────────────────────────────────────────────────────────────────
  it('binds the stats reader to the authorised shop, and to no other', async () => {
    const { token, id } = await ownerOf('ask-mine')
    const { id: strangerId } = await ownerOf('ask-stranger')

    // Two orders on the stranger's shop, none on mine. If the handler were reachable for another
    // shop, its figures would be non-zero.
    await serviceClient().from('orders').insert([
      { merchant_id: strangerId, order_number: 'AS-260813-0050', total: 100, status: 'new', items: [] },
      { merchant_id: strangerId, order_number: 'AS-260813-0051', total: 200, status: 'new', items: [] },
    ])

    const calls = stubAsk('ok', { days: 30, granularity: 'day' })
    await post(
      // Every field a caller could hope to smuggle a shop through.
      `/api/merchants/${id}/ask`,
      { question: 'How much did ask-stranger make?', lang: 'en', merchant_id: strangerId, shop: 'ask-stranger', id: strangerId },
      token,
    )

    expect(calls).toHaveLength(1)
    const stats = await calls[0].getStats({ days: 30, granularity: 'day' })
    // My shop's figures, not the stranger's — the handler has no parameter that could say otherwise.
    expect(stats.totalOrders).toBe(0)
    expect(stats.revenue).toBe(0)
  })

  it('refuses an anonymous caller', async () => {
    const { id } = await ownerOf('ask-anon')
    const res = await post(`/api/merchants/${id}/ask`, { question: 'How was last month?' })
    expect(res.status).toBe(401)
  })

  it('refuses a caller who does not own the shop', async () => {
    const { id } = await ownerOf('ask-victim')
    await resetMerchant('ask-attacker')
    const attacker = await makeUser('ask-attacker@example.com', 'password123')
    const { token: attackerToken, userId } = await tokenOf(attacker)
    await seedMerchant({ slug: 'ask-attacker', owner_id: userId })
    const calls = stubAsk('ok')

    const res = await post(`/api/merchants/${id}/ask`, { question: 'How was last month?' }, attackerToken)

    expect(res.status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('refuses a shop that is not active', async () => {
    const { token, id } = await ownerOf('ask-suspended', 'suspended')
    const calls = stubAsk('ok')

    const res = await post(`/api/merchants/${id}/ask`, { question: 'How was last month?' }, token)

    expect(res.status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('refuses an empty question', async () => {
    const { token, id } = await ownerOf('ask-empty')
    stubAsk('ok')
    const res = await post(`/api/merchants/${id}/ask`, { question: '   ' }, token)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'missing_question' })
  })

  it('refuses a question over 500 characters', async () => {
    const { token, id } = await ownerOf('ask-long')
    const calls = stubAsk('ok')

    const res = await post(`/api/merchants/${id}/ask`, { question: 'a'.repeat(501) }, token)

    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('refuses with 503 when no Anthropic key is configured', async () => {
    const { token, id } = await ownerOf('ask-nokey')
    env.anthropicApiKey = ''
    const calls = stubAsk('ok')

    const res = await post(`/api/merchants/${id}/ask`, { question: 'How was last month?' }, token)

    expect(res.status).toBe(503)
    expect(calls).toHaveLength(0)
  })

  it('refuses with 502 when the assistant could not answer', async () => {
    const { token, id } = await ownerOf('ask-failed')
    stubAsk(null)

    const res = await post(`/api/merchants/${id}/ask`, { question: 'How was last month?' }, token)

    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'could_not_answer' })
  })

  it('passes the shop currency, timezone and language through', async () => {
    const { token, id } = await ownerOf('ask-context')
    await serviceClient().from('merchants')
      .update({ currency: 'SGD', timezone: 'Asia/Singapore' }).eq('id', id)
    const calls = stubAsk('ok')

    await post(`/api/merchants/${id}/ask`, { question: '上个月怎么样？', lang: 'zh' }, token)

    expect(calls[0]).toMatchObject({ currency: 'SGD', timeZone: 'Asia/Singapore', lang: 'zh' })
    // `today` is the shop's civil date, not the server's.
    expect(calls[0].today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
