// tests/api/ai-usage.test.ts
// The MONTHLY ceiling on the platform's Anthropic spend, and the two routes that draw on it.
//
// This suite is DB-backed for the reason the ceiling is DB-backed at all: the daily windows are
// in memory and a redeploy clears them, which over a month means there is no ceiling. A version
// of this proved against a stubbed counter would assert that the code calls a function, not that
// a shop's allowance survives a restart — which is the only property worth having.
//
// The counter cannot be driven to its ceiling through a route: the DAILY window (20 imports, 50
// questions) refuses long before the monthly figure is reached, which is exactly the layering the
// design intends. So the module is tested directly with a small limit, and the routes are tested
// against a row seeded at the real ceiling.
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { app, assistantDeps, menuImportDeps } from '../../src/app.js'
import { env } from '../../src/env.js'
import { sql } from '../../src/db.js'
import { consumeAiCall } from '../../src/aiUsageDb.js'
import { usagePeriod, LIFETIME_PERIOD } from '../../src/aiUsage.js'
import { MENU_IMPORT_LIFETIME_LIMIT, MENU_IMPORT_MONTHLY_LIMIT, ASSISTANT_MONTHLY_LIMIT } from '../../src/quotaWindows.js'
import { makeUser, seedMerchant, resetMerchant } from '../rls/helpers.js'

const realAsk = assistantDeps.ask
const realExtract = menuImportDeps.extract
const realKey = env.anthropicApiKey

beforeEach(() => {
  // Same reason as tests/api/ask.test.ts: vitest.db.config.ts forces the key empty so a suite
  // that forgets to swap the dep cannot bill a real key. Both routes read it before the quota.
  env.anthropicApiKey = 'sk-ant-test-stub'
})

afterEach(() => {
  assistantDeps.ask = realAsk
  menuImportDeps.extract = realExtract
  env.anthropicApiKey = realKey
})

afterAll(async () => {
  // The merchants go with resetMerchant; ai_usage rows cascade with them. This clears the rows
  // written under ids that no longer exist by the time this runs.
  await sql`delete from ai_usage where merchant_id not in (select id from merchants)`
})

async function ownerOf(slug: string) {
  await resetMerchant(slug)
  const owner = await makeUser(`${slug}@example.com`, 'password123')
  const { data } = await owner.auth.getSession()
  const token = data.session!.access_token
  const id = await seedMerchant({ slug, owner_id: data.session!.user.id, status: 'active' })
  return { token, id }
}

