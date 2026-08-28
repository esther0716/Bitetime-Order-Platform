// tests/api/slug-history.test.ts
// Slug renames stop being destructive (#253, ADR 0022): the rename records the outgoing slug,
// the public shop read answers a retired slug with the shop's current one (the storefront edge
// function turns that into a 301), and a live claim on a retired slug beats the dead redirect.
import { describe, it, expect } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, resetMerchant } from '../rls/helpers.js'

async function ownerOf(slug: string) {
  await resetMerchant(slug)
  const owner = await makeUser(`${slug}@example.com`, 'password123')
  const { data } = await owner.auth.getSession()
  const token = data.session!.access_token
  const id = await seedMerchant({ slug, owner_id: data.session!.user.id, status: 'active' })
  return { token, id }
}

function patchSlug(id: string, slug: string, token: string) {
  return app.request(`/api/merchants/${id}/slug`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ slug }),
  })
}

const readShop = (slug: string) => app.request(`/api/merchants/${slug}`)

describe('slug rename history', () => {
  it('answers a retired slug with the current one', async () => {
    // A previous run leaves this shop at its RENAMED slug, so reset both before seeding — the
    // owner_id unique key otherwise refuses the seed.
    await resetMerchant('sh-after')
    const { token, id } = await ownerOf('sh-before')

    const renamed = await patchSlug(id, 'sh-after', token)
    expect(renamed.status).toBe(200)

    const old = await readShop('sh-before')
    expect(old.status).toBe(200)
    expect(await old.json()).toEqual({ moved_to: 'sh-after' })

    const current = await readShop('sh-after')
    const row = (await current.json()) as Record<string, unknown>
    expect(row.slug).toBe('sh-after')
    expect(row.id).toBe(id)

    await resetMerchant('sh-after')
  })

  it('still refuses another shop\'s CURRENT slug', async () => {
    const a = await ownerOf('sh-taken')
    const b = await ownerOf('sh-claimer')

    const res = await patchSlug(b.id, 'sh-taken', b.token)
    expect(res.status).toBe(409)

    await resetMerchant('sh-taken')
    await resetMerchant('sh-claimer')
    void a
  })

  it('claim-wins: a live claim on a retired slug kills the redirect', async () => {
    await resetMerchant('sh-a-new')
    const a = await ownerOf('sh-freed')
    await patchSlug(a.id, 'sh-a-new', a.token) // 'sh-freed' now retired, redirecting to a

    const b = await ownerOf('sh-b')
    const claim = await patchSlug(b.id, 'sh-freed', b.token)
    expect(claim.status).toBe(200)

    // The slug now serves shop B — a full row, not a redirect to A.
    const res = await readShop('sh-freed')
    const row = (await res.json()) as Record<string, unknown>
    expect(row.id).toBe(b.id)
    expect(row.moved_to).toBeUndefined()

    await resetMerchant('sh-a-new')
    await resetMerchant('sh-freed')
  })

  it('a chain rename redirects each retired slug to the CURRENT one', async () => {
    await resetMerchant('sh-two')
    await resetMerchant('sh-three')
    const { token, id } = await ownerOf('sh-one')

    await patchSlug(id, 'sh-two', token)
    await patchSlug(id, 'sh-three', token)

    for (const retired of ['sh-one', 'sh-two']) {
      const res = await readShop(retired)
      expect(await res.json()).toEqual({ moved_to: 'sh-three' })
    }

    await resetMerchant('sh-three')
  })

  it('an unknown slug still answers null', async () => {
    const res = await readShop('sh-never-existed')
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })
})
