// tests/api/menu-import.test.ts
// POST /api/merchants/:id/menu-import — AI menu import (tasks/prd-ai-menu-import.md).
//
// Two load-bearing assertions here, and neither is about the reading itself (that is
// tests/unit/menuImport.test.ts, which drives the adapter with no database):
//
//   1. The route CREATES NOTHING. Its whole reason for existing is that a machine-read price is
//      a proposal, so a `products` row appearing as a side effect of an import would be the
//      feature failing rather than a lint-level slip.
//   2. It REFUSES rather than degrades. An unconfigured platform, an unreadable response and an
//      oversized upload each get their own status. The failure this guards against is any of
//      them arriving as `{ items: [] }`, which on screen is indistinguishable from "your menu
//      has nothing on it".
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { app, menuImportDeps } from '../../src/app.js'
import { env } from '../../src/env.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'
import type { ExtractMenu } from '../../src/menuImport.js'

async function tokenOf(client: Awaited<ReturnType<typeof makeUser>>) {
  const { data } = await client.auth.getSession()
  return { token: data.session!.access_token, userId: data.session!.user.id }
}

function post(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

const PHOTO = { image: 'aGVsbG8=', media_type: 'image/jpeg' }

const realExtract = menuImportDeps.extract
const realKey = env.anthropicApiKey

beforeEach(() => {
  // vitest.db.config.ts FORCES `ANTHROPIC_API_KEY` empty so that a suite which forgets to swap
  // the dep cannot bill a real key. The route reads it before reaching the dep, so these tests
  // set it here — locally, and restored below — rather than weakening that guarantee for every
  // other suite in the run.
  env.anthropicApiKey = 'sk-ant-test-stub'
})

afterEach(() => {
  menuImportDeps.extract = realExtract
  env.anthropicApiKey = realKey
})

/** Swaps in a reader that returns `draft` and records what the route asked it to read. */
function stubExtract(draft: Awaited<ReturnType<ExtractMenu>>) {
  const calls: Parameters<ExtractMenu>[] = []
  menuImportDeps.extract = async (...args) => {
    calls.push(args)
    return draft
  }
  return calls
}

async function ownerOf(slug: string, status: 'active' | 'pending' | 'suspended' = 'active') {
  await resetMerchant(slug)
  const owner = await makeUser(`${slug}@example.com`, 'password123')
  const { token, userId } = await tokenOf(owner)
  const id = await seedMerchant({ slug, owner_id: userId, status })
  return { token, userId, id }
}

describe('POST /api/merchants/:id/menu-import', () => {
  it('returns drafts and passes the shop currency to the reader', async () => {
    const { token, id } = await ownerOf('menu-import-shop')
    await serviceClient().from('merchants').update({ currency: 'SGD' }).eq('id', id)
    const calls = stubExtract({
      items: [{
        name: 'Chocolate Chip Cookie',
        price_text: 'RM 12.50',
        price: 12.5,
      }],
    })

    const res = await post(`/api/merchants/${id}/menu-import`, PHOTO, token)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      items: [{ name: 'Chocolate Chip Cookie', price_text: 'RM 12.50', price: 12.5 }],
    })
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toEqual({ imageBase64: 'aGVsbG8=', mediaType: 'image/jpeg', currency: 'SGD' })
  })

  // The assertion the whole design rests on.
  it('creates no product row', async () => {
    const { token, id } = await ownerOf('menu-import-nowrite')
    stubExtract({ items: [{ name: 'Brownie', price_text: '6.00', price: 6 }] })

    await post(`/api/merchants/${id}/menu-import`, PHOTO, token)

    const { data } = await serviceClient().from('products').select('id').eq('merchant_id', id)
    expect(data ?? []).toHaveLength(0)
  })

  it('passes an empty item list through as a result', async () => {
    const { token, id } = await ownerOf('menu-import-empty')
    stubExtract({ items: [] })

    const res = await post(`/api/merchants/${id}/menu-import`, PHOTO, token)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [] })
  })

  it('refuses an anonymous caller', async () => {
    const { id } = await ownerOf('menu-import-anon')
    const res = await post(`/api/merchants/${id}/menu-import`, PHOTO)
    expect(res.status).toBe(401)
  })

  it("refuses a caller who does not own the shop", async () => {
    const { id } = await ownerOf('menu-import-victim')
    await resetMerchant('menu-import-attacker')
    const attacker = await makeUser('menu-import-attacker@example.com', 'password123')
    const { token: attackerToken, userId } = await tokenOf(attacker)
    await seedMerchant({ slug: 'menu-import-attacker', owner_id: userId })
    const calls = stubExtract({ items: [] })

    const res = await post(`/api/merchants/${id}/menu-import`, PHOTO, attackerToken)

    expect(res.status).toBe(403)
    // Refused before any spend, not merely refused in the answer.
    expect(calls).toHaveLength(0)
  })

  it('refuses a shop that is not active', async () => {
    const { token, id } = await ownerOf('menu-import-suspended', 'suspended')
    const calls = stubExtract({ items: [] })

    const res = await post(`/api/merchants/${id}/menu-import`, PHOTO, token)

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'shop_not_active' })
    expect(calls).toHaveLength(0)
  })

  it('refuses a media type that is not JPEG or PNG', async () => {
    const { token, id } = await ownerOf('menu-import-pdf')
    const calls = stubExtract({ items: [] })

    const res = await post(
      `/api/merchants/${id}/menu-import`,
      { image: 'aGVsbG8=', media_type: 'application/pdf' },
      token,
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'bad_media_type' })
    expect(calls).toHaveLength(0)
  })

  it('refuses a request with no image', async () => {
    const { token, id } = await ownerOf('menu-import-noimage')
    stubExtract({ items: [] })

    const res = await post(`/api/merchants/${id}/menu-import`, { media_type: 'image/png' }, token)

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'missing_image' })
  })

  it('refuses an image over the size cap', async () => {
    const { token, id } = await ownerOf('menu-import-huge')
    const calls = stubExtract({ items: [] })
    // Just past 5 MB decoded. Built as characters so nothing decodes it to find out.
    const oversized = 'A'.repeat(Math.ceil((5 * 1024 * 1024 * 4) / 3) + 8)

    const res = await post(
      `/api/merchants/${id}/menu-import`,
      { image: oversized, media_type: 'image/jpeg' },
      token,
    )

    expect(res.status).toBe(413)
    expect(calls).toHaveLength(0)
  })

  it('refuses with 503 when no Anthropic key is configured', async () => {
    const { token, id } = await ownerOf('menu-import-nokey')
    env.anthropicApiKey = ''
    const calls = stubExtract({ items: [] })

    const res = await post(`/api/merchants/${id}/menu-import`, PHOTO, token)

    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'menu_import_unavailable' })
    expect(calls).toHaveLength(0)
  })

  // 502, not 200 with an empty list. The distinction is the point of the endpoint.
  it('refuses with 502 when the reader could not read the menu', async () => {
    const { token, id } = await ownerOf('menu-import-unreadable')
    stubExtract(null)

    const res = await post(`/api/merchants/${id}/menu-import`, PHOTO, token)

    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'could_not_read_menu' })
  })
})
