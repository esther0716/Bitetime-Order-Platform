import { useSession } from '../SessionContext'
import type { Lang } from '../types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

// `items` is what lets <SelectValue/> show "EN" rather than the raw value "en" — Base UI's
// Value renders the value itself unless the Root can look a label up.
const LANG_ITEMS = [
  { value: 'en', label: 'EN' },
  { value: 'zh', label: '中文' },
] as const

/** Language switcher (EN / 中文) backed by the shadcn Select. */
export default function LanguageSelect({ className }: { className?: string }) {
  const { lang, setLang } = useSession()
  return (
    <Select value={lang} onValueChange={(v) => setLang(v as Lang)} items={LANG_ITEMS}>
      <SelectTrigger size="sm" className={className} aria-label="Language / 语言">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LANG_ITEMS.map(i => (
          <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
