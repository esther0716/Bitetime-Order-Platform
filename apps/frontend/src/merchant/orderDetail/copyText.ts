import { toast } from 'sonner'
import type { Translate } from '../../types'

/**
 * Copy one string, and say so.
 *
 * Two places in the drawer copy something a merchant has to get exactly right — the order
 * number they read back over the phone, and the address they paste into a courier's form. The
 * success line differs; the failure line is the same sentence in both, and was written twice.
 */
export async function copyText(value: string, ok: { en: string; zh: string }, t: Translate) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(t(ok.en, ok.zh))
  } catch {
    toast.error(t('Could not copy — copy it manually', '无法复制 — 请手动复制'))
  }
}
