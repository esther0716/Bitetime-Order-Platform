// tests/api/feedback.test.ts
// Merchant platform feedback (#89), driven in-process.
//
// The load-bearing assertions are the two the service-role client makes possible to get
// wrong: a merchant must not be able to file feedback against a shop they do not own, and
// a body carrying merchant_id / user_id / status must not be believed. admin is RLS-exempt,
// so requireMerchantOwns and the field-by-field build in validateFeedback are the ONLY
// things standing between a merchant and another shop's record. See CLAUDE.md → Backend.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { app, feedbackWindow, githubDeps } from '../../src/app.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function post(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

function get(path: string, token?: string) {
  return app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
}

function patch(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

type FeedbackRow = {
  id: string; merchant_id: string; user_id: string
  category: string; message: string; status: string; resolved_at: string | null
  image_paths: string[]
}

// Smallest valid PNG (1x1). The bucket enforces allowed_mime_types, so a fake body would be
// refused by Storage for a reason that has nothing to do with the route under test.
const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)
function pngFile(name: string) {
  return new File([PNG_1X1], name, { type: 'image/png' })
}

// Multipart submit. No Content-Type header: Request writes the boundary itself, and setting the
// header by hand produces a body the server cannot parse.
function postForm(path: string, fields: Record<string, string>, files: File[], token?: string) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  for (const f of files) form.append('images', f)
  return app.request(path, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
}

