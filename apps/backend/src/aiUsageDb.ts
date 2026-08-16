// The persistent half of the monthly Claude ceiling: one statement, and nothing else. The rules
// live next door in `aiUsage.ts`, which is pure — see the note at the top of that file for why
// the split.
//
// Goes through `db.ts`, which is RLS-EXEMPT: the merchant scoping below is a TypeScript
// invariant, and `requireMerchantOwns` on the route is what makes it true.

import { sql } from './db.js'
import type { AiFeature } from './aiUsage.js'

/**
 * Spend one call against a shop's monthly allowance. Returns false when the allowance is gone,
 * and in that case writes nothing.
 *
 * ONE statement, deliberately. A read followed by a write would let two concurrent requests both
 * see `calls = limit - 1` and both proceed, which is exactly the race the daily in-memory window
 * cannot have (single process, no await between the check and the record) and a database-backed
 * counter can. Here the `where` rides on the `do update`, so Postgres holds the row lock for the
 * decision: a conflicting insert that finds the row at its ceiling updates nothing and returns no
 * row, and the caller reads that empty result as a refusal. No transaction is needed for one
 * statement.
 *
 * The count is spent BEFORE the model is called, so a call that then fails still costs the shop
 * one unit. That is the correct side to err on: the request reached Anthropic and may well have
 * been billed. There is no refund path.
 */
export async function consumeAiCall({
  merchantId,
  feature,
  period,
  limit,
}: {
  merchantId: string
  feature: AiFeature
  period: string
  limit: number
}): Promise<boolean> {
  // The insert arm below carries no ceiling check — it cannot, there is no row yet to compare
  // against — so a limit of zero would let every shop through on its first call of the month.
  if (limit < 1) return false

  const rows = await sql<{ calls: number }[]>`
    insert into ai_usage (merchant_id, feature, period, calls)
    values (${merchantId}, ${feature}, ${period}, 1)
    on conflict (merchant_id, feature, period) do update
      set calls = ai_usage.calls + 1, updated_at = now()
      where ai_usage.calls < ${limit}
    returning calls
  `
  return rows.length > 0
}
