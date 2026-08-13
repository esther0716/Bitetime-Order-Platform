// The spend ceilings for everything that can call Google on the platform's account.
//
// They live in their own module because there are TWO spenders, not one: the quote endpoint and
// ORDER INTAKE, which re-resolves a distance when the cache missed. They must share one bucket —
// it is one Google bill for one shop, and a ceiling that only half the spenders consult is not a
// ceiling.
//
// Same in-memory limiter weaknesses as everywhere else here, inherited knowingly: they reset on
// redeploy and stop protecting anything past one backend instance (#101, Out of Scope).
import { createSlidingWindow } from './rateLimit.js'

// The quote endpoint SPENDS MONEY per cache miss (see docs/adr/0001), so it is bounded twice
// over, and the two bounds guard different things:
//
//   * `quoteIpWindow` bounds REQUESTS by caller IP — cheap flood protection, applied to hits
//     and misses alike.
//   * `quoteMerchantWindow` bounds PROVIDER CALLS per shop per day — the runaway stop. It is
//     checked only when the cache missed, because a cache hit costs nothing and must never eat
//     a shop's ceiling.
//
// Both inherit the in-memory limiter's known weaknesses KNOWINGLY, exactly as customer signup
// does: they reset on redeploy and stop protecting anything past one backend instance. Fixing
// that is its own piece of work (#101 Out of Scope).
// 300/hour, for the same reason `placesIpWindow` is: behind carrier-grade NAT or mall wifi —
// most Malaysian mobile traffic, on a Malaysian platform — dozens of unrelated customers share
// one address, and at 60 a busy shop's customers would refuse each other. Note ORDER INTAKE's
// cache-miss path draws on this same bucket, so an over-tight value here does not merely fail a
// quote, it fails an ORDER. The per-shop ceiling below is what actually bounds the spend.
export const quoteIpWindow = createSlidingWindow({ limit: 300, windowMs: 60 * 60_000, now: () => Date.now() })
export const quoteMerchantWindow = createSlidingWindow({ limit: 500, windowMs: 24 * 60 * 60_000, now: () => Date.now() })

// The UNSPOOFABLE stop for the Places proxy. `placesIpWindow`'s key comes from `clientIp`, which
// trusts `cf-connecting-ip` first — and this backend does not sit behind Cloudflare, so a caller
// rotates that header and mints a fresh per-IP bucket per request. That window bounds accidents;
// this one bounds abuse. There is no merchant to key on here (the proxy serves the storefront and
// Shop Settings alike), so the ceiling is global and deliberately generous: it should never be
// reached by honest traffic, and it is the only thing standing between a curl loop and a
// four-figure invoice.
//
// Same in-memory weaknesses as every other limiter here, inherited knowingly: resets on redeploy,
// stops working past one backend instance (#101, Out of Scope).
export const placesGlobalWindow = createSlidingWindow({ limit: 20_000, windowMs: 24 * 60 * 60_000, now: () => Date.now() })

// AI menu import (tasks/prd-ai-menu-import.md). Belongs in this file rather than beside the route
// for the reason the file exists at all: it is a ceiling on money the PLATFORM spends on a
// merchant's behalf, same as the Google windows above — one Claude bill for one shop.
//
// Keyed by merchant, not by IP, and there is no IP twin. The Google windows carry both because
// their spender is reachable by an anonymous storefront visitor; this route is behind
// `requireMerchantOwns`, so every call already has a named shop attached to it and the shop IS
// the unit of spend.
//
// 20 a day is set against the WORKFLOW, not against a cost model there is no data for yet: a
// menu is one photo per page, a merchant re-shooting a blurry page needs a handful of tries, and
// a shop legitimately importing twenty pages in one day is not a shop this platform has. It is a
// runaway stop, not a rationing device — reaching it should mean something is wrong.
//
// Same in-memory weaknesses as every other limiter here, inherited knowingly: resets on redeploy,
// stops working past one backend instance (#101, Out of Scope).
export const menuImportMerchantWindow = createSlidingWindow({ limit: 20, windowMs: 24 * 60 * 60_000, now: () => Date.now() })

// The shop analytics assistant (tasks/prd-shop-analytics-assistant.md). Same argument as the
// import window above, and the same in-memory weaknesses: one shop, one Claude bill, a ceiling
// that resets on redeploy and stops protecting anything past one backend instance (#101).
//
// 50 a day is a runaway stop rather than a ration, and the number is chosen from nothing — there
// is no usage data yet. It sits where an honest merchant will never meet it and a loop will.
// Revisit it once there is a week of real usage; a figure picked from no evidence deserves no
// more confidence than that.
export const assistantMerchantWindow = createSlidingWindow({ limit: 50, windowMs: 24 * 60 * 60_000, now: () => Date.now() })
