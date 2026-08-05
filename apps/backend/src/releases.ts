// Rewrites a raw GitHub release body into merchant-facing copy for the dashboard's "what's
// new" bell (#163). See docs/superpowers/specs/2026-08-05-github-release-notes-design.md.
//
// Pure adapter, shaped like github.ts's createGithubIssue: the API key is a PARAMETER, never
// read from env.ts, and this file imports nothing from supabase.ts/db.ts — that is what lets
// it be imported by a unit test with zero env vars set. The DB side (releasesDb.ts) is a
// separate file for the same reason shopCustomersDb.ts is split from shopCustomers.ts.
//
// Best-effort: swallows its own errors and returns null rather than throwing. A Claude outage
// must never break the pull action, only leave a release without a summary.
import Anthropic from '@anthropic-ai/sdk'

export interface HumanizedRelease {
  title: string
  summary: string
}

export type HumanizeRelease = (
  apiKey: string,
  input: { tag: string; name: string; body: string },
) => Promise<HumanizedRelease | null>

function buildPrompt(input: { tag: string; name: string; body: string }): string {
  return `You are writing a "what's new" note for a food-ordering platform's merchants — small business owners, not developers. Rewrite this GitHub release into copy they can read in ten seconds.

Release: ${input.name} (${input.tag})

Raw release notes (from GitHub, written for developers — pull request titles, links, technical jargon):
${input.body}

Write:
- "title": a short, plain-language headline (under 60 characters), no version numbers or PR references.
- "summary": 2-4 short sentences or bullet points describing what changed FOR THE MERCHANT — what they can now do or what improved. Skip anything purely internal (refactors, dependency bumps, test changes) unless it fixed a bug merchants would have noticed. If nothing in this release is merchant-visible, say so plainly in one sentence.

Write in plain English. No markdown formatting, no links, no PR/issue numbers.`
}

const RELEASE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['title', 'summary'],
  additionalProperties: false,
} as const

export const humanizeRelease: HumanizeRelease = async (apiKey, input) => {
  if (!apiKey) {
    console.error(`Release humanization skipped for ${input.tag}: no Anthropic API key configured`)
    return null
  }
  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1024,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: RELEASE_SCHEMA },
      },
      messages: [{ role: 'user', content: buildPrompt(input) }],
    })

    if (response.stop_reason === 'refusal') {
      console.error(`Release humanization refused for ${input.tag}`)
      return null
    }

    const block = response.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') {
      console.error(`Release humanization for ${input.tag} returned no text content`)
      return null
    }

    const parsed = JSON.parse(block.text) as HumanizedRelease
    if (!parsed.title || !parsed.summary) {
      console.error(`Release humanization for ${input.tag} returned an incomplete result`)
      return null
    }
    return parsed
  } catch (e) {
    console.error(`Release humanization failed for ${input.tag}:`, e instanceof Error ? e.message : String(e))
    return null
  }
}
