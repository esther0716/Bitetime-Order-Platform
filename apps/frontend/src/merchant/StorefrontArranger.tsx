import { useCallback, useEffect, useState } from 'react'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, EyeOff, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from '../SessionContext'
import { lookupProducts, saveProductOrder, updateMerchantConfig } from '../store'
import { formatMoney } from '../currency'
import { formatUnit } from '../productUnit'
import { menuCategoriesFromRow } from '@bitetime/shared'
import type { MenuCategory } from '@bitetime/shared'
import { Button } from '../components/ui/button'
import { SkeletonText } from '../components/Loaders'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '../components/ui/empty'
import MenuRow from '../components/MenuRow'
import MenuCategoriesDialog from './MenuCategoriesDialog'
import { useNavGuard } from './NavGuard'
import {
  arrangeMenu, reseedCategories, moveProduct, moveCategory, findProduct, resolveDropTarget,
  categoriesOf, productOrderPatch, arrangementKeys, categoryDragId, blockDropId,
  type ArrangedBlock,
} from './menuArrangement'
import { cn } from '@/lib/utils'

/**
 * The merchant arranging their own storefront (spec 2026-08-17).
 *
 * The drag surface IS the preview: every row is the same `MenuRow` the storefront draws, at phone
 * width. A merchant judging order and layout is looking at the real thing rather than at a
 * representation of it that can drift.
 *
 * What it is deliberately NOT faithful about is VISIBILITY. Hidden products and hidden categories
 * are drawn, tagged. A merchant must be able to file an item into a section that is switched off —
 * that is what a seasonal section is for — and cannot if the section is not on screen. The tags are
 * what stop the screen reading as a promise about what a customer sees.
 *
 * Every rule lives in `menuArrangement.ts`. This file holds state, dnd-kit wiring and markup.
 */

/** The product shape this screen reads. The rows arrive from the API as `any`, as everywhere else. */
interface Row {
  id: string
  category_id?: string | null
  name: string
  name_zh?: string | null
  descr?: string | null
  price: number
  unit?: string | null
  unit_quantity?: number | null
  active: boolean
  image_urls?: string[] | null
}

