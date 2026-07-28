import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { dashboardHash, parseDashboardHash } from './dashboardHash'

// Both hooks own one URL, so they write it the same way — the section hook clearing any
// sub-tab, the sub-tab hook preserving its section.
//
// Through the ROUTER, and as a PUSH. It used to be a bare `history.replaceState`, which cost two
// things. A replaced entry meant the dashboard's whole tab history collapsed into one, so Back
// from any section left the dashboard altogether — landing on the login screen the merchant had
// already used, which is what this looked like from the outside. And a `history` write the router
// never sees leaves `useLocation()` stale, which is why both hooks had to read the hash once into
// a `useState` initialiser and Settings needed a remount key to notice a new sub-tab.
//
// `search` is carried explicitly: a partial `to` keeps only what it names, and /merchant arrives
// back from Stripe Checkout with a `?checkout=success` that MerchantHome is still polling on.
function useWriteHash() {
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  return useCallback((section: string, sub?: string | null) => {
    const next = dashboardHash(section, sub)
    // Selecting the section you are already in is not a navigation. Without this the active nav
    // item stacks a duplicate entry per click, and Back then appears to do nothing.
    if (next === hash) return
    navigate({ pathname, search, hash: next })
  }, [navigate, pathname, search, hash])
}

// Keep the active dashboard section in the URL hash, so a refresh keeps the current section
// instead of resetting to the default and Back walks the sections the merchant actually visited.
// The hash is validated against the known section keys, falling back to `fallback` for an empty
// or unknown one. Shared by the merchant and admin dashboards.
//
// The hash carries a second, optional segment for a section's sub-tab (`#settings/subscription`)
// — see useDashboardSubsection. This hook reads and writes only the FIRST segment; without that
// split, `#settings/subscription` would fail the `keys.includes` check here and drop the merchant
// on Overview.
export function useDashboardSection(
  keys: string[],
  fallback: string,
): [string, (key: string, sub?: string) => void] {
  const { hash } = useLocation()
  const writeHash = useWriteHash()

  const { section } = parseDashboardHash(hash)
  const active = keys.includes(section) ? section : fallback

  // `sub` is for callers that know where inside the section they are going — the Pro upgrade
  // CTA aiming at `#settings/subscription`. Omitted, any existing sub-tab is dropped: switching
  // section makes the old section's sub-tab meaningless, and carrying it over would write
  // `#orders/shipping`.
  const setSection = useCallback(
    (key: string, sub?: string) => writeHash(key, sub),
    [writeHash],
  )

  return [active, setSection]
}

/**
 * The same trick one level down: a section's sub-tab, in the hash's second segment.
 *
 * Added so the Pro upgrade CTA can link at a specific settings tab (#112), but it also fixes an
 * older annoyance — before this, every settings sub-tab reset to Shipping on refresh, silently,
 * mid-edit.
 *
 * The caller decides WHEN a change is allowed: `ShopSettings` routes tab switches through
 * NavGuard, so a dirty form still blocks navigation. This hook only reports where we are.
 */
export function useDashboardSubsection<K extends string>(
  section: string,
  keys: readonly K[],
  fallback: K,
): [K, (key: K) => void] {
  const { hash } = useLocation()
  const writeHash = useWriteHash()

  const parsed = parseDashboardHash(hash)
  const found = keys.find(k => k === parsed.sub)
  const sub = parsed.section === section && found ? found : fallback

  const setSub = useCallback((key: K) => writeHash(section, key), [writeHash, section])

  return [sub, setSub]
}
