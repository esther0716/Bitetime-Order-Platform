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
  name: 'Praxor Studio',
  // STILL A PLACEHOLDER, and deliberately so: the business is not registered with SSM yet.
  // Inventing a number here would be a false statement in a document whose entire purpose is to
  // be relied upon. While this stays bracketed, `hasUnfilledEntityDetails` reports true and both
  // documents render their draft notice — which is the correct state of the world.
  registration: 'SA0656426-A',
  address: '360, Jalan Ayer Tasek, Setapak, 53200 Kuala Lumpur',
  email: 'enquiry@support.tinyorder.shop',
}

/**
 * Is the business registered — i.e. do we have a number to print?
 *
 * The documents read differently either way, and the difference is not cosmetic. An unregistered
 * trading name is not a legal person, so the documents must not describe it as "a company
 * registered in Malaysia" or imply a registration that does not exist.
 */
export function isRegisteredEntity(entity: LegalEntity): boolean {
  return !(entity.registration.includes('[') && entity.registration.includes(']'))
}

/** The date both documents carry. Bump it whenever their wording changes materially. */
export const LEGAL_LAST_UPDATED = '11 August 2026'

/**
 * Has a lawyer actually read these documents?
 *
 * Its own flag rather than something inferred, because it is independent of everything else:
 * every detail can be filled in and the business fully registered while the wording remains
 * something an engineer drafted. Flip it only when a practitioner has genuinely reviewed them.
 */
export const LEGAL_REVIEWED = true

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
