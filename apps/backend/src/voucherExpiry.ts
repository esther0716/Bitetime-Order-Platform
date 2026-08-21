// A voucher's expiry, between the date a merchant picks and the instant the column holds.
//
// The column is an ISO INSTANT — `products.promo_end`'s rule, and for the same reason: an instant
// compares with `>` against `now` and needs no timezone logic on the checkout path. But a merchant
// picking "31 Aug" means *usable all day on the 31st, in my shop's time*. Store that naively and it
// becomes 2026-08-31T00:00:00Z, which in Asia/Kuala_Lumpur is 8am on the 31st: the voucher dies
// mid-breakfast on the day they thought it ran.
//
// So the conversion lives HERE, at the edge, and nowhere else. `@bitetime/shared` never learns
// about timezones, and `voucherExpired` stays a plain comparison.
//
// Pure and dependency-free, so `pnpm --filter @bitetime/backend test` drives it with no env and no
// Supabase — the same posture as the Claude adapters.
import { isTimezone, DEFAULT_TIMEZONE } from '@bitetime/shared'

/** 'YYYY-MM-DD', and nothing else. A merchant's `<input type="date">` value. */
const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * How far the zone is from UTC at a given instant, in minutes.
 *
 * Read off `Intl` rather than a table, so it is right across a DST boundary — which Malaysia does
 * not have, but every other shop clock this platform may ever hold might.
 */
function offsetMinutes(tz: string, at: Date): number {
  // `en-CA` formats as YYYY-MM-DD, so the parts reassemble into a parseable UTC timestamp. The
  // difference between "this instant read in the zone" and the instant itself IS the offset.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00'
  // `24` for midnight is a documented `hourCycle: 'h23'` edge in some runtimes; normalise it.
  const hour = get('hour') === '24' ? '00' : get('hour')
  const asUTC = Date.parse(`${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}Z`)
  // ROUNDED to whole minutes, and that is not tidiness. `Intl` formats to whole seconds, so the
  // reassembled timestamp drops the milliseconds of `at` — and the expiry instant carries .999 by
  // construction. Unrounded, that lost fraction re-enters the result as a ~1s error, which pushes
  // the last millisecond of a day over into the next one. Every real zone offset is whole minutes.
  return Math.round((asUTC - at.getTime()) / 60_000)
}

/**
 * The merchant's chosen date → the INSTANT their day ends.
 *
 * 23:59:59.999 shop-local, so the voucher covers the whole of the day they picked. Returns null
 * for an absent or malformed date, which the caller reads as "no expiry" — a refusal is the
 * create endpoint's job, not this module's.
 *
 * The offset is read at the CANDIDATE instant, then re-read at the corrected one: near a DST
 * transition the first reading can be the wrong side of the jump. Two passes settle it, and a
 * third would change nothing for any real zone.
 */
export function expiryInstant(date: unknown, tz: unknown): string | null {
  if (typeof date !== 'string' || !DATE.test(date)) return null
  const zone = isTimezone(tz) ? (tz as string) : DEFAULT_TIMEZONE
  const naive = Date.parse(`${date}T23:59:59.999Z`)
  if (isNaN(naive)) return null
  let ms = naive - offsetMinutes(zone, new Date(naive)) * 60_000
  ms = naive - offsetMinutes(zone, new Date(ms)) * 60_000
  return new Date(ms).toISOString()
}

/**
 * The inverse, for the dashboard: which shop-local DATE does this instant end?
 *
 * The merchant must be shown back the date they typed, not a UTC rendering of it — for a shop east
 * of UTC the stored instant lands on the PREVIOUS calendar day in UTC, so a naive `slice(0, 10)`
 * shows them a voucher expiring a day earlier than they set it.
 */
export function expiryDate(instant: unknown, tz: unknown): string | null {
  if (typeof instant !== 'string' || !instant) return null
  const at = new Date(instant)
  if (isNaN(at.getTime())) return null
  const zone = isTimezone(tz) ? (tz as string) : DEFAULT_TIMEZONE
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
