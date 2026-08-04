import { useState, useEffect } from 'react'
import { fetchSampleShops, type SampleShop } from './store'

/**
 * Fetch the landing-page sample-shops carousel data once. No fallback content on error or an
 * empty result — `shops` just stays `[]`, and the caller (SampleShopsCarousel) renders nothing
 * in that case. Unlike usePlatformPricing, there is no sensible fake shop to fall back to.
 */
export function useSampleShops() {
  const [shops, setShops] = useState<SampleShop[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetchSampleShops()
      .then((r) => { if (active && r.ok) setShops(r.data) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return { shops, loading }
}
