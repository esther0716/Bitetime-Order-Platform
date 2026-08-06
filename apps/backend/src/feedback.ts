// Merchant platform feedback (#89) — data access.
//
// Every statement here is a single write or read, so this uses the REST `admin` client
// rather than db.ts; no transaction is needed. `admin` is the service-role client and is
// RLS-EXEMPT: the route middleware is the tenant boundary, and insertFeedback takes the
// merchant and user as explicit arguments precisely so a caller cannot supply them.
import { admin } from './supabase.js'
import type { FeedbackCategory, FeedbackStatus, FeedbackDraft } from '@bitetime/shared'

export interface FeedbackRow {
  id: string
  merchant_id: string
  user_id: string
  category: FeedbackCategory
  message: string
  // Storage paths in the PRIVATE `feedback-images` bucket, never URLs. Always an array — the
  // column is `not null default '{}'`, so there is no null spelling of "no screenshots".
  image_paths: string[]
  status: FeedbackStatus
  created_at: string
  resolved_at: string | null
  github_issue_number: number | null
  github_issue_url: string | null
}

export interface FeedbackWithShop extends FeedbackRow {
  shop_name: string | null
  shop_slug: string | null
}

export async function insertFeedback(input: {
  merchantId: string
  userId: string
  draft: FeedbackDraft
}): Promise<FeedbackRow> {
  const { data, error } = await admin
    .from('merchant_feedback')
    .insert({
      merchant_id: input.merchantId,
      user_id: input.userId,
      category: input.draft.category,
      message: input.draft.message,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as FeedbackRow
}

export async function listFeedback(status?: FeedbackStatus): Promise<FeedbackWithShop[]> {
  let query = admin
    .from('merchant_feedback')
    .select('*, merchants(name, slug)')
    .order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  return (data ?? []).map((row: any) => {
    const { merchants, ...rest } = row
    return { ...rest, shop_name: merchants?.name ?? null, shop_slug: merchants?.slug ?? null }
  })
}

// Reopening clears resolved_at so the column never claims a resolution that was undone.
//
// Joins the shop the same way listFeedback does, so both admin routes return the same
// FeedbackWithShop shape — the frontend spreads this response over an existing row (see
// store.ts's setFeedbackStatus) and that spread is only sound if the shape genuinely matches.
export async function updateFeedbackStatus(
  id: string,
  status: FeedbackStatus,
): Promise<FeedbackWithShop | null> {
  const { data, error } = await admin
    .from('merchant_feedback')
    .update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
    .eq('id', id)
    .select('*, merchants(name, slug)')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const { merchants, ...rest } = data as any
  return { ...rest, shop_name: merchants?.name ?? null, shop_slug: merchants?.slug ?? null }
}

// Best-effort in the same sense as updateFeedbackGithubIssue below: by the time this runs, the
// feedback row is committed and the bytes are already in the bucket. A failure here means the
// admin dashboard does not show screenshots that exist — recoverable by hand, and not worth
// failing a submission the merchant has already been told succeeded.
export async function updateFeedbackImages(id: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const { error } = await admin
    .from('merchant_feedback')
    .update({ image_paths: paths })
    .eq('id', id)
  if (error) console.error(`feedback ${id}: failed to record ${paths.length} image path(s):`, error.message)
}

// Best-effort link-back after a successful createGithubIssue call (github.ts). Failure
// here is logged, never thrown: GitHub already has the issue at this point, so losing the
// link means the admin dashboard doesn't show it, not that the issue is missing.
export async function updateFeedbackGithubIssue(
  id: string,
  issue: { number: number; html_url: string },
): Promise<void> {
  const { error } = await admin
    .from('merchant_feedback')
    .update({ github_issue_number: issue.number, github_issue_url: issue.html_url })
    .eq('id', id)
  if (error) console.error(`feedback ${id}: failed to link GitHub issue #${issue.number}:`, error.message)
}
