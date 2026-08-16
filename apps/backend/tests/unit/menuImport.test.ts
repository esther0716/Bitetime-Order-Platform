import { describe, it, expect, vi, afterEach } from 'vitest'
import { extractMenu, parsePrice } from '../../src/menuImport.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

const INPUT = {
  imageBase64: 'aGVsbG8=',
  mediaType: 'image/jpeg' as const,
  currency: 'MYR',
}

/** A Claude response carrying `text` as its only content block. */
function claudeResponse(body: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5',
      usage: { input_tokens: 10, output_tokens: 10 },
      ...body,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function textResponse(payload: unknown) {
  return claudeResponse({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }],
  })
}

describe('parsePrice', () => {
  it('reads a plain decimal', () => {
    expect(parsePrice('12.50')).toBe(12.5)
  })

  it('reads a price with a currency prefix and a space', () => {
    expect(parsePrice('RM 12.50')).toBe(12.5)
  })

  it('reads a price with no space after the prefix', () => {
    expect(parsePrice('RM12')).toBe(12)
  })

  it('reads a price with a thousands separator', () => {
    expect(parsePrice('RM 1,250.00')).toBe(1250)
  })

  it('reads a price written with a trailing currency code', () => {
    expect(parsePrice('8.00 SGD')).toBe(8)
  })

  // A menu that prints "Market price" must not become a product priced at zero.
  it('refuses text that holds no number', () => {
    expect(parsePrice('Market price')).toBeNull()
    expect(parsePrice('')).toBeNull()
    expect(parsePrice('   ')).toBeNull()
  })

  it('refuses a negative price', () => {
    expect(parsePrice('-5.00')).toBeNull()
  })

  // "12.50 / 15.00" is two prices, which means the reader guessed at a variant. Refusing
  // sends it to the merchant as an empty required field instead of a silent wrong number.
  it('refuses text that holds more than one number', () => {
    expect(parsePrice('12.50 / 15.00')).toBeNull()
  })
})

