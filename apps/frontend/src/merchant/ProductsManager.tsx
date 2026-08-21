import { useEffect, useState } from 'react'
// Never a native `<input type="date">` — see the note at the top of DateField.
import DateField from './DateField'
import type { ColumnDef } from '@tanstack/react-table'
import { MoreHorizontal, Package, Lock } from 'lucide-react'
import { useSession } from '../SessionContext'
import { toast } from 'sonner'
import { lookupProducts, upsertProduct, deleteProduct, deleteProductImages, productImageUrl, updateMerchantConfig } from '../store'
import { coerceQuantity, formatUnit } from '../productUnit'
import { formatMoney, currencyDef } from '../currency'
import { promoEndFromDate, promoEndToDate } from '../promoEnd'
import { SkeletonText } from '../components/Loaders'
import ConfirmDialog from '../components/ConfirmDialog'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Textarea } from '../components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '../components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { DataTable, SortableHeader } from '../components/ui/data-table'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '../components/ui/empty'
import ImagePicker from './ProductImages'
import OptionGroupsEditor from './OptionGroupsEditor'
import MenuCategoriesDialog, { blankCategory, categoryProblem } from './MenuCategoriesDialog'
import MenuImportDialog from './MenuImportDialog'
import { Tooltip, TooltipTrigger, TooltipContent } from '../components/ui/tooltip'
import { findCategory } from '../menuGroups'
import {
  optionGroupsFromRow, menuCategoriesFromRow, validateMenuCategories,
  MAX_MENU_CATEGORIES, MENU_CATEGORY_NAME_MAX,
} from '@bitetime/shared'
import type { OptionGroup, MenuCategory } from '@bitetime/shared'

// The picker's "create one" entry. A sentinel rather than a real id: it must not collide with a
// category id, and a UUID never starts with a space.
const NEW_CATEGORY = ' new '

/**
 * Has this product's sale already finished? Read once, when the edit dialog opens.
 *
 * MODULE SCOPE on purpose. `Date.now()` is impure, and the React Compiler refuses one called from
 * anything it compiles — which `openEdit` became once it started reading a value derived during
 * render. Outside the component the call is opaque to the compiler and the rule is satisfied
 * honestly rather than silenced.
 *
 * Display-only, so the device clock is an acceptable stand-in for the server's here — unlike the
 * storefront's price quote (#68), this never becomes an order, so a merchant's laptop being a few
 * minutes off makes the hint early or late, never a wrong price.
 */
const promoHasEnded = (promoEnd: unknown): boolean =>
  !!promoEnd && new Date(promoEnd as string).getTime() < Date.now()

// Canonical unit options (value stored as-is; label is bilingual).
const UNITS: { value: string; en: string; zh: string }[] = [
  { value: 'pcs', en: 'pcs', zh: '件' },
  { value: 'box', en: 'box', zh: '盒' },
  { value: 'set', en: 'set', zh: '套' },
  { value: 'pack', en: 'pack', zh: '包' },
  { value: 'dozen', en: 'dozen', zh: '打' },
  { value: 'bottle', en: 'bottle', zh: '瓶' },
  { value: 'cup', en: 'cup', zh: '杯' },
  { value: 'jar', en: 'jar', zh: '罐' },
  { value: 'tray', en: 'tray', zh: '盘' },
  { value: 'slice', en: 'slice', zh: '片' },
  { value: 'kg', en: 'kg', zh: '公斤' },
  { value: 'g', en: 'g', zh: '克' },
]

// `category_id: ''` is the form's "no category". It becomes NULL on the way out — the column has
// no empty-string state, and the two must not be allowed to diverge into "unfiled" and "filed
// under nothing".
const BLANK = {
  name: '', name_zh: '', descr: '', price: '', unit: 'pcs', unit_quantity: 1, active: true,
  promo_price: '', promo_limit: '', promo_end: '', category_id: '',
}

// Handlers + language + currency ride on table.options.meta so the column defs stay
// stable (defined once) and never reset sorting when a row action refetches.
interface ProductTableMeta {
  t: (en: string, zh: string) => string
  lang: string
  currency?: string
  /** The shop's own sections, so the Category column can name one — hidden ones included. */
  categories: MenuCategory[]
  onEdit: (p: any) => void
  onRemove: (p: any) => void
}

