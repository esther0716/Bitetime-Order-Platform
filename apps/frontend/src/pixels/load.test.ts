import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

interface FakeScript { textContent: string; dataset: Record<string, string> }

const head: FakeScript[] = []

function installFakeDocument() {
  head.length = 0
  ;(globalThis as any).document = {
    createElement: (): FakeScript => ({ textContent: '', dataset: {} }),
    head: { appendChild: (el: FakeScript) => { head.push(el) } },
  }
}

beforeEach(() => {
  vi.resetModules() // load.ts remembers what it injected; each test needs a fresh module
  installFakeDocument()
})
afterEach(() => {
  delete (globalThis as any).document
})

async function loader() {
  return (await import('./load')).loadPixels
}

describe('loadPixels', () => {
  it('injects nothing when no id is configured', async () => {
    const loadPixels = await loader()
    loadPixels({})
    expect(head).toHaveLength(0)
  })

  it('injects only the vendor whose id is set', async () => {
    const loadPixels = await loader()
    loadPixels({ meta: '123456789' })
    expect(head).toHaveLength(1)
    expect(head[0].dataset.pixel).toBe('meta')
    expect(head[0].textContent).toContain('123456789')
    expect(head[0].textContent).toContain('connect.facebook.net')
  })

  it('injects both when both ids are set', async () => {
    const loadPixels = await loader()
    loadPixels({ meta: '123456789', tiktok: 'CABCDEF' })
    expect(head.map(s => s.dataset.pixel)).toEqual(['meta', 'tiktok'])
    expect(head[1].textContent).toContain('CABCDEF')
    expect(head[1].textContent).toContain('analytics.tiktok.com')
  })

  it('fires no pageview of its own — one code path owns pageviews', async () => {
    const loadPixels = await loader()
    loadPixels({ meta: '123456789', tiktok: 'CABCDEF' })
    expect(head[0].textContent).not.toContain('PageView')
    expect(head[1].textContent).not.toContain('ttq.page()')
  })

  it('injects once however many times it is called', async () => {
    const loadPixels = await loader()
    loadPixels({ meta: '123456789' })
    loadPixels({ meta: '123456789' })
    loadPixels({ meta: '123456789' })
    expect(head).toHaveLength(1)
  })

  it('does not throw where there is no document', async () => {
    const loadPixels = await loader()
    delete (globalThis as any).document
    expect(() => loadPixels({ meta: '123456789' })).not.toThrow()
  })
})
