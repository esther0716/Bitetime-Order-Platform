import { useState } from 'react'
import { toast } from 'sonner'
import { SHOP_DESCRIPTION_MAX } from '@bitetime/shared'
import { useSession } from '../SessionContext'
import { updateMerchantConfig } from '../store'
import { Button } from '../components/ui/button'
import { Label } from '../components/ui/label'
import { Textarea } from '../components/ui/textarea'
import { useSaved } from './useSaved'
import { cn } from '@/lib/utils'

/**
 * The one line a customer reads under the shop's name, written by the merchant who owns it.
 *
 * ON THE STOREFRONT TAB, above the menu the arranger draws — this is the same screen, in the same
 * order the customer meets it: the blurb sits under the shop name, the menu sits under the blurb.
 * Shop Settings would have grouped it with the address and the currency, which is where a
 * merchant looks for a fact about the shop, not for a sentence about it.
 *
 * ITS OWN Save, not the arranger's. The arranger's Save is two writes that must both land (the
 * product order, then the categories) and it retries the whole thing on a failure; folding a
 * third, unrelated write into that would make a failed blurb re-send every product's position.
 *
 * The dirty flag is reported UP rather than registered with the NavGuard here. The guard holds
 * exactly one blocker (`blockerRef.current` in NavGuard.tsx), so a second registrant would
 * overwrite the arranger's — and this card unmounting would then clear the guard for a screen
 * still holding an un-saved drag. `onDirtyChange` must therefore be stable across renders:
 * `useSaved` reports through an effect that lists it as a dependency.
 */

type Fields = { en: string; zh: string }

const sameText = (a: Fields, b: Fields): boolean => a.en === b.en && a.zh === b.zh

export default function ShopDescriptionCard({ onDirtyChange }: {
  onDirtyChange: (dirty: boolean) => void
}) {
  const { t, merchant, refreshMerchant } = useSession()
  const merchantId = merchant!.id

  // Seeded ONCE from the row the session already holds, for the reason the arranger seeds once:
  // this screen calls `refreshMerchant` itself after every save, and re-seeding on that would
  // throw away whatever the merchant had typed since.
  const [fields, setFields] = useState<Fields>({
    en: merchant?.description ?? '',
    zh: merchant?.description_zh ?? '',
  })
  const [saving, setSaving] = useState(false)
  // The same saved-snapshot tracking the settings tabs use (#123): it owns the last-saved
  // snapshot, derives dirty through `sameText`, and reports the flag up in an effect.
  const { dirty, commit } = useSaved(fields, fields, sameText, onDirtyChange)

  const en = fields.en.trim()
  const zh = fields.zh.trim()
  const tooLong = en.length > SHOP_DESCRIPTION_MAX || zh.length > SHOP_DESCRIPTION_MAX

  async function save() {
    setSaving(true)
    // Trimmed before sending, and '' rather than null for a cleared field — the endpoint reads
    // both as "take it down" and stores null either way, so the column never holds a blank string.
    const r = await updateMerchantConfig(merchantId, { description: en, description_zh: zh })
    setSaving(false)
    if (!r.ok) {
      toast.error(r.error.message || t('Could not save the description', '无法保存简介'))
      return
    }
    await refreshMerchant()
    // Committed from what the write ANSWERED with, not from what was typed: the endpoint trims,
    // so a merchant who typed trailing spaces would otherwise be left with a card that stays
    // dirty forever, offering to save a change the shop already has.
    const applied = { en: r.data?.description ?? '', zh: r.data?.description_zh ?? '' }
    setFields(applied)
    commit(applied)
    toast.success(t('Description saved', '简介已保存'))
  }

  return (
    <div className="bg-card border-[0.5px] border-border rounded-2xl p-5 mb-8 w-full box-border">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="font-heading text-[15px] font-medium text-primary">
          {t('Shop description', '店铺简介')}
        </h3>
        <Button
          type="button" size="none"
          className="rounded-lg py-[6px] px-[14px] text-[13px] whitespace-nowrap"
          onClick={save}
          disabled={!dirty || saving || tooLong}
        >
          {saving ? t('Saving…', '保存中…') : t('Save', '保存')}
        </Button>
      </div>

      <p className="text-[12px] text-muted-foreground leading-[1.6] mb-4 max-w-[560px]">
        {t('One line customers read under your shop name. Say what you sell and anything they must know before ordering.',
           '顾客在店名下方读到的一行文字。写明您卖什么，以及下单前需要知道的事。')}
      </p>

      <div className="flex flex-col gap-4 max-w-[560px]">
        <Field
          id="shop-description-en"
          label={t('English', '英文')}
          placeholder="Home-style kuih, order a day ahead."
          value={fields.en}
          length={en.length}
          onChange={v => setFields(f => ({ ...f, en: v }))}
        />
        <Field
          id="shop-description-zh"
          label={t('Chinese (optional)', '中文（可选）')}
          placeholder="家庭式面包，请提前一天下单。"
          value={fields.zh}
          length={zh.length}
          onChange={v => setFields(f => ({ ...f, zh: v }))}
          // A merchant who writes only English is not missing anything: `shopDescr` gives a
          // Chinese reader the English line rather than a blank one.
          hint={t('Left blank, Chinese customers read the English line.',
                  '留空时，中文顾客会看到英文内容。')}
        />
      </div>
    </div>
  )
}

function Field({ id, label, placeholder, value, length, onChange, hint }: {
  id: string
  label: string
  placeholder: string
  value: string
  /** The TRIMMED length — what the endpoint measures, so the counter agrees with the refusal. */
  length: number
  onChange: (value: string) => void
  hint?: string
}) {
  const over = length > SHOP_DESCRIPTION_MAX
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={2}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
      <div className="flex items-start justify-between gap-3">
        {hint ? <p className="text-[12px] text-muted-foreground leading-[1.5]">{hint}</p> : <span />}
        <span className={cn(
          'text-[11px] whitespace-nowrap',
          over ? 'text-danger-fg' : 'text-muted-foreground',
        )}>
          {length} / {SHOP_DESCRIPTION_MAX}
        </span>
      </div>
    </div>
  )
}
