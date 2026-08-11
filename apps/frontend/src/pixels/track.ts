// What we tell the vendors. Two verbs, and nothing else may be added without re-reading the
// privacy notice, which describes exactly this and nothing more.
//
// NO PII EVER. No email, phone, name, shop name or slug is passed to either vendor. That is not a
// style preference: src/legal/documents.ts states that these pixels receive the pages you viewed
// and whether you created a shop, and a parameter added here without changing that sentence makes
// a legal document false.
//
// Every call is guarded twice — for a global that is absent (the snippets have not loaded, or an
// ad blocker removed them) and for one that throws. These fire from route effects, and a throw in
// a route effect takes down the navigation, which would trade a missing analytics event for a
// broken page.

type FbqFn = (...args: unknown[]) => void
interface TtqObject {
  page: () => void
  track: (event: string, params?: Record<string, unknown>) => void
}

function fbq(): FbqFn | null {
  const fn = (globalThis as { fbq?: unknown }).fbq
  return typeof fn === 'function' ? (fn as FbqFn) : null
}

function ttq(): TtqObject | null {
  const obj = (globalThis as { ttq?: unknown }).ttq as TtqObject | undefined
  return obj && typeof obj.page === 'function' && typeof obj.track === 'function' ? obj : null
}

function quietly(run: () => void): void {
  try {
    run()
  } catch {
    // An ad blocker can leave a global that throws. A missing report is acceptable; a route
    // transition that dies inside an effect is not.
  }
}

/** One pageview, to whichever vendors are loaded. Called per marketing route, including the first. */
export function pixelPageView(): void {
  quietly(() => fbq()?.('track', 'PageView'))
  quietly(() => ttq()?.page())
}

/** One named conversion. `CompleteRegistration` is the only caller today. */
export function pixelTrack(event: string, params?: Record<string, unknown>): void {
  quietly(() => {
    const fn = fbq()
    if (!fn) return
    if (params) fn('track', event, params)
    else fn('track', event)
  })
  quietly(() => {
    const obj = ttq()
    if (!obj) return
    if (params) obj.track(event, params)
    else obj.track(event)
  })
}