function post(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

/** Put a shop at a bucket's ceiling, the way a shop that spent it all would be. */
async function seedAtCeiling(
  merchantId: string,
  feature: 'menu_import' | 'assistant',
  calls: number,
  period = usagePeriod('Asia/Kuala_Lumpur', new Date()),
) {
  await sql`
    insert into ai_usage (merchant_id, feature, period, calls)
    values (${merchantId}, ${feature}, ${period}, ${calls})
    on conflict (merchant_id, feature, period) do update set calls = ${calls}
  `
  return period
}

/** Spends a shop's whole menu-import setup grant, so the next import draws on the month. */
function exhaustLifetimeGrant(merchantId: string) {
  return seedAtCeiling(merchantId, 'menu_import', MENU_IMPORT_LIFETIME_LIMIT, LIFETIME_PERIOD)
}

async function callsFor(
  merchantId: string,
  feature: 'menu_import' | 'assistant',
  period = usagePeriod('Asia/Kuala_Lumpur', new Date()),
) {
  const rows = await sql<{ calls: number }[]>`
    select calls from ai_usage
     where merchant_id = ${merchantId} and feature = ${feature} and period = ${period}
  `
  return rows[0]?.calls ?? 0
}

describe('consumeAiCall', () => {
  // A fixed period, not the current one: these tests write and read the same bucket, and the
  // bucket must not change under them when the calendar month turns over.
  const PERIOD = '2026-08'
  const NEXT_PERIOD = '2026-09'

  it('allows exactly the limit, then refuses', async () => {
    const { id } = await ownerOf('aiu-ceiling')

    for (let i = 0; i < 3; i++) {
      expect(await consumeAiCall({ merchantId: id, feature: 'assistant', period: PERIOD, limit: 3 }),
        `call ${i + 1} should be allowed`).toBe(true)
    }

    expect(await consumeAiCall({ merchantId: id, feature: 'assistant', period: PERIOD, limit: 3 })).toBe(false)
  })

  it('writes nothing when it refuses', async () => {
    const { id } = await ownerOf('aiu-norecord')
    await consumeAiCall({ merchantId: id, feature: 'assistant', period: PERIOD, limit: 1 })
    await consumeAiCall({ merchantId: id, feature: 'assistant', period: PERIOD, limit: 1 })

    // A refusal that still incremented would push the count past the ceiling, and the next month
    // would start from a number nobody spent.
    expect(await callsFor(id, 'assistant', PERIOD)).toBe(1)
  })

  it('gives each feature its own budget', async () => {
    const { id } = await ownerOf('aiu-features')
    await consumeAiCall({ merchantId: id, feature: 'assistant', period: PERIOD, limit: 1 })

    // A menu photo costs several times a question, which is why they are two budgets and not one.
    expect(await consumeAiCall({ merchantId: id, feature: 'menu_import', period: PERIOD, limit: 1 })).toBe(true)
  })

  it('gives each shop its own budget', async () => {
    const { id: mine } = await ownerOf('aiu-mine')
    const { id: theirs } = await ownerOf('aiu-theirs')
    await consumeAiCall({ merchantId: mine, feature: 'assistant', period: PERIOD, limit: 1 })

    expect(await consumeAiCall({ merchantId: theirs, feature: 'assistant', period: PERIOD, limit: 1 })).toBe(true)
  })

  it('gives back the allowance in the next month', async () => {
    const { id } = await ownerOf('aiu-rollover')
    await consumeAiCall({ merchantId: id, feature: 'assistant', period: PERIOD, limit: 1 })

    expect(await consumeAiCall({ merchantId: id, feature: 'assistant', period: NEXT_PERIOD, limit: 1 })).toBe(true)
  })

  it('refuses a limit of zero rather than letting the first call through', async () => {
    const { id } = await ownerOf('aiu-zero')
    // The insert arm has no row to compare against, so a zero limit is checked before the query.
    expect(await consumeAiCall({ merchantId: id, feature: 'assistant', period: PERIOD, limit: 0 })).toBe(false)
    expect(await callsFor(id, 'assistant', PERIOD)).toBe(0)
  })

  it('holds concurrent calls to the ceiling', async () => {
    const { id } = await ownerOf('aiu-race')

    // Ten at once against a ceiling of three. A read-then-write counter lets more than three
    // through here; the single conflicting insert does not.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeAiCall({ merchantId: id, feature: 'assistant', period: PERIOD, limit: 3 })),
    )

    expect(results.filter(Boolean)).toHaveLength(3)
    expect(await callsFor(id, 'assistant', PERIOD)).toBe(3)
  })
})

