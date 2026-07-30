import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The Supabase client is only reached for the auth header; stub it so we can drive
// "has a session" vs "no session" per test.
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('./supabase', () => ({ auth: { getSession } }))

import { apiGet, apiSend, unwrap } from './api'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: null } })
})

describe('apiGet — the three mapping cases', () => {
  it('200 → { ok: true, data }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ a: 1 }) }))
    const r = await apiGet<{ a: number }>('/x')
    expect(r).toEqual({ ok: true, data: { a: 1 } })
  })

  it('non-2xx → { ok: false, error } carrying status + body message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false, status: 404, json: async () => ({ error: 'nope' }),
    }))
    const r = await apiGet('/x')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.status).toBe(404)
      expect(r.error.message).toBe('nope')
    }
  })

  it('fetch rejection (network/CORS) → { ok: false }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')))
    const r = await apiGet('/x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.status).toBeUndefined()
  })
})

describe('apiSend', () => {
  it('200 with JSON body → { ok: true, data }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'v1' }) }))
    const r = await apiSend<{ id: string }>('/x', 'POST', { n: 1 })
    expect(r).toEqual({ ok: true, data: { id: 'v1' } })
  })

  it('empty 200 body → { ok: true, data: null }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' }))
    const r = await apiSend('/x', 'DELETE')
    expect(r).toEqual({ ok: true, data: null })
  })

  it('non-2xx → { ok: false, error }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'bad' }) }))
    const r = await apiSend('/x', 'POST', {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toBe('bad')
  })

  it('serialises the body and sets the content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)
    await apiSend('/x', 'PATCH', { a: 2 })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('PATCH')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ a: 2 })
  })
})

describe('auth: false | true | "required"', () => {
  it('auth:false sends no Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await apiGet('/x')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })

  it('auth:true attaches the token when a session exists', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await apiGet('/x', { auth: true })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
  })

  it('auth:true with no session sends the request without a header (guest-tolerant)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await apiGet('/x', { auth: true })
    expect(fetchMock).toHaveBeenCalled()
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })

  it('auth:"required" with no session resolves offline to not_signed_in and NEVER fetches', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await apiGet('/x', { auth: 'required' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('not_signed_in')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('auth:"required" with a session attaches the token and fetches', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const r = await apiGet('/x', { auth: 'required' })
    expect(r.ok).toBe(true)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
  })
})

describe('unwrap', () => {
  it('returns data on ok', () => {
    expect(unwrap({ ok: true, data: 42 })).toBe(42)
  })

  it('throws the error on failure', () => {
    expect(() => unwrap({ ok: false, error: { message: 'boom', status: 500 } }))
      .toThrow('boom')
  })
})
