// Trial feedback (#155) — data access for the one-time, platform-initiated survey asked
// once a shop's trial has ended. See CONTEXT.md → Trial feedback.
//
// Every statement here is a single write or read against the service-role `admin` client
// (RLS-exempt) — no transaction is needed, same posture as feedback.ts. The pure email
// builder lives in trialFeedbackEmail.ts, not here: this file imports `admin`, which pulls
// in env.ts at module load, so a plain unit test importing anything from here needs every
// required env var set — keeping the pure builder in its own file is what lets it be unit
// tested without a Supabase stack (mirrors billingLifecycle.ts staying separate from
// feedback.ts's DB access).
import { admin } from './supabase.js'
import type { TrialFeedbackDraft } from '@bitetime/shared'

export interface TrialFeedbackRow {
  merchant_id: string
  sent_at: string
  rating: number | null
  comment: string | null
  responded_at: string | null
  skipped_at: string | null
}

export interface TrialFeedbackWithShop extends TrialFeedbackRow {
  shop_name: string | null
  shop_slug: string | null
}

export interface DueTrial {
  merchantId: string
  ownerId: string
  shopName: string
}

/**
 * Merchants whose trial has ended and who have never been sent this survey — the sweep's
 * worklist. A merchant with no `merchant_billing` row, or one whose `trial_ends_at` is null
 * (never trialed, or comped) or still in the future, is not a candidate.
 */
export async function findDueTrials(now: Date): Promise<DueTrial[]> {
  const { data, error } = await admin
    .from('merchant_billing')
    .select('merchant_id, trial_ends_at, merchants(owner_id, name)')
    .not('trial_ends_at', 'is', null)
    .lte('trial_ends_at', now.toISOString())
  if (error) throw new Error(error.message)

  const candidates = (data ?? []).map((row: any) => ({
    merchantId: row.merchant_id as string,
    ownerId: row.merchants.owner_id as string,
    shopName: row.merchants.name as string,
  }))
  if (candidates.length === 0) return []

  const { data: already, error: seenErr } = await admin
    .from('trial_feedback')
    .select('merchant_id')
    .in('merchant_id', candidates.map(c => c.merchantId))
  if (seenErr) throw new Error(seenErr.message)

  const seen = new Set((already ?? []).map((r: any) => r.merchant_id as string))
  return candidates.filter(c => !seen.has(c.merchantId))
}

/**
 * The atomic one-shot claim: creates the row BEFORE the email is sent, so a concurrent sweep
 * run cannot double-send. Mirrors claimOnce in orderEmails.ts, adapted to an INSERT —
 * `merchant_id` is the primary key, so a second claim for the same merchant hits a
 * unique-violation and this returns false rather than throwing.
 */
export async function claimSend(merchantId: string): Promise<boolean> {
  const { error } = await admin.from('trial_feedback').insert({ merchant_id: merchantId })
  if (!error) return true
  if (error.code === '23505') return false // already claimed by a concurrent run
  throw new Error(error.message)
}

/**
 * Hand back a claim whose send did not happen, so the next sweep retries it — mirrors
 * releaseClaim in orderEmails.ts. Deletes rather than nulling a column, because "claimed" for
 * this table IS "the row exists".
 */
export async function releaseSend(merchantId: string): Promise<void> {
  const { error } = await admin.from('trial_feedback').delete().eq('merchant_id', merchantId)
  if (error) {
    console.error(`Failed to release trial_feedback claim for ${merchantId} — survey will not be retried:`, error.message)
  }
}

export async function getOwnTrialFeedback(merchantId: string): Promise<TrialFeedbackRow | null> {
  const { data, error } = await admin
    .from('trial_feedback').select('*').eq('merchant_id', merchantId).maybeSingle()
  if (error) throw new Error(error.message)
  return data as TrialFeedbackRow | null
}

type WriteOutcome =
  | { ok: true; row: TrialFeedbackRow }
  | { ok: false; reason: 'not_found' | 'already_done' }

async function writeOnce(merchantId: string, patch: Record<string, unknown>): Promise<WriteOutcome> {
  const { data, error } = await admin
    .from('trial_feedback')
    .update(patch)
    .eq('merchant_id', merchantId)
    .is('responded_at', null)
    .is('skipped_at', null)
    .select('*')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (data) return { ok: true, row: data as TrialFeedbackRow }

  // The conditional UPDATE matched nothing — either no survey was ever sent to this
  // merchant, or one was and it is already answered/skipped. Distinguish them so the route
  // can tell "nothing to answer" (404) from "you already answered" (409).
  const existing = await getOwnTrialFeedback(merchantId)
  return { ok: false, reason: existing ? 'already_done' : 'not_found' }
}

export async function respondTrialFeedback(merchantId: string, draft: TrialFeedbackDraft): Promise<WriteOutcome> {
  return writeOnce(merchantId, {
    rating: draft.rating,
    comment: draft.comment,
    responded_at: new Date().toISOString(),
  })
}

export async function skipTrialFeedback(merchantId: string): Promise<WriteOutcome> {
  return writeOnce(merchantId, { skipped_at: new Date().toISOString() })
}

// Newest-first, joined with the shop the same way feedback.ts's listFeedback is — only
// ANSWERED rows (a rating was actually given), which is what a superadmin reading responses
// means; a merchant who was sent the survey and never touched it is not a "response".
export async function listTrialFeedbackForAdmin(): Promise<TrialFeedbackWithShop[]> {
  const { data, error } = await admin
    .from('trial_feedback')
    .select('*, merchants(name, slug)')
    .not('responded_at', 'is', null)
    .order('responded_at', { ascending: false })
  if (error) throw new Error(error.message)

  return (data ?? []).map((row: any) => {
    const { merchants, ...rest } = row
    return { ...rest, shop_name: merchants?.name ?? null, shop_slug: merchants?.slug ?? null }
  })
}