describe('the monthly ceiling on the AI routes', () => {
  it('refuses a question once the month is spent, and does not call Claude', async () => {
    const { token, id } = await ownerOf('aiu-ask-spent')
    await seedAtCeiling(id, 'assistant', ASSISTANT_MONTHLY_LIMIT)
    let called = false
    assistantDeps.ask = async () => { called = true; return { text: 'ok', queried: null } }

    const res = await post(`/api/merchants/${id}/ask`, { question: 'How was last month?' }, token)

    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({
      error: 'monthly_limit_reached',
      limit: ASSISTANT_MONTHLY_LIMIT,
      resets: expect.stringMatching(/^\d{4}-\d{2}-01$/),
    })
    // The point of the ceiling: the spend does not happen.
    expect(called).toBe(false)
  })

  it('refuses a menu photo once BOTH the setup grant and the month are spent', async () => {
    const { token, id } = await ownerOf('aiu-import-spent')
    await exhaustLifetimeGrant(id)
    await seedAtCeiling(id, 'menu_import', MENU_IMPORT_MONTHLY_LIMIT)
    let called = false
    menuImportDeps.extract = async () => { called = true; return { items: [] } }

    const res = await post(
      `/api/merchants/${id}/menu-import`,
      { image: 'AAAA', media_type: 'image/jpeg' },
      token,
    )

    expect(res.status).toBe(429)
    // The MONTHLY figure, never the grant's: a merchant whose setup allowance is gone must not be
    // told to wait for it to return, because it never does. What comes back on the 1st is this.
    expect(await res.json()).toMatchObject({
      error: 'monthly_limit_reached',
      limit: MENU_IMPORT_MONTHLY_LIMIT,
      resets: expect.stringMatching(/^\d{4}-\d{2}-01$/),
    })
    expect(called).toBe(false)
  })

  // ── The two buckets ───────────────────────────────────────────────────────────────────────
  it('spends the setup grant first, leaving the month untouched', async () => {
    const { token, id } = await ownerOf('aiu-grant-first')
    menuImportDeps.extract = async () => ({ items: [] })

    await post(`/api/merchants/${id}/menu-import`, { image: 'AAAA', media_type: 'image/jpeg' }, token)

    // A merchant photographing their menu for the first time draws on the once-ever grant. If
    // this spent the month instead, five photos would exhaust a year's ongoing allowance in the
    // first afternoon.
    expect(await callsFor(id, 'menu_import', LIFETIME_PERIOD)).toBe(1)
    expect(await callsFor(id, 'menu_import')).toBe(0)
  })

  it('falls through to the month once the setup grant is gone', async () => {
    const { token, id } = await ownerOf('aiu-grant-spent')
    await exhaustLifetimeGrant(id)
    menuImportDeps.extract = async () => ({ items: [] })

    const res = await post(
      `/api/merchants/${id}/menu-import`,
      { image: 'AAAA', media_type: 'image/jpeg' },
      token,
    )

    // The grant running out is not the end of the feature — a shop still gets a few a month for
    // a new page or a seasonal change.
    expect(res.status).toBe(200)
    expect(await callsFor(id, 'menu_import', LIFETIME_PERIOD)).toBe(MENU_IMPORT_LIFETIME_LIMIT)
    expect(await callsFor(id, 'menu_import')).toBe(1)
  })

  it('gives the assistant no setup grant — its allowance is monthly only', async () => {
    const { token, id } = await ownerOf('aiu-ask-nogrant')
    assistantDeps.ask = async () => ({ text: 'ok', queried: null })

    await post(`/api/merchants/${id}/ask`, { question: 'How was last month?' }, token)

    // Asking questions is the ongoing use of the feature, not a setup burst, so there is no
    // once-ever bucket to spend.
    expect(await callsFor(id, 'assistant', LIFETIME_PERIOD)).toBe(0)
    expect(await callsFor(id, 'assistant')).toBe(1)
  })

  it('spends one unit on a question that is answered', async () => {
    const { token, id } = await ownerOf('aiu-ask-spends')
    assistantDeps.ask = async () => ({ text: 'ok', queried: null })

    await post(`/api/merchants/${id}/ask`, { question: 'How was last month?' }, token)

    expect(await callsFor(id, 'assistant')).toBe(1)
  })

  it('spends nothing on a call the key check already refuses', async () => {
    const { token, id } = await ownerOf('aiu-nokey')
    env.anthropicApiKey = ''
    assistantDeps.ask = async () => ({ text: 'ok', queried: null })

    const res = await post(`/api/merchants/${id}/ask`, { question: 'How was last month?' }, token)

    expect(res.status).toBe(503)
    // An unconfigured platform must never spend a merchant's allowance answering 503.
    expect(await callsFor(id, 'assistant')).toBe(0)
  })

  it('spends nothing on a call refused before the model, and counts one that reaches it', async () => {
    const { token, id } = await ownerOf('aiu-order')
    assistantDeps.ask = async () => ({ text: 'ok', queried: null })

    // Refused on the question, which is checked ahead of the ceiling.
    await post(`/api/merchants/${id}/ask`, { question: '   ' }, token)
    expect(await callsFor(id, 'assistant')).toBe(0)

    await post(`/api/merchants/${id}/ask`, { question: 'How was last month?' }, token)
    expect(await callsFor(id, 'assistant')).toBe(1)
  })

  it('counts a unit against the shop that asked, and no other', async () => {
    const { token, id } = await ownerOf('aiu-attrib-mine')
    const { id: strangerId } = await ownerOf('aiu-attrib-other')
    assistantDeps.ask = async () => ({ text: 'ok', queried: null })

    await post(`/api/merchants/${id}/ask`, { question: 'How was last month?', merchant_id: strangerId }, token)

    expect(await callsFor(id, 'assistant')).toBe(1)
    expect(await callsFor(strangerId, 'assistant')).toBe(0)
  })
})
