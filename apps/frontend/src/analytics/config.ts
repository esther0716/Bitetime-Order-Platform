// WHETHER first-party analytics is configured at all, as data rather than as an `if` inside the
// hook. The same shape and the same trim as pixels/ids.ts, for the same reason: a Vercel variable
// set to a blank string is the shape of a half-finished configuration, and `''` would otherwise
// create a client that reports to a site id nobody owns.
//
// A site id is public — it ships in the page. The variable is a switch, not a secret.

export type PraxorSettings = {
  /** The site ID shown in the Praxor Analytics dashboard. */
  siteId: string
  /**
   * A self-hosted or local Praxor origin. ABSENT rather than blank when unset: `initPraxor` throws
   * on a value that is not an absolute URL, and a throw here would take the app down on boot for a
   * misconfigured environment variable.
   */
  apiUrl?: string
}

function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** The platform's settings, from the build environment. `null` means the feature is off. */
export function praxorSettings(): PraxorSettings | null {
  const siteId = configured(import.meta.env.VITE_PRAXOR_SITE_ID)
  if (!siteId) return null
  const apiUrl = configured(import.meta.env.VITE_PRAXOR_API_URL)
  return apiUrl ? { siteId, apiUrl } : { siteId }
}
