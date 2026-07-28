import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  validateOptionGroups, MAX_GROUPS_PER_PRODUCT, MAX_OPTIONS_PER_GROUP,
} from '@bitetime/shared'
import type { OptionGroup, Option } from '@bitetime/shared'

/**
 * The merchant writing a product's questions.
 *
 * Lives INSIDE the product form and is saved by the product's own upsert (ADR 0008). That is the
 * whole reason the groups are a jsonb column: product and questions commit together, so there is
 * no half-saved menu item, no transaction, and one dirty-tracking path instead of two.
 *
 * Array order IS display order, for groups and for options — there is no `sort` column and no
 * tie-break to get wrong, which is why reordering here is just moving an array element.
 *
 * The validation shown is `validateOptionGroups`, the SAME function the write endpoint refuses
 * on. ADR 0008 traded away every check constraint for the atomic save, so that function is the
 * only thing standing between a merchant and a question no answer can satisfy — showing its
 * verdict here means they meet it while they are still looking at the form, rather than as a 400.
 */
const blankOption = (n: number): Option =>
  ({ id: `o${n}-${Math.random().toString(36).slice(2, 8)}`, name: '', delta: 0, active: true })

const blankGroup = (n: number): OptionGroup => ({
  id: `g${n}-${Math.random().toString(36).slice(2, 8)}`,
  name: '', minSelect: 1, maxSelect: 1, maxPerOption: 1, active: true,
  options: [blankOption(1), blankOption(2)],
})

export interface OptionGroupsEditorProps {
  value: OptionGroup[]
  onChange: (groups: OptionGroup[]) => void
  currency?: string
  t: (en: string, zh: string) => string
  /** Products this merchant already has, for "copy options from…". */
  copyFrom?: { id: string; name: string; groups: OptionGroup[] }[]
}

const move = <T,>(xs: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= xs.length) return xs
  const next = [...xs]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}

