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
import { Checkbox } from '../components/ui/checkbox'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '../components/ui/empty'
import type { Voucher } from '../types'

/**
 * The blank form.
 *
 * The four `limit*` booleans are the DISCLOSURE state, not the values. Stripe's coupon screen is
 * the shape being followed: three fields visible, everything else behind a checkbox that reveals
 * its input, so the common voucher — a percent off, unlimited, one each — stays a 30-second job
 * rather than a form with four blanks the merchant has to decide to leave blank.
 *
 * Read the two "off" meanings carefully, because they are OPPOSITE and the labels have to say so:
 * total uses unchecked means UNLIMITED, per-customer unchecked means ONE EACH.
 */
const BLANK = {
  code: '', kind: 'percent', amount: '',
  limitTotal: false, maxUses: '',
  limitPerCustomer: false, perCustomerLimit: '2',
  limitExpiry: false, expiresOn: '',
  limitMinOrder: false, minOrder: '',
}

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

/**
 * One checkbox that reveals its own inputs.
 *
 * A component rather than four copies because the pattern is the thing being repeated, and
 * because the reveal must be CONDITIONAL RENDER, not a hidden div: a hidden `<input>` still
 * submits, still validates and still takes focus from a keyboard, so an unticked limit would
 * block the form on a value the merchant cannot see.
 */
