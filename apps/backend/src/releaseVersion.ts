// The version rule for the automatic release cut on every push to `main`
// (.github/workflows/release.yml). Pure — no git, no network, no env — so `pnpm test`
// exercises it and the script that shells out to git stays a thin wrapper.
//
// This repository's tags carry NO `v` prefix (`0.2.4`), and one early tag is two-part
// (`0.2`). Both are read here; everything written out is three-part and unprefixed, so the
// existing tag list and the generated one are one sequence.

const CONVENTIONAL_HEAD = /^([a-z]+)(\([^)]*\))?(!)?:/i
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/

/** Reads a tag into [major, minor, patch]. Throws rather than guess — a version guessed off an
 *  unreadable tag would tag `0.0.1` over a repository already at `0.2.4`. */
function parseTag(tag: string): [number, number, number] {
  const parts = tag.replace(/^v/, '').split('.')
  if (parts.length < 1 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`Cannot read a version out of the tag "${tag}"`)
  }
  const [major = 0, minor = 0, patch = 0] = parts.map(Number)
  return [major, minor, patch]
}

/**
 * The next tag for a release covering `messages`, or null when there is nothing to release.
 *
 * @param lastTag  the most recent tag, or null/'' for a repository with none
 * @param messages full commit messages (subject + body) in the range, merges excluded
 */
export function nextVersion(lastTag: string | null, messages: string[]): string | null {
  const commits = messages.filter((m) => m.trim() !== '')
  if (commits.length === 0) return null

  const [major, minor, patch] = lastTag ? parseTag(lastTag) : [0, 0, 0]

  // Only the SUBJECT decides feat vs fix: a body quoting or reverting another commit must not
  // move the version. A breaking change is the exception — its marker is either the `!` on the
  // subject or a footer, which by definition lives further down.
  let breaking = false
  let feature = false
  for (const message of commits) {
    const lines = message.split('\n')
    const head = CONVENTIONAL_HEAD.exec(lines[0].trim())
    if (head?.[3] === '!') breaking = true
    if (head?.[1]?.toLowerCase() === 'feat') feature = true
    if (lines.slice(1).some((line) => BREAKING_FOOTER.test(line.trim()))) breaking = true
  }

  if (breaking) return `${major + 1}.0.0`
  if (feature) return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}
