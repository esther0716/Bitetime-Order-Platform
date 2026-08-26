import { describe, it, expect } from 'vitest'
import { nextVersion } from '../../src/releaseVersion.js'

describe('nextVersion', () => {
  it('bumps the patch when nothing in the range adds a feature', () => {
    expect(nextVersion('0.2.4', ['fix(vouchers): stop serving redeemer emails', 'chore: bump deps']))
      .toBe('0.2.5')
  })

  it('bumps the minor and zeroes the patch when any commit is a feat', () => {
    expect(nextVersion('0.2.4', ['fix(x): a fix', 'feat(merchant): a shop writes its own description']))
      .toBe('0.3.0')
  })

  it('bumps the major on a ! marker, whatever else is in the range', () => {
    expect(nextVersion('0.2.4', ['feat(api)!: rename the order field'])).toBe('1.0.0')
    expect(nextVersion('0.2.4', ['fix!: drop the legacy column'])).toBe('1.0.0')
  })

  it('reads a BREAKING CHANGE footer out of the commit body', () => {
    expect(nextVersion('1.4.2', ['fix(api): tidy the payload\n\nBREAKING CHANGE: callers must send a tag']))
      .toBe('2.0.0')
    expect(nextVersion('1.4.2', ['fix(api): tidy the payload\n\nBREAKING-CHANGE: callers must send a tag']))
      .toBe('2.0.0')
  })

  it('does not read a feat or a ! out of a later line', () => {
    // A commit body quoting another commit must not decide the bump.
    expect(nextVersion('0.2.4', ['fix(x): a fix\n\nReverts feat(y): the thing']))
      .toBe('0.2.5')
  })

  it('accepts a two-part tag and always emits three parts', () => {
    expect(nextVersion('0.2', ['fix: a fix'])).toBe('0.2.1')
    expect(nextVersion('0.2', ['feat: a feature'])).toBe('0.3.0')
  })

  it('accepts a v prefix on the way in and drops it on the way out', () => {
    expect(nextVersion('v1.2.3', ['fix: a fix'])).toBe('1.2.4')
  })

  it('starts a repository with no tags at 0.0.1 / 0.1.0', () => {
    expect(nextVersion(null, ['fix: a fix'])).toBe('0.0.1')
    expect(nextVersion('', ['feat: a feature'])).toBe('0.1.0')
  })

  it('returns null when the range holds no commits', () => {
    expect(nextVersion('0.2.4', [])).toBeNull()
    expect(nextVersion('0.2.4', ['   ', ''])).toBeNull()
  })

  it('throws on a tag it cannot read rather than guessing a version', () => {
    expect(() => nextVersion('release-candidate', ['fix: a fix'])).toThrow(/release-candidate/)
    expect(() => nextVersion('1.2.3.4', ['fix: a fix'])).toThrow(/1\.2\.3\.4/)
  })

  it('is case insensitive about the commit type but not about BREAKING CHANGE', () => {
    expect(nextVersion('0.2.4', ['FEAT: a feature'])).toBe('0.3.0')
    expect(nextVersion('0.2.4', ['fix: a fix\n\nbreaking change: not a footer'])).toBe('0.2.5')
  })
})
