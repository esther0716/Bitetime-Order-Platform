import { useMemo } from 'react'
import { DayPicker } from 'react-day-picker'
import { enGB, zhCN } from 'react-day-picker/locale'
// Imported HERE, not from `index.css`, and that is a size decision rather than a style one:
// this is 11KB of library CSS in a 108KB render-blocking bundle, for a control only merchants
// ever see. `MerchantHome` is `lazy()`, so importing it from inside this component puts it in
// the dashboard's own chunk and off the storefront's critical path entirely. The theming that
// makes it look like the rest of the app stays in `index.css`, beside the tokens it reads.
import 'react-day-picker/style.css'
// The `YYYY-MM-DD` ↔ local-midnight `Date` bridge, extracted so it can be tested as a pair of
// exact inverses — see calendarDate.ts for why local and not UTC.
import { toDate, toIso } from './calendarDate'

interface Props {
  /** The ticked dates, `YYYY-MM-DD`, sorted. */
  value: string[]
  onChange: (dates: string[]) => void
  /** The horizon's bounds, `YYYY-MM-DD`, from `customDateBounds`. */
  first: string
  last: string
  t: (en: string, zh: string) => string
  lang: 'en' | 'zh'
}

export default function CustomDatesCalendar({ value, onChange, first, last, t, lang }: Props) {
  const selected = useMemo(() => value.map(toDate), [value])
  const start = toDate(first)
  const end = toDate(last)

  return (
    <div className="custom-dates-calendar">
      <DayPicker
        mode="multiple"
        locale={lang === 'zh' ? zhCN : enGB}
        selected={selected}
        onSelect={days => onChange((days ?? []).map(toIso).sort())}
        startMonth={start}
        endMonth={end}
        defaultMonth={selected[0] ?? start}
        // Past days and anything past the horizon render DISABLED rather than hidden, the same
        // choice `FulfilDatePicker` makes on the customer's side: a merchant who cannot find next
        // Monday assumes the calendar is broken, and the horizon is only legible if you can see
        // where it falls.
        disabled={[{ before: start }, { after: end }]}
        aria-label={t('Order dates', '可选日期')}
      />
      <p className="text-[12px] text-muted-foreground mt-2 leading-[1.5]">
        {t(`Dates can be picked up to ${last}.`, `最远可选至 ${last}。`)}
      </p>
    </div>
  )
}
