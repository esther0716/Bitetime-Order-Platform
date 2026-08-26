// tests/api/sample-shot-upload.test.ts
// POST /api/internal/sample-shop-screenshot/:merchantId — the sample-shop screenshot cron's
// upload endpoint. Unauthenticated (no user token), gated by a shared secret header instead,
// exactly like /api/internal/trial-feedback-sweep. Driven in-process against real Postgres +
// real Storage: admin.storage is not mockable here without also faking the property (a real
// upload landing in the bucket) this suite exists to prove.
import { describe, it, expect, beforeAll } from 'vitest'
import { app } from '../../src/app.js'
import { env } from '../../src/env.js'
import { serviceClient, resetMerchant, seedMerchant, makeUser } from '../rls/helpers.js'

const BUCKET = 'sample-shop-screenshots'

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

function post(merchantId: string, body: Uint8Array | string, opts: { contentType?: string; secret?: string } = {}) {
  const headers: Record<string, string> = {}
  if (opts.contentType !== undefined) headers['Content-Type'] = opts.contentType
  if (opts.secret !== undefined) headers['x-sweep-secret'] = opts.secret
  return app.request(`/api/internal/sample-shop-screenshot/${merchantId}`, { method: 'POST', headers, body })
}

describe('POST /api/internal/sample-shop-screenshot/:merchantId', () => {
  let merchantId: string

  beforeAll(async () => {
    await resetMerchant('sample-shot-shop')
    const owner = await makeUser('sample-shot-owner@example.com', 'password123')
    const { data: session } = await owner.auth.getSession()
    merchantId = await seedMerchant({ slug: 'sample-shot-shop', owner_id: session.session!.user.id })
  })

  it('503s when the sweep secret env var is unset', async () => {
    const saved = env.sampleShopScreenshotSweepSecret
    env.sampleShopScreenshotSweepSecret = ''
    try {
      const res = await post(merchantId, PNG_1X1, { contentType: 'image/png', secret: 'anything' })
      expect(res.status).toBe(503)
    } finally {
      env.sampleShopScreenshotSweepSecret = saved
    }
  })

  it('refuses a missing secret', async () => {
    const res = await post(merchantId, PNG_1X1, { contentType: 'image/png' })
    expect(res.status).toBe(403)
  })

  it('refuses a wrong secret', async () => {
    const res = await post(merchantId, PNG_1X1, { contentType: 'image/png', secret: 'wrong-secret' })
    expect(res.status).toBe(403)
  })

  it('refuses a non-image/png content-type', async () => {
    const res = await post(merchantId, PNG_1X1, { contentType: 'image/jpeg', secret: env.sampleShopScreenshotSweepSecret })
    expect(res.status).toBe(400)
  })

  it('refuses an empty body', async () => {
    const res = await post(merchantId, new Uint8Array(0), { contentType: 'image/png', secret: env.sampleShopScreenshotSweepSecret })
    expect(res.status).toBe(400)
  })

  it('refuses an oversized body', async () => {
    const big = new Uint8Array(3 * 1024 * 1024 + 1)
    const res = await post(merchantId, big, { contentType: 'image/png', secret: env.sampleShopScreenshotSweepSecret })
    expect(res.status).toBe(400)
  })

  it('404s on an unknown merchant', async () => {
    const res = await post(
      '00000000-0000-0000-0000-000000000000',
      PNG_1X1,
      { contentType: 'image/png', secret: env.sampleShopScreenshotSweepSecret },
    )
    expect(res.status).toBe(404)
  })

  async function storedPath(id: string) {
    const { data } = await serviceClient()
      .from('merchants').select('sample_screenshot_path').eq('id', id).maybeSingle()
    return data?.sample_screenshot_path as string | null
  }

  it('uploads the image and persists the path', async () => {
    const res = await post(merchantId, PNG_1X1, { contentType: 'image/png', secret: env.sampleShopScreenshotSweepSecret })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // {merchant}/{ms}.png — the timestamp is what makes a recaptured screenshot a NEW URL. The
    // old fixed `{merchant}.png` was overwritten in place, so a browser holding the previous
    // picture (Storage serves it with a max-age) kept showing it long after the recapture.
    const path = await storedPath(merchantId)
    expect(path).toMatch(new RegExp(`^${merchantId}/\\d+\\.png$`))

    const { data: file, error } = await serviceClient().storage.from(BUCKET).download(path!)
    expect(error).toBeNull()
    expect(file).not.toBeNull()
  })

  it('replaces the previous capture rather than accumulating one file per week', async () => {
    await post(merchantId, PNG_1X1, { contentType: 'image/png', secret: env.sampleShopScreenshotSweepSecret })
    const first = await storedPath(merchantId)

    // Same millisecond would produce the same name and defeat the point of the assertion.
    await new Promise((r) => setTimeout(r, 5))
    await post(merchantId, PNG_1X1, { contentType: 'image/png', secret: env.sampleShopScreenshotSweepSecret })
    const second = await storedPath(merchantId)

    expect(second).not.toBe(first)

    const { data: gone } = await serviceClient().storage.from(BUCKET).download(first!)
    expect(gone).toBeNull()
    const { data: kept } = await serviceClient().storage.from(BUCKET).download(second!)
    expect(kept).not.toBeNull()
  })
})
