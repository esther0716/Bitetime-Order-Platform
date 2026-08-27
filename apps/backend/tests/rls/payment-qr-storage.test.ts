// tests/rls/payment-qr-storage.test.ts
// The payment QR is the second — and last — dashboard control the browser writes DIRECTLY to
// Storage with its own token (`store.ts -> uploadPaymentQr`), so `payment_qr_write_own`
// (20260729130000) is the whole control, exactly as `product_images_write_own` is for photos.
// It had no suite of its own, which is how it came to carry the same superadmin defect the photo
// policy did and be fixed by the same migration (20260826130000) with nothing asserting either
// half. This is that assertion: owner yes, stranger no, impersonating superadmin yes, anon no.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { anonClient, makeUser, seedMerchant, serviceClient } from './helpers.js'

const BUCKET = 'payment-qr'

// Smallest valid PNG (1x1). The bucket enforces allowed_mime_types + a 2 MiB cap, so the upload
// has to be a real image/png or Storage rejects it for a reason unrelated to the policy.
const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

function png() {
  return new Blob([PNG_1X1], { type: 'image/png' })
}

describe('payment-qr storage policy', () => {
  let ownerA: Awaited<ReturnType<typeof makeUser>>
  let superadmin: Awaited<ReturnType<typeof makeUser>>
  let merchantA: string
  let merchantB: string
  const written: string[] = []

  beforeAll(async () => {
    ownerA = await makeUser('payment-qr-owner-a@example.com', 'password123')
    const ownerB = await makeUser('payment-qr-owner-b@example.com', 'password123')
    const { data: sessionA } = await ownerA.auth.getSession()
    const { data: sessionB } = await ownerB.auth.getSession()
    merchantA = await seedMerchant({ slug: 'payment-qr-shop-a', owner_id: sessionA.session!.user.id })
    merchantB = await seedMerchant({ slug: 'payment-qr-shop-b', owner_id: sessionB.session!.user.id })

    // A superadmin owns no shop, so `current_merchant_id()` returns NULL for them — the condition
    // the policy has to survive. Written by the service client because `guard_profile_privileges`
    // (20260627120300) forces app_role to 'customer' for every other writer.
    superadmin = await makeUser('payment-qr-superadmin@example.com', 'password123')
    const { data: sessionS } = await superadmin.auth.getSession()
    const superUid = sessionS.session!.user.id
    const svc = serviceClient()
    await svc.from('profiles').delete().eq('user_id', superUid)
    const { error: profileErr } = await svc
      .from('profiles')
      .insert({ id: superUid, user_id: superUid, app_role: 'superadmin' })
    if (profileErr) throw new Error(`seeding superadmin profile: ${profileErr.message}`)
  })

  afterAll(async () => {
    // Storage objects have no FK to merchants, so resetMerchant does not take them with it.
    if (written.length) await serviceClient().storage.from(BUCKET).remove(written)
  })

  it('lets a merchant owner upload into their own folder', async () => {
    const path = `${merchantA}/own-folder.png`
    const { error } = await ownerA.storage
      .from(BUCKET)
      .upload(path, png(), { contentType: 'image/png', upsert: true })
    if (!error) written.push(path)

    expect(error).toBeNull()
  })

  it("denies a merchant owner writing into another merchant's folder", async () => {
    const path = `${merchantB}/stolen.png`
    const { error } = await ownerA.storage
      .from(BUCKET)
      .upload(path, png(), { contentType: 'image/png', upsert: true })
    if (!error) written.push(path)

    expect(error).not.toBeNull()
  })

  it("lets a superadmin upload into a shop's folder while impersonating it", async () => {
    const path = `${merchantA}/superadmin.png`
    const { error } = await superadmin.storage
      .from(BUCKET)
      .upload(path, png(), { contentType: 'image/png', upsert: true })
    if (!error) written.push(path)

    expect(error).toBeNull()
  })

  it('denies an anonymous upload', async () => {
    const path = `${merchantA}/anon.png`
    const { error } = await anonClient()
      .storage.from(BUCKET)
      .upload(path, png(), { contentType: 'image/png', upsert: true })
    if (!error) written.push(path)

    expect(error).not.toBeNull()
  })
})
