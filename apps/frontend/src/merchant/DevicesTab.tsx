import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useSession } from '../SessionContext'
import { fetchMyDevices, signOutDevice, type Device, type DeviceList } from '../store'
import { fmtDateTime } from '../merchantDate'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'

// Settings → Devices. The merchant reads which devices hold their account, and signs one out.
//
// It shows no IP address and no location. `auth.sessions` stores an IP, but an address tells a
// merchant nothing they can act on, and turning one into a place name means adding a geolocation
// provider — a second bill and a second thing to bound. The device name and its two timestamps are
// what identify a phone.
//
// Rows are in the server's order, which is EVICTION order: the device that goes next is last.
//
// Every sentence here is built with `t(en, zh)` from the PARTS the server sends. The server never
// sends a finished phrase: "Chrome on macOS" reads as "macOS 上的 Chrome", and a joined English
// string from the backend could not be turned into that.
//
// The timestamps use `fmtDateTime`, which is pinned to en-MY and deliberately NOT language-aware —
// the dashboard is the merchant's own back office and reads one way whatever the storefront
// language toggle says. See merchantDate.ts.
//
// This tab has no Save and no dirty state, so unlike its neighbours it takes no `onDirtyChange`.
export default function DevicesTab() {
  const { t } = useSession()
  const [list, setList] = useState<DeviceList | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  // Not an async callback, and `.then` rather than `await`, matching SubscriptionTab: an effect
  // that calls an async function which then sets state is what the React Compiler lint refuses.
  // Extracted so signing a device out can re-read the list afterwards.
  const load = useCallback(() => {
    fetchMyDevices()
      .then(r => {
        if (r.ok) { setList(r.data); setFailed(false) }
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

  // A failed read and an empty list are different news, and only one of them is true at a time.
  if (failed) {
    return (
      <p className="text-[14px] text-muted-foreground">
        {t('We could not load your devices. Please try again.', '无法加载设备列表，请重试。')}
      </p>
    )
  }
  if (list === null) {
    return <p className="text-[14px] text-muted-foreground">{t('Loading…', '加载中…')}</p>
  }

  return (
    <div className="max-w-[720px]">
      {/* The ceiling is the server's own figure, not a "2" typed into this sentence. */}
      <p className="text-[14px] text-muted-foreground mb-5">
        {t(
          `Your account can be signed in on ${list.limit} devices. Signing in on one more signs out the device you used longest ago.`,
          `您的账号最多可在 ${list.limit} 台设备上登录。再多登录一台，最久未使用的设备就会被登出。`,
        )}
      </p>

      {/* Two datetime columns do not fit a phone, so the table scrolls inside its own box rather
          than pushing the settings panel sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="[border-bottom:0.5px_solid_var(--color-border)]">
              <th className="py-2 pr-4 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                {t('Device', '设备')}
              </th>
              <th className="py-2 pr-4 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                {t('Created', '创建时间')}
              </th>
              <th className="py-2 pr-4 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                {t('Updated', '更新时间')}
              </th>
              {/* The action column is headed by the row buttons themselves. */}
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {list.devices.map(d => (
              <tr key={d.id} className="[border-bottom:0.5px_solid_var(--color-border)] last:border-b-0">
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium">{deviceName(d)}</span>
                    {/* The badge carries the meaning, so the row needs no second "this device"
                        line under the name. */}
                    {d.current && (
                      <Badge variant="info" className="text-[11px] font-medium">
                        {t('Current', '当前')}
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="py-3 pr-4 text-[13px] text-muted-foreground whitespace-nowrap">
                  {fmtDateTime(d.createdAt)}
                </td>
                <td className="py-3 pr-4 text-[13px] text-muted-foreground whitespace-nowrap">
                  {fmtDateTime(d.updatedAt)}
                </td>
                <td className="py-3 text-right">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
