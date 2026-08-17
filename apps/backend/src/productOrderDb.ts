// The one statement that writes a shop's arrangement: where each product sits, and which section
// it sits in. The rules live next door in `productOrder.ts`, which is pure — see the note at the
// top of that file for why the split.
//
// Goes through `db.ts`, which is RLS-EXEMPT. The `p.merchant_id` predicate below is the WHOLE
// tenancy guard on this path; `requireMerchantOwns` on the route is what makes it true. A body
// naming a stranger's product updates zero rows, which is the correct answer and needs no
// separate lookup.

import { sql } from './db.js'
import type { ProductOrderItem } from './productOrder.js'

/**
 * Apply an arrangement. Returns how many rows it moved.
 *
 * ONE statement, so it is atomic on its own and needs no `withTransaction()`. A merchant never
 * sees half an arrangement.
 *
 * Three parallel arrays through `unnest`, rather than a `values` list built from the body: the
 * statement is then a fixed string with three parameters whatever the shop's size, and no SQL is
 * assembled from anything a request contained.
 */
export async function writeProductOrder(
  merchantId: string,
  items: ProductOrderItem[],
): Promise<number> {
  // `unnest` of three empty arrays is legal but pointless, and postgres.js has to guess the type
  // of an empty array. Nothing to do is nothing to ask.
  if (items.length === 0) return 0

  const ids = items.map(i => i.id)
  const sorts = items.map(i => i.sort)
  const categoryIds = items.map(i => i.category_id)

  const rows = await sql<{ id: string }[]>`
    update products p
       set sort = v.sort, category_id = v.category_id
      from unnest(${ids}::uuid[], ${sorts}::int[], ${categoryIds}::text[])
           as v(id, sort, category_id)
     where p.id = v.id
       and p.merchant_id = ${merchantId}
    returning p.id
  `
  return rows.length
}