export default function StorefrontArranger() {
  const { t, lang, merchant, refreshMerchant } = useSession()
  const { registerBlocker } = useNavGuard()

  const [blocks, setBlocks] = useState<ArrangedBlock<Row>[] | null>(null)
  const [saved, setSaved] = useState({ categories: '', products: '' })
  const [saving, setSaving] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [categoriesSaving, setCategoriesSaving] = useState(false)

  const merchantId = merchant!.id
  const currency = merchant?.currency
  const storedCategories = merchant?.product_categories

  // Seeded ONCE, from the products read plus the row the session already holds. Re-seeding whenever
  // the merchant row changes would throw away unsaved drags every time `refreshMerchant` ran — and
  // this screen calls that itself, after every save.
  useEffect(() => {
    let live = true
    lookupProducts(merchantId).then(r => {
      if (!live) return
      const rows = (r.ok ? r.data : []) as Row[]
      const next = arrangeMenu(rows, menuCategoriesFromRow(storedCategories))
      setBlocks(next)
      setSaved(arrangementKeys(next))
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeding is a one-shot, not a subscription
  }, [merchantId])

  const keys = blocks ? arrangementKeys(blocks) : saved
  const dirty = keys.categories !== saved.categories || keys.products !== saved.products

  // The same guard ShopSettings registers, so the sidebar cannot silently discard a rearrangement.
  useEffect(() => {
    registerBlocker(() => dirty)
    return () => registerBlocker(null)
  }, [dirty, registerBlocker])

  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const sensors = useSensors(
    // A small distance, so a tap on a row is still a tap and not the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragOver = useCallback((e: DragOverEvent) => {
    const { active, over } = e
    if (!over || active.data.current?.type !== 'product') return
    setBlocks(bs => {
      if (!bs) return bs
      const from = findProduct(bs, String(active.id))
      const to = resolveDropTarget(bs, String(over.id))
      // Only a CROSS-BLOCK move is applied here. Within one block dnd-kit's own sorting preview is
      // enough, and applying it on every over-event fights the animation.
      if (!from || !to || from.block === to.block) return bs
      return moveProduct(bs, from, to)
    })
  }, [])

  const onDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e
    if (!over) return
    setBlocks(bs => {
      if (!bs) return bs
      if (active.data.current?.type === 'category') {
        const named = categoriesOf(bs)
        const from = named.findIndex(c => categoryDragId(c.id) === active.id)
        const to = named.findIndex(c => categoryDragId(c.id) === over.id)
        // A section dropped on the trailing block resolves to no index and is left where it was.
        return from === -1 || to === -1 ? bs : moveCategory(bs, from, to)
      }
      const from = findProduct(bs, String(active.id))
      const to = resolveDropTarget(bs, String(over.id))
      return from && to ? moveProduct(bs, from, to) : bs
    })
  }, [])

  /**
   * Save. Products first, then the categories.
   *
   * The two are not atomic together, and that order is the choice: a wrong item order under correct
   * headings is a smaller wrong than headings naming sections whose items never moved. Both writes
   * are idempotent, so a failure keeps the draft and keeps it dirty — Save retries the whole thing.
   */
  async function save() {
    if (!blocks) return
    setSaving(true)
    const order = await saveProductOrder(merchantId, productOrderPatch(blocks))
    if (!order.ok) {
      setSaving(false)
      toast.error(order.error.message || t('Could not save the order', '无法保存顺序'))
      return
    }
    const patched = await updateMerchantConfig(merchantId, { product_categories: categoriesOf(blocks) })
    setSaving(false)
    if (!patched.ok) {
      toast.error(t('The item order is saved, but the sections are not. Press Save again.',
                    '产品顺序已保存，但分类未保存。请再次保存。'))
      return
    }
    await refreshMerchant()
    setSaved(arrangementKeys(blocks))
    toast.success(t('Storefront saved', '店面已保存'))
  }

  /**
   * The categories dialog writes on its own, immediately.
   *
   * It is seeded from the DRAFT, so a rename made after a drag saves the dragged order too. Then
   * the draft keeps every product where it is (`reseedCategories`), and only the category half of
   * the saved key moves — a dirty product order stays dirty.
   */
  async function saveCategories(next: MenuCategory[]): Promise<boolean> {
    setCategoriesSaving(true)
    const r = await updateMerchantConfig(merchantId, { product_categories: next })
    setCategoriesSaving(false)
    if (!r.ok) {
      toast.error(r.error.message || t('Could not save categories', '无法保存分类'))
      return false
    }
    await refreshMerchant()
    setBlocks(bs => (bs ? reseedCategories(bs, next) : bs))
    setSaved(s => ({ ...s, categories: JSON.stringify(next) }))
    toast.success(t('Categories saved', '分类已保存'))
    return true
  }

  if (!blocks) return (
    <div className="bg-card border-[0.5px] border-border rounded-2xl p-5 mb-8 w-full box-border">
      <SkeletonText lines={4} />
    </div>
  )

  const total = blocks.reduce((n, b) => n + b.products.length, 0)
  const counts = Object.fromEntries(
    blocks.filter(b => b.category).map(b => [b.category!.id, b.products.length]),
  )

  return (
    // The same card the other dashboard sections are drawn in. The MENU inside it is capped at
    // phone width, because that is the width the merchant is previewing.
    <div className="bg-card border-[0.5px] border-border rounded-2xl p-5 mb-8 w-full box-border">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="font-heading text-[15px] font-medium text-primary flex items-center gap-2">
          {t('Your storefront', '您的店面')}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            type="button" variant="soft" size="none"
            className="rounded-lg py-[6px] px-[14px] text-[13px] whitespace-nowrap"
            onClick={() => setCategoriesOpen(true)}
          >
            <Settings2 className="size-4 mr-1" />
            {t('Categories', '分类')}
          </Button>
          <Button
            type="button" size="none"
            className="rounded-lg py-[6px] px-[14px] text-[13px] whitespace-nowrap"
            onClick={save}
            disabled={!dirty || saving}
          >
            {saving ? t('Saving…', '保存中…') : t('Save', '保存')}
          </Button>
        </div>
      </div>

      <p className="text-[12px] text-muted-foreground leading-[1.6] mb-4 max-w-[560px]">
        {t('Drag to arrange your menu. Customers see this order. Hidden items and hidden categories are shown here, marked — customers do not see them.',
           '拖动即可排列菜单，顾客看到的就是此顺序。已隐藏的产品和分类在此显示并标注，顾客看不到。')}
      </p>

      {total === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('No products yet', '暂无产品')}</EmptyTitle>
            <EmptyDescription>
              {t('Add products first. They appear here to arrange.', '请先添加产品，然后在此排列。')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          {/* The trailing block's id rides in this list even though the block cannot be dragged
              (its `useSortable` is disabled): dnd-kit warns about a sortable whose id its context
              does not hold. A section dropped ON it resolves to no index and is left alone. */}
          <SortableContext
            items={[...categoriesOf(blocks).map(c => categoryDragId(c.id)), categoryDragId('trailing')]}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-4 max-w-[560px]">
              {blocks.map((block, i) => (
                <Block
                  key={block.category?.id ?? 'trailing'}
                  block={block}
                  index={i}
                  lang={lang}
                  currency={currency}
                  t={t}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <MenuCategoriesDialog
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        value={categoriesOf(blocks)}
        counts={counts}
        saving={categoriesSaving}
        onSave={saveCategories}
        t={t}
      />
    </div>
  )
}

/** One section, or the trailing un-headed block. */
function Block({
  block, index, lang, currency, t,
}: {
  block: ArrangedBlock<Row>
  index: number
  lang: string
  currency?: string
  t: (en: string, zh: string) => string
}) {
  // The trailing block has no heading to drag by, so it is not sortable — it is drawn last always.
  const category = block.category
  // DESTRUCTURED at the call, not held as one object: `useSortable` hands back a ref callback among
  // its fields, and the compiler's lint reads `sortable.anything` during render as reading a ref.
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({
    id: categoryDragId(category?.id ?? 'trailing'),
    data: { type: 'category' },
    disabled: !category,
  })
  // Every block is a droppable, so an EMPTY section still accepts a product.
  const { setNodeRef: setDropRef } = useDroppable({ id: blockDropId(index) })

  return (
    <div
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && 'opacity-60')}
    >
      {category ? (
        // `setNodeRef` goes on the HEADING, not on the block wrapper, and that placement is
        // load-bearing. dnd-kit resolves a drop from the measured rects, and a wrapper's rect
        // covers every product inside it — so a product dragged over another product resolved to
        // the SECTION (the end of the block) instead of the slot under the cursor. Measured on the
        // heading strip, the section competes only where a section should: at its own heading.
        <div ref={setNodeRef} className="flex items-center gap-1 mb-2">
          <button
            type="button"
            className="size-8 rounded-lg flex items-center justify-center cursor-grab text-muted-foreground hover:text-foreground touch-none"
            aria-label={t('Move category', '移动分类')}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <span className="text-[13px] font-semibold text-foreground">
            {(lang === 'zh' && category.name_zh) || category.name}
          </span>
          {!category.active && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <EyeOff className="size-3" />
              {t('hidden', '已隐藏')}
            </span>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground mb-2">
          {t('No category — listed last, without a heading', '未分类 — 排在最后，不带标题')}
        </div>
      )}

      <SortableContext items={block.products.map(p => p.id)} strategy={verticalListSortingStrategy}>
        <div ref={setDropRef} className="flex flex-col gap-[10px] min-h-[52px] rounded-xl">
          {block.products.length === 0 && (
            <div className="text-[12px] text-muted-foreground italic border-[0.5px] border-dashed border-border rounded-xl py-4 text-center">
              {t('Drop products here', '将产品拖到此处')}
            </div>
          )}
          {block.products.map(p => (
            <ProductRow key={p.id} product={p} lang={lang} currency={currency} t={t} />
          ))}
        </div>
      </SortableContext>
    </div>
  )
}

/** One product, drawn as the storefront draws it, with a handle and no cart. */
function ProductRow({
  product, lang, currency, t,
}: {
  product: Row
  lang: string
  currency?: string
  t: (en: string, zh: string) => string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: product.id,
    data: { type: 'product' },
  })
  const unit = formatUnit(product.unit_quantity, product.unit || t('unit', '个'))
  const name = (lang === 'zh' && product.name_zh) || product.name

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && 'opacity-60')}
    >
      <MenuRow
        imagePaths={product.image_urls ?? []}
        title={
          <span className="flex items-center gap-2">
            {name}
            {!product.active && (
              <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                <EyeOff className="size-3" />
                {t('hidden', '已隐藏')}
              </span>
            )}
          </span>
        }
        subtitle={product.descr || undefined}
        meta={
          <div className="text-[13px] font-medium text-primary mt-[5px]">
            {formatMoney(product.price, currency)} / {unit}
          </div>
        }
        className={cn(!product.active && 'opacity-60')}
        trailing={
          <button
            type="button"
            className="size-9 rounded-lg flex items-center justify-center cursor-grab text-muted-foreground hover:text-foreground touch-none"
            aria-label={t('Move product', '移动产品')}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        }
      />
    </div>
  )
}
