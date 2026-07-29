import { useState } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '../components/ui/dropdown-menu'
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
  // What a remove control is asking about — a whole question, or one choice inside one. Held by
  // INDEX because that is what the removal itself uses; the confirm is modal, so no other edit
  // can reorder the array underneath it while it is open.
  const [pendingDelete, setPendingDelete] = useState<
    { kind: 'group'; gi: number } | { kind: 'option'; gi: number; oi: number } | null
  >(null)

  const patchGroup = (i: number, patch: Partial<OptionGroup>) =>
    onChange(value.map((g, n) => (n === i ? { ...g, ...patch } : g)))

  const patchOption = (gi: number, oi: number, patch: Partial<Option>) =>
    patchGroup(gi, { options: value[gi].options.map((o, n) => (n === oi ? { ...o, ...patch } : o)) })

  const problem = validateOptionGroups(value)

  // Collapsed by default when there is nothing to show: most shops on the platform sell things
  // that ask no questions, and they should never meet this section at all.
  if (!open) {
    return (
      <Button
        type="button" variant="outline" size="sm"
        onClick={() => setOpen(true)}
      >
        {t('Add options (sizes, flavours, add-ons)', '添加选项（规格、口味、加料）')}
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-4 border border-clay-border rounded-md p-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium">{t('Options', '选项')}</span>
        {copyFrom.length > 0 && value.length === 0 && (
          // A menu, not a select: this holds no value. It fires once, copies, and the
          // condition above then hides it because `value` is no longer empty.
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button" variant="outline" size="none"
                  className="text-[12px] px-2 py-1 rounded"
                />
              }
            >
              {t('Copy options from…', '从其他商品复制…')}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {copyFrom.map(p => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => {
                    // A COPY, not a link. Editing "Milk" on one drink must never reprice eleven
                    // others — that surprise is why there is no shared library (ADR 0008).
                    onChange(structuredClone(p.groups))
                  }}
                >
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {value.map((group, gi) => (
        <div key={group.id} className="flex flex-col gap-2 border-t border-divider pt-3 first:border-t-0 first:pt-0 min-w-0">
          <div className="flex items-end gap-2 flex-wrap min-w-0">
            <div className="flex-1 basis-[180px] min-w-0">
              <Label className="text-[12px]">{t('Question', '问题')}</Label>
              <Input
                value={group.name}
                placeholder={t('e.g. Choose your flavours', '例如：选择口味')}
                onChange={e => patchGroup(gi, { name: e.target.value })}
              />
            </div>
            <div className="flex-1 basis-[150px] min-w-0">
              {/* Optional, like `products.name_zh`. The ORDER snapshots both languages, so what
                  is typed here is what a Chinese-reading customer sees on their receipt. */}
              <Label className="text-[12px]">{t('Question (中文)', '问题（中文）')}</Label>
              <Input
                value={group.name_zh ?? ''}
                placeholder={t('optional', '选填')}
                onChange={e => patchGroup(gi, { name_zh: e.target.value || null })}
              />
            </div>
            {/* The three numbers are one thought — "how many, and how many of each" — so they
                wrap together instead of one field peeling off onto its own line. */}
            <div className="flex items-end gap-2 basis-full sm:basis-auto min-w-0">
            <div className="flex-1 sm:w-[92px] sm:flex-none">
              <Label className="text-[12px]">{t('Choose at least', '最少选')}</Label>
              <Input
                type="number" min={0} value={group.minSelect}
                onChange={e => patchGroup(gi, { minSelect: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="flex-1 sm:w-[92px] sm:flex-none">
              <Label className="text-[12px]">{t('At most', '最多选')}</Label>
              <Input
                type="number" min={1} value={group.maxSelect ?? ''}
                placeholder={t('any', '不限')}
                onChange={e => patchGroup(gi, {
                  maxSelect: e.target.value === '' ? null : Number(e.target.value) || 1,
                })}
              />
            </div>
            <div className="flex-1 sm:w-[124px] sm:flex-none">
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
          </div>

          <div className="flex flex-col gap-1.5 pl-1 min-w-0">
            {group.options.map((option, oi) => (
              // WRAPS, and every field can shrink. Fixed minimums with no wrap meant this row
              // could not fit a narrow dialog, so it pushed the card wider than its container and
              // the availability and remove controls were simply cut off the right edge.
              <div key={option.id} className="flex flex-wrap items-center gap-2 min-w-0">
                <Input
                  className="flex-1 basis-[130px] min-w-0"
                  value={option.name}
                  placeholder={t('Choice name', '选项名称')}
                  onChange={e => patchOption(gi, oi, { name: e.target.value })}
                />
                <Input
                  className="flex-1 basis-[110px] min-w-0"
                  value={option.name_zh ?? ''}
                  placeholder={t('中文（选填）', '中文（选填）')}
                  onChange={e => patchOption(gi, oi, { name_zh: e.target.value || null })}
                />
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[12px] text-text-tertiary whitespace-nowrap">+{currency ?? ''}</span>
                  <Input
                    className="w-[72px]"
                    type="number" min={0} step="0.01" value={option.delta}
                    onChange={e => patchOption(gi, oi, { delta: Number(e.target.value) || 0 })}
                  />
                </div>
                {/* THE 3PM CONTROL, and the reason `option_unavailable` exists at all: a shop
                    that runs out of oat milk switches it off rather than deleting it, keeping the
                    price and the name for tomorrow. Without this the only way an option ever went
                    inactive was a Pro downgrade. */}
                <div className="flex items-center gap-1 shrink-0 ml-auto">
                <Button
                  type="button" variant={option.active ? 'soft' : 'outline'} size="sm"
                  onClick={() => patchOption(gi, oi, { active: !option.active })}
                  aria-pressed={!option.active}
                  aria-label={t(`Mark ${option.name || 'choice'} unavailable`, `将 ${option.name || '选项'} 设为不可选`)}
                  title={t('Sold out today', '今日售罄')}
                >{option.active ? t('Available', '可选') : t('Sold out', '售罄')}</Button>
                <Button
                  type="button" variant="ghost" size="sm"
                  onClick={() => setPendingDelete({ kind: 'option', gi, oi })}
                  aria-label={t('Remove choice', '删除选项')}
                >×</Button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2 min-w-0">
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
                type="button" variant={group.active ? 'ghost' : 'outline'} size="sm"
                onClick={() => patchGroup(gi, { active: !group.active })}
                aria-pressed={!group.active}
              >{group.active ? t('Switch off', '停用') : t('Switched off', '已停用')}</Button>
              <Button
                type="button" variant="ghost" size="sm"
                onClick={() => setPendingDelete({ kind: 'group', gi })}
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

      {/* Opened from inside the product form's dialog — z-modal-popover paints it above that
          popup, the same way the form's Select menu escapes it. */}
      <ConfirmDialog
        className="z-modal-popover"
        open={!!pendingDelete}
        onOpenChange={o => { if (!o) setPendingDelete(null) }}
        title={pendingDelete?.kind === 'group'
          ? t('Remove this question?', '删除这个问题？')
          : t('Remove this choice?', '删除这个选项？')}
        body={<p>{pendingDeleteBody()}</p>}
        confirmLabel={pendingDelete?.kind === 'group'
          ? t('Remove question', '删除问题')
          : t('Remove choice', '删除选项')}
        onConfirm={() => {
          if (!pendingDelete) return
          if (pendingDelete.kind === 'group') {
            onChange(value.filter((_, n) => n !== pendingDelete.gi))
          } else {
            const { gi, oi } = pendingDelete
            patchGroup(gi, { options: value[gi].options.filter((_, n) => n !== oi) })
          }
        }}
      />
    </div>
  )

  // Names what is going, and stays honest that nothing here is written until the product is
  // saved — unlike a product or a photo, this one IS still recoverable by cancelling the form.
  function pendingDeleteBody() {
    if (!pendingDelete) return null
    const group = value[pendingDelete.gi]
    if (pendingDelete.kind === 'group') {
      const name = group?.name || t('this question', '这个问题')
      const count = group?.options.length ?? 0
      return t(
        `“${name}” and its ${count} ${count === 1 ? 'choice' : 'choices'} go with it. Nothing is written until you save the product.`,
        `“${name}” 及其 ${count} 个选项都会一并删除。在保存产品之前不会写入更改。`,
      )
    }
    const name = group?.options[pendingDelete.oi]?.name || t('this choice', '这个选项')
    return t(
      `“${name}” stops being offered on this question. Nothing is written until you save the product.`,
      `“${name}” 将不再作为该问题的选项。在保存产品之前不会写入更改。`,
    )
  }
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
    case 'duplicate_option_name':
      return t('Two choices share a name — a customer cannot tell them apart.', '两个选项名称相同，顾客无法区分。')
    case 'blank_name':
      return t('Every question and choice needs a name.', '每个问题和选项都需要名称。')
    case 'malformed_group':
    case 'malformed_option':
      return t('Something in these options is incomplete.', '选项设置不完整。')
    case 'too_many_options':
      return t(`At most ${MAX_OPTIONS_PER_GROUP} choices per question.`, `每个问题最多 ${MAX_OPTIONS_PER_GROUP} 个选项。`)
    default:
      return t('Those options are not valid yet.', '选项设置尚未有效。')
  }
}
