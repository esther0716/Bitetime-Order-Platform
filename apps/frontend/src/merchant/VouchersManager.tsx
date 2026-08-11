import { useEffect, useState } from 'react'
import { Ticket } from 'lucide-react'
import { useSession } from '../SessionContext'
import { toast } from 'sonner'
import { fetchMerchantVouchers, createMerchantVoucher, deleteMerchantVoucher } from '../store'
import { formatMoney, currencyDef } from '../currency'
import { SkeletonText } from '../components/Loaders'
import ConfirmDialog from '../components/ConfirmDialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '../components/ui/empty'
import type { Voucher } from '../types'

const BLANK = { code: '', kind: 'percent', amount: '', maxUses: '' }

// Unambiguous alphabet (no 0/O/1/I) so codes read cleanly aloud
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function randomChars(len: number) {
  let out = ''
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return out
}
// Per-merchant voucher code: <SLUG-PREFIX>-XXXXX — prefix keeps codes unique across shops
function voucherPrefix(slug: string) {
  const alnum = String(slug ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return alnum.slice(0, 4) || 'SHOP'
}
function generateVoucherCode(slug: string) {
  return `${voucherPrefix(slug)}-${randomChars(5)}`
}

export default function VouchersManager() {
  const { t, merchant } = useSession()
  const [rows, setRows] = useState<Voucher[] | null>(null)
  const [form, setForm] = useState<any>(BLANK)
  const [busy, setBusy] = useState(false)
  // The voucher a Delete button is asking about; null → no confirm open.
  const [pendingDelete, setPendingDelete] = useState<Voucher | null>(null)
  const currency = merchant?.currency
  const symbol = currencyDef(currency).symbol

  // Annotated, not inferred: `form` is `any`, so nothing else here would catch a typo'd kind.
  const kindItems: { value: 'percent' | 'fixed'; label: string }[] = [
    { value: 'percent', label: t('Percentage (%)', '百分比 (%)') },
    { value: 'fixed', label: t(`Fixed amount (${symbol})`, `固定金额 (${symbol})`) },
  ]

  // Parity with the old `[]`-on-failure behaviour: a dashboard list that could not load shows
  // empty rather than a stuck spinner. The load-bearing could-not-ask handling lives on the
  // customer path (Storefront), not here.
  async function load() {
    const r = await fetchMerchantVouchers(merchant!.id)
    setRows(r.ok ? r.data : [])
  }
  useEffect(() => { fetchMerchantVouchers(merchant!.id).then(r => setRows(r.ok ? r.data : [])) }, [merchant!.id])

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true)
    const r = await createMerchantVoucher({
      merchantId: merchant!.id,
      code: form.code,
      kind: form.kind,
      amount: Number(form.amount) || 0,
      maxUses: form.maxUses === '' ? null : Number(form.maxUses),
    })
    setBusy(false)
    if (r.ok) {
      setForm(BLANK); await load()
      toast.success(t('Voucher created', '优惠券已创建'))
    } else {
      toast.error(t('Could not create voucher — is the code already used?', '无法创建优惠券 — 优惠码是否已存在？'))
    }
  }

  async function remove(id: string) {
    const r = await deleteMerchantVoucher(id, merchant!.id)
    if (r.ok) {
      await load()
      toast.success(t('Voucher deleted', '优惠券已删除'))
    } else {
      toast.error(t('Could not delete voucher', '无法删除优惠券'))
    }
  }

  function valueLabel(v: Voucher) {
    const value = (v as any).value
    return (v as any).type === 'percent' ? `${value}% off` : `${formatMoney(value, currency)} off`
  }
  function usesLabel(v: Voucher) {
    const used = Array.isArray(v.usedBy) ? v.usedBy.length : 0
    const cap = v.maxUses == null ? '∞' : v.maxUses
    return t(`${used} / ${cap} used`, `已用 ${used} / ${cap}`)
  }

  if (!rows) return (
    <div className="bg-card border-[0.5px] border-border rounded-2xl p-5 mb-8 w-full box-border">
      <SkeletonText lines={4} />
    </div>
  )

  return (
    <div>
      {/* Your vouchers panel */}
      <div className="bg-card border-[0.5px] border-border rounded-2xl p-5 mb-8 w-full box-border">
        <h3 className="font-heading text-[15px] font-medium text-primary mb-4 flex items-center gap-2">
          {t('Your vouchers', '您的优惠券')}
        </h3>
        {rows.length === 0 ? (
          <Empty className="border-[0.5px] border-dashed border-border bg-background/50">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="bg-brand-100 text-primary">
                <Ticket />
              </EmptyMedia>
              <EmptyTitle className="text-primary">{t('No vouchers yet', '还没有优惠券')}</EmptyTitle>
              <EmptyDescription className="text-muted-foreground">
                {t('Create your first voucher below to offer discounts at checkout.', '在下方创建第一张优惠券，为结账提供折扣。')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((v: Voucher) => (
              <div
                key={(v as any).id}
                className="flex items-center gap-3 px-[14px] py-[10px] bg-background border-[0.5px] border-border rounded-lg transition-colors max-[480px]:flex-wrap"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-foreground flex items-center gap-2 flex-wrap">
                    {v.code}
                    {/* A voucher a shop's customers already hold, which no longer redeems
                        because the shop stepped down from Pro. Shown rather than hidden: the
                        merchant needs to know the codes they have handed out are dead, and a
                        silently missing row reads as a bug in the dashboard. */}
                    {(v as any).active === false && (
                      <Badge variant="outline" className="uppercase tracking-[0.08em]">
                        {t('Inactive', '已停用')}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[12px] text-muted-foreground mt-0.5">{valueLabel(v)} · {usesLabel(v)}</div>
                </div>
                <div className="flex gap-[6px] shrink-0 max-[480px]:w-full max-[480px]:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="none"
                    className="rounded-pill py-[5px] px-3 text-[12px] bg-card whitespace-nowrap hover:border-primary hover:text-primary hover:bg-brand-100"
                    onClick={() => setPendingDelete(v)}
                  >
                    {t('Delete', '删除')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create a voucher panel */}
      <div className="bg-card border-[0.5px] border-border rounded-2xl p-5 mb-8 w-full box-border">
        <h3 className="font-heading text-[15px] font-medium text-primary mb-4 flex items-center gap-2">
          {t('Create a voucher', '创建优惠券')}
        </h3>
        <form onSubmit={save}>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-[6px]">
              <Label htmlFor="vm-code">{t('Code', '优惠码')}</Label>
              <div className="flex gap-2">
                <Input
                  id="vm-code"
                  variant="compact"
                  className="flex-1"
                  value={form.code}
                  onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  required
                  placeholder={t('e.g. SAVE10', '如：SAVE10')}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="none"
                  className="shrink-0 rounded-sm px-3 text-[12px] bg-card whitespace-nowrap hover:border-primary hover:text-primary hover:bg-brand-100"
                  onClick={() => setForm({ ...form, code: generateVoucherCode(merchant!.slug) })}
                >
                  {t('Generate', '生成')}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-[6px]">
              <Label htmlFor="vm-kind">{t('Type', '类型')}</Label>
              <Select
                value={form.kind}
                onValueChange={v => setForm({ ...form, kind: v ?? form.kind })}
                items={kindItems}
              >
                <SelectTrigger id="vm-kind" className="w-full bg-background text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kindItems.map(i => (
                    <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-[6px]">
              <Label htmlFor="vm-amount">
                {form.kind === 'percent' ? t('Percent off', '折扣百分比') : t(`Amount off (${symbol})`, `折扣金额 (${symbol})`)}
              </Label>
              <Input
                id="vm-amount"
                variant="compact"
                type="number"
                step={form.kind === 'percent' ? '1' : '0.01'}
                value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })}
                required
                placeholder={form.kind === 'percent' ? '10' : '5.00'}
              />
            </div>
            <div className="flex flex-col gap-[6px]">
              <Label htmlFor="vm-max">{t('Max total uses (blank = unlimited)', '最大使用次数（留空 = 不限）')}</Label>
              <Input
                id="vm-max"
                variant="compact"
                type="number"
                step="1"
                value={form.maxUses}
                onChange={e => setForm({ ...form, maxUses: e.target.value })}
                placeholder={t('unlimited', '不限')}
              />
            </div>
          </div>
          <Button type="submit" size="md" className="mt-3" disabled={busy}>
            {busy ? t('Saving…', '保存中…') : t('Create voucher', '创建优惠券')}
          </Button>
        </form>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={o => { if (!o) setPendingDelete(null) }}
        title={t('Delete this voucher?', '删除此优惠券？')}
        body={
          <p>
            {t(
              `Code ${pendingDelete?.code ?? ''} stops working at checkout, and any customer already holding it can no longer redeem it. This cannot be undone.`,
              `优惠码 ${pendingDelete?.code ?? ''} 将在结账时失效，已持有该码的顾客也无法再使用。此操作无法撤销。`,
            )}
          </p>
        }
        confirmLabel={t('Delete voucher', '删除优惠券')}
        onConfirm={async () => { if (pendingDelete) await remove((pendingDelete as any).id) }}
      />
    </div>
  )
}
