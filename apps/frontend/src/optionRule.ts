// A merchant's three numbers, read back as a sentence.
//
// `minSelect`, `maxSelect` and `maxPerOption` are correct and complete, and they are also three
// integers that a merchant has to run in their head. "Pick any 4 of 8, max 2 of each" is
// `4 / 4 / 2`, and nothing on the form confirmed they had typed what they meant — the storefront
// only ever counts ("3 of 4 chosen", `OptionPicker.tsx`), so there was no way to check by looking
// either. This turns the numbers back into the words the merchant started from.
//
// DISPLAY ONLY, which is why it lives here and not in `@bitetime/shared`: that package holds
// rules that must hold identically on both sides of the wire, and a sentence is not one. The
// rules themselves stay in `validateSelections` / `validateOptionGroups` and this file never
// decides anything.
import type { OptionGroup } from '@bitetime/shared'

/**
 * Narrower than `types.ts`'s `Translate`, whose `zh` is optional.
 *
 * Every string below has a Chinese twin and always passes one, and this is the shape
 * `OptionGroupsEditor` already declares for its own `t` prop. A `Translate` still satisfies it,
 * so nothing is closed off — but a call site that forgot a translation would not compile.
 */
type TranslatePair = (en: string, zh: string) => string

/** The count clause: how many a customer takes across the whole group. */
function countClause(g: Pick<OptionGroup, 'minSelect' | 'maxSelect'>, t: TranslatePair): string {
  const { minSelect: min, maxSelect: max } = g

  if (max === 1) {
    return min >= 1
      ? t('Customers must pick one.', '顾客必须选 1 个。')
      : t('Customers can pick one, or none.', '顾客可以选 1 个，也可以不选。')
  }
  if (max === null) {
    return min >= 1
      ? t(`Customers pick at least ${min}, with no limit.`, `顾客最少选 ${min} 个，没有上限。`)
      : t('Customers can pick any number, or none.', '顾客可以选任意数量，也可以不选。')
  }
  if (min === max) return t(`Customers pick exactly ${min}.`, `顾客选 ${min} 个。`)
  if (min === 0) return t(`Customers can pick up to ${max}, or none.`, `顾客最多选 ${max} 个，也可以不选。`)
  return t(`Customers pick ${min} to ${max}.`, `顾客选 ${min} 至 ${max} 个。`)
}

/**
 * The repeat clause: how often ONE choice may be taken.
 *
 * Silent for a pick-one group, where a repeat is not expressible and the sentence would only add
 * a rule the merchant cannot break. Everywhere else it is said out loud, including the common
 * `maxPerOption: 1` — "up to 3 toppings" and "3 different toppings" are the same numbers to a
 * reader who does not already know which field means which.
 */
function repeatClause(g: Pick<OptionGroup, 'maxSelect' | 'maxPerOption'>, t: TranslatePair): string {
  if (g.maxSelect === 1) return ''
  if (g.maxPerOption === null) {
    return t('They can take the same one any number of times.', '同一个选项可以选任意次数。')
  }
  if (g.maxPerOption === 1) return t('They can take each choice once.', '每个选项只能选 1 次。')
  return t(
    `They can take the same one up to ${g.maxPerOption} times.`,
    `同一个选项最多可选 ${g.maxPerOption} 次。`,
  )
}

/**
 * What this group asks of a customer, in words.
 *
 * An impossible window is NOT described. `validateOptionGroups` refuses `minSelect > maxSelect`
 * as `impossible_window`, and the editor already shows that refusal; inventing a sentence for a
 * configuration nobody can answer would read as confirmation that it works.
 */
export function optionRuleSentence(
  g: Pick<OptionGroup, 'minSelect' | 'maxSelect' | 'maxPerOption'>,
  t: TranslatePair,
): string {
  if (g.maxSelect !== null && g.minSelect > g.maxSelect) {
    return t('These numbers do not work together.', '这些数字互相矛盾。')
  }
  const repeat = repeatClause(g, t)
  // The JOINER is translated too. Chinese sets no space after 。 — an English-shaped join leaves
  // a gap mid-sentence that reads as a typo to the merchant it is written for.
  return repeat ? `${countClause(g, t)}${t(' ', '')}${repeat}` : countClause(g, t)
}
