import { useState, useEffect } from 'react'
import { fetchSampleShops, type CapturedSampleShop } from './store'

/**
 * Fetch the landing-page sample-shops carousel data once. No fallback content on error or an
 * empty result — `shops` just stays `[]`, and the caller (SampleShopsCarousel) renders nothing
 * in that case. Unlike usePlatformPricing, there is no sensible fake shop to fall back to.
 *
 * Shops with no screenshot yet are DROPPED here rather than rendered a second way. A row that
 * mixed screenshots with avatar-and-product-list cards read as a broken page; a shop that is
 * simply absent for the few minutes between the superadmin flagging it and GitHub Actions
 * capturing it does not. The capture is asked for at flag time, not left to the weekly cron.
 */
export function useSampleShops() {
  const [shops, setShops] = useState<CapturedSampleShop[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetchSampleShops()
      .then((r) => {
        if (!active || !r.ok) return
        setShops(r.data.filter((s): s is CapturedSampleShop => !!s.screenshotPath))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return { shops, loading }
}
