// What we tell the vendors, and WHICH pixel we tell it to.
//
// EVERY CALL IS SCOPED TO ONE ID, and that is the load-bearing property here. Meta's queue is
// global: `fbq('track', …)` reports to every pixel that has been inited in the page. Once a
// customer opens two storefronts in one SPA session — a normal afternoon — an unscoped call
// sends shop B's order to shop A's ad account. `fbq('trackSingle', id, …)` and
// `ttq.instance(id).track(…)` are the vendors' own answers to this. load.ts's `injected` set is
// keyed `vendor:id` for the same reason.
//
// The platform's own pixels (#217) go through these functions too. One code path, not a safe one
// and a leaky one — a second set of unscoped helpers is a footgun left loaded for whoever adds
// the next event.
//
// THE TWO VENDORS DO NOT AGREE ON NAMES. Meta says `Purchase`; TikTok says `CompletePayment`. A
// single string handed to both is an event TikTok drops in silence, so the union below maps to a
// per-vendor name rather than being sent as-is.
//
// NO PII EVER, and the signatures are what enforce it rather than this comment. The only payload
// is `{ value, currency }` on a sale — no email, phone, name, address or cart contents. The
// privacy notice and the Terms describe exactly this; anything smuggled in here makes them false.
//
// Every call is guarded twice — for a global that is absent (the snippets have not loaded, or an
// ad blocker removed them) and for one that throws. These fire from route effects and from a
// checkout click, and a throw there trades a missing analytics event for a broken page.

import type { PixelIds } from './ids'

/**
 * Every event this app may report, named as the domain names it.
 *
 * A union rather than a string, so the set is a rule the compiler holds instead of a sentence
 * someone has to remember: adding a third is a type error at every call site until someone edits
 * this file — which is the moment to re-read src/legal/documents.ts.
 *
 * `PageView` is not here — it has its own function, because the vendors spell it so differently
 * that it is not an event to TikTok at all (`ttq.page()`).
 */
export type PixelEvent = 'CompleteRegistration' | 'AddToCart' | 'InitiateCheckout' | 'Purchase'

/** The sale's value, in the shop's own currency. The ONLY payload either vendor is given. */
export interface PixelValue {
  value: number
  /** ISO 4217, which is what `merchants.currency` already holds. */
  currency: string
}

// Meta's names happen to equal ours for three of the four. `Purchase` is the one that does not,
// and writing all four out is what stops the next reader from assuming a passthrough.
const META_EVENT: Record<PixelEvent, string> = {
  CompleteRegistration: 'CompleteRegistration',
  AddToCart: 'AddToCart',
  InitiateCheckout: 'InitiateCheckout',
  Purchase: 'Purchase',
}

const TIKTOK_EVENT: Record<PixelEvent, string> = {
  CompleteRegistration: 'CompleteRegistration',
  AddToCart: 'AddToCart',
  InitiateCheckout: 'InitiateCheckout',
  // TikTok has no `Purchase`. Sending one is not an error to them — it is an unrecognised custom
  // event that no campaign optimizes on, which is a silent failure of the whole feature.
  Purchase: 'CompletePayment',
}

type FbqFn = (...args: unknown[]) => void
interface TtqInstance {
  page: () => void
  track: (event: string, params?: PixelValue) => void
}
interface TtqObject {
  instance: (id: string) => TtqInstance | undefined
}

function fbq(): FbqFn | null {
  const fn = (globalThis as { fbq?: unknown }).fbq
  return typeof fn === 'function' ? (fn as FbqFn) : null
}

function ttqInstance(id: string): TtqInstance | null {
  const obj = (globalThis as { ttq?: unknown }).ttq as TtqObject | undefined
  if (!obj || typeof obj.instance !== 'function') return null
  const inst = obj.instance(id)
  return inst && typeof inst.page === 'function' && typeof inst.track === 'function' ? inst : null
}

function quietly(run: () => void): void {
  try {
    run()
  } catch {
    // An ad blocker can leave a global that throws. A missing report is acceptable; a route
    // transition or a checkout that dies inside a handler is not.
  }
}

/**
 * One pageview, to each of the given pixels and to no others.
 *
 * Called per marketing route for the platform's pixels, and once per storefront for a shop's.
 */
export function pixelPageView(ids: PixelIds): void {
  if (ids.meta) quietly(() => fbq()?.('trackSingle', ids.meta, 'PageView'))
  if (ids.tiktok) quietly(() => ttqInstance(ids.tiktok!)?.page())
}

/**
 * One named event, to each of the given pixels and to no others.
 *
 * `value` is optional because only a sale has one. When it is passed it must be the total the
 * BACKEND committed, never a number the browser recomputed after the fact — an ad platform that
 * optimizes on a figure which does not match revenue is worse than one told nothing.
 */
export function pixelTrack(ids: PixelIds, event: PixelEvent, value?: PixelValue): void {
  if (ids.meta) {
    quietly(() => value
      ? fbq()?.('trackSingle', ids.meta, META_EVENT[event], value)
      : fbq()?.('trackSingle', ids.meta, META_EVENT[event]))
  }
  if (ids.tiktok) {
    quietly(() => ttqInstance(ids.tiktok!)?.track(TIKTOK_EVENT[event], value))
  }
}
