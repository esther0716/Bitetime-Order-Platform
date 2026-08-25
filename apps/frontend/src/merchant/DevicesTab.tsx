import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useSession } from '../SessionContext'
import { fetchMyDevices, signOutDevice, type Device, type DeviceList } from '../store'
import { Button } from '../components/ui/button'

// Settings → Devices. The merchant reads which devices hold their account, and signs one out.
//
// It shows no IP address. `auth.sessions` stores one, but an address tells a merchant nothing they
// can act on, and making it useful means adding a geolocation provider — a second bill and a
// second thing to bound. The device name and when it was last used are what identify a phone.
//
// Every sentence here is built with `t(en, zh)` from the PARTS the server sends. The server never
// sends a finished phrase: "Chrome on macOS" reads as "macOS 上的 Chrome", and a joined English
// string from the backend could not be turned into that.
//
// This tab has no Save and no dirty state, so unlike its neighbours it takes no `onDirtyChange`.
export default function DevicesTab() {
  const { t } = useSession()
  // The list AND the clock it was read against. "3 hours ago" is relative to something, and the
  // honest something is the moment of the fetch — not the moment of a re-render. Capturing it here
  // also keeps render pure: `Date.now()` in the render body is an impure call the React Compiler
  // rejects, and the repo's own discipline (SubscriptionTab, ProductsManager's promoEnded) is to
  // read the clock once and hand the value in.
  const [snapshot, setSnapshot] = useState<{ list: DeviceList; at: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  // Not an async callback, and `.then` rather than `await`, matching SubscriptionTab: an effect
  // that calls an async function which then sets state is what the React Compiler lint refuses.
  // Extracted so signing a device out can re-read the list afterwards.
  const load = useCallback(() => {
    fetchMyDevices()
      .then(r => {
        if (r.ok) { setSnapshot({ list: r.data, at: Date.now() }); setFailed(false) }
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

  /** The device's name, composed here so both languages read naturally. */
  const deviceName = (d: Device) => {
    if (d.browser && d.platform) return t(`${d.browser} on ${d.platform}`, `${d.platform} 上的 ${d.browser}`)
    // One name is still worth showing — "Linux" identifies a device better than "unknown" does.
    return d.browser ?? d.platform ?? t('Unknown device', '未知设备')
  }

  /** A short "3 hours ago", measured from when the list was read. Falls back to the date past a week. */
  const lastUsed = (iso: string, now: number) => {
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return t('unknown', '未知')
    const minutes = Math.max(0, Math.round((now - then) / 60_000))
    if (minutes < 2) return t('just now', '刚刚')
    if (minutes < 60) return t(`${minutes} minutes ago`, `${minutes} 分钟前`)
    const hours = Math.round(minutes / 60)
    if (hours < 24) return t(`${hours} hours ago`, `${hours} 小时前`)
    const days = Math.round(hours / 24)
    if (days <= 7) return t(`${days} days ago`, `${days} 天前`)
    return new Date(iso).toLocaleDateString(t('en-GB', 'zh-CN'))
  }

  // A failed read and an empty list are different news, and only one of them is true at a time.
  if (failed) {
    return (
      <p className="text-[14px] text-muted-foreground">
        {t('We could not load your devices. Please try again.', '无法加载设备列表，请重试。')}
      </p>
    )
  }
  if (snapshot === null) {
    return <p className="text-[14px] text-muted-foreground">{t('Loading…', '加载中…')}</p>
  }
  const { list, at } = snapshot

  return (
    <div className="max-w-[520px]">
      {/* The ceiling is the server's own figure, not a "2" typed into this sentence. */}
      <p className="text-[14px] text-muted-foreground mb-5">
        {t(
          `Your account can be signed in on ${list.limit} devices. Signing in on one more signs out the device you used longest ago.`,
          `您的账号最多可在 ${list.limit} 台设备上登录。再多登录一台，最久未使用的设备就会被登出。`,
        )}
      </p>

      <ul className="flex flex-col">
        {list.devices.map(d => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-4 py-3 [border-bottom:0.5px_solid_var(--color-border)] last:border-b-0"
          >
            <div className="min-w-0">
              <div className="text-[14px] font-medium truncate">{deviceName(d)}</div>
              <div className="text-[13px] text-muted-foreground">
                {d.current
                  ? t('This device', '当前设备')
                  : t(`Last used ${lastUsed(d.lastSeen, at)}`, `最后使用：${lastUsed(d.lastSeen, at)}`)}
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
