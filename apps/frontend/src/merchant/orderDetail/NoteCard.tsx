import { useSession } from '../../SessionContext'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import DrawerCard from './DrawerCard'

/** The merchant's own note on the order. Read-only for a suspended shop. */
export default function NoteCard({
  note,
  saved,
  onChange,
  onSave,
  saving,
  dirty,
  readOnly,
}: {
  note: string
  saved: string | null
  onChange: (v: string) => void
  onSave: () => void
  saving: boolean
  dirty: boolean
  readOnly: boolean
}) {
  const { t } = useSession()

  if (readOnly) {
    // A suspended shop with no note has nothing to show and no way to write one.
    if (!saved) return null
    return (
      <DrawerCard title={t('Note', '备注')}>
        <p className="text-[13px] text-foreground break-words whitespace-pre-wrap">{saved}</p>
      </DrawerCard>
    )
  }

  return (
    <DrawerCard
      title={t('Note', '备注')}
      footer={
        <Button
          type="button"
          size="none"
          className="rounded-lg py-[6px] px-[14px] text-[13px]"
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving ? t('Saving…', '保存中…') : t('Save note', '保存备注')}
        </Button>
      }
    >
      <Textarea
        value={note}
        onChange={e => onChange(e.target.value)}
        rows={3}
        placeholder={t('Add a note for this order…', '为此订单添加备注…')}
        className="text-[13px] bg-background border-border resize-none"
      />
    </DrawerCard>
  )
}
