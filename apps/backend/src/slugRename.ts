// The slug rename rule (#253, ADR 0022), as ONE transaction — the multi-statement shape that
// CLAUDE.md sends through withTransaction(), like order intake. Three effects commit whole or
// not at all: the claim-wins delete (a live claim on a retired slug kills its redirect), the
// rename itself, and the history row that keeps the OLD slug answering. Split across REST calls
// these had real failure windows — a rename without its history row is a shop whose printed QR
// codes just died.
//
// db.ts is RLS-exempt: `merchantId` MUST come from a caller that requireMerchantOwns has
// already authorised — tenancy on this path is this signature, not a policy.
import { withTransaction } from './db.js'

/** Renames the shop and returns its full row, or null when the shop does not exist. Throws on
 *  conflict with another shop's current slug (merchants.slug is unique). */
export function renameMerchantSlug(
  merchantId: string,
  slug: string,
): Promise<Record<string, unknown> | null> {
  return withTransaction(async (tx) => {
    const [current] = await tx`select slug from merchants where id = ${merchantId} for update`
    if (!current) return null
    if (current.slug === slug) {
      const [row] = await tx`select * from merchants where id = ${merchantId}`
      return row ?? null
    }
    await tx`delete from merchant_slug_history where old_slug = ${slug}`
    const [row] = await tx`
      update merchants set slug = ${slug} where id = ${merchantId} returning *`
    await tx`
      insert into merchant_slug_history (old_slug, merchant_id)
      values (${current.slug}, ${merchantId})
      on conflict (old_slug) do update set merchant_id = ${merchantId}, created_at = now()`
    return row ?? null
  })
}
