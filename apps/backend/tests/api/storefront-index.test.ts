// tests/api/storefront-index.test.ts
// GET /api/storefront-index — the shop sitemap's source (#253). Public by definition: it holds
// exactly what /sitemap-shops.xml publishes, which is active shops' slugs and nothing else.
import { describe, it, expect } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, resetMerchant } from '../rls/helpers.js'

async function seedShop(slug: string, status: 'active' | 'pending' | 'suspended') {
  await resetMerchant(slug)
  const owner = await makeUser(`${slug}@example.com`, 'password123')
  const { data } = await owner.auth.getSession()
  await seedMerchant({ slug, owner_id: data.session!.user.id, status })
}

describe('GET /api/storefront-index', () => {
  it('lists active shops only, as slugs', async () => {
    await seedShop('idx-live', 'active')
    await seedShop('idx-shut', 'suspended')
    await seedShop('idx-stuck', 'pending')

    const res = await app.request('/api/storefront-index')
    expect(res.status).toBe(200)
    const { shops } = (await res.json()) as { shops: { slug: string }[] }
    const slugs = shops.map((s: { slug: string }) => s.slug)
    expect(slugs).toContain('idx-live')
    expect(slugs).not.toContain('idx-shut')
    expect(slugs).not.toContain('idx-stuck')

    for (const s of ['idx-live', 'idx-shut', 'idx-stuck']) await resetMerchant(s)
  })
})
