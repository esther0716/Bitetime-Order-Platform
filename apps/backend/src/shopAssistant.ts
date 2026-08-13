// Answers a merchant's plain-language question about their own shop's orders.
// See tasks/prd-shop-analytics-assistant.md.
//
// Pure adapter, shaped like releases.ts and menuImport.ts: the API key is a PARAMETER, the stats
// reader is INJECTED, and this file imports nothing from supabase.ts / db.ts. A unit test drives
// it with no database and no env.
//
// ── The tenancy design, which is the whole point of this module ──────────────────────────────
//
// The model is given ONE tool, and that tool cannot name a shop. Its schema has two parameters —
// how many days, and how coarse the buckets are. The merchant id is closed over by the handler
// the route builds, after it has already proven the caller owns that shop.
//
// So a question about somebody else's shop is not refused, it is UNSAYABLE. There is no field in
// which to put another merchant's id. That matters more here than in most places: `db.ts` runs as
// the database owner and no RLS policy applies to it, so on this path tenancy is a TypeScript
// invariant rather than a Postgres one. A tool that took a merchant id — however carefully
// checked — would put that invariant one prompt away from being wrong.
//
// There is deliberately no SQL tool, no table name and no free-form filter.
import Anthropic from '@anthropic-ai/sdk'
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema'
import { REVENUE_RANGES } from '@bitetime/shared'
import type { MerchantStats } from '@bitetime/shared'

export interface ShopStatsQuery {
  days: number
  granularity: 'day' | 'week'
}

/** Reads one shop's statistics. The shop is bound by the caller; this signature cannot name one. */
export type GetShopStats = (query: ShopStatsQuery) => Promise<MerchantStats>

export interface ShopAnswer {
  text: string
  /**
   * The window the model actually asked for, or null when it answered without calling the tool.
   * The route turns this into the disclaimer — generated from the call, never written by the
   * model, so it cannot describe a window it did not read.
   */
  queried: ShopStatsQuery | null
}

export type AskShopAssistant = (
  apiKey: string,
  input: {
    question: string
    lang: 'en' | 'zh'
    currency: string
    timeZone: string
    /** Today in the shop's zone, as `YYYY-MM-DD`. Injected so a test can pin the date. */
    today: string
    getStats: GetShopStats
  },
) => Promise<ShopAnswer | null>

/** How many turns the loop may take before it is cut off. One question needs one or two. */
const MAX_ITERATIONS = 6

/**
 * Splits `MerchantStats` into what is ALL-TIME and what covers the requested window.
 *
 * `computeMerchantStats` deliberately mixes the two: the KPI cards are all-time and everything
 * under them is windowed, and on screen the range pills sit between the two groups and say so.
 * The model gets no pills. Handed the bare object it reads `revenue` as the window's revenue and
 * answers "how was last month" with an all-time number — confidently, and wrongly.
 *
 * So the shape it receives names the split instead of relying on it to be inferred.
 */
function labelled(stats: MerchantStats, query: ShopStatsQuery, timeZone: string) {
  return {
    window: {
      days: query.days,
      granularity: query.granularity,
      time_zone: timeZone,
      note: `The "in_window" figures below cover the last ${query.days} days only. The "all_time" figures cover the shop's whole history and are NOT limited to that window.`,
    },
    all_time: {
      total_orders: stats.totalOrders,
      revenue: stats.revenue,
      customer_count: stats.customerCount,
      average_order_value: stats.avgOrder,
      vouchers_redeemed: stats.vouchersRedeemed,
      orders_change_vs_last_month: stats.ordersDelta,
      revenue_change_vs_last_month: stats.revenueDelta,
    },
    in_window: {
      revenue_by_bucket: stats.series,
      revenue_by_product: stats.productRevenue,
      orders_by_status: stats.statusBreakdown,
    },
  }
}

function buildSystem(input: { lang: 'en' | 'zh'; currency: string; timeZone: string; today: string }): string {
  return `You answer a shop owner's questions about their own shop, using only the statistics the get_shop_stats tool returns.

Today is ${input.today} in the shop's own time zone (${input.timeZone}). Money is in ${input.currency}.

Rules:
- Call get_shop_stats to get the figures. Choose the "days" window that fits the question.
- Answer ONLY from what the tool returned. Never estimate, extrapolate or invent a number.
- If the figures do not contain the answer, say so plainly and say what they do show. Do not apologise at length.
- Read the "window" note carefully: "all_time" figures cover the shop's whole history, "in_window" figures cover the chosen window only. Never present an all_time figure as the window's.
- Revenue excludes cancelled orders.
- Keep the answer short — two or three sentences, or a short list. The owner is reading this between orders.
- Write plain sentences. Use NO markdown: no asterisks for bold, no backticks, no headings, no bullet characters. The answer is shown as plain text, so any markup appears literally on screen.
- Write the answer in ${input.lang === 'zh' ? 'Chinese' : 'English'}.
- You cannot see any other shop's figures, and you cannot change anything. If asked to, say so.`
}

export const askShopAssistant: AskShopAssistant = async (apiKey, input) => {
  if (!apiKey) {
    console.error('Shop assistant skipped: no Anthropic API key configured')
    return null
  }

  // The last window the model asked for, captured as the tool runs. The disclaimer is built from
  // this rather than from anything the model wrote.
  let queried: ShopStatsQuery | null = null

  try {
    const client = new Anthropic({ apiKey })

    const statsTool = betaTool({
      name: 'get_shop_stats',
      // No shop, merchant, tenant or id parameter — see the header. The description says whose
      // figures these are so the model does not go looking for a way to name one.
      description:
        'Returns order statistics for THIS shop — the only shop you can see. Revenue, order counts, '
        + 'a per-product breakdown and a status breakdown. Cancelled orders are excluded from revenue.',
      inputSchema: {
        type: 'object',
        properties: {
          days: {
            type: 'integer',
            enum: [...REVENUE_RANGES],
            description: 'How many days back the windowed figures should cover.',
          },
          granularity: {
            type: 'string',
            enum: ['day', 'week'],
            description: 'Bucket size for the revenue series. Use "week" for windows over 30 days.',
          },
        },
        required: ['days', 'granularity'],
        additionalProperties: false,
      },
      run: async (args) => {
        const query: ShopStatsQuery = {
          days: args.days,
          granularity: args.granularity,
        }
        queried = query
        const stats = await input.getStats(query)
        return JSON.stringify(labelled(stats, query, input.timeZone))
      },
    })

    const runner = client.beta.messages.toolRunner({
      model: 'claude-opus-5',
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system: buildSystem(input),
      tools: [statsTool],
      messages: [{ role: 'user', content: input.question }],
    })

    let iterations = 0
    let last: Anthropic.Beta.BetaMessage | null = null
    for await (const message of runner) {
      last = message
      if (++iterations >= MAX_ITERATIONS) break
    }

    if (!last) {
      console.error('Shop assistant produced no message')
      return null
    }
    if (last.stop_reason === 'refusal') {
      console.error('Shop assistant was refused')
      return null
    }
    if (last.stop_reason === 'max_tokens') {
      // A truncated answer about money is worse than no answer: the merchant cannot tell which
      // half is missing.
      console.error('Shop assistant ran out of tokens')
      return null
    }

    const text = last.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim()

    if (!text) {
      console.error('Shop assistant returned no text')
      return null
    }

    return { text, queried }
  } catch (e) {
    console.error('Shop assistant failed:', e instanceof Error ? e.message : String(e))
    return null
  }
}