function Disclosure({ id, checked, onCheckedChange, label, children }: {
  id: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Checkbox id={id} checked={checked} onCheckedChange={v => onCheckedChange(v === true)} />
        <Label htmlFor={id} className="text-[13px] font-normal cursor-pointer">{label}</Label>
      </div>
      {checked && <div className="ml-6 flex flex-col gap-[6px]">{children}</div>}
    </div>
  )
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
    // An unchecked box sends null, never the value still sitting in the input behind it — a
    // merchant who types an expiry, changes their mind and unticks it must not get that expiry.
    const r = await createMerchantVoucher({
      merchantId: merchant!.id,
      code: form.code,
      kind: form.kind,
      amount: Number(form.amount) || 0,
      maxUses: form.limitTotal && form.maxUses !== '' ? Number(form.maxUses) : null,
      // Unchecked is ONE each — the rule every voucher predating this form was created under.
      // Checked with a blank input is unlimited, which is the whole of what #241 asked for.
      perCustomerLimit: !form.limitPerCustomer ? 1 : form.perCustomerLimit === '' ? null : Number(form.perCustomerLimit),
      expiresOn: form.limitExpiry && form.expiresOn !== '' ? form.expiresOn : null,
      minOrder: form.limitMinOrder && form.minOrder !== '' ? Number(form.minOrder) : null,
    })
    setBusy(false)
    if (r.ok) {
      setForm(BLANK); await load()
      toast.success(t('Voucher created', '优惠券已创建'))
    } else if (r.error?.code === 'unbounded_voucher') {
      // The one refusal a merchant can reach by ticking boxes, so it gets its own sentence rather
      // than the generic one. Unlimited per customer AND unlimited in total is an unlimited
      // discount for one person.
      toast.error(t(
        'Set a total limit when one customer may use a voucher any number of times.',
        '当一位顾客可无限次使用优惠券时，必须设置总使用次数上限。',
      ))
    } else if (r.error?.code === 'duplicate_code') {
      toast.error(t('That code is already in use.', '该优惠码已被使用。'))
    } else {
      toast.error(t('Could not create voucher.', '无法创建优惠券。'))
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
    // The API's count. It never sends the redeemer list any more, to the merchant either — a
    // shop sees shop-scoped facts and no account email (CONTEXT.md -> Shop customer).
    const used = v.usedCount ?? 0
    const cap = v.maxUses == null ? '∞' : v.maxUses
    return t(`${used} / ${cap} used`, `已用 ${used} / ${cap}`)
  }

  /**
   * The restrictions, as short clauses. Only what the merchant actually set is drawn — a row
   * reading "1 per customer · no expiry · no minimum" states three non-facts and buries the one
   * voucher on the list that does have a rule.
   */
  function restrictionLabels(v: Voucher): string[] {
    const out: string[] = []
    if (v.perCustomerLimit == null) out.push(t('reusable', '可重复使用'))
    else if (v.perCustomerLimit > 1) out.push(t(`${v.perCustomerLimit} per customer`, `每人 ${v.perCustomerLimit} 次`))
    // `expiresOn` is the SHOP-LOCAL date the server derived. Never slice `expiresAt` here: east of
    // UTC the instant sits on the previous calendar day and would read a day early.
    if (v.expiresOn) out.push(t(`until ${v.expiresOn}`, `有效期至 ${v.expiresOn}`))
    if (v.minOrder != null) out.push(t(`min ${formatMoney(Number(v.minOrder), currency)}`, `最低 ${formatMoney(Number(v.minOrder), currency)}`))
    return out
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
                  <div className="text-[12px] text-muted-foreground mt-0.5">
                    {[valueLabel(v), usesLabel(v), ...restrictionLabels(v)].join(' · ')}
                  </div>
                </div>
                <div className="flex gap-[6px] shrink-0 max-[480px]:w-full max-[480px]:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="none"
                    className="rounded-pill py-[5px] px-3 text-[12px] bg-card whitespace-nowrap hover:border-primary hover:text-primary hover:bg-brand-100"
                    onClick={() => setPendingDelete(v)}
                  >
                    {t('Turn off', '停用')}
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
          </div>

          {/* Redemption limits and restrictions, each behind its own checkbox — Stripe's coupon
              screen. Off by default, so the ordinary voucher above is the whole form. */}
          <div className="mt-4 pt-4 border-t-[0.5px] border-border flex flex-col gap-3">
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-[0.08em]">
              {t('Limits', '使用限制')}
            </p>

            <Disclosure
              id="vm-limit-total"
              checked={form.limitTotal}
              onCheckedChange={v => setForm({ ...form, limitTotal: v })}
              label={t('Limit the total number of redemptions', '限制总兑换次数')}
            >
              <Input
                id="vm-max" variant="compact" type="number" step="1" min="1"
                value={form.maxUses}
                onChange={e => setForm({ ...form, maxUses: e.target.value })}
                placeholder="100"
              />
            </Disclosure>

            {/* #241, in the merchant's own words. Unticked is one redemption each, which is what
                every voucher created before this form does. */}
            <Disclosure
              id="vm-limit-per-customer"
              checked={form.limitPerCustomer}
              onCheckedChange={v => setForm({ ...form, limitPerCustomer: v })}
              label={t('Reusable — one customer can use this more than once', '可重复使用 — 同一顾客可多次使用')}
            >
              <Label htmlFor="vm-per-customer" className="text-[12px] text-muted-foreground">
                {t('Times per customer (blank = unlimited)', '每位顾客可用次数（留空 = 不限）')}
              </Label>
              <Input
                id="vm-per-customer" variant="compact" type="number" step="1" min="1"
                value={form.perCustomerLimit}
                onChange={e => setForm({ ...form, perCustomerLimit: e.target.value })}
                placeholder={t('unlimited', '不限')}
              />
              {/* The one combination the server refuses, said BEFORE they submit. Unlimited each
                  and unlimited in total is an unlimited discount for one person. */}
              {form.perCustomerLimit === '' && !form.limitTotal && (
                <p className="text-[12px] text-destructive">
                  {t('Also set a total limit above.', '请同时设置上方的总次数上限。')}
                </p>
              )}
            </Disclosure>

            <Disclosure
              id="vm-limit-expiry"
              checked={form.limitExpiry}
              onCheckedChange={v => setForm({ ...form, limitExpiry: v })}
              label={t('Add an expiry date', '设置到期日期')}
            >
              <Input
                id="vm-expires" variant="compact" type="date"
                value={form.expiresOn}
                onChange={e => setForm({ ...form, expiresOn: e.target.value })}
              />
              <p className="text-[12px] text-muted-foreground">
                {t('The voucher works all day on this date, in your shop\u2019s time.', '优惠券在该日期当天（按店铺时区）全天有效。')}
              </p>
            </Disclosure>

            <Disclosure
              id="vm-limit-min"
              checked={form.limitMinOrder}
              onCheckedChange={v => setForm({ ...form, limitMinOrder: v })}
              label={t('Require a minimum order', '设置最低消费')}
            >
              <Input
                id="vm-min-order" variant="compact" type="number" step="0.01" min="0"
                value={form.minOrder}
                onChange={e => setForm({ ...form, minOrder: e.target.value })}
                placeholder="50.00"
              />
              {/* Says which number, because it is not the one at the bottom of the customer's
                  screen. Counting shipping would move the threshold with the delivery address. */}
              <p className="text-[12px] text-muted-foreground">
                {t('Counted on the food subtotal, before delivery and tax.', '按商品小计计算，不含配送费与税费。')}
              </p>
            </Disclosure>
          </div>
          <Button type="submit" size="md" className="mt-3" disabled={busy}>
            {busy ? t('Saving…', '保存中…') : t('Create voucher', '创建优惠券')}
          </Button>
        </form>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={o => { if (!o) setPendingDelete(null) }}
        title={t('Turn off this voucher?', '停用此优惠券？')}
        body={
          <p>
            {/* No longer "cannot be undone", and the copy had to move with the behaviour: the row
                is deactivated, not deleted, so its redemption history survives and the code string
                is free to use again. Saying otherwise would misdescribe what the button does. */}
            {t(
              `Code ${pendingDelete?.code ?? ''} stops working at checkout, and any customer already holding it can no longer redeem it. You can create the same code again later.`,
              `优惠码 ${pendingDelete?.code ?? ''} 将在结账时失效，已持有该码的顾客也无法再使用。日后可重新创建相同的优惠码。`,
            )}
          </p>
        }
        confirmLabel={t('Turn off voucher', '停用优惠券')}
        onConfirm={async () => { if (pendingDelete) await remove((pendingDelete as any).id) }}
      />
    </div>
  )
}
