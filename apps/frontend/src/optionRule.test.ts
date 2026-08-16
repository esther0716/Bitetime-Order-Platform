import { describe, it, expect } from 'vitest'
import { optionRuleSentence } from './optionRule'
import type { OptionGroup } from '@bitetime/shared'

const en = (e: string) => e
const zh = (_e: string, z?: string) => z ?? _e

const group = (
  minSelect: number,
  maxSelect: number | null,
  maxPerOption: number | null,
): OptionGroup => ({
  id: 'g1', name: 'Flavours', minSelect, maxSelect, maxPerOption, active: true,
  options: [
    { id: 'o1', name: 'Lotus', delta: 0, active: true },
    { id: 'o2', name: 'Red bean', delta: 0, active: true },
  ],
})

describe('optionRuleSentence', () => {
  it('reads a required pick-one', () => {
    expect(optionRuleSentence(group(1, 1, 1), en)).toBe('Customers must pick one.')
  })

  it('reads an optional pick-one', () => {
    expect(optionRuleSentence(group(0, 1, 1), en)).toBe('Customers can pick one, or none.')
  })

  it('reads an exact count, and says how often one choice may repeat', () => {
    expect(optionRuleSentence(group(4, 4, 2), en))
      .toBe('Customers pick exactly 4. They can take the same one up to 2 times.')
  })

  it('says each choice counts once when repeats are barred', () => {
    expect(optionRuleSentence(group(4, 4, 1), en))
      .toBe('Customers pick exactly 4. They can take each choice once.')
  })

  it('reads a range', () => {
    expect(optionRuleSentence(group(1, 3, 1), en))
      .toBe('Customers pick 1 to 3. They can take each choice once.')
  })

  it('reads an open-ended floor', () => {
    expect(optionRuleSentence(group(2, null, null), en))
      .toBe('Customers pick at least 2, with no limit. They can take the same one any number of times.')
  })

  it('reads a fully open group', () => {
    expect(optionRuleSentence(group(0, null, 1), en))
      .toBe('Customers can pick any number, or none. They can take each choice once.')
  })

  it('reads an optional ceiling', () => {
    expect(optionRuleSentence(group(0, 3, 1), en))
      .toBe('Customers can pick up to 3, or none. They can take each choice once.')
  })

  it('refuses to describe an impossible window', () => {
    expect(optionRuleSentence(group(4, 2, 1), en)).toBe('These numbers do not work together.')
  })

  // Chinese is checked case by case, not spot-checked. The sentence IS the feature, and a
  // translation that is merely present rather than readable leaves the Chinese-reading merchant
  // exactly where they started — reading three numbers.
  describe('in Chinese', () => {
    it('reads a required pick-one', () => {
      expect(optionRuleSentence(group(1, 1, 1), zh)).toBe('顾客必须选 1 个。')
    })

    it('reads an optional pick-one', () => {
      expect(optionRuleSentence(group(0, 1, 1), zh)).toBe('顾客可以选 1 个，也可以不选。')
    })

    it('reads an exact count, and says how often one choice may repeat', () => {
      expect(optionRuleSentence(group(4, 4, 2), zh)).toBe('顾客选 4 个。同一个选项最多可选 2 次。')
    })

    it('says each choice counts once when repeats are barred', () => {
      expect(optionRuleSentence(group(4, 4, 1), zh)).toBe('顾客选 4 个。每个选项只能选 1 次。')
    })

    it('reads a range', () => {
      expect(optionRuleSentence(group(1, 3, 1), zh)).toBe('顾客选 1 至 3 个。每个选项只能选 1 次。')
    })

    it('reads an open-ended floor', () => {
      expect(optionRuleSentence(group(2, null, null), zh)).toBe('顾客最少选 2 个，没有上限。同一个选项可以选任意次数。')
    })

    it('reads a fully open group', () => {
      expect(optionRuleSentence(group(0, null, 1), zh)).toBe('顾客可以选任意数量，也可以不选。每个选项只能选 1 次。')
    })

    it('reads an optional ceiling', () => {
      expect(optionRuleSentence(group(0, 3, 1), zh)).toBe('顾客最多选 3 个，也可以不选。每个选项只能选 1 次。')
    })

    it('refuses to describe an impossible window', () => {
      expect(optionRuleSentence(group(4, 2, 1), zh)).toBe('这些数字互相矛盾。')
    })

    it('sets no space between the two clauses', () => {
      expect(optionRuleSentence(group(4, 4, 2), zh)).not.toMatch(/。\s/)
    })
  })
})
