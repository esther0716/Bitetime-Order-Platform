// What is still unfinished about the legal documents, and therefore what the draft notice says.
//
// Pure and in its own module, following the same split as `billingBannerState` and `poll`: the
// rule is testable in this workspace's `node` environment, and `LegalPage` only renders what it
// returns.
import { LEGAL_ENTITY, LEGAL_REVIEWED, hasUnfilledEntityDetails, isRegisteredEntity, type LegalEntity } from './entity'

export interface DraftCaveat { id: string; en: string; zh: string }

/**
 * Each caveat stands or falls on its own: registering the business removes one, a lawyer reading
 * the wording removes another, filling in a bracketed field removes the third. When none apply,
 * the notice does not render at all.
 *
 * Separate reasons rather than one sentence is what keeps this honest. The notice previously told
 * the reader to look for "details in square brackets below" — true when every field was a
 * placeholder, and false the moment the unregistered wording stopped rendering the registration
 * field at all. It was pointing at something that appeared nowhere on the page.
 */
export function draftCaveats(
  entity: LegalEntity = LEGAL_ENTITY,
  reviewed: boolean = LEGAL_REVIEWED,
): DraftCaveat[] {
  const out: DraftCaveat[] = []

  if (!isRegisteredEntity(entity)) {
    out.push({
      id: 'registration',
      en: 'The business is not yet registered, so no business registration number is shown.',
      zh: '本业务尚未注册，因此未显示商业注册号码。',
    })
  }

  // Registration is excluded here because it has its own caveat above, and because while the
  // business is unregistered that field is never rendered — calling it a visible blank would be
  // describing something the reader cannot see.
  if (hasUnfilledEntityDetails({ ...entity, registration: '' })) {
    out.push({
      id: 'placeholders',
      en: 'Some details shown in square brackets below have still to be filled in.',
      zh: '下方方括号内的部分资料仍待填写。',
    })
  }

  if (!reviewed) {
    out.push({
      id: 'review',
      en: 'It has not been reviewed by a lawyer.',
      zh: '本文件尚未经过律师审阅。',
    })
  }

  return out
}
