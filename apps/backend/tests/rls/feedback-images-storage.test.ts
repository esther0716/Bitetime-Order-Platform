// tests/rls/feedback-images-storage.test.ts
// The `feedback-images` bucket is deliberately given NO storage.objects policies
// (20260806120000) — a merchant's screenshot goes in through the backend's service-role
// client (POST /api/merchants/:id/feedback) and comes out through a superadmin-only route
// (GET /api/admin/feedback/:feedbackId/images/:index). The bucket is PRIVATE because the
// platform repo is public and a bug screenshot is usually the merchant's own dashboard —
// customer names, phone numbers, addresses.
//
// This is the proof that "no policy" really does mean "no access" for the browser's own
// Supabase client. Nothing in the app exercises this bucket from the browser, so a future
// migration that flips it public or adds a permissive policy is only ever caught here.
import { describe, it, expect } from 'vitest'
import { anonClient, makeUser, seedMerchant, serviceClient } from './helpers.js'

const BUCKET = 'feedback-images'

// Smallest valid PNG (1x1) — the bucket enforces allowed_mime_types, so the upload has to be
// a real image/png or Storage would refuse it for a reason unrelated to the policy under test.
const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)
function png() {
  return new Blob([PNG_1X1], { type: 'image/png' })
}

describe('feedback-images storage: no browser access either way', () => {
  it('denies an anonymous upload', async () => {
    const { error } = await anonClient()
      .storage.from(BUCKET)
      .upload('anon/anon.png', png(), { contentType: 'image/png' })
    expect(error).not.toBeNull()
  })

  it('denies a merchant owner uploading, even into what would be their own folder', async () => {
    const owner = await makeUser('feedback-images-owner@example.com', 'password123')
    const { data: session } = await owner.auth.getSession()
    const merchantId = await seedMerchant({
      slug: 'feedback-images-shop',
      owner_id: session.session!.user.id,
    })

    const { error } = await owner.storage
      .from(BUCKET)
      .upload(`${merchantId}/own.png`, png(), { contentType: 'image/png' })
    expect(error).not.toBeNull()
  })

  it('denies an anonymous read of an object the service role wrote', async () => {
    const path = 'seed/read-check.png'
    const seeded = await serviceClient().storage.from(BUCKET)
      .upload(path, png(), { contentType: 'image/png', upsert: true })
    // The seed is the premise, not the assertion: if the service role cannot write here, the
    // read check below would "pass" for the wrong reason.
    expect(seeded.error).toBeNull()

    const { error } = await anonClient().storage.from(BUCKET).download(path)
    expect(error).not.toBeNull()

    await serviceClient().storage.from(BUCKET).remove([path])
  })

  it("denies a signed-in merchant reading another shop's screenshot", async () => {
    const path = 'seed/cross-tenant.png'
    const seeded = await serviceClient().storage.from(BUCKET)
      .upload(path, png(), { contentType: 'image/png', upsert: true })
    expect(seeded.error).toBeNull()

    const snooper = await makeUser('feedback-images-snooper@example.com', 'password123')
    const { error } = await snooper.storage.from(BUCKET).download(path)
    expect(error).not.toBeNull()

    await serviceClient().storage.from(BUCKET).remove([path])
  })
})
