// The only file in this folder that touches a third party.
//
// It is called from exactly one place — usePixels, after the visitor accepts — and every rule
// about who gets tracked is decided BEFORE control reaches here. That is deliberate: a module
// that both decides and injects is one where a refactor can quietly reorder the two.
//
// The snippets below are the vendors' own base code, verbatim, with the id interpolated and with
// their trailing pageview call REMOVED. Do not rewrite them by hand: ttq's shim builds internals
// (_i, _t, _o, instance) that the real events.js reads back, and a hand-made copy that drifts from
// the vendor's own fails silently. Refresh them by re-copying from the vendors, keeping the two
// edits noted here.
//
// Both snippets create their own async <script>, and this runs only after Accept — so neither
// vendor is ever on the critical path or visible to the preload scanner. That matters here more
// than most places: index.css and index.html exist in their current shape because two cold
// third-party origins in series cost 793ms of a 2.75s mobile FCP once already.

import type { PixelIds } from './ids'

// Keyed by vendor AND id rather than a single boolean, so that a second pixel id in one session
// still loads. Not reachable today (the platform's ids are fixed at build time) and squarely a
// #220 concern, where a customer may see two shops in one SPA session.
const injected = new Set<string>()

// The vendor's snippet minus its trailing `fbq('track','PageView')`. Its own `if(f.fbq)return`
// guard skips only the shim setup, so a later `fbq('init', <other id>)` still runs.
function metaSnippet(id: string): string {
  return `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?` +
    `n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;` +
    `n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;` +
    `t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,` +
    `document,'script','https://connect.facebook.net/en_US/fbevents.js');` +
    `fbq('init','${id}');`
}

// The vendor's snippet minus its trailing `ttq.page()`.
function tiktokSnippet(id: string): string {
  return `!function (w, d, t) {w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];` +
    `ttq.methods=["page","track","identify","instances","debug","on","off","once","ready",` +
    `"alias","group","enableCookie","disableCookie","holdConsent","revokeConsent",` +
    `"grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){` +
    `t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};` +
    `for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);` +
    `ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)` +
    `ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){` +
    `var r="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},` +
    `ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},` +
    `ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",` +
    `n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];` +
    `e.parentNode.insertBefore(n,e)};ttq.load('${id}');}(window, document, 'ttq');`
}

function inject(vendor: 'meta' | 'tiktok', id: string, code: string): void {
  const key = `${vendor}:${id}`
  if (injected.has(key)) return
  injected.add(key)
  const el = document.createElement('script')
  el.dataset.pixel = vendor
  el.textContent = code
  document.head.appendChild(el)
}

/**
 * Load whichever pixels the given ids name. Idempotent per vendor and id.
 *
 * Callers must already have established that the visitor accepted. This function asks no such
 * question, and must not be given the chance to answer one wrongly.
 */
export function loadPixels(ids: PixelIds): void {
  if (typeof document === 'undefined') return
  if (ids.meta) inject('meta', ids.meta, metaSnippet(ids.meta))
  if (ids.tiktok) inject('tiktok', ids.tiktok, tiktokSnippet(ids.tiktok))
}
