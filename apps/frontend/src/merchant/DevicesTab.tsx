import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useSession } from '../SessionContext'
import { fetchMyDevices, signOutDevice, type Device } from '../store'
import { Button } from '../components/ui/button'

// Settings → Devices. The merchant reads which two devices hold their account, and signs one out.
//
// It shows no IP address. `auth.sessions` stores one, but an address tells a merchant nothing they
// can act on, and making it useful means adding a geolocation provider — a second bill and a
// second thing to bound. The device name and when it was last used are what identify a phone.
//
// This tab has no Save and no dirty state, so unlike its neighbours it takes no `onDirtyChange`.
export default function DevicesTab() {
  const { t } = useSession()
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  // Not an async callback, and `.then` rather than `await`, matching SubscriptionTab: an effect
  // that calls an async function which then sets state is what the React Compiler lint refuses.
  // Extracted so signing a device out can re-read the list afterwards.
  const load = useCallback(() => {
    fetchMyDevices()
      .then(r => {
        if (r.ok) { setDevices(r.data); setFailed(false) }
        else setFailed(true)
      })
  }, [])

  useEffect(() => { load() }, [load])

  const remove = async (id: string) => {
    setBusy(id)
    const r = await signOutDevice(id)
    setBusy(null)
    if (r.ok) { toast.success(t('Device signed out', '已登出该设备')); load() }
    else toast.error(t('Could not sign that device out', '无法登出该设备'))
  }

  // A failed read and an empty list are different news, and only one of them is true at a time.
  if (failed) {
    return (
      <p className="text-[14px] text-muted-foreground">
        {t('We could not load your devices. Please try again.', '无法加载设备列表，请重试。')}
      </p>
    )
  }
  if (devices === null) {
    return <p className="text-[14px] text-muted-foreground">{t('Loading…', '加载中…')}</p>
  }

  return (
    <div className="max-w-[520px]">
      <p className="text-[14px] text-muted-foreground mb-5">
        {t(
          'Your account can be signed in on 2 devices. Signing in on a third signs out the one you used longest ago.',
          '您的账号最多可在 2 台设备上登录。在第三台设备登录后，最久未使用的设备会被登出。',
        )}
      </p>

      <ul className="flex flex-col">
        {devices.map(d => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-4 py-3 [border-bottom:0.5px_solid_var(--color-border)] last:border-b-0"
          >
            <div className="min-w-0">
              <div className="text-[14px] font-medium truncate">{d.label}</div>
              <div className="text-[13px] text-muted-foreground">
                {d.current
                  ? t('This device', '当前设备')
                  : t(`Last used ${formatLastSeen(d.lastSeen, 'en')}`, `最后使用：${formatLastSeen(d.lastSeen, 'zh')}`)}
              </div>
            </div>
            {!d.current && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy === d.id}
                onClick={() => remove(d.id)}
              >
                {t('Sign out', '登出')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A short "3 hours ago" for a session's last use. Falls back to the date past a week. */
function formatLastSeen(iso: string, lang: 'en' | 'zh'): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return lang === 'zh' ? '未知' : 'unknown'
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000))
  if (minutes < 2) return lang === 'zh' ? '刚刚' : 'just now'
  if (minutes < 60) return lang === 'zh' ? `${minutes} 分钟前` : `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return lang === 'zh' ? `${hours} 小时前` : `${hours} hours ago`
  const days = Math.round(hours / 24)
  if (days <= 7) return lang === 'zh' ? `${days} 天前` : `${days} days ago`
  return new Date(iso).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-GB')
}
