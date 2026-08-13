// Menu import review (tasks/prd-ai-menu-import.md).
//
// The machine reads; the merchant decides. Nothing here saves until the merchant presses the
// button, and the drafts go out through `upsertProduct` — the same call the add-product form
// makes — so every rule that already applies to a product applies to an imported one.
//
// The screen is built around ONE job: checking a price against the photograph. That is why the
// photo stays on screen beside the rows rather than behind a preview toggle, and why a price the
// reader could not parse arrives as an empty required field rather than a 0 the merchant has to
// notice among forty rows.
import { useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { importMenu, upsertProduct, updateMerchantConfig, type MenuDraftItem } from '../store'
import { currencyDef } from '../currency'
import { coerceQuantity } from '../productUnit'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Checkbox } from '../components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { MAX_MENU_CATEGORIES } from '@bitetime/shared'
import type { MenuCategory } from '@bitetime/shared'

/** Mirrors the backend's own cap (MAX_MENU_IMAGE_BYTES) so an oversized file is refused here. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ACCEPTED = ['image/jpeg', 'image/png'] as const

/** A draft the merchant is editing, plus the two decisions they make about it. */
interface Row extends MenuDraftItem {
  /** Local key. Not the product id — that is minted at save, like the add form's draftId. */
  key: string
  /** Unchecked rows are not saved. Checked by default: the common case is "keep them all". */
  include: boolean
  /** '' is uncategorized. Set from `category_label` when it matches a section the shop holds. */
  category_id: string
  /** Create `category_label` as a new section on save. Defaults OFF — see below. */
  createCategory: boolean
}

/** Strips the `data:image/jpeg;base64,` prefix a FileReader produces. */
function base64Of(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('read_failed'))
    reader.readAsDataURL(file)
  })
}

/**
 * Matches a printed section heading to one of the shop's own sections, case- and space-blind.
 *
 * Returns the category id, or '' for no match. A near-miss is deliberately NOT accepted: filing a
 * product into the wrong section silently is worse than leaving it uncategorized, which the
 * products table already shows plainly in its Category column.
 */
function matchCategory(categories: MenuCategory[], label: string | undefined): string {
  if (!label) return ''
  const norm = (s: string) => s.trim().toLowerCase()
  const hit = categories.find(c => norm(c.name) === norm(label) || (c.name_zh && norm(c.name_zh) === norm(label)))
  return hit?.id ?? ''
}

