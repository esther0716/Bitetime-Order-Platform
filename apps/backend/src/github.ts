// The one place in this codebase that talks to GitHub — auto-filing merchant platform
// feedback (#89-follow-up) as an issue on the platform repo, so it lands in the same
// triage queue (needs-triage, docs/agents/triage-labels.md) as everything else the
// project tracks. See docs/superpowers/specs/2026-08-04-feedback-github-issues-design.md.
//
// Every export here is an ADAPTER, shaped and injected like telegramSend in notify.ts: the
// token is a PARAMETER, never read from env.ts. That is what lets this module be imported
// at runtime by a unit test that has zero env vars set (tests/unit runs with none, per
// .github/workflows/ci.yml) without tripping env.ts's fail-fast required() checks. The
// caller (app.ts, which already imports env.ts for other reasons) reads env.githubToken
// and passes it in.
//
// Best-effort throughout: every export here swallows its own errors and returns null /
// resolves void rather than throwing. A GitHub outage must never fail a feedback
// submission or an admin's resolve/reopen click.
import type { FeedbackCategory } from '@bitetime/shared'

export const GITHUB_REPO = 'leongcheefai/Bitetime-Order-Platform'
const GITHUB_API = 'https://api.github.com'

// bug/enhancement already exist on the repo; billing/other are created once by hand (see
// the spec's "One-time setup"). feature -> enhancement reuses the repo's existing
// vocabulary rather than inventing a feedback-specific label.
const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: 'bug',
  feature: 'enhancement',
  billing: 'billing',
  other: 'other',
}

export function categoryToLabel(category: FeedbackCategory): string {
  return CATEGORY_LABELS[category]
}

export function buildIssueTitle(category: FeedbackCategory, shopName: string): string {
  return `[Feedback] ${category}: ${shopName}`
}

export function buildIssueBody(input: {
  message: string
  shopName: string
  shopSlug: string
  feedbackId: string
  createdAt: string
  imageCount: number
  adminUrl: string
}): string {
  const lines = [
    input.message,
    '',
    '---',
    `Shop: ${input.shopName} (/s/${input.shopSlug})`,
    `Feedback ID: ${input.feedbackId}`,
    `Submitted: ${input.createdAt}`,
  ]
  // COUNT AND A DASHBOARD LINK ONLY — never an image URL, signed or otherwise. This repo is
  // public (GITHUB_REPO above), and a merchant's bug screenshot is usually their own dashboard:
  // customer names, phone numbers, delivery addresses. The bucket is private and the bytes come
  // out through a superadmin-only route; this line exists so whoever triages the issue knows
  // there is something to go and look at. Omitted entirely at zero, so every issue body filed
  // before this shipped stays byte-identical.
  //
  // imageCount and adminUrl are REQUIRED, not optional: a caller that forgot them would quietly
  // file an issue that hides the screenshots, which is the one failure this line exists to
  // prevent. adminUrl is a parameter rather than an env read, same adapter discipline as the
  // token — it is what keeps this module importable by tests/unit with zero env vars set.
  //
  // `/admin#feedback`, with a HASH: the admin dashboard is one route and its sections are hash
  // segments (useDashboardSection). `/admin/feedback` is not a route — it matches nothing and
  // renders a blank page, which is exactly what it did until a run-and-verify pass caught it.
  if (input.imageCount > 0) {
    lines.push(`Screenshots: ${input.imageCount} — view at ${input.adminUrl}/admin#feedback`)
  }
  return lines.join('\n')
}

export interface GithubIssue {
  number: number
  html_url: string
}

export type CreateGithubIssue = (
  token: string,
  input: { title: string; body: string; labels: string[] },
) => Promise<GithubIssue | null>

export type GithubIssueAction = (token: string, issueNumber: number) => Promise<void>

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/**
 * Files the issue. On a 422 with more than one label (most likely an unrecognised
 * category label — see the spec's one-time setup step) retries once with only
 * needs-triage, so a missed label never loses the issue outright. Any other failure, or a
 * second failure, logs and returns null.
 */
