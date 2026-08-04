// tests/rls/payment-proof-storage.test.ts
// The `payment-proof` bucket is deliberately given NO storage.objects policies
// (20260804160000) — every read and write goes through the backend's service-role client
// instead (POST /api/orders/:orderId/payment-proof, GET /api/merchants/:id/orders/:orderId/
// payment-proof). This is the proof that "no policy" really does mean "no access" for the
// browser's own Supabase client, not an assumption: a future migration that accidentally flips
// the bucket `public` or adds a permissive policy is only ever caught here, since — unlike
// product-images-storage.test.ts's bucket — no app surface exercises this one directly.
import { describe, it, expect } from 'vitest'
import { anonClient, makeUser, seedMerchant, serviceClient } from './helpers.js'

const BUCKET = 'payment-proof'

// Smallest valid PNG (1x1) — the bucket enforces allowed_mime_types, so the upload has to be a
// real image/png or Storage would refuse it for a reason that has nothing to do with the policy
// under test.
const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)
function png() {
  return new Blob([PNG_1X1], { type: 'image/png' })
}

describe('payment-proof storage: no browser access either way', () => {
  it('denies an anonymous upload', async () => {
    const { error } = await anonClient()
      .storage.from(BUCKET)
      .upload('anon/anon.png', png(), { contentType: 'image/png' })
    expect(error).not.toBeNull()
  })

  it('denies a merchant owner uploading, even into what would be their own folder', async () => {
    const owner = await makeUser('payment-proof-owner@example.com', 'password123')
    const { data: session } = await owner.auth.getSession()
    const merchantId = await seedMerchant({ slug: 'payment-proof-shop', owner_id: session.session!.user.id })

    const { error } = await owner.storage
      .from(BUCKET)
      .upload(`${merchantId}/own.png`, png(), { contentType: 'image/png' })
    expect(error).not.toBeNull()
  })

  it('denies an anonymous read', async () => {
    // Written directly by the service role, exactly as the backend does after a real upload.
    const path = 'seed/read-check.png'
    await serviceClient().storage.from(BUCKET).upload(path, png(), { contentType: 'image/png', upsert: true })

    const { error } = await anonClient().storage.from(BUCKET).download(path)
    expect(error).not.toBeNull()

    await serviceClient().storage.from(BUCKET).remove([path])
  })
})
