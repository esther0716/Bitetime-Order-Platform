import { describe, it, expect } from 'vitest'
import { normalizeReferralCode, resolveReferredByCode, referralCodeFromInput } from './referralCode'

describe('normalizeReferralCode', () => {
  it('accepts an 8-char hex code, uppercased', () => {
    expect(normalizeReferralCode('ab12cd34')).toBe('AB12CD34')
  })
  it('trims surrounding whitespace', () => {
    expect(normalizeReferralCode('  AB12CD34 ')).toBe('AB12CD34')
  })
  it('rejects wrong length', () => {
    expect(normalizeReferralCode('AB12CD3')).toBeNull()
    expect(normalizeReferralCode('AB12CD345')).toBeNull()
  })
  it('rejects non-hex characters', () => {
    expect(normalizeReferralCode('AB12CG34')).toBeNull()
  })
  it('returns null for empty / nullish', () => {
    expect(normalizeReferralCode('')).toBeNull()
    expect(normalizeReferralCode(null)).toBeNull()
    expect(normalizeReferralCode(undefined)).toBeNull()
  })
})

describe('resolveReferredByCode', () => {
  it('returns the normalized code when it differs from the owner code', () => {
    expect(resolveReferredByCode('ab12cd34', 'FFFFFFFF')).toBe('AB12CD34')
  })
  it('returns null on self-referral (equals owner code)', () => {
    expect(resolveReferredByCode('AB12CD34', 'AB12CD34')).toBeNull()
    expect(resolveReferredByCode('ab12cd34', 'AB12CD34')).toBeNull()
  })
  it('returns null for a malformed code', () => {
    expect(resolveReferredByCode('nope', 'FFFFFFFF')).toBeNull()
  })
})

describe('referralCodeFromInput', () => {
  it('uppercases and trims what the merchant typed', () => {
    expect(referralCodeFromInput('  ab12cd34 ')).toBe('AB12CD34')
  })
  it('reads the code out of a pasted invite link', () => {
    expect(referralCodeFromInput('https://tinyorder.app/merchant/signup?ref=ab12cd34')).toBe('AB12CD34')
    expect(referralCodeFromInput('https://tinyorder.app/merchant/signup?billing=yearly&ref=AB12CD34')).toBe('AB12CD34')
  })
  it('keeps a wrong-length value whole, so the format check can say so', () => {
    expect(referralCodeFromInput('ab12cd345')).toBe('AB12CD345')
    expect(referralCodeFromInput('abc')).toBe('ABC')
  })
  it('returns an empty string for empty input', () => {
    expect(referralCodeFromInput('')).toBe('')
    expect(referralCodeFromInput('   ')).toBe('')
  })
})
