// GitHub adapter for auto-filing merchant feedback as issues (#89-follow-up). Token is a
// PARAMETER on every export here (never read from env.ts) precisely so this file can be
// imported at runtime by a unit test with zero env vars set — see the plan's Global
// Constraints. No network call happens unless `fetch` is stubbed below.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  GITHUB_REPO,
  categoryToLabel,
  buildIssueTitle,
  buildIssueBody,
  createGithubIssue,
  closeGithubIssue,
  reopenGithubIssue,
  listGithubReleases,
} from '../../src/github.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('categoryToLabel', () => {
  it("maps to the repo's existing labels where one already fits", () => {
    expect(categoryToLabel('bug')).toBe('bug')
    expect(categoryToLabel('feature')).toBe('enhancement')
    expect(categoryToLabel('billing')).toBe('billing')
    expect(categoryToLabel('other')).toBe('other')
  })
})

describe('buildIssueTitle', () => {
  it('is [Feedback] <category>: <shop name>', () => {
    expect(buildIssueTitle('bug', 'Golden Wok')).toBe('[Feedback] bug: Golden Wok')
  })
})

describe('buildIssueBody', () => {
  const base = {
    message: 'App crashes when I add a voucher at checkout',
    shopName: 'Golden Wok',
    shopSlug: 'golden-wok',
    feedbackId: 'abc-123',
    createdAt: '2026-08-04T00:00:00Z',
    adminUrl: 'https://tinyorder.vercel.app',
  }

  it('includes the message, shop, feedback id and timestamp', () => {
    const body = buildIssueBody({ ...base, imageCount: 0 })
    expect(body).toContain('App crashes when I add a voucher at checkout')
    expect(body).toContain('Golden Wok')
    expect(body).toContain('/s/golden-wok')
    expect(body).toContain('abc-123')
    expect(body).toContain('2026-08-04T00:00:00Z')
  })

  it('says nothing about screenshots when there are none', () => {
    expect(buildIssueBody({ ...base, imageCount: 0 })).not.toContain('Screenshot')
  })

  it('states the count and where to look when there are some', () => {
    const body = buildIssueBody({ ...base, imageCount: 2 })
    expect(body).toContain('Screenshots: 2')
    // A HASH, not a path segment. The admin dashboard is a single route whose sections live in
    // the hash (useDashboardSection); `/admin/feedback` matches no route and renders blank.
    expect(body).toContain('https://tinyorder.vercel.app/admin#feedback')
    expect(body).not.toContain('/admin/feedback')
  })

  it('never puts an image URL in a public issue', () => {
    const body = buildIssueBody({ ...base, imageCount: 3 })
    expect(body).not.toMatch(/feedback-images/)
    expect(body).not.toMatch(/storage\/v1/)
    expect(body).not.toMatch(/\.(png|jpe?g|webp)\b/i)
  })
})

describe('createGithubIssue', () => {
  it('skips and makes no request when the token is empty', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await createGithubIssue('', { title: 't', body: 'b', labels: ['needs-triage'] })
    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns the issue number and url on success, and posts to the right repo', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe(`https://api.github.com/repos/${GITHUB_REPO}/issues`)
      return new Response(
        JSON.stringify({ number: 42, html_url: 'https://github.com/x/y/issues/42' }),
        { status: 201 },
      )
    })
    vi.stubGlobal('fetch', fetchSpy)
    const result = await createGithubIssue('ghp_test', {
      title: 't', body: 'b', labels: ['needs-triage', 'bug'],
    })
    expect(result).toEqual({ number: 42, html_url: 'https://github.com/x/y/issues/42' })
  })

  it('retries once without the category label on a 422, and still returns the issue', async () => {
    let call = 0
    const fetchSpy = vi.fn(async (_url: string, init: any) => {
      call++
      const labels = JSON.parse(init.body).labels
      if (call === 1) {
        expect(labels).toEqual(['needs-triage', 'other'])
        return new Response('{"message":"Label does not exist"}', { status: 422 })
      }
      expect(labels).toEqual(['needs-triage'])
      return new Response(
        JSON.stringify({ number: 7, html_url: 'https://github.com/x/y/issues/7' }),
        { status: 201 },
      )
    })
    vi.stubGlobal('fetch', fetchSpy)
    const result = await createGithubIssue('ghp_test', {
      title: 't', body: 'b', labels: ['needs-triage', 'other'],
    })
    expect(result).toEqual({ number: 7, html_url: 'https://github.com/x/y/issues/7' })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('returns null and does not throw when every attempt fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    const result = await createGithubIssue('ghp_test', { title: 't', body: 'b', labels: ['needs-triage'] })
    expect(result).toBeNull()
  })

  it('returns null and does not throw on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await createGithubIssue('ghp_test', { title: 't', body: 'b', labels: ['needs-triage'] })
    expect(result).toBeNull()
  })
})

describe('closeGithubIssue / reopenGithubIssue', () => {
  it('PATCHes the issue state', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init: any) => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    await closeGithubIssue('ghp_test', 42)
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://api.github.com/repos/${GITHUB_REPO}/issues/42`,
      expect.objectContaining({ method: 'PATCH' }),
    )
    const [, closeInit] = fetchSpy.mock.calls[0]
    expect(JSON.parse(closeInit.body)).toEqual({ state: 'closed' })

    fetchSpy.mockClear()
    await reopenGithubIssue('ghp_test', 42)
    const [, reopenInit] = fetchSpy.mock.calls[0]
    expect(JSON.parse(reopenInit.body)).toEqual({ state: 'open' })
  })

  it('never throws when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(closeGithubIssue('ghp_test', 42)).resolves.toBeUndefined()
    await expect(reopenGithubIssue('ghp_test', 42)).resolves.toBeUndefined()
  })

  it('skips without a token', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await closeGithubIssue('', 42)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('listGithubReleases', () => {
  it('returns null and makes no request when the token is empty', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await listGithubReleases('', 10)
    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches releases from the right repo and per_page, mapping the fields', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`)
      return new Response(
        JSON.stringify([
          {
            tag_name: '0.1.5', name: '0.1.5', body: 'raw body',
            html_url: 'https://github.com/x/y/releases/tag/0.1.5',
            published_at: '2026-08-05T05:02:51Z',
          },
        ]),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchSpy)
    const result = await listGithubReleases('ghp_test', 10)
    expect(result).toEqual([
      {
        tag_name: '0.1.5', name: '0.1.5', body: 'raw body',
        html_url: 'https://github.com/x/y/releases/tag/0.1.5',
        published_at: '2026-08-05T05:02:51Z',
      },
    ])
  })

  it('defaults a null body to an empty string', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify([{
        tag_name: '0.1.4', name: '0.1.4', body: null,
        html_url: 'https://github.com/x/y/releases/tag/0.1.4',
        published_at: '2026-08-04T00:00:00Z',
      }]),
      { status: 200 },
    )))
    const result = await listGithubReleases('ghp_test', 10)
    expect(result?.[0]?.body).toBe('')
  })

  it('returns null and does not throw on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    const result = await listGithubReleases('ghp_test', 10)
    expect(result).toBeNull()
  })

  it('returns null and does not throw on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await listGithubReleases('ghp_test', 10)
    expect(result).toBeNull()
  })
})
