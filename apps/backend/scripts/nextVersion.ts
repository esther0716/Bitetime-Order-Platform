// Prints the tag the next release should carry, or nothing at all when there is nothing to
// release. Run by .github/workflows/release.yml on every push to `main`; the workflow skips
// the release when this prints an empty line.
//
// Everything that decides a version lives in src/releaseVersion.ts and is unit-tested. This
// file only asks git the two questions that rule needs, which is why it has no test of its
// own: `git describe` and `git log` are not ours to prove.
//
// Run through jiti (see the `release:version` package script), same as the dev server: the
// backend keeps `.js` specifiers that resolve to `.ts` source, which node cannot follow on its
// own. Needs the full history and every tag — the workflow checks out with `fetch-depth: 0`.
import { execFileSync } from 'node:child_process'
import { nextVersion } from '../src/releaseVersion.js'

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' })
}

function lastTagOrNull(): string | null {
  try {
    return git('describe', '--tags', '--abbrev=0').trim() || null
  } catch {
    // No tag reachable from HEAD: a fresh repository, released from 0.0.0.
    return null
  }
}

const lastTag = lastTagOrNull()

// Merges excluded: a merge commit's subject is "Merge pull request #244 from …", which says
// nothing about the change, and every commit it brings in is already in the range.
// NUL-separated because a commit message contains newlines and we need the body for a
// BREAKING CHANGE footer.
const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
const messages = git('log', '--no-merges', '--format=%B%x00', range)
  .split('\0')
  .map((m) => m.trim())
  .filter((m) => m !== '')

process.stdout.write(nextVersion(lastTag, messages) ?? '')