export default function OptionGroupsEditor({
  value, onChange, currency, t, copyFrom = [],
}: OptionGroupsEditorProps) {
  const [open, setOpen] = useState(value.length > 0)

  const patchGroup = (i: number, patch: Partial<OptionGroup>) =>
    onChange(value.map((g, n) => (n === i ? { ...g, ...patch } : g)))

  const patchOption = (gi: number, oi: number, patch: Partial<Option>) =>
    patchGroup(gi, { options: value[gi].options.map((o, n) => (n === oi ? { ...o, ...patch } : o)) })

  const problem = validateOptionGroups(value)

  // Collapsed by default when there is nothing to show: most shops on the platform sell things
  // that ask no questions, and they should never meet this section at all.
  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t('Add options (sizes, flavours, add-ons)', '添加选项（规格、口味、加料）')}
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-4 border border-clay-border rounded-md p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium">{t('Options', '选项')}</span>
        {copyFrom.length > 0 && value.length === 0 && (
          <select
            className="text-[12px] border border-clay-border rounded px-2 py-1 bg-transparent"
            value=""
            onChange={e => {
              const src = copyFrom.find(p => p.id === e.target.value)
              // A COPY, not a link. Editing "Milk" on one drink must never reprice eleven others
              // — that surprise is why there is no shared library (ADR 0008).
              if (src) onChange(structuredClone(src.groups))
            }}
          >
            <option value="">{t('Copy options from…', '从其他商品复制…')}</option>
            {copyFrom.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      {value.map((group, gi) => (
        <div key={group.id} className="flex flex-col gap-2 border-t border-divider pt-3 first:border-t-0 first:pt-0">
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <Label className="text-[12px]">{t('Question', '问题')}</Label>
              <Input
                value={group.name}
                placeholder={t('e.g. Choose your flavours', '例如：选择口味')}
                onChange={e => patchGroup(gi, { name: e.target.value })}
              />
            </div>
            <div className="w-[92px]">
              <Label className="text-[12px]">{t('Choose at least', '最少选')}</Label>
              <Input
                type="number" min={0} value={group.minSelect}
                onChange={e => patchGroup(gi, { minSelect: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="w-[92px]">
              <Label className="text-[12px]">{t('At most', '最多选')}</Label>
              <Input
                type="number" min={1} value={group.maxSelect ?? ''}
                placeholder={t('any', '不限')}
                onChange={e => patchGroup(gi, {
                  maxSelect: e.target.value === '' ? null : Number(e.target.value) || 1,
                })}
              />
            </div>
            <div className="w-[132px]">
              {/* Independent of "at most", and it cannot be inferred from it: "up to 3 toppings"
                  with a per-option cap of 1 is three DIFFERENT toppings, not chilli three times. */}
              <Label className="text-[12px]">{t('Max of one choice', '同一选项上限')}</Label>
              <Input
                type="number" min={1} value={group.maxPerOption ?? ''}
                placeholder={t('any', '不限')}
                onChange={e => patchGroup(gi, {
                  maxPerOption: e.target.value === '' ? null : Number(e.target.value) || 1,
                })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5 pl-1">
            {group.options.map((option, oi) => (
              <div key={option.id} className="flex items-center gap-2">
                <Input
                  className="flex-1"
                  value={option.name}
                  placeholder={t('Choice name', '选项名称')}
                  onChange={e => patchOption(gi, oi, { name: e.target.value })}
                />
                <div className="flex items-center gap-1">
                  <span className="text-[12px] text-text-tertiary">+{currency ?? ''}</span>
                  <Input
                    className="w-[76px]"
                    type="number" min={0} step="0.01" value={option.delta}
                    onChange={e => patchOption(gi, oi, { delta: Number(e.target.value) || 0 })}
                  />
                </div>
                <Button
                  type="button" variant="ghost" size="sm"
                  onClick={() => patchGroup(gi, { options: group.options.filter((_, n) => n !== oi) })}
                  aria-label={t('Remove choice', '删除选项')}
                >×</Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                type="button" variant="outline" size="sm"
                disabled={group.options.length >= MAX_OPTIONS_PER_GROUP}
                onClick={() => patchGroup(gi, { options: [...group.options, blankOption(group.options.length + 1)] })}
              >{t('Add choice', '添加选项')}</Button>
              <Button
                type="button" variant="ghost" size="sm"
                onClick={() => onChange(move(value, gi, gi - 1))}
                disabled={gi === 0}
                aria-label={t('Move up', '上移')}
              >↑</Button>
              <Button
                type="button" variant="ghost" size="sm"
                onClick={() => onChange(move(value, gi, gi + 1))}
                disabled={gi === value.length - 1}
                aria-label={t('Move down', '下移')}
              >↓</Button>
              <Button
                type="button" variant="ghost" size="sm"
                onClick={() => onChange(value.filter((_, n) => n !== gi))}
              >{t('Remove question', '删除问题')}</Button>
            </div>
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button" variant="outline" size="sm"
          disabled={value.length >= MAX_GROUPS_PER_PRODUCT}
          onClick={() => onChange([...value, blankGroup(value.length + 1)])}
        >{t('Add a question', '添加问题')}</Button>
        {/* The same verdict the write endpoint refuses on, shown while the merchant is still
            here. Without the SQL constraints ADR 0008 gave up, this is where they find out. */}
        {problem && <span className="text-[12px] text-danger">{configMessage(problem, t)}</span>}
      </div>
    </div>
  )
}

function configMessage(code: string, t: (en: string, zh: string) => string): string {
  switch (code) {
    case 'impossible_window':
      return t('“Choose at least” cannot be more than “at most”.', '“最少选”不能大于“最多选”。')
    case 'window_too_wide':
      return t('That is more choices than one order can carry.', '数量超过单笔订单上限。')
    case 'negative_delta':
      return t('An extra charge cannot be negative.', '加价不能为负数。')
    case 'empty_group':
      return t('Every question needs at least one choice.', '每个问题至少要有一个选项。')
    case 'duplicate_group_id':
    case 'duplicate_option_id':
      return t('Two entries share an id — remove one and add it again.', '存在重复项，请删除后重新添加。')
    case 'too_many_groups':
      return t(`At most ${MAX_GROUPS_PER_PRODUCT} questions per item.`, `每件商品最多 ${MAX_GROUPS_PER_PRODUCT} 个问题。`)
    case 'too_many_options':
      return t(`At most ${MAX_OPTIONS_PER_GROUP} choices per question.`, `每个问题最多 ${MAX_OPTIONS_PER_GROUP} 个选项。`)
    default:
      return t('Those options are not valid yet.', '选项设置尚未有效。')
  }
}
