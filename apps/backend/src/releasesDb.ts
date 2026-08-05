// The releases table's data access. The rewrite logic lives next door in `releases.ts`, which
// is pure — see the note at the top of that file for why the split.
//
// Uses the service-role `admin` client (same posture as feedback.ts): every statement here is
// a single read or write, so no transaction is needed.
import { admin } from './supabase.js'
import type { HumanizedRelease } from './releases.js'

export interface ReleaseRow {
  id: string
  tag: string
  name: string
  html_url: string
  raw_body: string
  published_at: string
  title: string | null
  summary: string | null
  humanize_error: string | null
  status: 'draft' | 'published'
  created_at: string
  updated_at: string
}

export async function listReleaseTags(): Promise<string[]> {
  const { data, error } = await admin.from('releases').select('tag')
  if (error) throw new Error(error.message)
  return (data ?? []).map((row: { tag: string }) => row.tag)
}

export async function insertDraftRelease(input: {
  tag: string
  name: string
  htmlUrl: string
  rawBody: string
  publishedAt: string
}): Promise<ReleaseRow> {
  const { data, error } = await admin
    .from('releases')
    .insert({
      tag: input.tag,
      name: input.name,
      html_url: input.htmlUrl,
      raw_body: input.rawBody,
      published_at: input.publishedAt,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as ReleaseRow
}

export async function listAllReleases(): Promise<ReleaseRow[]> {
  const { data, error } = await admin
    .from('releases')
    .select('*')
    .order('published_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as ReleaseRow[]
}

export async function getReleaseById(id: string): Promise<ReleaseRow | null> {
  const { data, error } = await admin.from('releases').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as ReleaseRow | null
}

export async function updateReleaseStatus(
  id: string,
  status: 'draft' | 'published',
): Promise<ReleaseRow | null> {
  const { data, error } = await admin
    .from('releases')
    .update({ status })
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as ReleaseRow | null
}

// Best-effort, like feedback.ts's updateFeedbackGithubIssue: the pull/regenerate action has
// already happened by the time this is called, so a write failure here is logged, never thrown.
export async function updateReleaseHumanization(
  id: string,
  outcome: HumanizedRelease | { error: string },
): Promise<void> {
  const patch = 'title' in outcome
    ? { title: outcome.title, summary: outcome.summary, humanize_error: null }
    : { humanize_error: outcome.error }
  const { error } = await admin.from('releases').update(patch).eq('id', id)
  if (error) console.error(`release ${id}: failed to save humanization result:`, error.message)
}

export interface PublicReleaseRow {
  tag: string
  title: string
  published_at: string
}

export async function listPublishedReleases(limit: number): Promise<PublicReleaseRow[]> {
  const { data, error } = await admin
    .from('releases')
    .select('tag, title, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as PublicReleaseRow[]
}

export interface PublicReleaseDetailRow extends PublicReleaseRow {
  summary: string
}

export async function getPublishedReleaseByTag(tag: string): Promise<PublicReleaseDetailRow | null> {
  const { data, error } = await admin
    .from('releases')
    .select('tag, title, summary, published_at')
    .eq('status', 'published')
    .eq('tag', tag)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as PublicReleaseDetailRow | null
}
