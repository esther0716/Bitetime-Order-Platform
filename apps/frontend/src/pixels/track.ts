// What we tell the vendors. Two verbs, and nothing else may be added without re-reading the
// privacy notice, which describes exactly this and nothing more.
//
// NO PII EVER, and the signatures below are what enforce it rather than this comment: there is no
// parameter to pass data through. `PixelEvent` is a union of the events the notice discloses, so
// adding a third is a type error at every call site until someone edits this file — which is the
// moment to re-read src/legal/documents.ts. That document states these pixels receive the pages
// you viewed and whether you created a shop; a payload smuggled in here makes it false.
//
// Every call is guarded twice — for a global that is absent (the snippets have not loaded, or an
// ad blocker removed them) and for one that throws. These fire from route effects, and a throw in
// a route effect takes down the navigation, which would trade a missing analytics event for a
// broken page.

/**
 * Every event this app may report. A union rather than a string, so "two verbs and nothing else"
 * is a rule the compiler holds instead of a sentence someone has to remember.
 *
 * `PageView` is not here — it has its own function, because the two vendors spell it differently.
 */
export type PixelEvent = 'CompleteRegistration'

type FbqFn = (...args: unknown[]) => void
interface TtqObject {
  page: () => void
  track: (event: string) => void
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

/**
 * One named conversion, and no payload with it.
 *
 * There is deliberately no `params` argument. #220 will want one for a merchant's order value, and
 * adding it then is one line — adding it now would be an untyped hole into two ad networks with no
 * caller to justify it.
 */
export function pixelTrack(event: PixelEvent): void {
  quietly(() => fbq()?.('track', event))
  quietly(() => ttq()?.track(event))
}
