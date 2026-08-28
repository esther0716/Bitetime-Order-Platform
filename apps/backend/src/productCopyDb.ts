// The write half of Product copy: apply a plan productCopy.ts already made. The rules live next
// door in `productCopy.ts`, which is pure — see the note at the top of that file for the split.
//
// Goes through `db.ts`, which is RLS-EXEMPT. Tenancy here is the plan itself: every row carries
// the `merchant_id` the pure half stamped from the route's own target, and the route's
// `requireSuperadmin` is what makes that target legitimate.

import { withTransaction } from './db.js'
import type { CopyPlan } from './productCopy.js'

/**
 * Insert the planned rows and, when sections were appended, write the merged category list —
 * ONE transaction, so the copy lands whole or not at all. A failed insert rolls back every row
 * and the category write with it; a customer never sees half a menu arrive.
 *
 * Image OBJECTS are not this module's job: the route copies them BEFORE calling this, so a
 * storage failure aborts with nothing in the database (orphaned files are tolerated; orphaned
 * rows pointing at nothing would be broken products on a live storefront).
 */
export async function applyProductCopy(targetMerchantId: string, plan: CopyPlan): Promise<number> {
  return withTransaction(async (tx) => {
    for (const r of plan.rows) {
      await tx`
        insert into products (
          id, merchant_id, name, name_zh, descr, descr_zh, price, unit, unit_quantity,
          active, image_urls, option_groups, category_id, sort
        ) values (
          ${r.id}, ${r.merchant_id}, ${r.name}, ${r.name_zh}, ${r.descr}, ${r.descr_zh},
          ${r.price as never}, ${r.unit}, ${r.unit_quantity},
          ${r.active}, ${r.image_urls}, ${tx.json(r.option_groups as never)},
          ${r.category_id}, ${r.sort}
        )
      `
    }
    if (plan.categories) {
      await tx`
        update merchants
           set product_categories = ${tx.json(plan.categories as never)}
         where id = ${targetMerchantId}
      `
    }
    return plan.rows.length
  })
}
