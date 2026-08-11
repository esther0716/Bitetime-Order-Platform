// The bridge between `YYYY-MM-DD` and the `Date` objects `react-day-picker` speaks, and the only
// place in the app allowed to build a `Date` for a calendar date.
//
// Both directions go through LOCAL midnight — `new Date(y, m, d)` and the local getters — never
// UTC and never `Date.parse`, so the two are exact inverses in whatever zone the merchant's
// browser is in. That matters more than it looks: the shared rule (`fulfilment.ts`) does its
// arithmetic in UTC midnight precisely because UTC has no daylight saving, and mixing the two
// conventions is how a tick lands on the wrong day — a day the shop then bakes for and nobody
// ordered. Keeping the local pair here, named and tested as inverses, is what stops the two
// conventions from being confused for one.
//
// The SHOP's clock never enters this: the calendar's bounds are computed from the shop timezone
// by `customDateBounds` and arrive as strings already.

/** `2026-08-16` → local midnight on 16 August, for `react-day-picker`. */
export function toDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** A local `Date` back to the `YYYY-MM-DD` the rest of the app stores. */
export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
