import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { app, releaseDeps } from '../../src/app.js'
import { env } from '../../src/env.js'
import { makeUser, serviceClient } from '../rls/helpers.js'

// The pull answers as soon as the drafts are stored and rewrites them afterwards, so every
// assertion about a title or a summary has to await the work the route let run on. Importing
// the live binding (rather than destructuring it) matters: the route REASSIGNS it per pull,
// and a destructured copy would forever hold the resolved promise from module load.
async function settleHumanization() {
  const { releaseHumanization } = await import('../../src/app.js')
  await releaseHumanization
}

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function get(path: string, token?: string) {
  return app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
}
function post(path: string, token?: string) {
  return app.request(path, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} })
}
function internalPull(secret?: string, tag?: string) {
  return app.request('/api/internal/releases-pull', {
    method: 'POST',
    headers: {
      ...(secret !== undefined ? { 'x-sweep-secret': secret } : {}),
      ...(tag !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(tag !== undefined ? { body: JSON.stringify({ tag }) } : {}),
  })
}
function patch(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

let superToken: string
let memberToken: string

const origListReleases = releaseDeps.listReleases
const origReleaseByTag = releaseDeps.releaseByTag
const origHumanize = releaseDeps.humanize

describe('releases', () => {
  beforeAll(async () => {
    const superClient = await makeUser('releases-super@example.com', 'password123')
    const superIds = await tokenOf(superClient)
    const svc = serviceClient()
    await svc.from('profiles').delete().eq('user_id', superIds.userId)
    await svc.from('profiles').insert({ user_id: superIds.userId, name: 'Super', app_role: 'superadmin' })
    superToken = superIds.token

    const member = await makeUser('releases-member@example.com', 'password123')
    const memberIds = await tokenOf(member)
    memberToken = memberIds.token

    await svc.from('releases').delete().like('tag', 'releases-test-%')
  })

  afterEach(() => {
    releaseDeps.listReleases = origListReleases
    releaseDeps.releaseByTag = origReleaseByTag
    releaseDeps.humanize = origHumanize
  })

  afterAll(async () => {
    await serviceClient().from('releases').delete().like('tag', 'releases-test-%')
  })

  it('refuses the admin list to a non-superadmin and to an anonymous caller', async () => {
    expect((await get('/api/admin/releases', memberToken)).status).toBe(403)
    expect((await get('/api/admin/releases')).status).toBe(401)
  })

  it('pulls new releases, humanizes them, and skips tags already in the table', async () => {
    releaseDeps.listReleases = async () => [
      {
        tag_name: 'releases-test-1', name: 'Test 1', body: 'raw body 1',
        html_url: 'https://github.com/x/y/releases/tag/releases-test-1',
        published_at: '2026-08-05T00:00:00Z',
      },
    ]
    releaseDeps.humanize = async () => ({ title: 'Test release one', summary: 'A short summary.' })

    const first = await post('/api/admin/releases/pull', superToken)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ pulled: 1 })
    await settleHumanization()

    const list = await get('/api/admin/releases', superToken)
    const rows = (await list.json()) as Array<{ tag: string; title: string | null; status: string }>
    const row = rows.find((r) => r.tag === 'releases-test-1')
    expect(row?.title).toBe('Test release one')
    expect(row?.status).toBe('draft')

    // Second pull sees the same GitHub release — already-pulled tag is skipped, not duplicated.
    const second = await post('/api/admin/releases/pull', superToken)
    expect(await second.json()).toEqual({ pulled: 0 })
  })

  it('records a humanize failure without blocking the pull', async () => {
    releaseDeps.listReleases = async () => [
      {
        tag_name: 'releases-test-2', name: 'Test 2', body: 'raw body 2',
        html_url: 'https://github.com/x/y/releases/tag/releases-test-2',
        published_at: '2026-08-05T00:00:00Z',
      },
    ]
    releaseDeps.humanize = async () => null

    const res = await post('/api/admin/releases/pull', superToken)
    expect(await res.json()).toEqual({ pulled: 1 })
    await settleHumanization()

    const list = await get('/api/admin/releases', superToken)
    const rows = (await list.json()) as Array<{ tag: string; title: string | null; humanize_error: string | null }>
    const row = rows.find((r) => r.tag === 'releases-test-2')
    expect(row?.title).toBeNull()
    expect(row?.humanize_error).toBeTruthy()
  })

  it('answers the pull before the rewrite finishes, and fills the title in afterwards', async () => {
    releaseDeps.listReleases = async () => [
      {
        tag_name: 'releases-test-slow', name: 'Slow', body: 'raw body slow',
        html_url: 'https://github.com/x/y/releases/tag/releases-test-slow',
        published_at: '2026-08-05T00:00:00Z',
      },
    ]
    // Held open until this test says so — the whole point of the route is that it does not
    // wait for this, so a rewrite that never returns must not hold the response.
    let release: (v: { title: string; summary: string }) => void
    const held = new Promise<{ title: string; summary: string }>((resolve) => { release = resolve })
    releaseDeps.humanize = () => held

    const res = await post('/api/admin/releases/pull', superToken)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ pulled: 1 })

    // Draft is already readable, still unwritten — this is the state the dashboard polls on.
    const during = (await (await get('/api/admin/releases', superToken)).json()) as Array<{
      tag: string; title: string | null; humanize_error: string | null; status: string
    }>
    const pending = during.find((r) => r.tag === 'releases-test-slow')
    expect(pending?.status).toBe('draft')
    expect(pending?.title).toBeNull()
    expect(pending?.humanize_error).toBeNull()

    release!({ title: 'Slow release', summary: 'Written late.' })
    await settleHumanization()

    const after = (await (await get('/api/admin/releases', superToken)).json()) as Array<{
      tag: string; title: string | null
    }>
    expect(after.find((r) => r.tag === 'releases-test-slow')?.title).toBe('Slow release')
  })

  it('regenerates a failed humanization', async () => {
    releaseDeps.listReleases = async () => [
      {
        tag_name: 'releases-test-3', name: 'Test 3', body: 'raw body 3',
        html_url: 'https://github.com/x/y/releases/tag/releases-test-3',
        published_at: '2026-08-05T00:00:00Z',
      },
    ]
    releaseDeps.humanize = async () => null
    await post('/api/admin/releases/pull', superToken)
    // Settle before swapping the stub: the pull's own rewrite is still in flight, and letting
    // it land AFTER the regenerate below would overwrite the regenerated title with the
    // failure this test set up.
    await settleHumanization()

    const list = await get('/api/admin/releases', superToken)
    const rows = (await list.json()) as Array<{ id: string; tag: string }>
    const id = rows.find((r) => r.tag === 'releases-test-3')!.id

    releaseDeps.humanize = async () => ({ title: 'Regenerated title', summary: 'Regenerated summary.' })
    const res = await post(`/api/admin/releases/${id}/regenerate`, superToken)
    expect(res.status).toBe(200)
    const row = (await res.json()) as { title: string | null; humanize_error: string | null }
    expect(row.title).toBe('Regenerated title')
    expect(row.humanize_error).toBeNull()
  })

  it('publishes a release, and it becomes visible on the public endpoints; unpublishing hides it again', async () => {
    releaseDeps.listReleases = async () => [
      {
        tag_name: 'releases-test-4', name: 'Test 4', body: 'raw body 4',
        html_url: 'https://github.com/x/y/releases/tag/releases-test-4',
        published_at: '2026-08-05T00:00:00Z',
      },
    ]
    releaseDeps.humanize = async () => ({ title: 'Public title', summary: 'Public summary.' })
    await post('/api/admin/releases/pull', superToken)
    await settleHumanization()

    const list = await get('/api/admin/releases', superToken)
    const rows = (await list.json()) as Array<{ id: string; tag: string }>
    const id = rows.find((r) => r.tag === 'releases-test-4')!.id

    const draftList = await get('/api/releases')
    expect((await draftList.json() as Array<{ tag: string }>).some((r) => r.tag === 'releases-test-4')).toBe(false)
    expect((await get('/api/releases/releases-test-4')).status).toBe(404)

    const published = await patch(`/api/admin/releases/${id}`, { status: 'published' }, superToken)
    expect(published.status).toBe(200)

    const publicList = await get('/api/releases')
    expect((await publicList.json() as Array<{ tag: string }>).some((r) => r.tag === 'releases-test-4')).toBe(true)

    const detail = await get('/api/releases/releases-test-4')
    expect(detail.status).toBe(200)
    const detailBody = (await detail.json()) as { tag: string; title: string; summary: string; published_at: string }
    expect(detailBody.tag).toBe('releases-test-4')
    expect(detailBody.title).toBe('Public title')
    expect(detailBody.summary).toBe('Public summary.')
    expect(new Date(detailBody.published_at).toISOString()).toBe('2026-08-05T00:00:00.000Z')

    await patch(`/api/admin/releases/${id}`, { status: 'draft' }, superToken)
    expect((await get('/api/releases/releases-test-4')).status).toBe(404)
  })

  it('rejects an unknown status value on PATCH', async () => {
    const res = await patch(
      '/api/admin/releases/00000000-0000-0000-0000-000000000000', { status: 'bogus' }, superToken,
    )
    expect(res.status).toBe(400)
  })

  it('404s PATCH and regenerate for an unknown id', async () => {
    const bogusId = '00000000-0000-0000-0000-000000000000'
    expect((await patch(`/api/admin/releases/${bogusId}`, { status: 'published' }, superToken)).status).toBe(404)
    expect((await post(`/api/admin/releases/${bogusId}/regenerate`, superToken)).status).toBe(404)
  })

  // POST /api/internal/releases-pull — the release workflow's own door onto the same pull.
  // No user token reaches it, so the shared secret is the whole gate and these check it holds.
  describe('the workflow pull', () => {
    it('refuses with no secret configured, and refuses a missing or wrong header', async () => {
      const saved = env.releasePullSecret
      env.releasePullSecret = ''
      try {
        expect((await internalPull('anything')).status).toBe(503)
      } finally {
        env.releasePullSecret = saved
      }
      expect((await internalPull()).status).toBe(403)
      expect((await internalPull('wrong-secret')).status).toBe(403)
    })

    it('stores the new release as a draft, never as published', async () => {
      releaseDeps.listReleases = async () => [
        {
          tag_name: 'releases-test-workflow', name: 'Workflow', body: 'raw body workflow',
          html_url: 'https://github.com/x/y/releases/tag/releases-test-workflow',
          published_at: '2026-08-26T00:00:00Z',
        },
      ]
      releaseDeps.humanize = async () => ({ title: 'Cut by the workflow', summary: 'A summary.' })

      const res = await internalPull(env.releasePullSecret)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ pulled: 1 })
      await settleHumanization()

      const rows = (await (await get('/api/admin/releases', superToken)).json()) as Array<{
        tag: string; title: string | null; status: string
      }>
      const row = rows.find((r) => r.tag === 'releases-test-workflow')
      expect(row?.title).toBe('Cut by the workflow')
      expect(row?.status).toBe('draft')

      // The merchant-facing endpoint must not see it until a human publishes it.
      expect((await get('/api/releases/releases-test-workflow')).status).toBe(404)
    })

    it('answers 502 when GitHub cannot be reached', async () => {
      releaseDeps.listReleases = async () => null
      expect((await internalPull(env.releasePullSecret)).status).toBe(502)
    })

    // A named tag reads that ONE release instead of the list, and the list is why: GitHub caches
    // it for 60 seconds, the workflow calls two seconds after cutting the tag, and the pull
    // stored nothing while answering 200 — the release then waited for the next one to carry it
    // in. These three pin the behaviour the workflow now depends on.
    it('stores the named tag even when the cached list has not caught up', async () => {
      // The list here is the stale one the cache serves: it does not carry the tag just cut.
      // Storing it anyway is the whole fix.
      releaseDeps.listReleases = async () => []
      releaseDeps.releaseByTag = async (_token, tag) => ({
        tag_name: tag, name: 'By tag', body: 'raw body by tag',
        html_url: `https://github.com/x/y/releases/tag/${tag}`,
        published_at: '2026-09-01T00:00:00Z',
      })
      releaseDeps.humanize = async () => ({ title: 'Named by the workflow', summary: 'A summary.' })

      const res = await internalPull(env.releasePullSecret, 'releases-test-by-tag')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ pulled: 1 })
      await settleHumanization()

      const rows = (await (await get('/api/admin/releases', superToken)).json()) as Array<{
        tag: string; title: string | null; status: string
      }>
      const row = rows.find((r) => r.tag === 'releases-test-by-tag')
      expect(row?.title).toBe('Named by the workflow')
      expect(row?.status).toBe('draft')
    })

    it('carries in a release an earlier pull missed, alongside the named one', async () => {
      releaseDeps.listReleases = async () => [
        {
          tag_name: 'releases-test-straggler', name: 'Straggler', body: 'raw body straggler',
          html_url: 'https://github.com/x/y/releases/tag/releases-test-straggler',
          published_at: '2026-08-31T00:00:00Z',
        },
      ]
      releaseDeps.releaseByTag = async (_token, tag) => ({
        tag_name: tag, name: 'Fresh', body: 'raw body fresh',
        html_url: `https://github.com/x/y/releases/tag/${tag}`,
        published_at: '2026-09-01T00:00:00Z',
      })
      releaseDeps.humanize = async () => ({ title: 'Two at once', summary: 'A summary.' })

      const res = await internalPull(env.releasePullSecret, 'releases-test-fresh')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ pulled: 2 })
      await settleHumanization()

      const rows = (await (await get('/api/admin/releases', superToken)).json()) as Array<{ tag: string }>
      expect(rows.some((r) => r.tag === 'releases-test-straggler')).toBe(true)
      expect(rows.some((r) => r.tag === 'releases-test-fresh')).toBe(true)
    })

    it('answers 502 for a tag GitHub does not show yet, so the workflow retries', async () => {
      // The list answering is not enough: the caller asked about one tag, and a 200 here would
      // report a pull that never stored it.
      releaseDeps.listReleases = async () => []
      releaseDeps.releaseByTag = async () => null
      const res = await internalPull(env.releasePullSecret, 'releases-test-not-yet')
      expect(res.status).toBe(502)

      const rows = (await (await get('/api/admin/releases', superToken)).json()) as Array<{ tag: string }>
      expect(rows.some((r) => r.tag === 'releases-test-not-yet')).toBe(false)
    })

    it('answers 200 and stores nothing when the named tag is already held', async () => {
      releaseDeps.listReleases = async () => []
      releaseDeps.releaseByTag = async (_token, tag) => ({
        tag_name: tag, name: 'By tag', body: 'raw body by tag',
        html_url: `https://github.com/x/y/releases/tag/${tag}`,
        published_at: '2026-09-01T00:00:00Z',
      })
      releaseDeps.humanize = async () => ({ title: 'Named by the workflow', summary: 'A summary.' })

      await internalPull(env.releasePullSecret, 'releases-test-twice')
      await settleHumanization()
      const res = await internalPull(env.releasePullSecret, 'releases-test-twice')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ pulled: 0 })
    })
  })
})
