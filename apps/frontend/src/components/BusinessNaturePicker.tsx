// The one business-nature dropdown (#161). Signup collects it and Shop Settings edits it, and
// the two used to be near-identical copies — same label, same placeholder, same option map,
// differing only in how they greyed the placeholder out.
//
// `value` is '' for "not chosen yet", which is both what a new signup starts as and what a shop
// that predates the field carries. '' is deliberately NOT an option in the list: a merchant can
// leave it unset, but cannot pick "unspecified" as an answer.

import { useSession } from '../SessionContext'
import { BUSINESS_NATURE_OPTIONS, businessNatureLabel } from '../businessNature'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export default function BusinessNaturePicker({ id, value, onChange, className }: {
  id: string
  value: string
  onChange: (value: string) => void
  /** Trigger width; the two callers size it differently (full-width card vs settings column). */
  className?: string
}) {
  const { t } = useSession()
  const label = t('What do you sell?', '你卖什么？')
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className={cn('w-full', className)} aria-label={label}>
          <span className={cn('truncate', !value && 'text-rose-muted')}>
            {value ? t(...businessNatureLabel(value)) : t('Choose your business type', '选择业务类型')}
          </span>
        </SelectTrigger>
        <SelectContent>
          {BUSINESS_NATURE_OPTIONS.map(o => (
            <SelectItem key={o.value} value={o.value}>{t(...o.label)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
