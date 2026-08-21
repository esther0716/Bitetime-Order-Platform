// tests/api/writes-vouchers.test.ts
// POST/DELETE /api/merchants/:id/vouchers[/:voucherId] — voucher create/delete. The
// load-bearing assertion is tenancy on delete: requireMerchantOwns only proves the caller
// owns :id — it says nothing about whether :voucherId actually belongs to that shop. An
// owner of shop A nesting shop B's voucher under :id = A must be refused (404), not silently
// allowed to delete a stranger's row. See CLAUDE.md → Backend, Global Constraint 2.
import { describe, it, expect, beforeAll } from 'vitest'
import { app } from '../../src/app.js'
import { makeUser, seedMerchant, serviceClient, resetMerchant } from '../rls/helpers.js'

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

function del(path: string, token?: string) {
  return app.request(path, {
    method: 'DELETE',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

type VoucherRow = { id: string; merchant_id: string; code: string; kind: string; amount: number }

async function seedVoucher(fields: { merchant_id: string; code: string; kind?: string; amount?: number }) {
  const { data, error } = await serviceClient()
    .from('vouchers')
    .insert({
      merchant_id: fields.merchant_id,
      code: fields.code,
      kind: fields.kind ?? 'fixed',
      amount: fields.amount ?? 5,
    })
    .select('id')
    .single()
  if (error) throw new Error(`seeding voucher: ${error.message}`)
  return data!.id as string
}

describe('POST /api/merchants/:id/vouchers', () => {
  it('creates a voucher for the owner, forcing merchant_id from the route and uppercasing the code', async () => {
    await resetMerchant('voucher-owner-shop')
    const owner = await makeUser('voucher-owner@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'voucher-owner-shop', owner_id: userId })

    const res = await post(`/api/merchants/${id}/vouchers`, {
      code: 'save10', kind: 'percent', amount: 10, maxUses: 100,
    }, token)

    expect(res.status).toBe(200)
    const row = (await res.json()) as VoucherRow
    expect(row.merchant_id).toBe(id)
    expect(row.code).toBe('SAVE10')

    await serviceClient().from('vouchers').delete().eq('id', row.id)
    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('400s on an empty code', async () => {
    await resetMerchant('voucher-empty-shop')
    const owner = await makeUser('voucher-empty-owner@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'voucher-empty-shop', owner_id: userId })

    const res = await post(`/api/merchants/${id}/vouchers`, { code: '   ', kind: 'fixed', amount: 5 }, token)
    expect(res.status).toBe(400)

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('ignores a client-supplied merchant_id (forced from :id)', async () => {
    await resetMerchant('voucher-evil-shop')
    const owner = await makeUser('voucher-evil-owner@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'voucher-evil-shop', owner_id: userId })

    const res = await post(`/api/merchants/${id}/vouchers`, {
      code: 'SNEAKY', kind: 'fixed', amount: 1, merchant_id: '00000000-0000-0000-0000-000000000000',
    }, token)

    expect(res.status).toBe(200)
    const row = (await res.json()) as VoucherRow
    expect(row.merchant_id).toBe(id)

    await serviceClient().from('vouchers').delete().eq('id', row.id)
    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // ── the #241 restrictions ──────────────────────────────────────────────────
  describe('restrictions', () => {
    let id: string
    let token: string

    beforeAll(async () => {
      await resetMerchant('voucher-limits-shop')
      const owner = await makeUser('voucher-limits-owner@example.com', 'password123')
      const t = await tokenOf(owner)
      token = t.token
      id = await seedMerchant({ slug: 'voucher-limits-shop', owner_id: t.userId, timezone: 'Asia/Kuala_Lumpur' })
    })

    it('resolves the merchant’s DATE to the last instant of that day on the shop clock', async () => {
      const res = await post(`/api/merchants/${id}/vouchers`, {
        code: 'TZ1', kind: 'percent', amount: 10, expiresOn: '2026-08-31',
      }, token)
      expect(res.status).toBe(200)
      const row = (await res.json()) as Record<string, unknown>
      // NOT 2026-08-31T00:00:00Z, which in Kuala Lumpur is 8am on the 31st — the voucher would die
      // mid-breakfast on the day the merchant thought it ran.
      //
      // Compared as an INSTANT, not as a string: PostgREST renders the offset as `+00:00` where
      // `toISOString()` writes `Z`, and pinning the spelling would fail on a formatting choice
      // while the moment is identical. `new Date()` parses both, which is what the browser does.
      expect(new Date(row.expires_at as string).toISOString()).toBe('2026-08-31T15:59:59.999Z')
      // And the merchant is shown back the date they typed, not a UTC slice of that instant.
      expect(row.expires_on).toBe('2026-08-31')
    })

    it('refuses unlimited per customer AND unlimited in total', async () => {
      // #72 reached through the dashboard rather than the request body: an unlimited discount for
      // one person. The named code is what lets the form say something better than "failed".
      const res = await post(`/api/merchants/${id}/vouchers`, {
        code: 'OPENTILL', kind: 'percent', amount: 100, perCustomerLimit: null, maxUses: null,
      }, token)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'unbounded_voucher' })
    })

    it('allows unlimited per customer when the total is bounded', async () => {
      const res = await post(`/api/merchants/${id}/vouchers`, {
        code: 'LOYAL', kind: 'percent', amount: 10, perCustomerLimit: null, maxUses: 500,
      }, token)
      expect(res.status).toBe(200)
      expect((await res.json() as Record<string, unknown>).per_customer_limit).toBeNull()
    })

    it('treats an ABSENT per-customer limit as one each, not as unlimited', async () => {
      // The two are not the same answer. Unlimited is the value that costs the merchant money, so
      // it must be said out loud rather than arrived at by leaving a field off — otherwise every
      // caller predating this field silently creates an open till.
      const res = await post(`/api/merchants/${id}/vouchers`, { code: 'PLAIN', kind: 'fixed', amount: 5 }, token)
      expect(res.status).toBe(200)
      expect((await res.json() as Record<string, unknown>).per_customer_limit).toBe(1)
    })

    it('refuses a limit below one, and a negative minimum', async () => {
      for (const body of [
        { code: 'BAD1', kind: 'fixed', amount: 5, perCustomerLimit: 0 },
        { code: 'BAD2', kind: 'fixed', amount: 5, maxUses: -3 },
        { code: 'BAD3', kind: 'fixed', amount: 5, minOrder: -1 },
      ]) {
        expect((await post(`/api/merchants/${id}/vouchers`, body, token)).status).toBe(400)
      }
    })

    it('refuses a present-but-unparseable expiry rather than dropping it', async () => {
      // Dropped, it becomes a voucher the merchant believes will stop and does not.
      const res = await post(`/api/merchants/${id}/vouchers`, {
        code: 'BADDATE', kind: 'fixed', amount: 5, expiresOn: '31/08/2026',
      }, token)
      expect(res.status).toBe(400)
    })

    it('frees a retired code’s string, and refuses a live duplicate', async () => {
      const first = await post(`/api/merchants/${id}/vouchers`, { code: 'REUSE', kind: 'fixed', amount: 5 }, token)
      const firstId = (await first.json() as { id: string }).id

      // While it is live, the code is taken.
      const dup = await post(`/api/merchants/${id}/vouchers`, { code: 'REUSE', kind: 'fixed', amount: 5 }, token)
      expect(dup.status).toBe(409)
      expect(await dup.json()).toEqual({ error: 'duplicate_code' })

      // Retired, it is free again — the partial unique index. The new row is a NEW campaign with
      // its own id, so the old one's redemptions count against nobody.
      await del(`/api/merchants/${id}/vouchers/${firstId}`, token)
      const again = await post(`/api/merchants/${id}/vouchers`, { code: 'REUSE', kind: 'fixed', amount: 5 }, token)
      expect(again.status).toBe(200)
      expect((await again.json() as { id: string }).id).not.toBe(firstId)
    })
  })

  it('403 for a non-owner', async () => {
    await resetMerchant('voucher-a-shop')
    const owner = await makeUser('voucher-a-owner@example.com', 'password123')
    const { userId: ownerId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'voucher-a-shop', owner_id: ownerId })

    const other = await makeUser('voucher-a-other@example.com', 'password123')
    const { token: otherToken } = await tokenOf(other)

    const res = await post(`/api/merchants/${id}/vouchers`, { code: 'X', kind: 'fixed', amount: 1 }, otherToken)
    expect(res.status).toBe(403)

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('401 without a token', async () => {
    await resetMerchant('voucher-anon-shop')
    const owner = await makeUser('voucher-anon-owner@example.com', 'password123')
    const { userId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'voucher-anon-shop', owner_id: userId })

    const res = await post(`/api/merchants/${id}/vouchers`, { code: 'X', kind: 'fixed', amount: 1 })
    expect(res.status).toBe(401)

    await serviceClient().from('merchants').delete().eq('id', id)
  })
})

describe('DELETE /api/merchants/:id/vouchers/:voucherId', () => {
  it('deactivates the owner’s own voucher, keeping the row', async () => {
    await resetMerchant('voucher-del-shop')
    const owner = await makeUser('voucher-del-owner@example.com', 'password123')
    const { token, userId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'voucher-del-shop', owner_id: userId })
    const voucherId = await seedVoucher({ merchant_id: id, code: 'DOOMED' })

    const res = await del(`/api/merchants/${id}/vouchers/${voucherId}`, token)
    expect(res.status).toBe(200)

    // DEACTIVATED, not deleted. The row survives so its redemption history does, and every read
    // filters `active` — so the customer-facing behaviour is identical to what a delete gave.
    // The unique index is partial, so the code string is free to use again.
    const { data } = await serviceClient().from('vouchers').select('id, active').eq('id', voucherId).maybeSingle()
    expect(data).not.toBeNull()
    expect(data!.active).toBe(false)

    await serviceClient().from('merchants').delete().eq('id', id)
  })

  // Load-bearing: an owner of shop A cannot delete shop B's voucher by nesting it under
  // :id = A. requireMerchantOwns only proves ownership of :id; the handler must separately
  // verify the voucher's own merchant_id before deleting it.
  it('404s and leaves the row intact when the voucher belongs to a different shop', async () => {
    await resetMerchant('voucher-tenant-a')
    await resetMerchant('voucher-tenant-b')
    const ownerA = await makeUser('voucher-tenant-a-owner@example.com', 'password123')
    const { token: tokenA, userId: ownerAId } = await tokenOf(ownerA)
    const shopA = await seedMerchant({ slug: 'voucher-tenant-a', owner_id: ownerAId })

    const ownerB = await makeUser('voucher-tenant-b-owner@example.com', 'password123')
    const { userId: ownerBId } = await tokenOf(ownerB)
    const shopB = await seedMerchant({ slug: 'voucher-tenant-b', owner_id: ownerBId })
    const voucherB = await seedVoucher({ merchant_id: shopB, code: 'SHOPB10' })

    const res = await del(`/api/merchants/${shopA}/vouchers/${voucherB}`, tokenA)
    expect(res.status).toBe(404)

    const { data } = await serviceClient()
      .from('vouchers').select('id, merchant_id, code').eq('id', voucherB).single()
    expect(data!.merchant_id).toBe(shopB)
    expect(data!.code).toBe('SHOPB10')

    await serviceClient().from('vouchers').delete().eq('id', voucherB)
    await serviceClient().from('merchants').delete().eq('id', shopA)
    await serviceClient().from('merchants').delete().eq('id', shopB)
  })

  it('403 for a non-owner', async () => {
    await resetMerchant('voucher-del-a-shop')
    const owner = await makeUser('voucher-del-a-owner@example.com', 'password123')
    const { userId: ownerId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'voucher-del-a-shop', owner_id: ownerId })
    const voucherId = await seedVoucher({ merchant_id: id, code: 'GUARDED' })

    const other = await makeUser('voucher-del-a-other@example.com', 'password123')
    const { token: otherToken } = await tokenOf(other)

    const res = await del(`/api/merchants/${id}/vouchers/${voucherId}`, otherToken)
    expect(res.status).toBe(403)

    await serviceClient().from('vouchers').delete().eq('id', voucherId)
    await serviceClient().from('merchants').delete().eq('id', id)
  })

  it('401 without a token', async () => {
    await resetMerchant('voucher-del-anon-shop')
    const owner = await makeUser('voucher-del-anon-owner@example.com', 'password123')
    const { userId } = await tokenOf(owner)
    const id = await seedMerchant({ slug: 'voucher-del-anon-shop', owner_id: userId })
    const voucherId = await seedVoucher({ merchant_id: id, code: 'ANONCODE' })

    const res = await del(`/api/merchants/${id}/vouchers/${voucherId}`)
    expect(res.status).toBe(401)

    await serviceClient().from('vouchers').delete().eq('id', voucherId)
    await serviceClient().from('merchants').delete().eq('id', id)
  })
})
