// Who the legal documents are actually by. One place, read by both documents.
//
// These ship as CONSPICUOUS PLACEHOLDERS on purpose. A privacy notice must identify the data
// user and the Terms must name a contracting party, so the fields cannot simply be omitted —
// but an invented company name on a live legal page is worse than an obvious blank, because a
// blank gets fixed and an invention gets believed.

export interface LegalEntity {
  /** Registered company name. */
  name: string
  /** SSM business registration number. */
  registration: string
  /** Registered address. */
  address: string
  /** The address a data-access or correction request is sent to. Must be MONITORED before it
   *  is published: an address nobody reads is a worse failure than the omission it replaced. */
  email: string
}

export const LEGAL_ENTITY: LegalEntity = {
  name: '[COMPANY NAME]',
  registration: '[SSM REGISTRATION NO.]',
  address: '[REGISTERED ADDRESS]',
  email: '[CONTACT EMAIL]',
}

/** The date both documents carry. Bump it whenever their wording changes materially. */
export const LEGAL_LAST_UPDATED = '26 July 2026'

/**
 * Does any field still hold a bracketed placeholder?
 *
 * Exists so "we never filled in the company details" is a condition the code can state, rather
 * than something someone has to remember. A test asserts it, so filling the details in turns
 * the reminder off deliberately instead of silently.
 */
export function hasUnfilledEntityDetails(entity: LegalEntity): boolean {
  return Object.values(entity).some((v) => v.includes('[') && v.includes(']'))
}