describe('merchant feedback', () => {
  let ownerToken: string
  let ownerId: string
  let ownShopId: string
  let strangerShopId: string
  let superToken: string

  const origCreateIssue = githubDeps.createIssue
  const origCloseIssue = githubDeps.closeIssue
  const origReopenIssue = githubDeps.reopenIssue

  afterAll(() => {
    githubDeps.createIssue = origCreateIssue
    githubDeps.closeIssue = origCloseIssue
    githubDeps.reopenIssue = origReopenIssue
  })

  beforeAll(async () => {
    await resetMerchant('feedback-own-shop')
    await resetMerchant('feedback-stranger-shop')

    const owner = await makeUser('feedback-owner@example.com', 'password123')
    const owned = await tokenOf(owner)
    ownerToken = owned.token
    ownerId = owned.userId
    ownShopId = await seedMerchant({ slug: 'feedback-own-shop', owner_id: ownerId })

    const stranger = await makeUser('feedback-stranger@example.com', 'password123')
    const strangerIds = await tokenOf(stranger)
    strangerShopId = await seedMerchant({ slug: 'feedback-stranger-shop', owner_id: strangerIds.userId })

    const superClient = await makeUser('feedback-super@example.com', 'password123')
    const superIds = await tokenOf(superClient)
    const svc = serviceClient()
    await svc.from('profiles').delete().eq('user_id', superIds.userId)
    await svc.from('profiles').insert({ user_id: superIds.userId, name: 'Super', app_role: 'superadmin' })
    superToken = superIds.token
  })

  it('stores feedback for the shop the caller owns', async () => {
    const res = await post(`/api/merchants/${ownShopId}/feedback`, {
      category: 'bug', message: '  the orders tab is blank on mobile  ',
    }, ownerToken)

    expect(res.status).toBe(201)
    const row = (await res.json()) as FeedbackRow
    expect(row.merchant_id).toBe(ownShopId)
    expect(row.user_id).toBe(ownerId)
    expect(row.category).toBe('bug')
    expect(row.message).toBe('the orders tab is blank on mobile')
    expect(row.status).toBe('open')
    expect(row.resolved_at).toBeNull()
  })

  it('stores a multipart submission and stamps one storage path per screenshot', async () => {
    const res = await postForm(
      `/api/merchants/${ownShopId}/feedback`,
      { category: 'bug', message: 'the orders tab is blank on mobile' },
      [pngFile('a.png'), pngFile('b.png')],
      ownerToken,
    )

    expect(res.status).toBe(201)
    const row = (await res.json()) as FeedbackRow & { images_failed: number }
    expect(row.merchant_id).toBe(ownShopId)
    expect(row.message).toBe('the orders tab is blank on mobile')
    expect(row.images_failed).toBe(0)
    expect(row.image_paths).toHaveLength(2)
    // Merchant-first, feedback-id second — a prefix delete removes a merchant's screenshots,
    // and one report's images are one folder.
    for (const p of row.image_paths) {
      expect(p.startsWith(`${ownShopId}/${row.id}/`)).toBe(true)
      expect(p.endsWith('.png')).toBe(true)
    }

    // The paths are on the ROW, not just in the response — the response could be right while
    // updateFeedbackImages silently failed.
    const { data: stored } = await serviceClient()
      .from('merchant_feedback').select('image_paths').eq('id', row.id).single()
    expect(stored!.image_paths).toEqual(row.image_paths)

    // And the bytes are really in the bucket, not just the paths in the row.
    const { data, error } = await serviceClient().storage
      .from('feedback-images').download(row.image_paths[0])
    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  it('accepts a JSON submission with no screenshots, and stores an empty array', async () => {
    const res = await post(`/api/merchants/${ownShopId}/feedback`, {
      category: 'other', message: 'no screenshots here',
    }, ownerToken)

    expect(res.status).toBe(201)
    const row = (await res.json()) as FeedbackRow & { images_failed: number }
    expect(row.image_paths).toEqual([])
    expect(row.images_failed).toBe(0)
  })

  it('refuses a fourth screenshot, and writes no row at all', async () => {
    const before = await serviceClient()
      .from('merchant_feedback').select('id').eq('merchant_id', ownShopId)

    const res = await postForm(
      `/api/merchants/${ownShopId}/feedback`,
      { category: 'bug', message: 'four is too many' },
      [pngFile('a.png'), pngFile('b.png'), pngFile('c.png'), pngFile('d.png')],
      ownerToken,
    )
    expect(res.status).toBe(400)

    const after = await serviceClient()
      .from('merchant_feedback').select('id').eq('merchant_id', ownShopId)
    expect(after.data!.length).toBe(before.data!.length)
  })

  it('refuses a file type the bucket would not take, and writes no row at all', async () => {
    const before = await serviceClient()
      .from('merchant_feedback').select('id').eq('merchant_id', ownShopId)

    const res = await postForm(
      `/api/merchants/${ownShopId}/feedback`,
      { category: 'bug', message: 'wrong type' },
      [new File([new Uint8Array([1, 2, 3])], 'notes.pdf', { type: 'application/pdf' })],
      ownerToken,
    )
    expect(res.status).toBe(400)

    const after = await serviceClient()
      .from('merchant_feedback').select('id').eq('merchant_id', ownShopId)
    expect(after.data!.length).toBe(before.data!.length)
  })

  it('still refuses a multipart submission against a shop the caller does not own', async () => {
    const res = await postForm(
      `/api/merchants/${strangerShopId}/feedback`,
      { category: 'other', message: 'not my shop' },
      [pngFile('a.png')],
      ownerToken,
    )
    expect(res.status).toBe(403)
  })

  it('tells the GitHub issue how many screenshots landed', async () => {
    let seenBody = ''
    githubDeps.createIssue = async (_token, input) => {
      seenBody = input.body
      return { number: 1, html_url: 'https://example.test/issues/1' }
    }

    await postForm(
      `/api/merchants/${ownShopId}/feedback`,
      { category: 'bug', message: 'count check' },
      [pngFile('a.png')],
      ownerToken,
    )

    expect(seenBody).toContain('Screenshots: 1')
    expect(seenBody).not.toMatch(/feedback-images/)
    githubDeps.createIssue = origCreateIssue
  })

  describe('reading a feedback screenshot', () => {
    let feedbackId: string

    beforeAll(async () => {
      const res = await postForm(
        `/api/merchants/${ownShopId}/feedback`,
        { category: 'bug', message: 'screenshot read fixture' },
        [pngFile('read-me.png')],
        ownerToken,
      )
      feedbackId = ((await res.json()) as FeedbackRow).id
    })

    it('hands a superadmin the bytes, typed as the image it is', async () => {
      const res = await get(`/api/admin/feedback/${feedbackId}/images/0`, superToken)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('image/png')
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0)
    })

    it('404s an index past the end rather than reaching for a neighbouring path', async () => {
      expect((await get(`/api/admin/feedback/${feedbackId}/images/1`, superToken)).status).toBe(404)
      expect((await get(`/api/admin/feedback/${feedbackId}/images/-1`, superToken)).status).toBe(404)
      expect((await get(`/api/admin/feedback/${feedbackId}/images/abc`, superToken)).status).toBe(404)
    })

    it('404s an unknown feedback id — a guess and a real id with no images look identical', async () => {
      const res = await get('/api/admin/feedback/00000000-0000-0000-0000-000000000000/images/0', superToken)
      expect(res.status).toBe(404)
    })

    it('refuses the merchant who sent it — this is a superadmin surface', async () => {
      expect((await get(`/api/admin/feedback/${feedbackId}/images/0`, ownerToken)).status).toBe(403)
    })

    it('refuses an anonymous caller with 401', async () => {
      expect((await get(`/api/admin/feedback/${feedbackId}/images/0`)).status).toBe(401)
    })
  })

  it('refuses feedback filed against a shop the caller does not own', async () => {
    const res = await post(`/api/merchants/${strangerShopId}/feedback`, {
      category: 'other', message: 'not my shop',
    }, ownerToken)
    expect(res.status).toBe(403)
  })

  it('rejects an anonymous submission with 401', async () => {
    const res = await post(`/api/merchants/${ownShopId}/feedback`, { category: 'other', message: 'hi' })
    expect(res.status).toBe(401)
  })

  it('ignores merchant_id, user_id and status supplied in the body', async () => {
    const res = await post(`/api/merchants/${ownShopId}/feedback`, {
      category: 'billing', message: 'charged twice',
      merchant_id: strangerShopId, user_id: '00000000-0000-0000-0000-000000000000',
      status: 'resolved',
    }, ownerToken)

    expect(res.status).toBe(201)
    const row = (await res.json()) as FeedbackRow
    expect(row.merchant_id).toBe(ownShopId)
    expect(row.user_id).toBe(ownerId)
    expect(row.status).toBe('open')
  })

  it('400s on an unknown category and on an empty message', async () => {
    expect((await post(`/api/merchants/${ownShopId}/feedback`,
      { category: 'complaint', message: 'hello' }, ownerToken)).status).toBe(400)
    expect((await post(`/api/merchants/${ownShopId}/feedback`,
      { category: 'other', message: '   ' }, ownerToken)).status).toBe(400)
  })

  it('lists feedback newest-first to a superadmin — the freshest post lands first, with the shop attached', async () => {
    // Every prior row in `mine` shares this same shop, so a naive "is mine[0] my shop"
    // check can't fail no matter what order the rows come back in. Post one more row
    // right here and assert it — the one we KNOW is newest — is first; that only holds
    // if listFeedback's `.order('created_at', { ascending: false })` is doing its job.
    const probe = await post(`/api/merchants/${ownShopId}/feedback`,
      { category: 'other', message: 'freshest feedback for the ordering probe' }, ownerToken)
    const probeRow = (await probe.json()) as FeedbackRow

    const res = await get('/api/admin/feedback', superToken)
    expect(res.status).toBe(200)
    const rows = (await res.json()) as Array<FeedbackRow & { shop_slug: string | null }>
    const mine = rows.filter(r => r.merchant_id === ownShopId)
    expect(mine.length).toBeGreaterThanOrEqual(3)
    expect(mine[0]!.id).toBe(probeRow.id)
    expect(mine[0]!.shop_slug).toBe('feedback-own-shop')
  })

  it('refuses the admin list to a merchant and to an anonymous caller', async () => {
    expect((await get('/api/admin/feedback', ownerToken)).status).toBe(403)
    expect((await get('/api/admin/feedback')).status).toBe(401)
  })

  it('resolves and reopens, stamping and clearing resolved_at', async () => {
    const created = await post(`/api/merchants/${ownShopId}/feedback`,
      { category: 'feature', message: 'export orders to csv' }, ownerToken)
    const { id } = (await created.json()) as FeedbackRow

    const resolved = await patch(`/api/admin/feedback/${id}`, { status: 'resolved' }, superToken)
    expect(resolved.status).toBe(200)
    const resolvedRow = (await resolved.json()) as FeedbackRow
    expect(resolvedRow.status).toBe('resolved')
    expect(resolvedRow.resolved_at).not.toBeNull()

    const reopened = await patch(`/api/admin/feedback/${id}`, { status: 'open' }, superToken)
    const reopenedRow = (await reopened.json()) as FeedbackRow
    expect(reopenedRow.status).toBe('open')
    expect(reopenedRow.resolved_at).toBeNull()
  })

  it('filters the list to open only', async () => {
    const res = await get('/api/admin/feedback?status=open', superToken)
    expect(res.status).toBe(200)
    const rows = (await res.json()) as FeedbackRow[]
    expect(rows.every(r => r.status === 'open')).toBe(true)
  })

  it('400s on an unknown status, both as a filter and as an update', async () => {
    expect((await get('/api/admin/feedback?status=closed', superToken)).status).toBe(400)
    const created = await post(`/api/merchants/${ownShopId}/feedback`,
      { category: 'other', message: 'status check' }, ownerToken)
    const { id } = (await created.json()) as FeedbackRow
    expect((await patch(`/api/admin/feedback/${id}`, { status: 'closed' }, superToken)).status).toBe(400)
  })

  it('404s when resolving feedback that does not exist', async () => {
    const res = await patch('/api/admin/feedback/00000000-0000-0000-0000-000000000000',
      { status: 'resolved' }, superToken)
    expect(res.status).toBe(404)
  })

  it('refuses a status change from a merchant', async () => {
    const created = await post(`/api/merchants/${ownShopId}/feedback`,
      { category: 'other', message: 'merchant cannot resolve this' }, ownerToken)
    const { id } = (await created.json()) as FeedbackRow
    expect((await patch(`/api/admin/feedback/${id}`, { status: 'resolved' }, ownerToken)).status).toBe(403)
  })

  // feedbackWindow (app.ts) is a module-level singleton shared by every test in this
  // process, and it cannot be reset from outside. Using feedback-owner / feedback-own-shop
  // here would burn the quota the earlier tests still rely on, so this test gets its own
  // pair of users and shops, distinct from every fixture above.
  //
  // The test proves the limit trips at 20 per hour and that the counter is not global
  // (a different user is unaffected). It does not distinguish per-user from per-merchant
  // keying: merchants_owner_id_key, a unique partial index enforcing one shop per owner
  // (migration 20260715120100_referral_reward_lookup.sql), means the two are behaviorally
  // identical for every reachable request state. If a multi-shop-per-owner model lands,
  // this distinction becomes testable and the test should be extended then.
  //
  // The bucket is filled by calling `feedbackWindow.allow()` directly, and only the last
  // three of the twenty-one hits are real requests. Exhausting it over HTTP cost twenty
  // sequential round-trips against Postgres inside vitest's 5s default, which passed only
  // as long as the DB suite stayed small and flaked once it did not (#147) — and it
  // presented as "my unrelated change broke feedback". Counting to twenty and sliding is
  // proved without a database in tests/unit/rateLimit.test.ts; what needs a request here
  // is that this ROUTE draws on that window under the caller's user id.
  it('rate-limits feedback submissions per user, not globally', async () => {
    await resetMerchant('feedback-limit-shop')
    await resetMerchant('feedback-limit-second-shop')

    const limited = await makeUser('feedback-limit-owner@example.com', 'password123')
    const limitedIds = await tokenOf(limited)
    const limitedShopId = await seedMerchant({ slug: 'feedback-limit-shop', owner_id: limitedIds.userId })

    const other = await makeUser('feedback-limit-second@example.com', 'password123')
    const otherIds = await tokenOf(other)
    const otherShopId = await seedMerchant({ slug: 'feedback-limit-second-shop', owner_id: otherIds.userId })

    // Nineteen of the limited user's twenty, spent straight against the limiter. Each must
    // be allowed — a false here would mean the budget was already partly gone and the 429
    // below could arrive for the wrong reason.
    for (let i = 0; i < 19; i++) {
      expect(feedbackWindow.allow(limitedIds.userId)).toBe(true)
    }

    // The twentieth is a REAL submission, and it must succeed: that is what ties the route
    // to this window and to this key. Were the route counting under some other key, this
    // request would be the limited user's first as far as the limiter is concerned — and
    // the next one would then be allowed too, failing the assertion after it.
    const lastAllowed = await post(`/api/merchants/${limitedShopId}/feedback`,
      { category: 'other', message: 'the twentieth submission' }, limitedIds.token)
    expect(lastAllowed.status).toBe(201)

    const blocked = await post(`/api/merchants/${limitedShopId}/feedback`,
      { category: 'other', message: 'one too many' }, limitedIds.token)
    expect(blocked.status).toBe(429)

    // A different user, submitting to a shop they own, is unaffected — proving the
    // limiter is keyed per user rather than sharing one global (or per-merchant) counter.
    const stillAllowed = await post(`/api/merchants/${otherShopId}/feedback`,
      { category: 'other', message: 'a different user, a fresh budget' }, otherIds.token)
    expect(stillAllowed.status).toBe(201)
  })

  it('links a created GitHub issue back onto the feedback row', async () => {
    githubDeps.createIssue = async (_token, input) => {
      expect(input.labels).toEqual(['needs-triage', 'bug'])
      expect(input.title).toBe('[Feedback] bug: feedback-own-shop')
      return { number: 999, html_url: 'https://github.com/leongcheefai/Bitetime-Order-Platform/issues/999' }
    }

    const created = await post(`/api/merchants/${ownShopId}/feedback`,
      { category: 'bug', message: 'github link-back check' }, ownerToken)
    const { id } = (await created.json()) as FeedbackRow

    const list = await get('/api/admin/feedback', superToken)
    const rows = (await list.json()) as Array<FeedbackRow & { github_issue_number: number | null; github_issue_url: string | null }>
    const row = rows.find(r => r.id === id)
    expect(row?.github_issue_number).toBe(999)
    expect(row?.github_issue_url).toBe('https://github.com/leongcheefai/Bitetime-Order-Platform/issues/999')
  })

  it('closes and reopens the linked GitHub issue when admin resolves/reopens', async () => {
    githubDeps.createIssue = async () => ({
      number: 1001, html_url: 'https://github.com/leongcheefai/Bitetime-Order-Platform/issues/1001',
    })
    const calls: Array<{ action: 'close' | 'reopen'; issueNumber: number }> = []
    githubDeps.closeIssue = async (_token, issueNumber) => { calls.push({ action: 'close', issueNumber }) }
    githubDeps.reopenIssue = async (_token, issueNumber) => { calls.push({ action: 'reopen', issueNumber }) }

    const created = await post(`/api/merchants/${ownShopId}/feedback`,
      { category: 'other', message: 'resolve/reopen sync check' }, ownerToken)
    const { id } = (await created.json()) as FeedbackRow

    await patch(`/api/admin/feedback/${id}`, { status: 'resolved' }, superToken)
    await patch(`/api/admin/feedback/${id}`, { status: 'open' }, superToken)

    expect(calls).toEqual([
      { action: 'close', issueNumber: 1001 },
      { action: 'reopen', issueNumber: 1001 },
    ])
  })
})