describe('extractMenu', () => {
  it('returns null and makes no request when the API key is empty', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await extractMenu('', INPUT)
    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns drafts with the price parsed into a number', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse({
      items: [
        {
          name: 'Chocolate Chip Cookie',
          name_zh: '巧克力豆曲奇',
          description: 'Soft-baked, sea salt on top',
          price_text: 'RM 12.50',
          unit: 'pcs',
          category_label: 'Cookies',
        },
      ],
    })))

    const result = await extractMenu('sk-ant-test', INPUT)

    expect(result).not.toBeNull()
    expect(result!.items).toHaveLength(1)
    expect(result!.items[0]).toMatchObject({
      name: 'Chocolate Chip Cookie',
      name_zh: '巧克力豆曲奇',
      description: 'Soft-baked, sea salt on top',
      price_text: 'RM 12.50',
      price: 12.5,
      unit: 'pcs',
      category_label: 'Cookies',
    })
  })

  // The schema's enum asks for a unit from the product form's own list; this is the belt to it.
  // A "bowl" that reached a draft would vanish from the form's Select without saying so.
  it('drops a unit the product form does not offer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse({
      items: [{ name: 'Laksa', price_text: '9.00', unit: 'bowl' }],
    })))

    const result = await extractMenu('sk-ant-test', INPUT)

    expect(result!.items[0].unit).toBeUndefined()
    expect(result!.items[0].name).toBe('Laksa')
  })

  // The merchant fills the price in. A draft priced 0 is the failure this guards.
  it('keeps the raw text and a null price when the price cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse({
      items: [{ name: 'Catch of the day', price_text: 'Market price' }],
    })))

    const result = await extractMenu('sk-ant-test', INPUT)

    expect(result!.items[0].price).toBeNull()
    expect(result!.items[0].price_text).toBe('Market price')
  })

  it('drops an item with no name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse({
      items: [
        { name: '', price_text: '5.00' },
        { name: 'Brownie', price_text: '6.00' },
      ],
    })))

    const result = await extractMenu('sk-ant-test', INPUT)

    expect(result!.items).toHaveLength(1)
    expect(result!.items[0].name).toBe('Brownie')
  })

  it('returns an empty item list when the photo holds no menu', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse({ items: [] })))
    const result = await extractMenu('sk-ant-test', INPUT)
    expect(result).toEqual({ items: [] })
  })

  // This asserts the ABSENCE of a parameter, which is unusual enough to justify itself: Sonnet 5
  // does not merely ignore `fallbacks`, it rejects the whole request —
  //   "'claude-sonnet-5' does not support the `fallbacks` parameter" (HTTP 400)
  // — and `/v1/models` reports its `allowed_fallback_models` as empty. So a well-meaning
  // reinstatement of the old parameter would not degrade menu import, it would break every
  // import outright. Nothing else in the suite would notice, because every other test stubs a
  // successful response.
  it('never sends the fallbacks parameter, which Sonnet 5 rejects outright', async () => {
    let sentBody = ''
    let betaHeader = ''
    // `HeadersInit` is a DOM lib type this workspace does not load; derive it from `Headers`.
    type HeadersArg = ConstructorParameters<typeof Headers>[0]
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: { body: string; headers: HeadersArg }) => {
      sentBody = init.body
      betaHeader = new Headers(init.headers).get('anthropic-beta') ?? ''
      return textResponse({ items: [] })
    }))

    await extractMenu('sk-ant-test', INPUT)

    expect(JSON.parse(sentBody).fallbacks).toBeUndefined()
    expect(betaHeader).not.toContain('server-side-fallback')
  })

  // There is no fallback behind this one now — a refusal is the end of the import.
  it('returns null when the model refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => claudeResponse({ stop_reason: 'refusal', content: [] })))
    const result = await extractMenu('sk-ant-test', INPUT)
    expect(result).toBeNull()
  })

  it('returns null when the response ran out of tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => claudeResponse({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"items":[{"name":"Coo' }],
    })))
    const result = await extractMenu('sk-ant-test', INPUT)
    expect(result).toBeNull()
  })

  it('returns null when the response holds no text block', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => claudeResponse({ stop_reason: 'end_turn', content: [] })))
    const result = await extractMenu('sk-ant-test', INPUT)
    expect(result).toBeNull()
  })

  it('returns null on malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('not json at all')))
    const result = await extractMenu('sk-ant-test', INPUT)
    expect(result).toBeNull()
  })

  it('returns null when the payload has no items array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse({ products: [] })))
    const result = await extractMenu('sk-ant-test', INPUT)
    expect(result).toBeNull()
  })

  it('returns null and does not throw on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await extractMenu('sk-ant-test', INPUT)
    expect(result).toBeNull()
  })

  it('sends the image as a base64 block ahead of the instruction', async () => {
    let sentBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: { body: string }) => {
      sentBody = init.body
      return textResponse({ items: [] })
    }))

    await extractMenu('sk-ant-test', INPUT)

    const sent = JSON.parse(sentBody)
    // Sonnet 5 specifically: it shares Opus 5's 2576px vision tier, and Haiku's 1568px cap is a
    // downgrade on exactly this input — a phone photograph of a crowded menu board.
    expect(sent.model).toBe('claude-sonnet-5')
    // Thinking stays ON (a crowded board is a reading problem), bounded by effort rather than
    // switched off. Output tokens are 5x the price of input, so this pins the cost model.
    expect(sent.thinking).toEqual({ type: 'adaptive' })
    expect(sent.output_config.effort).toBe('medium')
    const content = sent.messages[0].content
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'aGVsbG8=' },
    })
    expect(content[1].type).toBe('text')
    // The shop's currency reaches the reader, so "12.50" is not read as a foreign amount.
    expect(content[1].text).toContain('MYR')
  })
})
