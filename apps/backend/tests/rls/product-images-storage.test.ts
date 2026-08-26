// tests/rls/product-images-storage.test.ts
// Product image uploads are the ONE write the browser still makes directly against Postgres-backed
// infrastructure: `store.ts -> uploadProductImages` posts to Storage with the merchant's own token,
// so the `product_images_write_own` policy on storage.objects is the whole control. That policy
// calls `public.current_merchant_id()`, which reads `public.merchants` — a table the browser roles
// hold no grant on since 20260718130000. A SECURITY INVOKER helper there denies the OWNER their own
// folder ("permission denied for table merchants"), which is a broken feature, not a closed door.
//
// So this suite asserts BOTH directions: the owner can write their own folder, and cannot write
// anyone else's. A fix that grants the browser SELECT on merchants would pass the first and reopen
// the door the revoke closed; a helper that is definer-but-unscoped would pass the first and fail
// the second.
//
// The THIRD role is asserted for a reason the first two do not cover. `current_merchant_id()`
// answers "the shop the caller owns", and a superadmin owns none — so it returns NULL and the
// folder comparison is NULL, not true. That denied a superadmin impersonating a shop
// (merchant/Dashboard.tsx, "Viewing as shop") the one dashboard control the browser still writes
// straight to Storage, with the bare "new row violates row-level security policy". Fixed by
// 20260826130000, which adds the `or public.is_superadmin()` escape every table policy in
// 20260627120100 already carried.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { anonClient, makeUser, seedMerchant, seedProduct, serviceClient } from './helpers.js'

const BUCKET = 'product-images'

// Smallest valid PNG (1x1). The bucket enforces allowed_mime_types + a 5 MiB cap
// (20260727120000), so the upload has to be a real image/png or Storage rejects it for a reason
// that has nothing to do with the policy under test.
const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

function png() {
  return new Blob([PNG_1X1], { type: 'image/png' })
}

describe('product-images storage policy', () => {
  let ownerA: Awaited<ReturnType<typeof makeUser>>
  let superadmin: Awaited<ReturnType<typeof makeUser>>
  let merchantA: string
  let merchantB: string
  let productA: string
  let productB: string
  const written: string[] = []

  beforeAll(async () => {
    ownerA = await makeUser('product-images-owner-a@example.com', 'password123')
    const ownerB = await makeUser('product-images-owner-b@example.com', 'password123')
    const { data: sessionA } = await ownerA.auth.getSession()
    const { data: sessionB } = await ownerB.auth.getSession()
    merchantA = await seedMerchant({ slug: 'product-images-shop-a', owner_id: sessionA.session!.user.id })
    merchantB = await seedMerchant({ slug: 'product-images-shop-b', owner_id: sessionB.session!.user.id })
    productA = await seedProduct({ merchant_id: merchantA, price: 10 })
    productB = await seedProduct({ merchant_id: merchantB, price: 10 })

    // A superadmin owns no shop — which is exactly the condition that broke the upload. The
    // profile row is written by the service client because `guard_profile_privileges`
    // (20260627120300) forces app_role to 'customer' for every other writer.
    superadmin = await makeUser('product-images-superadmin@example.com', 'password123')
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
    const path = `${merchantA}/${productA}/own-folder.png`
    const { error } = await ownerA.storage
      .from(BUCKET)
      .upload(path, png(), { contentType: 'image/png', upsert: true })
    if (!error) written.push(path)

    expect(error).toBeNull()
  })

  it("denies a merchant owner writing into another merchant's folder", async () => {
    const path = `${merchantB}/${productB}/stolen.png`
    const { error } = await ownerA.storage
      .from(BUCKET)
      .upload(path, png(), { contentType: 'image/png', upsert: true })
    if (!error) written.push(path)

    expect(error).not.toBeNull()
  })

  it("lets a superadmin upload into a shop's folder while impersonating it", async () => {
    const path = `${merchantA}/${productA}/superadmin.png`
    const { error } = await superadmin.storage
      .from(BUCKET)
      .upload(path, png(), { contentType: 'image/png', upsert: true })
    if (!error) written.push(path)

    expect(error).toBeNull()
  })

  it('denies an anonymous upload', async () => {
    const path = `${merchantA}/${productA}/anon.png`
    const { error } = await anonClient()
      .storage.from(BUCKET)
      .upload(path, png(), { contentType: 'image/png', upsert: true })
    if (!error) written.push(path)

    expect(error).not.toBeNull()
  })
})