export default function MenuImportDialog({
  open, onOpenChange, merchantId, currency, categories, unitItems, t, onSaved, onCategoriesChanged,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  merchantId: string
  currency?: string
  categories: MenuCategory[]
  /** The product form's own unit list, passed in so the two can never offer different units. */
  unitItems: { value: string; label: string }[]
  t: (en: string, zh: string) => string
  onSaved: () => void | Promise<void>
  onCategoriesChanged: () => void | Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [msg, setMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const symbol = currencyDef(currency).symbol

  const chosen = rows?.filter(r => r.include) ?? []
  // A price the reader could not read is an empty required field. Saving past one would put a
  // product priced 0 on the storefront, which is the failure this whole screen exists to prevent.
  const unpriced = chosen.filter(r => r.price === null || Number.isNaN(r.price))
  // Computed plainly rather than memoised: `chosen` is rebuilt on every render, so a `useMemo`
  // keyed on it would recompute every render anyway while reading as though it did not. The list
  // is at most a few dozen rows.
  const newCategoryLabels = [...new Set(
    chosen.filter(r => r.createCategory && r.category_label).map(r => r.category_label!.trim()),
  )]
  const overCategoryCap = categories.length + newCategoryLabels.length > MAX_MENU_CATEGORIES

  function reset() {
    setFile(null); setPreview(''); setRows(null); setMsg(''); setReading(false); setSaving(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  function close(next: boolean) {
    // Cancelling discards every draft. Nothing was written, so there is nothing to undo.
    if (!next) reset()
    onOpenChange(next)
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    if (!picked) return
    setMsg(''); setRows(null)
    if (!(ACCEPTED as readonly string[]).includes(picked.type)) {
      setMsg(t('Choose a JPG or PNG photo.', '请选择 JPG 或 PNG 照片。'))
      return
    }
    if (picked.size > MAX_IMAGE_BYTES) {
      setMsg(t('That photo is larger than 5MB. Take it again at a smaller size.', '照片超过 5MB。请用较小的尺寸重新拍摄。'))
      return
    }
    setFile(picked)
    setPreview(await readAsDataUrl(picked))
  }

  async function read() {
    if (!file || !preview) return
    setReading(true); setMsg('')
    const r = await importMenu(merchantId, base64Of(preview), file.type as 'image/jpeg' | 'image/png')
    setReading(false)
    if (!r.ok) {
      // Each refusal says something different, and a merchant can act on the difference.
      const byCode: Record<string, string> = {
        menu_import_unavailable: t('Menu reading is not switched on for this platform yet.', '本平台尚未开启菜单识别。'),
        daily_limit_reached: t('You have reached today’s limit of 20 menu reads.', '您已达到今天 20 次菜单识别的上限。'),
        could_not_read_menu: t('The menu could not be read. Try a sharper photo, or one page at a time.', '无法识别该菜单。请拍得更清晰，或每次只拍一页。'),
        image_too_large: t('That photo is larger than 5MB.', '照片超过 5MB。'),
        shop_not_active: t('Your shop is not active, so menu reading is switched off.', '您的店铺未启用，菜单识别已关闭。'),
      }
      setMsg(byCode[r.error.code ?? ''] ?? r.error.message)
      return
    }
    setRows(r.data.items.map((item, i) => ({
      ...item,
      key: `${i}-${item.name}`,
      include: true,
      category_id: matchCategory(categories, item.category_label),
      createCategory: false,
    })))
  }

  function edit(key: string, patch: Partial<Row>) {
    setRows(prev => prev?.map(r => (r.key === key ? { ...r, ...patch } : r)) ?? prev)
  }

  async function save() {
    if (!rows) return
    setSaving(true); setMsg('')

    // Create the new sections FIRST, in one write, so every product that wants one has an id to
    // point at. `updateMerchantConfig` replaces the whole list, so it is built from the current
    // one rather than appended to blindly.
    const labelToId = new Map<string, string>()
    if (newCategoryLabels.length > 0) {
      const created: MenuCategory[] = newCategoryLabels.map(name => ({
        id: crypto.randomUUID(), name, active: true,
      }))
      for (const c of created) labelToId.set(c.name.trim().toLowerCase(), c.id)
      const r = await updateMerchantConfig(merchantId, { product_categories: [...categories, ...created] })
      if (!r.ok) {
        setSaving(false)
        setMsg(t('Could not create the new categories.', '无法创建新分类。'))
        return
      }
      await onCategoriesChanged()
    }

    let saved = 0
    const failed: string[] = []
    for (const row of rows.filter(r => r.include)) {
      const categoryId = row.createCategory && row.category_label
        ? labelToId.get(row.category_label.trim().toLowerCase()) ?? null
        : row.category_id || null
      const r = await upsertProduct({
        id: crypto.randomUUID(),
        merchant_id: merchantId,
        name: row.name,
        name_zh: row.name_zh ?? '',
        descr: row.description ?? '',
        price: Number(row.price) || 0,
        unit: row.unit ?? 'pcs',
        unit_quantity: coerceQuantity(row.unit_quantity ?? 1),
        active: true,
        category_id: categoryId,
        image_urls: [],
        option_groups: [],
      })
      if (r.ok) saved++
      else failed.push(row.name)
    }

    setSaving(false)
    await onSaved()

    if (failed.length === 0) {
      toast.success(t(`Added ${saved} products`, `已添加 ${saved} 个产品`))
      reset()
      onOpenChange(false)
      return
    }
    // Partial success is reported as partial. A toast saying "done" over three silently dropped
    // products is how a merchant ships an incomplete menu without knowing.
    toast.error(t(
      `Added ${saved}. These could not be saved: ${failed.join(', ')}`,
      `已添加 ${saved} 个。以下未能保存：${failed.join('、')}`,
    ))
    setRows(prev => prev?.filter(r => !r.include || failed.includes(r.name)) ?? prev)
  }

  return (
    <Dialog open={open} onOpenChange={close} disablePointerDismissal>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Import from a photo', '从照片导入')}</DialogTitle>
        </DialogHeader>

        <p className="text-[13px] text-muted-foreground -mt-1 mb-3">
          {t(
            'Take a photo of your menu. We read it into products for you to check. Nothing is saved until you press Add.',
            '拍一张菜单照片。我们会读成产品供您核对。按“添加”之前不会保存任何内容。',
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={pick}
            className="hidden"
            id="menu-import-file"
          />
          <Button
            type="button" variant="soft" size="none"
            className="rounded-lg py-[6px] px-[14px] text-[13px]"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-4 mr-1" />
            {file ? t('Choose another photo', '换一张照片') : t('Choose a photo', '选择照片')}
          </Button>
          {file && !rows && (
            <Button
              type="button" size="none"
              className="rounded-lg py-[6px] px-[14px] text-[13px]"
              onClick={read}
              disabled={reading}
            >
              {reading && <Loader2 className="size-4 mr-1 animate-spin" />}
              {reading ? t('Reading the menu…', '正在识别菜单…') : t('Read this menu', '识别这张菜单')}
            </Button>
          )}
        </div>

        {msg && <p className="text-[13px] text-destructive mb-3">{msg}</p>}

        {preview && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            {/* Stays on screen while the rows are corrected: checking a price against the photo
                is the merchant's whole job here, and making them scroll away to do it is how a
                misread price gets saved. */}
            <div className="md:sticky md:top-0 md:self-start">
              <img
                src={preview}
                alt={t('The menu photo you chose', '您选择的菜单照片')}
                className="w-full rounded-xl border-[0.5px] border-border object-contain max-h-[60vh]"
              />
            </div>

            <div>
              {rows === null ? (
                <p className="text-[13px] text-muted-foreground">
                  {reading
                    ? t('Reading the menu. This takes a few seconds.', '正在识别菜单，需要几秒钟。')
                    : t('Press “Read this menu” to start.', '请按“识别这张菜单”开始。')}
                </p>
              ) : rows.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  {t(
                    'No menu items were found in that photo. Try a sharper photo, or one page at a time.',
                    '这张照片中没有找到菜单项目。请拍得更清晰，或每次只拍一页。',
                  )}
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {rows.map(row => {
                    const matched = !!row.category_id
                    const priceMissing = row.include && (row.price === null || Number.isNaN(row.price))
                    return (
                      <div
                        key={row.key}
                        className={`rounded-xl border-[0.5px] border-border p-3 ${row.include ? '' : 'opacity-50'}`}
                      >
                        <div className="flex items-start gap-2 mb-2">
                          <Checkbox
                            checked={row.include}
                            onCheckedChange={v => edit(row.key, { include: v === true })}
                            aria-label={t(`Include ${row.name}`, `包含 ${row.name}`)}
                          />
                          <Input
                            value={row.name}
                            onChange={e => edit(row.key, { name: e.target.value })}
                            className="h-8 text-[13px]"
                            aria-label={t('Product name', '产品名称')}
                          />
                          <Input
                            value={row.name_zh ?? ''}
                            onChange={e => edit(row.key, { name_zh: e.target.value })}
                            placeholder={t('Chinese name', '中文名称')}
                            className="h-8 text-[13px]"
                            aria-label={t('Chinese name', '中文名称')}
                          />
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[auto_1fr_1fr] items-end pl-6">
                          <div>
                            <Label className="text-[11px] text-muted-foreground">
                              {t('Price', '价格')} ({symbol})
                            </Label>
                            <Input
                              type="number" step="0.01" min="0"
                              value={row.price === null ? '' : String(row.price)}
                              onChange={e => edit(row.key, {
                                price: e.target.value === '' ? null : Number(e.target.value),
                              })}
                              className={`h-8 w-28 text-[13px] ${priceMissing ? 'border-destructive' : ''}`}
                              aria-label={t('Price', '价格')}
                            />
                          </div>
                          <div>
                            <Label className="text-[11px] text-muted-foreground">{t('Unit', '单位')}</Label>
                            <Select
                              value={row.unit ?? 'pcs'}
                              onValueChange={v => edit(row.key, { unit: v ?? 'pcs' })}
                              items={unitItems}
                            >
                              <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {unitItems.map(u => (
                                  <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-[11px] text-muted-foreground">{t('Category', '分类')}</Label>
                            <Select
                              value={row.category_id}
                              onValueChange={v => edit(row.key, { category_id: v ?? '', createCategory: false })}
                              items={[{ value: '', label: t('No category', '不分类') },
                                ...categories.map(c => ({ value: c.id, label: c.name }))]}
                            >
                              <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="">{t('No category', '不分类')}</SelectItem>
                                {categories.map(c => (
                                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {/* The printed price, kept beside the parsed one. It is what the merchant
                            checks against, and it is the only thing on screen that came off the
                            menu untouched. */}
                        {row.price_text && (
                          <p className="text-[11px] text-muted-foreground mt-1 pl-6">
                            {t('Printed on the menu:', '菜单上印的：')} <span className="font-mono">{row.price_text}</span>
                            {priceMissing && (
                              <span className="text-destructive">
                                {' · '}{t('Type the price yourself.', '请自行输入价格。')}
                              </span>
                            )}
                          </p>
                        )}

                        {/* Offered, never assumed. A section created on the merchant's behalf is a
                            change to their storefront's shape that they did not ask for, so the
                            toggle starts off and an unmatched label simply stays uncategorized. */}
                        {!matched && row.category_label && (
                          <label className="flex items-center gap-2 text-[11px] text-muted-foreground mt-2 pl-6">
                            <Checkbox
                              checked={row.createCategory}
                              onCheckedChange={v => edit(row.key, { createCategory: v === true })}
                            />
                            {t(
                              `Create the category “${row.category_label}”`,
                              `创建分类“${row.category_label}”`,
                            )}
                          </label>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-3 mt-4 pt-3 border-t-[0.5px] border-border">
            {unpriced.length > 0 && (
              <p className="text-[12px] text-destructive mr-auto">
                {t(
                  `${unpriced.length} of the selected products still need a price.`,
                  `已选产品中有 ${unpriced.length} 个还没有价格。`,
                )}
              </p>
            )}
            {overCategoryCap && (
              <p className="text-[12px] text-destructive mr-auto">
                {t(
                  `That is more than ${MAX_MENU_CATEGORIES} categories. Untick some.`,
                  `分类数超过 ${MAX_MENU_CATEGORIES} 个。请取消部分勾选。`,
                )}
              </p>
            )}
            <Button
              type="button" variant="soft" size="none"
              className="rounded-lg py-[6px] px-[14px] text-[13px]"
              onClick={() => close(false)}
              disabled={saving}
            >
              {t('Cancel', '取消')}
            </Button>
            <Button
              type="button" size="none"
              className="rounded-lg py-[6px] px-[14px] text-[13px]"
              onClick={save}
              disabled={saving || chosen.length === 0 || unpriced.length > 0 || overCategoryCap}
            >
              {saving && <Loader2 className="size-4 mr-1 animate-spin" />}
              {t(`Add ${chosen.length} products`, `添加 ${chosen.length} 个产品`)}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