export const createGithubIssue: CreateGithubIssue = async (token, { title, body, labels }) => {
  if (!token) {
    console.error('GitHub issue skipped: no token configured')
    return null
  }

  const post = (issueLabels: string[]) =>
    fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ title, body, labels: issueLabels }),
    })

  try {
    let res = await post(labels)
    if (res.status === 422 && labels.length > 1) {
      res = await post(labels.filter((l) => l === 'needs-triage'))
    }
    if (!res.ok) {
      console.error(`GitHub issue creation failed: ${res.status} ${await res.text()}`)
      return null
    }
    const data = (await res.json()) as { number: number; html_url: string }
    return { number: data.number, html_url: data.html_url }
  } catch (e) {
    console.error('GitHub issue creation failed:', e instanceof Error ? e.message : String(e))
    return null
  }
}

async function setIssueState(token: string, issueNumber: number, state: 'open' | 'closed'): Promise<void> {
  if (!token) return
  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({ state }),
    })
    if (!res.ok) console.error(`GitHub issue #${issueNumber} state update failed: ${res.status}`)
  } catch (e) {
    console.error(`GitHub issue #${issueNumber} state update failed:`, e instanceof Error ? e.message : String(e))
  }
}

export const closeGithubIssue: GithubIssueAction = (token, issueNumber) =>
  setIssueState(token, issueNumber, 'closed')
export const reopenGithubIssue: GithubIssueAction = (token, issueNumber) =>
  setIssueState(token, issueNumber, 'open')

export interface GithubRelease {
  tag_name: string
  name: string
  body: string
  html_url: string
  published_at: string
}

export type ListGithubReleases = (token: string, perPage: number) => Promise<GithubRelease[] | null>

export const listGithubReleases: ListGithubReleases = async (token, perPage) => {
  if (!token) {
    console.error('GitHub release listing skipped: no token configured')
    return null
  }
  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/releases?per_page=${perPage}`, {
      headers: headers(token),
    })
    if (!res.ok) {
      console.error(`GitHub release listing failed: ${res.status} ${await res.text()}`)
      return null
    }
    const data = (await res.json()) as GithubRelease[]
    return data.map((r) => ({
      tag_name: r.tag_name,
      name: r.name,
      body: r.body ?? '',
      html_url: r.html_url,
      published_at: r.published_at,
    }))
  } catch (e) {
    console.error('GitHub release listing failed:', e instanceof Error ? e.message : String(e))
    return null
  }
}

/**
 * Asks the sample-shop screenshot workflow to capture storefronts now
 * (.github/workflows/sample-shop-screenshot-sweep.yml, `workflow_dispatch` with a
 * `merchant_id` input). Two callers, and the difference is the argument:
 *
 * - with a merchant id, when a superadmin flags one shop as a sample — without it that shop
 *   has no screenshot, and so no card, until the weekly cron runs;
 * - with none, to re-shoot every sample shop at once, which is what a storefront redesign
 *   needs: it makes every stored screenshot stale simultaneously and changes no shop.
 *
 * Returns whether GitHub accepted the request — the caller reports that to the admin and
 * never fails on it. Two things this needs that issue filing does not: the token must carry
 * `actions: write`, and the workflow file must exist on `ref` below, because GitHub resolves
 * a dispatch against that ref's tree and 404s otherwise.
 */
export type DispatchSampleScreenshot = (token: string, merchantId?: string) => Promise<boolean>

const SCREENSHOT_WORKFLOW = 'sample-shop-screenshot-sweep.yml'
const SCREENSHOT_WORKFLOW_REF = 'main'

export const dispatchSampleScreenshot: DispatchSampleScreenshot = async (token, merchantId) => {
  if (!token) {
    console.error('Sample screenshot capture skipped: no token configured')
    return false
  }
  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${GITHUB_REPO}/actions/workflows/${SCREENSHOT_WORKFLOW}/dispatches`,
      {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({
          ref: SCREENSHOT_WORKFLOW_REF,
          // Empty string, never an absent key: the workflow's input has `default: ''` and the
          // script reads the empty value as "sweep every sample shop".
          inputs: { merchant_id: merchantId ?? '' },
        }),
      },
    )
    // 204 No Content on success — a dispatch returns no body.
    if (!res.ok) {
      console.error(`Sample screenshot dispatch failed: ${res.status} ${await res.text()}`)
      return false
    }
    return true
  } catch (e) {
    console.error('Sample screenshot dispatch failed:', e instanceof Error ? e.message : String(e))
    return false
  }
}
