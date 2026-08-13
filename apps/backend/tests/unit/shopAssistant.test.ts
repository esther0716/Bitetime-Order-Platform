// tests/unit/shopAssistant.test.ts
//
// The load-bearing test in this file is `has no parameter that could name a shop`. Everything
// else here is ordinary failure handling; that one is the security property the whole module is
// shaped around, and it is asserted against the schema actually sent on the wire rather than
// against the source.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { askShopAssistant } from '../../src/shopAssistant.js'
import type { MerchantStats } from '@bitetime/shared'

afterEach(() => {
  vi.unstubAllGlobals()
})

const STATS: MerchantStats = {
  totalOrders: 120,
  revenue: 4300,
  customerCount: 44,
  avgOrder: 35.83,
  vouchersRedeemed: 7,
  ordersDelta: { pct: 12, dir: 'up' },
  revenueDelta: { pct: 9, dir: 'up' },
  series: [{ key: '2026-08-01', label: '1 Aug', start: '2026-08-01', end: '2026-08-01', revenue: 120, orders: 4 }],
  granularity: 'day',
  productRevenue: [{ name: 'Chocolate Chip Cookie', value: 900, units: 72 }],
  statusBreakdown: [{ status: 'completed', count: 100, pct: 83 }],
}

const INPUT = {
  question: 'How did last month compare with the month before?',
  lang: 'en' as const,
  currency: 'MYR',
  timeZone: 'Asia/Kuala_Lumpur',
  today: '2026-08-13',
  getStats: async () => STATS,
}

function claudeResponse(body: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5',
      usage: { input_tokens: 10, output_tokens: 10 },
      ...body,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

const textResponse = (text: string) =>
  claudeResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text }] })

/** A turn asking for the tool, followed by a turn answering — the ordinary two-step. */
function toolThenAnswer(args: { days: number; granularity: string }, answer: string) {
  const responses = [
    claudeResponse({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_shop_stats', input: args }],
    }),
    textResponse(answer),
  ]
  let i = 0
  return vi.fn(async () => responses[Math.min(i++, responses.length - 1)])
}

describe('askShopAssistant', () => {
  it('returns null and makes no request when the API key is empty', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await askShopAssistant('', INPUT)).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // ── The tenancy property ──────────────────────────────────────────────────────────────────
  it('exposes one tool whose schema has no parameter that could name a shop', async () => {
    let sentBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: { body: string }) => {
      sentBody = init.body
      return textResponse('ok')
    }))

    await askShopAssistant('sk-ant-test', INPUT)

    const sent = JSON.parse(sentBody)
    expect(sent.tools).toHaveLength(1)
    const tool = sent.tools[0]
    expect(tool.name).toBe('get_shop_stats')

    const params = Object.keys(tool.input_schema.properties)
    expect(params.sort()).toEqual(['days', 'granularity'])
    for (const name of params) {
      expect(name).not.toMatch(/merchant|shop|tenant|slug|id/i)
    }
    // Nothing may be smuggled in beside them.
    expect(tool.input_schema.additionalProperties).toBe(false)
    // And there is no second tool that could read anything else.
    expect(JSON.stringify(sent.tools)).not.toMatch(/sql|query|table|select/i)
  })

  it('reports the window the model actually asked for', async () => {
    vi.stubGlobal('fetch', toolThenAnswer({ days: 30, granularity: 'day' }, 'Revenue rose 9%.'))

    const answer = await askShopAssistant('sk-ant-test', INPUT)

    expect(answer).toEqual({ text: 'Revenue rose 9%.', queried: { days: 30, granularity: 'day' } })
  })

  it('reports a null window when the model answered without reading the figures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('I cannot change your prices.')))

    const answer = await askShopAssistant('sk-ant-test', INPUT)

    // The route must be able to tell "answered from the figures" from "answered without them",
    // because only the first earns a disclaimer naming a window.
    expect(answer?.queried).toBeNull()
    expect(answer?.text).toBe('I cannot change your prices.')
  })

  it('passes the requested window through to the stats reader', async () => {
    const seen: unknown[] = []
    vi.stubGlobal('fetch', toolThenAnswer({ days: 90, granularity: 'week' }, 'Done.'))

    await askShopAssistant('sk-ant-test', {
      ...INPUT,
      getStats: async (q) => { seen.push(q); return STATS },
    })

    expect(seen).toEqual([{ days: 90, granularity: 'week' }])
  })

  it('labels all-time figures separately from windowed ones in the tool result', async () => {
    const bodies: string[] = []
    const responses = [
      claudeResponse({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_shop_stats', input: { days: 30, granularity: 'day' } }],
      }),
      textResponse('Done.'),
    ]
    let i = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: { body: string }) => {
      bodies.push(init.body)
      return responses[Math.min(i++, responses.length - 1)]
    }))

    await askShopAssistant('sk-ant-test', INPUT)

    // The second request carries the tool result back to the model. Without the split, the model
    // reads all-time `revenue` as the window's and answers a range question with the wrong number.
    const toolResult = JSON.parse(bodies[1])
    const resultText = JSON.stringify(toolResult.messages)
    expect(resultText).toContain('all_time')
    expect(resultText).toContain('in_window')
    expect(resultText).toContain('are NOT limited to that window')
  })

  it('returns null when the response is a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => claudeResponse({ stop_reason: 'refusal', content: [] })))
    expect(await askShopAssistant('sk-ant-test', INPUT)).toBeNull()
  })

  it('returns null when the answer ran out of tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => claudeResponse({
      stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Revenue last month was RM 4,3' }],
    })))
    expect(await askShopAssistant('sk-ant-test', INPUT)).toBeNull()
  })

  it('returns null when the model produced no text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => claudeResponse({ stop_reason: 'end_turn', content: [] })))
    expect(await askShopAssistant('sk-ant-test', INPUT)).toBeNull()
  })

  it('returns null and does not throw on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    expect(await askShopAssistant('sk-ant-test', INPUT)).toBeNull()
  })

  it('does not throw when the stats reader fails', async () => {
    vi.stubGlobal('fetch', toolThenAnswer({ days: 30, granularity: 'day' }, 'Done.'))

    const answer = await askShopAssistant('sk-ant-test', {
      ...INPUT,
      getStats: async () => { throw new Error('database down') },
    })

    // Either a null or an answer is acceptable; a thrown error reaching the route is not, because
    // the route would turn it into a 500 rather than the 502 this failure actually is.
    expect(answer === null || typeof answer.text === 'string').toBe(true)
  })
})
