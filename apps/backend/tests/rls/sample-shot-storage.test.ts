// tests/rls/sample-shot-storage.test.ts
// The `sample-shop-screenshots` bucket is PUBLIC for reads (the migration's `public: true`) but
// has no storage.objects policy at all — every write goes through the backend's service-role
// client in POST /api/internal/sample-shop-screenshot/:merchantId. This is the proof that no
// browser role (anon or an authenticated shop owner) can write here directly, and that the public
// read flag actually works — unlike payment-proof-storage.test.ts's bucket (private, no read
// either), a sample shot is meant to be viewable without auth once the sweep has written it.
import { describe, it, expect } from 'vitest'
import { anonClient, makeUser, seedMerchant, serviceClient } from './helpers.js'

const BUCKET = 'sample-shop-screenshots'

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)
function png() {
  return new Blob([PNG_1X1], { type: 'image/png' })
}

describe('sample-shop-screenshots storage: public read, no browser write', () => {
  it('denies an anonymous upload', async () => {
    const { error } = await anonClient()
      .storage.from(BUCKET)
      .upload('anon/anon.png', png(), { contentType: 'image/png' })
    expect(error).not.toBeNull()
  })

  it('denies a merchant owner uploading, even into what would be their own file', async () => {
    const owner = await makeUser('sample-shot-storage-owner@example.com', 'password123')
    const { data: session } = await owner.auth.getSession()
    const merchantId = await seedMerchant({ slug: 'sample-shot-storage-shop', owner_id: session.session!.user.id })

    const { error } = await owner.storage
      .from(BUCKET)
      .upload(`${merchantId}.png`, png(), { contentType: 'image/png' })
    expect(error).not.toBeNull()
  })

  it('allows an anonymous read of a file the service role wrote', async () => {
    const path = 'seed/read-check.png'
    await serviceClient().storage.from(BUCKET).upload(path, png(), { contentType: 'image/png', upsert: true })

    const { data, error } = await anonClient().storage.from(BUCKET).download(path)
    expect(error).toBeNull()
    expect(data).not.toBeNull()

    await serviceClient().storage.from(BUCKET).remove([path])
  })
})
