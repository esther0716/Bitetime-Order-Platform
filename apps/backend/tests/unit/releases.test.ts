import { describe, it, expect, vi, afterEach } from 'vitest'
import { humanizeRelease } from '../../src/releases.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('humanizeRelease', () => {
  it('returns null and makes no request when the API key is empty', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await humanizeRelease('', { tag: '0.1.5', name: '0.1.5', body: 'raw body' })
    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns the parsed title and summary on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        stop_reason: 'end_turn',
        content: [{
          type: 'text',
          text: JSON.stringify({ title: 'Faster checkout', summary: 'Orders now confirm instantly.' }),
        }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const result = await humanizeRelease('sk-ant-test', { tag: '0.1.5', name: '0.1.5', body: 'raw body' })
    expect(result).toEqual({ title: 'Faster checkout', summary: 'Orders now confirm instantly.' })
  })

  it('returns null when the response is a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5',
        stop_reason: 'refusal', content: [], usage: { input_tokens: 10, output_tokens: 0 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const result = await humanizeRelease('sk-ant-test', { tag: '0.1.5', name: '0.1.5', body: 'raw body' })
    expect(result).toBeNull()
  })

  it('returns null and does not throw on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await humanizeRelease('sk-ant-test', { tag: '0.1.5', name: '0.1.5', body: 'raw body' })
    expect(result).toBeNull()
  })
})