const columns: ColumnDef<any>[] = [
  {
    id: 'photo',
    header: () => null,
    enableSorting: false,
    cell: ({ row }) => {
      const p = row.original
      return p.image_urls?.length ? (
        <img
          src={productImageUrl(p.image_urls[0])}
          alt=""
          className="size-11 shrink-0 object-cover rounded-lg border-[0.5px] border-border"
        />
      ) : (
        <div className="size-11 shrink-0 rounded-lg border-[0.5px] border-dashed border-border" aria-hidden />
      )
    },
  },
  {
    accessorKey: 'name',
    header: ({ column, table }) => (
      <SortableHeader column={column} label={(table.options.meta as ProductTableMeta).t('Product', '产品')} />
    ),
    cell: ({ row, table }) => {
      const { t } = table.options.meta as ProductTableMeta
      const p = row.original
      return (
        <div className="text-[14px] font-medium text-foreground">
          {p.name}
          {p.name_zh ? <span className="text-muted-foreground font-normal"> / {p.name_zh}</span> : null}
          {!p.active && <em className="italic text-[12px] text-muted-foreground"> · {t('hidden', '已隐藏')}</em>}
        </div>
      )
    },
  },
  {
    // Which section the product sits in — and, more usefully, which products are still in none.
    // A new product falls to the bottom of the storefront's un-headed trailing block, and this
    // column is where a merchant notices that rather than mistaking it for a save that failed.
    id: 'category',
    // NOT sortable, and that is a deliberate trade rather than an omission. The label a merchant
    // would want to sort on is resolved from the shop's category list, which lives on
    // `table.options.meta` — reachable from a cell, but not from a `sortingFn`. Threading it in
    // would mean rebuilding these column defs whenever the merchant row changes, which is the one
    // thing the stability comment above exists to prevent (it resets the table's sort).
    enableSorting: false,
    header: ({ table }) => (
      <span className="whitespace-nowrap">{(table.options.meta as ProductTableMeta).t('Category', '分类')}</span>
    ),
    cell: ({ row, table }) => {
      const { t, lang, categories } = table.options.meta as ProductTableMeta
      // Hidden categories resolve too: a merchant needs to see where an item is filed even while
      // that section is switched off. Only an id the shop no longer holds reads as unfiled.
      const c = findCategory(categories, row.original.category_id)
      if (!c) return <span className="text-[13px] text-muted-foreground italic">{t('None', '未分类')}</span>
      return (
        <span className="text-[13px] text-muted-foreground whitespace-nowrap">
          {(lang === 'zh' && c.name_zh) || c.name}
          {!c.active && <em className="italic"> · {t('hidden', '已隐藏')}</em>}
        </span>
      )
    },
  },
  {
    accessorKey: 'price',
    header: ({ column, table }) => (
      <SortableHeader column={column} label={(table.options.meta as ProductTableMeta).t('Price', '价格')} />
    ),
    cell: ({ row, table }) => {
      const { currency } = table.options.meta as ProductTableMeta
      const p = row.original
      return <span className="text-[13px] text-muted-foreground whitespace-nowrap">{formatMoney(p.price, currency)} / {formatUnit(p.unit_quantity, p.unit)}</span>
    },
  },
  {
    id: 'actions',
    header: ({ table }) => (
      <div className="text-right whitespace-nowrap">{(table.options.meta as ProductTableMeta).t('Actions', '操作')}</div>
    ),
    cell: ({ row, table }) => {
      const meta = table.options.meta as ProductTableMeta
      const { t } = meta
      const p = row.original
      return (
        <div className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="none"
                  className="size-8 p-0 rounded-pill cursor-pointer hover:bg-brand-100 hover:text-primary"
                  aria-label={t('Actions', '操作')}
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="cursor-pointer" onClick={() => meta.onEdit(p)}>{t('Edit', '编辑')}</DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer" onClick={() => meta.onRemove(p)}>{t('Delete', '删除')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )
    },
  },
]

export default function ProductsManager() {
  const { t, lang, merchant, refreshMerchant } = useSession()
  const [rows, setRows] = useState<any[] | null>(null)
  const [form, setForm] = useState<any>(BLANK)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  // editingProduct = the row being edited (null → add mode).
  const [editingProduct, setEditingProduct] = useState<any | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  // Draft id lets the add-form upload images to Storage before the row exists.
  const [draftId, setDraftId] = useState(() => crypto.randomUUID())
  // Photos being edited in the add/edit dialog (add: new draft; edit: the row's).
  const [images, setImages] = useState<string[]>([])
  // Saved by the product's own upsert, not by a second write — see ADR 0008.
  const [optionGroups, setOptionGroups] = useState<OptionGroup[]>([])
  // The shop's menu sections (ADR 0013). Read off the merchant row the session already holds —
  // no request — and written back through `PATCH /api/merchants/:id`, so `refreshMerchant` is
  // what makes a save visible rather than a local copy that could drift from the row.
  const categories = menuCategoriesFromRow(merchant?.product_categories)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  // Menu import (tasks/prd-ai-menu-import.md). Its own dialog, and deliberately not folded into
  // the add/edit form: that form saves ONE product on submit, and this one proposes many and
  // saves none until asked.
  const [importOpen, setImportOpen] = useState(false)
  const [categoriesSaving, setCategoriesSaving] = useState(false)
  // The inline "+ New category…" draft in the product form. `null` is "not creating one" — an
  // empty string is a merchant who opened it and has not typed yet, and the two are different.
  const [newCategory, setNewCategory] = useState<string | null>(null)
  const currency = merchant?.currency
  const symbol = currencyDef(currency).symbol
  // Whether the row being edited has a promo whose end date has already passed. Computed once, in
  // openEdit below, rather than read from `Date.now()` during render (React Compiler forbids calling
  // an impure function while rendering — the result would also go stale without a re-render to
  // recompute it anyway). Display-only, so the device clock is an acceptable stand-in for the
  // server's here — unlike the storefront's price quote (#68), this never becomes an order, so a
  // merchant's laptop clock being a few minutes off only makes the hint a few minutes early or late,
  // never a wrong price. `promo_end` is an absolute instant already (see promoEnd.ts).
  const [promoEnded, setPromoEnded] = useState(false)
  // The row a Delete action is asking about, held here rather than in the column def so the
  // columns stay stable (see ProductTableMeta). null → no confirm open.
  const [pendingDelete, setPendingDelete] = useState<any | null>(null)

  async function load() { const r = await lookupProducts(merchant!.id); setRows(r.ok ? r.data : []) }
  useEffect(() => { lookupProducts(merchant!.id).then(r => setRows(r.ok ? r.data : [])) }, [merchant!.id])

  function openAdd() {
    setEditingProduct(null)
    setForm(BLANK)
    setImages([]); setOptionGroups([]); setDraftId(crypto.randomUUID()); setMsg(''); setPromoEnded(false)
    setFormOpen(true)
  }
  function openEdit(p: any) {
    setEditingProduct(p)
    setMsg('')
    setForm({
      name: p.name ?? '', name_zh: p.name_zh ?? '', descr: p.descr ?? '',
      price: String(p.price ?? ''), unit: p.unit ?? 'pc', unit_quantity: p.unit_quantity ?? 1, active: p.active,
      promo_price: p.promo_price === null || p.promo_price === undefined ? '' : String(p.promo_price),
      promo_limit: p.promo_limit === null || p.promo_limit === undefined ? '' : String(p.promo_limit),
      promo_end: promoEndToDate(p.promo_end),
      // THE STORED VALUE, VERBATIM, dangling id and all. `categoryItems` keeps a dead id
      // selectable, the way `unitItems` keeps a legacy unit selectable, so a rename round-trips
      // byte-identically instead of quietly unfiling the product.
      category_id: p.category_id ?? '',
    })
    setImages(p.image_urls ?? [])
    setOptionGroups(optionGroupsFromRow(p.option_groups))
    setPromoEnded(promoHasEnded(p.promo_end))
    setFormOpen(true)
  }

  /**
   * The promo columns, from the three form fields. An empty field is NULL — no promo / no cap / no
   * end date — and `promo_price: 0` is a real promo (a free item), so this tests for '' and never
   * for falsiness.
   *
   * `promo_sold` is deliberately absent: the browser cannot write it (a DB trigger pins it), and it
   * is the backend's counter. The whole-row spread below still carries it back unchanged; the
   * trigger is what makes that harmless.
   */
  function promoFields(f: any) {
    return {
      promo_price: f.promo_price === '' ? null : Number(f.promo_price),
      promo_limit: f.promo_limit === '' ? null : Number(f.promo_limit),
      promo_end: promoEndFromDate(f.promo_end),
    }
  }

  /**
   * The promo columns to send with this write.
   *
   * `form`'s own promo keys are STRINGS ('' for empty) and must never reach the write: '' is not
   * a number. `promoFields` is what turns them into the three real columns, and this ALWAYS
   * returns all three, to spread AFTER `...form` rather than deleting them afterwards.
   */
  function promoWrite() {
    return promoFields(form)
  }

  /**
   * Returns a message to show, or null. The DB has the same checks — this is the one with words.
   *
   * The `promo_limit` check runs first and unconditionally (not gated on `promo_price !== ''`): the
   * `min="1" step="1"` on the input is a convenience, not the enforcement, so a limit of 0 must be
   * refused here even for a product with no promo price set at all — otherwise it reaches Postgres's
   * `products_promo_limit_positive` constraint as a raw error.
   */
  function promoProblem(f: any): string | null {
    if (f.promo_limit !== '' && (!Number.isInteger(Number(f.promo_limit)) || Number(f.promo_limit) < 1)) {
      return t('The promo limit must be a whole number of at least 1.', '优惠数量上限必须是不小于 1 的整数。')
    }
    if (f.promo_price === '') return null
    const promo = Number(f.promo_price)
    const price = Number(f.price) || 0
    if (!Number.isFinite(promo) || promo < 0) {
      return t('The promo price must be a number, and not negative.', '优惠价必须是非负数字。')
    }
    if (promo >= price) {
      return t('The promo price must be below the normal price.', '优惠价必须低于原价。')
    }
    return null
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMsg('')
    const problem = promoProblem(form)
    if (problem) { setMsg(problem); setBusy(false); return }
    const r = editingProduct
      // Spread the original row first so sort / active / etc. survive the upsert.
      ? await upsertProduct({
          ...editingProduct, ...form, ...promoWrite(),
          image_urls: images,
          option_groups: optionGroups,
          price: Number(form.price) || 0,
          unit_quantity: coerceQuantity(form.unit_quantity),
          // '' is the form's "no category" and NULL is the column's; the picker's create sentinel
          // is intercepted before it can land here, and this is the belt to that brace — a
          // sentinel written as an id would be a product filed under a category nobody can name.
          category_id: form.category_id && form.category_id !== NEW_CATEGORY ? form.category_id : null,
        })
      : await upsertProduct({
          ...form,
          ...promoWrite(),
          id: draftId,
          image_urls: images,
          option_groups: optionGroups,
          price: Number(form.price) || 0,
          unit_quantity: coerceQuantity(form.unit_quantity),
          // '' is the form's "no category" and NULL is the column's; the picker's create sentinel
          // is intercepted before it can land here, and this is the belt to that brace — a
          // sentinel written as an id would be a product filed under a category nobody can name.
          category_id: form.category_id && form.category_id !== NEW_CATEGORY ? form.category_id : null,
          merchant_id: merchant!.id,
        })
    if (r.ok) {
      setFormOpen(false); setForm(BLANK); setEditingProduct(null); setImages([]); setOptionGroups([]); setDraftId(crypto.randomUUID())
      await load()
      toast.success(t('Product saved', '产品已保存'))
    } else {
      const err = r.error
      // `promoProblem` above already catches a promo left above a base price the merchant just
      // lowered in THIS save — it reads `f.price`, which is the price being saved, so `8 >= 7` is
      // refused with words before this ever runs. This branch is a backstop for a DIFFERENT writer:
      // the dashboard form is not the only thing that can touch a `products` row (a script, an
      // admin tool, a direct SQL edit), and `products_promo_below_price` is what stops one of those
      // leaving a promo priced above the item. Postgres's raw constraint string is not something to
      // show a merchant if that ever collides with a live promo here.
      if (err.message.includes('products_promo_below_price')) {
        setMsg(t('The promo price is no longer below the normal price. Lower or clear the promo price first.',
          '优惠价已不低于原价。请先降低或清除优惠价。'))
      } else {
        setMsg(err.message || t('Something went wrong.', '出错了。'))
      }
    }
    setBusy(false)
  }

  async function setProductImages(p: any, image_urls: string[]) {
    // No promo handling here: `p` IS the stored row, so its promo columns go back unchanged, which
    // the backend's change-based gate lets through on any plan (#145).
    const r = await upsertProduct({ ...p, image_urls })
    if (r.ok) await load()
  }
  // The name to quote back in the delete confirm, in the language being read.
  function productLabel(p: any) {
    return (lang === 'zh' && p.name_zh) ? p.name_zh : p.name
  }
  async function remove(p: any) {
    const r = await deleteProduct(p.id, merchant!.id)
    if (!r.ok) { toast.error(r.error.message || t('Could not delete product', '无法删除产品')); return }
    if (p.image_urls?.length) { try { await deleteProductImages(p.image_urls) } catch { /* best-effort */ } }
    await load(); toast.success(t('Product deleted', '产品已删除'))
  }

  /**
   * Write the whole category list back, in one PATCH.
   *
   * `refreshMerchant` rather than a local copy: this list lives on the merchant row that the
   * session holds and that the storefront reads, so keeping a second copy here would leave the
   * two able to disagree about what the shop's menu looks like.
   */
  async function saveCategories(next: MenuCategory[]): Promise<boolean> {
    setCategoriesSaving(true)
    const r = await updateMerchantConfig(merchant!.id, { product_categories: next })
    setCategoriesSaving(false)
    if (!r.ok) {
      toast.error(r.error.message || t('Could not save categories', '无法保存分类'))
      return false
    }
    await refreshMerchant()
    toast.success(t('Categories saved', '分类已保存'))
    return true
  }

  // How many products each category holds, so the delete confirm can say what it costs. Counted
  // over ALL products, hidden ones included: a merchant deleting a category is told about every
  // row that points at it, not only the ones currently on sale.
  const categoryCounts = (rows ?? []).reduce<Record<string, number>>((acc, p) => {
    if (p.category_id) acc[p.category_id] = (acc[p.category_id] ?? 0) + 1
    return acc
  }, {})

  const meta: ProductTableMeta = {
    t, lang, currency, categories,
    onEdit: openEdit,
    onRemove: setPendingDelete,
  }

  /**
   * Create one category from the product form, without leaving it.
   *
   * A SECOND write, and knowingly so: the list lives on the merchant row and the product on its
   * own, so there is no single upsert that could carry both (the arrangement ADR 0008 had for
   * option groups and ADR 0013 gives up here). What that costs is an empty category left behind
   * if the product save then fails — benign, because a category holding nothing renders nothing.
   *
   * Appended, never inserted: array order is display order, and a new section quietly landing in
   * the middle of a menu the merchant arranged is worse than one landing at the end.
   */
  async function createCategory() {
    const name = (newCategory ?? '').trim()
    if (!name) return
    const created = { ...blankCategory(), name }
    const next = [...categories, created]
    const bad = validateMenuCategories(next)
    if (bad) { toast.error(categoryProblem(bad, t)); return }
    if (await saveCategories(next)) {
      setForm((f: any) => ({ ...f, category_id: created.id }))
      setNewCategory(null)
    }
  }

  /**
   * What the picker offers. The leading entry is "no category" — the state most products are in
   * and the one a merchant must be able to get back to, which is why it is an option rather than
   * an empty selection.
   *
   * Hidden categories are OFFERED, marked as hidden: a merchant filing a product into a section
   * they have switched off is a legitimate thing to do (arranging next month's menu), and
   * removing the option would leave a product already in one unable to be re-selected.
   */
  const categoryItems = [
    { value: '', label: t('No category', '不分类') },
    // The leading entry keeps a DANGLING id selectable — its category was deleted, and the
    // product still carries the id. Exactly the reason `unitItems` below keeps a legacy unit:
    // dropping it would silently rewrite the column on the next save, which here means a Basic
    // ex-Pro shop being refused an ordinary rename (`categoryChanged` sees null vs the stored id).
    ...(form.category_id && !findCategory(categories, form.category_id)
      ? [{ value: form.category_id as string, label: t('Deleted category', '已删除的分类') }]
      : []),
    ...categories.map(c => ({
      value: c.id,
      label: ((lang === 'zh' && c.name_zh) || c.name)
        + (c.active ? '' : ` · ${t('hidden', '已隐藏')}`),
    })),
    ...(categories.length < MAX_MENU_CATEGORIES
      ? [{ value: NEW_CATEGORY, label: t('+ New category…', '+ 新建分类…') }]
      : []),
  ]

  // `items` feeds the trigger's label lookup and the rendered list from one expression.
  // The leading entry keeps a legacy value (e.g. an old "pc") selectable so existing rows
  // survive — dropping it would silently rewrite a merchant's unit on the next save.
  const unitItems = [
    ...(form.unit && !UNITS.some(u => u.value === form.unit)
      ? [{ value: form.unit as string, label: form.unit as string }]
      : []),
    ...UNITS.map(u => ({ value: u.value, label: t(u.en, u.zh) })),
  ]

  if (!rows) return (
    <div className="bg-card border-[0.5px] border-border rounded-2xl p-5 mb-8 w-full box-border">
      <SkeletonText lines={4} />
    </div>
  )

  return (
    <div className="bg-card border-[0.5px] border-border rounded-2xl p-5 mb-8 w-full box-border">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="font-heading text-[15px] font-medium text-primary flex items-center gap-2">
          {t('Your products', '您的产品')}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            type="button" variant="soft" size="none"
            className="rounded-lg py-[6px] px-[14px] text-[13px] whitespace-nowrap"
            onClick={() => setCategoriesOpen(true)}
          >
            {t('Categories', '分类')}
          </Button>
          <Button
            type="button" variant="soft" size="none"
            className="rounded-lg py-[6px] px-[14px] text-[13px] whitespace-nowrap"
            onClick={() => setImportOpen(true)}
          >
            {t('Import from a photo', '从照片导入')}
          </Button>
          <Button data-tour="add-product" type="button" size="none" className="rounded-lg py-[6px] px-[14px] text-[13px] whitespace-nowrap" onClick={openAdd}>
            {t('+ Add product', '+ 添加产品')}
          </Button>
        </div>
      </div>

      <MenuImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        merchantId={merchant!.id}
        currency={currency}
        categories={categories}
        unitItems={UNITS.map(u => ({ value: u.value, label: t(u.en, u.zh) }))}
        t={t}
        onSaved={load}
        onCategoriesChanged={refreshMerchant}
      />

      <MenuCategoriesDialog
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        value={categories}
        counts={categoryCounts}
        saving={categoriesSaving}
        onSave={saveCategories}
        t={t}
      />

      {rows.length === 0 ? (
        <Empty className="border-[0.5px] border-dashed border-border bg-background/50">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="bg-brand-100 text-primary">
              <Package />
            </EmptyMedia>
            <EmptyTitle className="text-primary">{t('No products yet', '还没有产品')}</EmptyTitle>
            <EmptyDescription className="text-muted-foreground">
              {t('Add your first product to start taking orders in your storefront.', '添加第一个产品，开始在店面接收订单。')}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {/* Both offered, with the import first: this is the screen a shop with a printed menu
                and no products is looking at, and typing forty items by hand is where trials
                stall. Adding by hand stays one press away for a shop with three items. */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button" size="none"
                className="rounded-lg py-[6px] px-[14px] text-[13px]"
                onClick={() => setImportOpen(true)}
              >
                {t('Import from a photo', '从照片导入')}
              </Button>
              <Button
                type="button" variant="soft" size="none"
                className="rounded-lg py-[6px] px-[14px] text-[13px]"
                onClick={openAdd}
              >
                {t('+ Add product', '+ 添加产品')}
              </Button>
            </div>
          </EmptyContent>
        </Empty>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          meta={meta}
          searchPlaceholder={t('Search products…', '搜索产品…')}
          emptyText={t('No products match your search.', '没有匹配的产品。')}
          prevLabel={t('Previous', '上一页')}
          nextLabel={t('Next', '下一页')}
        />
      )}

      {/* Add / edit product details. disablePointerDismissal: the unit Select
          portals its menu to <body>, so an item click would otherwise read as an
          outside-press and close the dialog. Close via the X, Save, or Escape. */}
      <Dialog open={formOpen} onOpenChange={setFormOpen} disablePointerDismissal>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProduct ? t('Edit product', '编辑产品') : t('Add a product', '添加产品')}</DialogTitle>
          </DialogHeader>
          {msg && (
            <div className="text-[13px] text-ink-700 bg-brand-100 border border-border rounded-sm px-[13px] py-[10px] mb-[10px] leading-[1.5]">
              {msg}
            </div>
          )}
          <form onSubmit={save}>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-[6px]">
                <Label htmlFor="pm-1">{t('Name', '名称')}</Label>
                <Input
                  id="pm-1"
                  variant="compact"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder={t('e.g. Brown Butter Cookie', '如：焦化奶油曲奇')}
                />
              </div>
              <div className="flex flex-col gap-[6px]">
                <Label htmlFor="pm-2">{t('Chinese name (optional)', '中文名称（可选）')}</Label>
                <Input
                  id="pm-2"
                  variant="compact"
                  value={form.name_zh}
                  onChange={e => setForm({ ...form, name_zh: e.target.value })}
                  placeholder="e.g. 焦化奶油曲奇"
                />
              </div>
              {/* Up here with the names, not down beside Photos. Which section a product belongs
                  to is part of WHAT IT IS, and it was landing below the promo block and the photo
                  picker — past the fold on a laptop, so the merchant met it only after they had
                  finished thinking about the product. Identity first, then price, then media. */}
              <div className="flex flex-col gap-[6px] min-w-0">
                <Label htmlFor="pm-category">{t('Category (optional)', '分类（可选）')}</Label>
                <Select
                  value={form.category_id}
                  onValueChange={v => {
                    // The inline create. Writing the shop's list mid-product-edit is a second,
                    // separate save, so a product save that then fails leaves an empty category
                    // behind — benign, because a category holding nothing renders nothing.
                    if (v === NEW_CATEGORY) { setNewCategory(''); return }
                    setNewCategory(null)
                    setForm({ ...form, category_id: v ?? '' })
                  }}
                  items={categoryItems}
                >
                  <SelectTrigger id="pm-category" className="bg-background border-border text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-modal-popover">
                    {categoryItems.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {newCategory !== null && (
                  <div className="flex gap-2">
                    <Input
                      variant="compact"
                      autoFocus
                      value={newCategory}
                      maxLength={MENU_CATEGORY_NAME_MAX}
                      onChange={e => setNewCategory(e.target.value)}
                      // Enter inside a form submits it, and the product is not what is being
                      // saved here. Create the category instead.
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void createCategory() } }}
                      placeholder={t('New category name', '新分类名称')}
                      aria-label={t('New category name', '新分类名称')}
                    />
                    <Button
                      type="button" size="none"
                      className="rounded-lg px-[14px] text-[13px] whitespace-nowrap"
                      disabled={categoriesSaving || newCategory.trim() === ''}
                      onClick={() => void createCategory()}
                    >{categoriesSaving ? t('Saving…', '保存中…') : t('Create', '创建')}</Button>
                  </div>
                )}
                <span className="text-[12px] text-muted-foreground">
                  {t('Products with no category are listed last on your storefront, without a heading.',
                     '未分类的产品会排在店面最后，且不带标题。')}
                </span>
              </div>
              <div className="flex flex-col gap-[6px]">
                <Label htmlFor="pm-3">{t('Description', '描述')}</Label>
                <Textarea
                  id="pm-3"
                  value={form.descr}
                  onChange={e => setForm({ ...form, descr: e.target.value })}
                  placeholder={t('Short description (optional)', '简短描述（可选）')}
                  className="bg-background text-[13px] rounded-sm py-[7px] px-2.5 min-h-0"
                />
              </div>
              <div className="flex flex-col gap-[6px]">
                <Label htmlFor="pm-4">{t(`Price (${symbol})`, `价格 (${symbol})`)}</Label>
                <Input
                  id="pm-4"
                  variant="compact"
                  type="number"
                  step="0.01"
                  value={form.price}
                  onChange={e => setForm({ ...form, price: e.target.value })}
                  required
                  placeholder="0.00"
                />
              </div>
              <div className="flex flex-col gap-[6px]">
                <Label htmlFor="pm-5">{t('Unit', '单位')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="pm-qty"
                    variant="compact"
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="w-24"
                    value={form.unit_quantity}
                    onChange={e => setForm({ ...form, unit_quantity: e.target.value })}
                    aria-label={t('Unit quantity', '单位数量')}
                    placeholder="1"
                  />
                  <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v ?? form.unit })} items={unitItems}>
                    <SelectTrigger id="pm-5" className="flex-1 bg-background border-border text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    {/* z-modal-popover (400) floats above the dialog popup (z-modal). */}
                    <SelectContent className="z-modal-popover">
                      {unitItems.map(u => (
                        <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="contents">
                <div className="flex flex-col gap-[6px]">
                  <Label htmlFor="pm-promo-price">{t('Promo price', '优惠价')}</Label>
                  <Input
                    id="pm-promo-price"
                    variant="compact"
                    type="number"
                    step="0.01"
                    value={form.promo_price}
                    onChange={e => setForm({ ...form, promo_price: e.target.value })}
                    placeholder="0.00"
                  />
                  <span className="text-[12px] text-muted-foreground">{t('Leave empty for no promo.', '留空表示无优惠。')}</span>
                </div>
                <div className="flex flex-col gap-[6px]">
                  <Label htmlFor="pm-promo-limit">{t('Promo limit', '优惠数量上限')}</Label>
                  <Input
                    id="pm-promo-limit"
                    variant="compact"
                    type="number"
                    step="1"
                    min="1"
                    value={form.promo_limit}
                    onChange={e => setForm({ ...form, promo_limit: e.target.value })}
                    placeholder={t('No limit', '不限')}
                  />
                  <span className="text-[12px] text-muted-foreground">
                    {t('How many units sell at this price. Leave empty for no limit.', '以此价格出售的数量。留空表示不限。')}
                  </span>
                </div>
                <div className="flex flex-col gap-[6px]">
                  <Label htmlFor="pm-promo-end">{t('Promo ends', '优惠结束日期')}</Label>
                  {/* `clearable`, unlike the voucher expiry: there is no enclosing checkbox here,
                      so this is the ONLY way back to "no end date" — and the native input this
                      replaced had the browser's own clear control. */}
                  <DateField
                    id="pm-promo-end"
                    value={form.promo_end}
                    onChange={iso => setForm({ ...form, promo_end: iso })}
                    tz={merchant?.timezone as string | undefined}
                    t={t}
                    lang={lang}
                    clearable
                    placeholder={t('No end date', '无结束日期')}
                  />
                  <span className="text-[12px] text-muted-foreground">
                    {t('The promo runs to the end of this day. Leave empty for no end date.', '优惠持续到当天结束。留空表示无结束日期。')}
                  </span>
                </div>
              </div>
              {editingProduct && editingProduct.promo_price !== null && editingProduct.promo_price !== undefined && (() => {
                // M-1: `promo_sold` can outlive a LOWERED `promo_limit` — sell 8 against a cap of
                // 10, then drop the cap to 3, and the row is `promo_sold: 8, promo_limit: 3`.
                // Money is unaffected (`remaining = max(0, 3-8) = 0`, so the promo just ends), but
                // the raw numbers read as "8 of 3 sold", which looks broken. Clamp the DISPLAY to
                // the cap and say the promo is finished — the DB row itself is untouched.
                const sold = editingProduct.promo_sold ?? 0
                const limit = editingProduct.promo_limit
                const capReached = limit != null && sold >= limit
                const shownSold = limit != null ? Math.min(sold, limit) : sold
                return (
                  <p className="text-[12px] text-muted-foreground">
                    {limit
                      ? t(`${shownSold} of ${limit} sold at the promo price.`,
                          `已以优惠价售出 ${shownSold} / ${limit} 件。`)
                      : t(`${sold} sold at the promo price.`,
                          `已以优惠价售出 ${sold} 件。`)}
                    {' '}
                    {t('Changing the promo price starts the count again.', '更改优惠价将重新计数。')}
                    {capReached && (
                      <>
                        {' '}
                        {t('This promo is finished — the cap has been reached.', '此优惠已结束——已达上限。')}
                      </>
                    )}
                    {promoEnded && (
                      <>
                        {' '}
                        {t('This promo has ended.', '此优惠已结束。')}
                      </>
                    )}
                  </p>
                )
              })()}
              <div className="flex flex-col gap-[6px]">
                <Label>{t('Photos (optional)', '图片（可选）')}</Label>
                <ImagePicker
                  merchantId={merchant!.id}
                  productId={editingProduct ? editingProduct.id : draftId}
                  value={images}
                  onChange={paths => {
                    setImages(paths as string[])
                    // Edit mode: the row exists, so persist immediately — that way a
                    // removed photo isn't left dangling if the dialog is cancelled.
                    if (editingProduct) return setProductImages(editingProduct, paths as string[])
                  }}
                  t={t}
                />
              </div>
              <div className="flex flex-col gap-[6px] min-w-0">
                <Label>{t('Options (optional)', '选项（可选）')}</Label>
                <OptionGroupsEditor
                  // Keyed on the product, so each one gets its own editor. `open` is seeded from
                  // `value.length` on MOUNT only, so without this a new product inherited the
                  // expanded editor of whichever product was edited before it.
                  key={editingProduct?.id ?? draftId}
                  value={optionGroups}
                  onChange={setOptionGroups}
                  currency={currency}
                  t={t}
                  copyFrom={rows
                    .filter(p => p.id !== editingProduct?.id
                      && optionGroupsFromRow(p.option_groups).length > 0)
                    .map(p => ({
                      id: p.id,
                      name: (lang === 'zh' && p.name_zh) ? p.name_zh : p.name,
                      groups: optionGroupsFromRow(p.option_groups),
                    }))}
                />
              </div>
              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="flex flex-col">
                  <Label htmlFor="pm-active">{t('Visible in storefront', '在店面显示')}</Label>
                  <span className="text-[12px] text-muted-foreground">
                    {form.active ? t('Customers can order this', '顾客可下单') : t('Hidden from customers', '对顾客隐藏')}
                  </span>
                </div>
                <button
                  id="pm-active"
                  type="button"
                  role="switch"
                  aria-checked={form.active}
                  onClick={() => setForm({ ...form, active: !form.active })}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill transition-colors cursor-pointer ${form.active ? 'bg-primary' : 'bg-border'}`}
                >
                  <span className={`inline-block size-5 rounded-pill bg-white shadow-sm transition-transform ${form.active ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>
            <Button type="submit" size="md" className="mt-4 w-full" disabled={busy}>
              {busy ? t('Saving…', '保存中…') : editingProduct ? t('Save changes', '保存更改') : t('Add product', '添加产品')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={o => { if (!o) setPendingDelete(null) }}
        title={t('Delete this product?', '删除此产品？')}
        body={
          <p>
            {t(
              `“${pendingDelete ? productLabel(pendingDelete) : ''}” disappears from your storefront and cannot be brought back. Orders already placed keep their record of it.`,
              `“${pendingDelete ? productLabel(pendingDelete) : ''}” 将从店面消失且无法恢复。已下的订单仍保留该记录。`,
            )}
          </p>
        }
        confirmLabel={t('Delete product', '删除产品')}
        onConfirm={async () => { if (pendingDelete) await remove(pendingDelete) }}
      />
    </div>
  )
}
