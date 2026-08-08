# Custom Order Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Pro merchant replace the rolling order-date window with an explicit list of calendar dates they tick on a calendar, up to 90 days out, and make a shop with no offerable date pause honestly instead of silently selling on a window nobody chose.

**Architecture:** Everything lives in the existing `merchants.config -> 'fulfilment'` jsonb bag — **no migration**. `packages/shared/src/fulfilment.ts` gains a `mode` (`'rolling' | 'custom'`), a `custom_dates` allowlist and a `needs_review` pause flag, and `selectableDates` / `isDateSelectable` branch on them, so the storefront picker and order intake reach the same answer by construction. The Pro gate is a change-comparison in `app.ts`'s merchant PATCH (the `menuCategoriesChanged` shape, ADR 0013), and the downgrade/upgrade transitions are pure transforms called from `billing.ts`.

**Tech Stack:** TypeScript everywhere. Vitest for unit (`pnpm test`) and DB-backed API tests (`pnpm --filter @bitetime/backend test:db`). React 19 + Tailwind. `react-day-picker@10` — already a dependency, currently unused anywhere in `src`.

**Source of truth:** `CONTEXT.md → Fulfilment date` and [ADR 0015](../../adr/0015-a-shop-with-no-offerable-dates-pauses.md). Issue #210.

## Global Constraints

- **Dates are `YYYY-MM-DD` strings, never `Date` objects**, everywhere except inside `CustomDatesCalendar.tsx` (Task 4), which converts at its own boundary and is the single place allowed to hold a `Date`. A `Date` carrying a calendar date can shift a day under timezone conversion, and that day is what the merchant bakes on.
- **`now` is always a parameter**, never `Date.now()` read inside a pure function.
- **`fulfilmentConfig` is the only reader AND the only writer of the `fulfilment` bag.** The form writes through it, the backend normalises through it. Two parsers is a storefront that renders a window the settings form never saved.
- **Falls back per field.** One junk value must never discard the merchant's other fields — that is how a shop silently re-opens on a day it said it was closed.
- **The backend re-validates.** `db.ts` is RLS-exempt and the PATCH body is merchant-controlled. Browser validation never substitutes for the backend's.
- **Pro gates ask whether the write CHANGES the thing, never whether the body CARRIES it** (ADR 0013, `menuCategoriesChanged`). `ShopSettings` resubmits the whole config bag; a presence check would 403 a Basic ex-Pro shop editing its shipping rates.
- **Every merchant- and customer-facing string is bilingual** via `t(en, zh)`.
- **Backend relative imports keep `.js` specifiers** (NodeNext). Frontend imports are extensionless. `packages/shared` internal imports use `.js`.
- **No migration in this feature.** If you find yourself writing one, you have put state somewhere it does not belong.
- **Task ordering is load-bearing.** Task 1 ships a shared rule that is a no-op for every existing shop (`mode` absent reads as `rolling`). Tasks 2–3 make the backend able to gate and pause before Task 4 gives anyone a way to switch modes. Building the UI first would let a merchant save a `custom` config the backend does not yet understand.

---

### Task 1: The shared rule — mode, allowlist, pause

**Files:**
- Modify: `packages/shared/src/fulfilment.ts` (whole file — `FulfilmentConfig`, `fulfilmentConfig`, `selectableDates`, `isDateSelectable`, plus new exports)
- Modify: `packages/shared/src/fulfilment.test.ts` (append new describes; leave existing ones untouched)
- Modify: `packages/shared/src/index.ts:36-40` (the `./fulfilment.js` export block)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type FulfilmentMode = 'rolling' | 'custom'`
  - `interface FulfilmentConfig { mode: FulfilmentMode; lead_days: number; window_days: number; closed_weekdays: number[]; custom_dates: string[]; needs_review: boolean }`
  - `const FULFILMENT_HORIZON_DAYS = 90`
  - `const MAX_CUSTOM_DATES = 91`
  - `const DATES_ENDING_SOON_DAYS = 7`
  - `fulfilmentConfig(raw: unknown): FulfilmentConfig` *(existing name, widened)*
  - `selectableDates(cfg, tz, now): string[]` *(existing name, branches on mode)*
  - `isDateSelectable(date, cfg, tz, now): boolean` *(existing name, branches on mode)*
  - `customDateBounds(tz: string, now: Date): { first: string; last: string } | null`
  - `pruneCustomDates(cfg: FulfilmentConfig, tz: string, now: Date): string[]`
  - `type CustomDatesError = 'no_dates' | 'past_date' | 'beyond_horizon' | 'too_many'`
  - `validateCustomDates(dates: string[], tz: string, now: Date): CustomDatesError | null`
  - `type FulfilmentWarning = { kind: 'none' } | { kind: 'review' } | { kind: 'empty' } | { kind: 'ending'; last: string; daysLeft: number }`
  - `fulfilmentWarning(cfg, tz, now): FulfilmentWarning`
  - `pauseFulfilment(cfg: FulfilmentConfig): FulfilmentConfig | null`
  - `resumeFulfilment(cfg: FulfilmentConfig): FulfilmentConfig | null`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/fulfilment.test.ts` (keep the existing imports and add the new names to them):

```ts
import {
  FULFILMENT_HORIZON_DAYS, MAX_CUSTOM_DATES, DATES_ENDING_SOON_DAYS,
  customDateBounds, pruneCustomDates, validateCustomDates, fulfilmentWarning,
  pauseFulfilment, resumeFulfilment,
} from './fulfilment.js'

// 2026-07-20T04:00:00Z is noon on Monday 2026-07-20 in Kuala Lumpur (UTC+8).
const KL = 'Asia/Kuala_Lumpur'

const custom = (dates: string[], over: Partial<ReturnType<typeof fulfilmentConfig>> = {}) =>
  fulfilmentConfig({ fulfilment: { mode: 'custom', custom_dates: dates, ...over } })

describe('fulfilmentConfig — mode', () => {
  it('reads a shop that predates this feature as rolling, with an empty allowlist', () => {
    const cfg = fulfilmentConfig({ fulfilment: { lead_days: 1, window_days: 7 } })
    expect(cfg.mode).toBe('rolling')
    expect(cfg.custom_dates).toEqual([])
    expect(cfg.needs_review).toBe(false)
  })

  it('reads an unknown mode as rolling rather than throwing', () => {
    expect(fulfilmentConfig({ fulfilment: { mode: 'weekends' } }).mode).toBe('rolling')
  })

  it('sorts, dedupes and drops junk from custom_dates without touching the other fields', () => {
    const cfg = fulfilmentConfig({
      fulfilment: {
        mode: 'custom', lead_days: 2, window_days: 5, closed_weekdays: [0],
        custom_dates: ['2026-08-20', '2026-08-13', '2026-08-13', '2026-02-30', 'nonsense', 42],
      },
    })
    expect(cfg.custom_dates).toEqual(['2026-08-13', '2026-08-20'])
    // The rolling fields survive intact — switching mode is never a deletion.
    expect(cfg.lead_days).toBe(2)
    expect(cfg.window_days).toBe(5)
    expect(cfg.closed_weekdays).toEqual([0])
  })

  it('caps the allowlist length so a crafted body cannot bloat the row', () => {
    const many = Array.from({ length: 400 }, (_, i) => `2026-${String((i % 12) + 1).padStart(2, '0')}-01`)
    expect(fulfilmentConfig({ fulfilment: { mode: 'custom', custom_dates: many } }).custom_dates.length)
      .toBeLessThanOrEqual(MAX_CUSTOM_DATES)
  })

  it('reads needs_review as a real boolean only', () => {
    expect(fulfilmentConfig({ fulfilment: { needs_review: true } }).needs_review).toBe(true)
    expect(fulfilmentConfig({ fulfilment: { needs_review: 'yes' } }).needs_review).toBe(false)
  })
})

describe('selectableDates — custom mode', () => {
  it('offers exactly the ticked dates, ignoring lead, window and closed weekdays', () => {
    // 2026-07-26 is a Sunday, which closed_weekdays would remove in rolling mode.
    const cfg = custom(['2026-07-21', '2026-07-26', '2026-09-01'], {
      lead_days: 5, window_days: 1, closed_weekdays: [0, 1, 2, 3, 4, 5, 6],
    })
    expect(selectableDates(cfg, KL, NOON_MYT)).toEqual(['2026-07-21', '2026-07-26', '2026-09-01'])
  })

  it('offers today when today is ticked — ticked is ticked', () => {
    expect(selectableDates(custom(['2026-07-20']), KL, NOON_MYT)).toEqual(['2026-07-20'])
  })

  it('drops dates that have gone past on the SHOP clock', () => {
    expect(selectableDates(custom(['2026-07-19', '2026-07-21']), KL, NOON_MYT)).toEqual(['2026-07-21'])
  })

  it('drops dates beyond the 90-day horizon', () => {
    // 2026-07-20 + 91 days = 2026-10-19, one past the last selectable day.
    expect(selectableDates(custom(['2026-10-18', '2026-10-19']), KL, NOON_MYT)).toEqual(['2026-10-18'])
  })

  it('offers nothing when every ticked date has passed', () => {
    expect(selectableDates(custom(['2026-07-01']), KL, NOON_MYT)).toEqual([])
  })
})

describe('needs_review pauses the shop on BOTH sides of the wire', () => {
  const paused = fulfilmentConfig({
    fulfilment: { mode: 'rolling', lead_days: 0, window_days: 14, needs_review: true },
  })

  it('offers no date at all, even though the rolling window is wide open', () => {
    expect(selectableDates(paused, KL, NOON_MYT)).toEqual([])
  })

  it('refuses the date the rolling window would otherwise allow', () => {
    expect(isDateSelectable('2026-07-21', paused, KL, NOON_MYT)).toBe(false)
  })
})

describe('isDateSelectable agrees with selectableDates in custom mode', () => {
  const cfg = custom(['2026-07-21', '2026-08-01'])

  it('accepts every date the list offers and refuses everything else', () => {
    const offered = selectableDates(cfg, KL, NOON_MYT)
    for (const d of offered) expect(isDateSelectable(d, cfg, KL, NOON_MYT)).toBe(true)
    expect(isDateSelectable('2026-07-22', cfg, KL, NOON_MYT)).toBe(false)
    expect(isDateSelectable('not-a-date', cfg, KL, NOON_MYT)).toBe(false)
  })
})

describe('customDateBounds', () => {
  it('runs from today on the shop clock to today + 90', () => {
    expect(customDateBounds(KL, NOON_MYT)).toEqual({ first: '2026-07-20', last: '2026-10-18' })
    expect(FULFILMENT_HORIZON_DAYS).toBe(90)
  })
})

describe('pruneCustomDates', () => {
  it('keeps today and the future, drops the past', () => {
    expect(pruneCustomDates(custom(['2026-07-01', '2026-07-20', '2026-08-01']), KL, NOON_MYT))
      .toEqual(['2026-07-20', '2026-08-01'])
  })
})

describe('validateCustomDates', () => {
  it('passes a normal list', () => {
    expect(validateCustomDates(['2026-07-21', '2026-08-01'], KL, NOON_MYT)).toBeNull()
  })

  it('refuses an empty list — a shop with no date cannot be ordered from', () => {
    expect(validateCustomDates([], KL, NOON_MYT)).toBe('no_dates')
  })

  it('refuses a past date and a date beyond the horizon by their own names', () => {
    expect(validateCustomDates(['2026-07-19'], KL, NOON_MYT)).toBe('past_date')
    expect(validateCustomDates(['2026-10-19'], KL, NOON_MYT)).toBe('beyond_horizon')
  })

  it('refuses more dates than the cap', () => {
    const tooMany = Array.from({ length: MAX_CUSTOM_DATES + 1 }, (_, i) =>
      fromDayMsForTest(Date.UTC(2026, 6, 21) + i * 86_400_000))
    expect(validateCustomDates(tooMany, KL, NOON_MYT)).toBe('too_many')
  })
})

// Local helper so the test above does not reach into the module's private formatter.
function fromDayMsForTest(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

describe('fulfilmentWarning', () => {
  it('says nothing about a rolling shop — a window never runs dry', () => {
    expect(fulfilmentWarning(fulfilmentConfig({}), KL, NOON_MYT)).toEqual({ kind: 'none' })
  })

  it('reports the review first, whatever the dates say', () => {
    const cfg = custom(['2026-08-01'], { needs_review: true })
    expect(fulfilmentWarning(cfg, KL, NOON_MYT)).toEqual({ kind: 'review' })
  })

  it('reports empty when every ticked date has passed', () => {
    expect(fulfilmentWarning(custom(['2026-07-01']), KL, NOON_MYT)).toEqual({ kind: 'empty' })
  })

  it('reports ending when the last date is inside the warning window', () => {
    expect(fulfilmentWarning(custom(['2026-07-21', '2026-07-24']), KL, NOON_MYT))
      .toEqual({ kind: 'ending', last: '2026-07-24', daysLeft: 4 })
    expect(DATES_ENDING_SOON_DAYS).toBe(7)
  })

  it('says nothing while the last date is comfortably ahead', () => {
    expect(fulfilmentWarning(custom(['2026-09-01']), KL, NOON_MYT)).toEqual({ kind: 'none' })
  })
})

describe('pauseFulfilment / resumeFulfilment', () => {
  it('pausing a custom shop reverts the mode, keeps the dates and raises the flag', () => {
    const cfg = custom(['2026-08-01'], { lead_days: 3, window_days: 7, closed_weekdays: [0] })
    const paused = pauseFulfilment(cfg)!
    expect(paused.mode).toBe('rolling')
    expect(paused.needs_review).toBe(true)
    expect(paused.custom_dates).toEqual(['2026-08-01'])
    expect(paused.lead_days).toBe(3)
    expect(paused.window_days).toBe(7)
    expect(paused.closed_weekdays).toEqual([0])
  })

  it('pausing a shop that was never on custom dates is a no-op the caller can skip', () => {
    expect(pauseFulfilment(fulfilmentConfig({}))).toBeNull()
  })

  it('is idempotent — pausing an already-paused shop changes nothing further', () => {
    const paused = pauseFulfilment(custom(['2026-08-01']))!
    expect(pauseFulfilment(paused)).toBeNull()
  })

  it('resuming restores custom mode and clears the flag', () => {
    const paused = pauseFulfilment(custom(['2026-08-01']))!
    const back = resumeFulfilment(paused)!
    expect(back.mode).toBe('custom')
    expect(back.needs_review).toBe(false)
    expect(back.custom_dates).toEqual(['2026-08-01'])
  })

  it('does not resume a paused shop with no dates to go back to — the review still stands', () => {
    const paused = fulfilmentConfig({ fulfilment: { needs_review: true, custom_dates: [] } })
    expect(resumeFulfilment(paused)).toBeNull()
  })

  it('resuming a shop that was never paused is a no-op', () => {
    expect(resumeFulfilment(custom(['2026-08-01']))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
pnpm --filter @bitetime/shared test -- fulfilment
```

Expected: FAIL — `FULFILMENT_HORIZON_DAYS is not exported`, and the mode assertions fail on the current `FulfilmentConfig`.

- [ ] **Step 3: Widen `FulfilmentConfig` and `fulfilmentConfig`**

In `packages/shared/src/fulfilment.ts`, replace the interface, the default and the `LEAD_MAX` / `WINDOW_MAX` constants:

```ts
/** Which rule decides the dates a shop offers. Closed set — see CONTEXT.md → Fulfilment date. */
export type FulfilmentMode = 'rolling' | 'custom'

/** Per-merchant shape, stored under `merchants.config -> 'fulfilment'`. */
export interface FulfilmentConfig {
  /** `rolling` computes a moving range; `custom` offers an explicit allowlist and nothing else. */
  mode: FulfilmentMode
  /** Days before the first date a customer may pick. 0 allows same-day. ROLLING ONLY. */
  lead_days: number
  /** How many dates are offered, counted from the first selectable one. ROLLING ONLY. */
  window_days: number
  /** Weekdays the shop takes nothing, 0 = Sunday … 6 = Saturday. ROLLING ONLY. */
  closed_weekdays: number[]
  /** The dates a `custom` shop offers, `YYYY-MM-DD`, sorted and deduped. CUSTOM ONLY. */
  custom_dates: string[]
  /**
   * The shop is PAUSED until its owner confirms its dates in the Fulfilment tab.
   *
   * Set when a Pro shop steps down and loses custom dates (ADR 0015). It is checked here, in the
   * rule both sides of the wire share, rather than in the storefront — a pause the backend does
   * not honour is a pause a scripted POST walks straight through.
   */
  needs_review: boolean
}

export const DEFAULT_FULFILMENT: FulfilmentConfig = {
  mode: 'rolling',
  lead_days: 0,
  window_days: 14,
  closed_weekdays: [],
  custom_dates: [],
  needs_review: false,
}

export const DEFAULT_TIMEZONE = 'Asia/Kuala_Lumpur'

const LEAD_MAX = 30

/**
 * How far ahead a shop may commit, and it is ONE horizon for both modes — `window_days` is
 * clamped to it and a ticked date beyond it is never offered. The feedback asked for "three
 * months"; this is that, in the day-count arithmetic this module is already built from.
 */
export const FULFILMENT_HORIZON_DAYS = 90

/** today … today+90 inclusive is 91 days, so no honest allowlist can be longer. */
export const MAX_CUSTOM_DATES = 91

/** How close the last remaining date gets before the dashboard says so. */
export const DATES_ENDING_SOON_DAYS = 7
```

Then rewrite `fulfilmentConfig` to parse the two new fields, still per-field:

```ts
export function fulfilmentConfig(raw: unknown): FulfilmentConfig {
  const bag = (raw ?? {}) as Record<string, unknown>
  const f = (bag.fulfilment ?? {}) as Record<string, unknown>
  if (typeof f !== 'object' || f === null) return { ...DEFAULT_FULFILMENT }
  const closed = Array.isArray(f.closed_weekdays) ? f.closed_weekdays : []
  const dates = Array.isArray(f.custom_dates) ? f.custom_dates : []
  return {
    // Anything that is not the one known alternative reads as rolling: every shop predating this
    // feature, and any future value this build has never heard of. Never a throw — a config that
    // cannot be parsed must not take checkout down.
    mode: f.mode === 'custom' ? 'custom' : 'rolling',
    lead_days: clampInt(f.lead_days, 0, LEAD_MAX, DEFAULT_FULFILMENT.lead_days),
    window_days: clampInt(f.window_days, 1, FULFILMENT_HORIZON_DAYS, DEFAULT_FULFILMENT.window_days),
    closed_weekdays: [...new Set(
      closed.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6),
    )].sort((a, b) => a - b),
    // Structural only: real calendar dates, deduped, sorted, length-capped. The 90-day HORIZON is
    // not applied here because it needs a clock and this function deliberately has none — it is
    // enforced by `selectableDates` (which never offers a date past it) and `validateCustomDates`
    // (which refuses to save one).
    custom_dates: [...new Set(
      dates.filter((d): d is string => typeof d === 'string' && dayMs(d) !== null),
    )].sort().slice(0, MAX_CUSTOM_DATES),
    needs_review: f.needs_review === true,
  }
}
```

- [ ] **Step 4: Branch the two read functions on mode, and honour the pause**

Replace `selectableDates` and `isDateSelectable` in the same file:

```ts
/** The allowlist's bounds as UTC-midnight ms, or null if the shop clock cannot be read. */
function customBoundsMs(tz: string, now: Date): { first: number; last: number } | null {
  const today = dayMs(todayInZone(tz, now))
  if (today === null) return null
  return { first: today, last: today + FULFILMENT_HORIZON_DAYS * DAY }
}

/** The first and last date a merchant may TICK, for the calendar's own bounds. */
export function customDateBounds(tz: string, now: Date): { first: string; last: string } | null {
  const b = customBoundsMs(tz, now)
  return b ? { first: fromDayMs(b.first), last: fromDayMs(b.last) } : null
}

/**
 * Every date this shop is currently taking orders for, in order. What the picker renders.
 *
 * `needs_review` short-circuits both modes: a shop awaiting its owner's confirmation offers
 * nothing at all. That check lives HERE, not in the storefront, so order intake refuses the same
 * dates the picker declines to draw (ADR 0015).
 *
 * In `rolling`, closed weekdays are REMOVED from the window and do not extend it: `window_days`
 * is how far ahead the merchant is willing to commit, not a quota of open days.
 *
 * In `custom`, lead days, the window and closed weekdays do not apply at all — the merchant
 * named the dates, and honouring their own notice period is theirs to do by not ticking tomorrow.
 */
export function selectableDates(cfg: FulfilmentConfig, tz: string, now: Date): string[] {
  if (cfg.needs_review) return []
  if (cfg.mode === 'custom') {
    const b = customBoundsMs(tz, now)
    if (!b) return []
    // Already sorted and deduped by `fulfilmentConfig`, so this preserves order for free.
    return cfg.custom_dates.filter(d => {
      const ms = dayMs(d)
      return ms !== null && ms >= b.first && ms <= b.last
    })
  }
  const b = windowBounds(cfg, tz, now)
  if (!b) return []
  const out: string[] = []
  for (let ms = b.first; ms <= b.last; ms += DAY) {
    if (!cfg.closed_weekdays.includes(new Date(ms).getUTCDay())) out.push(fromDayMs(ms))
  }
  return out
}

/**
 * May this shop take an order for this date, right now?
 *
 * The intake check. Deliberately a predicate over one date rather than a lookup in
 * `selectableDates`, because intake gets a date from a request body and must judge it without
 * building a list — but the two MUST agree, and a test pins that they do.
 */
export function isDateSelectable(date: string, cfg: FulfilmentConfig, tz: string, now: Date): boolean {
  const ms = dayMs(date)
  if (ms === null) return false
  if (cfg.needs_review) return false
  if (cfg.mode === 'custom') {
    const b = customBoundsMs(tz, now)
    if (!b) return false
    return ms >= b.first && ms <= b.last && cfg.custom_dates.includes(date)
  }
  const b = windowBounds(cfg, tz, now)
  if (!b) return false
  if (ms < b.first || ms > b.last) return false
  return !cfg.closed_weekdays.includes(new Date(ms).getUTCDay())
}
```

- [ ] **Step 5: Add the save-time and dashboard helpers**

Append to `packages/shared/src/fulfilment.ts`:

```ts
/** Drop the dates that have gone past. Called on SAVE, never on read — see ADR 0015. */
export function pruneCustomDates(cfg: FulfilmentConfig, tz: string, now: Date): string[] {
  const today = dayMs(todayInZone(tz, now))
  if (today === null) return cfg.custom_dates
  return cfg.custom_dates.filter(d => {
    const ms = dayMs(d)
    return ms !== null && ms >= today
  })
}

export type CustomDatesError = 'no_dates' | 'past_date' | 'beyond_horizon' | 'too_many'

/**
 * Why this allowlist cannot be saved, or null.
 *
 * `no_dates` is the twin of the all-seven-days-closed refusal: it stops the merchant walking
 * into the paused state from the form itself, so only time or billing can put them there.
 */
export function validateCustomDates(dates: string[], tz: string, now: Date): CustomDatesError | null {
  if (dates.length === 0) return 'no_dates'
  if (dates.length > MAX_CUSTOM_DATES) return 'too_many'
  const b = customBoundsMs(tz, now)
  if (!b) return null
  for (const d of dates) {
    const ms = dayMs(d)
    if (ms === null || ms < b.first) return 'past_date'
    if (ms > b.last) return 'beyond_horizon'
  }
  return null
}

export type FulfilmentWarning =
  | { kind: 'none' }
  | { kind: 'review' }
  | { kind: 'empty' }
  | { kind: 'ending'; last: string; daysLeft: number }

/**
 * What the merchant dashboard needs to say about this shop's dates.
 *
 * A rolling shop is never warned: a moving window cannot run dry. A custom shop can, which is
 * the whole reason this exists — the merchant who ticked three dates in August must hear about
 * it in July, not from a customer in September.
 */
export function fulfilmentWarning(cfg: FulfilmentConfig, tz: string, now: Date): FulfilmentWarning {
  if (cfg.needs_review) return { kind: 'review' }
  if (cfg.mode !== 'custom') return { kind: 'none' }
  const open = selectableDates(cfg, tz, now)
  if (open.length === 0) return { kind: 'empty' }
  const today = dayMs(todayInZone(tz, now))
  const last = open[open.length - 1]
  const lastMs = dayMs(last)
  if (today === null || lastMs === null) return { kind: 'none' }
  const daysLeft = Math.round((lastMs - today) / DAY)
  return daysLeft <= DATES_ENDING_SOON_DAYS ? { kind: 'ending', last, daysLeft } : { kind: 'none' }
}

/**
 * The config a shop stepping down from Pro is left with, or null when there is nothing to do.
 *
 * Reverting the mode WITHOUT the flag would quietly resume a rolling window the merchant never
 * agreed to — very possibly the untouched 0/14/none default — and start taking same-day orders
 * on their behalf. The flag is what makes the revert honest. See ADR 0015.
 *
 * Returning null rather than an unchanged config is what makes the caller idempotent: a replayed
 * webhook does no write at all.
 */
export function pauseFulfilment(cfg: FulfilmentConfig): FulfilmentConfig | null {
  if (cfg.mode !== 'custom') return null
  return { ...cfg, mode: 'rolling', needs_review: true }
}

/**
 * The config a shop coming BACK to Pro is restored to, or null when there is nothing to restore.
 *
 * Deliberately not symmetric with vouchers and promos, which stay revoked (ADR 0010). The
 * difference is that this dormant state is a STOPPED SHOP, and there is nothing ambiguous to
 * decide on the way back — these are the merchant's own dates, unchanged. A paying shop staying
 * dark for want of a click is not a rule worth having.
 *
 * A paused shop with no dates left is NOT resumed: there is nothing to go back to, so the review
 * still stands.
 */
export function resumeFulfilment(cfg: FulfilmentConfig): FulfilmentConfig | null {
  if (!cfg.needs_review || cfg.custom_dates.length === 0) return null
  return { ...cfg, mode: 'custom', needs_review: false }
}
```

- [ ] **Step 6: Export the new names**

In `packages/shared/src/index.ts`, replace the `./fulfilment.js` block:

```ts
export {
  fulfilmentConfig, isTimezone, todayInZone,
  isDateSelectable, selectableDates,
  customDateBounds, pruneCustomDates, validateCustomDates,
  fulfilmentWarning, pauseFulfilment, resumeFulfilment,
  DEFAULT_FULFILMENT, DEFAULT_TIMEZONE,
  FULFILMENT_HORIZON_DAYS, MAX_CUSTOM_DATES, DATES_ENDING_SOON_DAYS,
} from './fulfilment.js'
export type { FulfilmentConfig, FulfilmentMode, CustomDatesError, FulfilmentWarning } from './fulfilment.js'
```

- [ ] **Step 7: Run the whole suite**

```bash
pnpm test && pnpm typecheck
```

Expected: PASS. Existing `fulfilment.test.ts` cases must still pass untouched — `mode` absent reads as `rolling`, so every current shop behaves exactly as before. If `apps/backend/tests/unit/writes.test.ts` or the API suites fail on the widened `FulfilmentConfig` shape, fix the fixtures by spreading `DEFAULT_FULFILMENT`, never by narrowing the type.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/fulfilment.ts packages/shared/src/fulfilment.test.ts packages/shared/src/index.ts
git commit -m "feat(fulfilment): custom date mode and the pause flag in the shared rule"
```

---

### Task 2: The backend gate — Pro, and one normaliser

**Files:**
- Modify: `apps/backend/src/writes.ts` (append `customDatesChanged` beside `menuCategoriesChanged`, ~line 384)
- Modify: `apps/backend/src/app.ts:236-277` (the `PATCH /api/merchants/:id` handler)
- Modify: `apps/backend/tests/api/writes-merchants.test.ts` (append a describe)

**Interfaces:**
- Consumes: `fulfilmentConfig`, `validateCustomDates`, `FULFILMENT_HORIZON_DAYS` from `@bitetime/shared` (Task 1).
- Produces: `customDatesChanged(patch: Record<string, unknown>, stored: Record<string, any> | null): boolean`

- [ ] **Step 1: Write the failing tests**

Append to `apps/backend/tests/api/writes-merchants.test.ts`:

```ts
describe('PATCH /api/merchants/:id — custom order dates', () => {
  // Dates far enough out that this suite does not rot: computed from the run's own clock.
  const iso = (offsetDays: number) => {
    const d = new Date(Date.now() + offsetDays * 86_400_000)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }

  async function shop(plan: 'basic' | 'pro', config: unknown = {}) {
    await resetMerchant('date-shop')
    const client = await makeUser(`dates-${plan}-${Math.random()}@example.com`, 'password123')
    const { token, userId } = await tokenOf(client)
    const m = await seedMerchant({ slug: 'date-shop', owner_id: userId, status: 'active', plan })
    await serviceClient().from('merchants').update({ config }).eq('id', m.id)
    return { id: m.id, token }
  }

  const bag = (over: Record<string, unknown>) => ({ config: { fulfilment: { mode: 'custom', custom_dates: [iso(7)], ...over } } })

  it('lets a Pro shop switch to custom dates', async () => {
    const { id, token } = await shop('pro')
    const res = await patch(`/api/merchants/${id}`, bag({}), token)
    expect(res.status).toBe(200)
    const row = (await res.json()) as { config: any }
    expect(row.config.fulfilment.mode).toBe('custom')
    expect(row.config.fulfilment.custom_dates).toEqual([iso(7)])
  })

  it('refuses a Basic shop switching to custom dates', async () => {
    const { id, token } = await shop('basic')
    const res = await patch(`/api/merchants/${id}`, bag({}), token)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('requires_pro')
  })

  it('lets a Basic ex-Pro shop resubmit its UNCHANGED bag while editing something else', async () => {
    // The failure this prevents: ShopSettings resubmits the whole config, so a presence-based
    // gate would 403 an ex-Pro shop editing its shipping rates (ADR 0013).
    const stored = { fulfilment: { mode: 'rolling', custom_dates: [iso(7)], needs_review: true } }
    const { id, token } = await shop('basic', stored)
    const res = await patch(`/api/merchants/${id}`, {
      config: { fulfilment: { mode: 'rolling', custom_dates: [iso(7)], needs_review: false } },
    }, token)
    expect(res.status).toBe(200)
    // Confirming clears the pause — that write is NOT part of the Pro comparison.
    expect((await res.json()).config.fulfilment.needs_review).toBe(false)
  })

  it('refuses a Basic shop CLEARING the dates it may no longer edit', async () => {
    const { id, token } = await shop('basic', { fulfilment: { mode: 'rolling', custom_dates: [iso(7)] } })
    const res = await patch(`/api/merchants/${id}`, {
      config: { fulfilment: { mode: 'rolling', custom_dates: [] } },
    }, token)
    expect(res.status).toBe(403)
  })

  it('refuses a custom save with no dates — the merchant cannot pause their own shop from the form', async () => {
    const { id, token } = await shop('pro')
    const res = await patch(`/api/merchants/${id}`, bag({ custom_dates: [] }), token)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('no_dates')
  })

  it('refuses a date beyond the 90-day horizon', async () => {
    const { id, token } = await shop('pro')
    const res = await patch(`/api/merchants/${id}`, bag({ custom_dates: [iso(120)] }), token)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('beyond_horizon')
  })

  it('normalises the bag it stores rather than trusting the body', async () => {
    const { id, token } = await shop('pro')
    const res = await patch(`/api/merchants/${id}`, {
      config: { fulfilment: { mode: 'custom', custom_dates: [iso(9), iso(7), iso(7)], junk: 'x', window_days: 9999 } },
    }, token)
    expect(res.status).toBe(200)
    const f = (await res.json()).config.fulfilment
    expect(f.custom_dates).toEqual([iso(7), iso(9)])   // sorted, deduped
    expect(f.window_days).toBe(90)                      // clamped to the horizon
    expect(f.junk).toBeUndefined()                      // unknown keys do not survive
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm --filter @bitetime/backend test:db -- writes-merchants
```

Expected: FAIL — the Basic shop's custom save returns 200, and the stored bag keeps `junk`.

- [ ] **Step 3: Add the change-comparison to `writes.ts`**

Append after `menuCategoriesChanged` in `apps/backend/src/writes.ts` (and add `fulfilmentConfig` to the `@bitetime/shared` import at the top of the file):

```ts
/**
 * Does this shop-config PATCH CHANGE the shop's custom order dates? (ADR 0015)
 *
 * `menuCategoriesChanged`'s sibling, same shape and same recorded reason: asking whether the
 * field is PRESENT is the wrong question, because `ShopSettings` resubmits a whole config bag.
 *
 * The compared slice is deliberately `{ mode, custom_dates }` and NOTHING ELSE. `needs_review`
 * is excluded on purpose: clearing it is exactly what a downgraded BASIC shop must be able to do
 * to reopen, and folding it into this comparison would lock a paused shop out of its own
 * confirmation — the one write that is not a Pro capability.
 *
 * CLEARING IS A CHANGE, as everywhere else: the dates a Basic shop may no longer edit stay put
 * until it is Pro again. A Pro feature must not be removable by ceasing to pay for it.
 */
export function customDatesChanged(
  patch: Record<string, unknown>,
  stored: Record<string, any> | null,
): boolean {
  const submitted = (patch.config as Record<string, unknown> | undefined)
  if (submitted === undefined) return false
  const a = fulfilmentConfig(submitted)
  const b = fulfilmentConfig(stored?.config ?? null)
  return canonicalJson({ mode: a.mode, custom_dates: a.custom_dates })
    !== canonicalJson({ mode: b.mode, custom_dates: b.custom_dates })
}
```

- [ ] **Step 4: Wire the gate, the validation and the normaliser into the route**

In `apps/backend/src/app.ts`, inside `app.patch('/api/merchants/:id', …)`, immediately after the existing `menuCategoriesChanged` block:

```ts
  // Custom order dates are Pro, gated by the same change-comparison and for the same recorded
  // reason (ADR 0015). `needs_review` is outside the comparison so a paused Basic shop can still
  // press Confirm and reopen — see customDatesChanged.
  if (customDatesChanged(patch, stored) && !(await hasProAccess(c))) {
    return c.json({ error: REQUIRES_PRO }, 403)
  }
  // The body is merchant-controlled and `admin` bypasses RLS, so the bag that lands in the row is
  // the one THIS function produces, never the one that arrived: sorted, deduped, clamped, with
  // unknown keys dropped. One writer, one reader — the storefront can never read back a shape the
  // settings form did not save.
  if (patch.config !== undefined) {
    const fulfilment = fulfilmentConfig(patch.config)
    if (fulfilment.mode === 'custom') {
      // The horizon needs a clock, so it cannot live in fulfilmentConfig. Refused here rather
      // than silently trimmed: a merchant who ticked a date in December must be told it did not
      // save, not discover in December that it did not.
      const bad = validateCustomDates(fulfilment.custom_dates, stored.timezone ?? DEFAULT_TIMEZONE, new Date())
      if (bad) return c.json({ error: bad }, 400)
    }
    patch.config = { ...(patch.config as Record<string, unknown>), fulfilment }
  }
```

Add to `app.ts`'s imports: `customDatesChanged` from `./writes.js`, and `fulfilmentConfig, validateCustomDates, DEFAULT_TIMEZONE` from `@bitetime/shared` (check whether the file already imports some of these before adding duplicates).

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @bitetime/backend test:db -- writes-merchants
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/writes.ts apps/backend/src/app.ts apps/backend/tests/api/writes-merchants.test.ts
git commit -m "feat(merchants): gate custom order dates behind Pro and normalise the fulfilment bag"
```

---

### Task 3: Pause at downgrade, restore at re-upgrade

**Files:**
- Modify: `apps/backend/src/billing.ts` — `revokeProArtifacts` (~line 114) and `reconcilePlan` (~line 66-90)
- Modify: `apps/backend/tests/api/webhook-plan.test.ts` (append a describe)

**Interfaces:**
- Consumes: `fulfilmentConfig`, `pauseFulfilment`, `resumeFulfilment` from `@bitetime/shared` (Task 1).
- Produces: `pauseCustomDates(merchantId: string): Promise<void>` and `restoreCustomDates(merchantId: string): Promise<void>`, both exported from `billing.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/backend/tests/api/webhook-plan.test.ts`:

```ts
describe('custom order dates across a plan change (ADR 0015)', () => {
  const iso = (offsetDays: number) => {
    const d = new Date(Date.now() + offsetDays * 86_400_000)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }

  async function seedWithDates(plan: 'basic' | 'pro', fulfilment: Record<string, unknown>) {
    await resetMerchant('dates-plan')
    const client = await makeUser(`dates-plan-${Math.random()}@example.com`, 'password123')
    const m = await seedMerchant({ slug: 'dates-plan', owner_id: await userIdOf(client), status: 'active', plan })
    await serviceClient().from('merchants').update({ config: { fulfilment } }).eq('id', m.id)
    return m.id
  }

  const readFulfilment = async (id: string) => {
    const { data } = await serviceClient().from('merchants').select('config').eq('id', id).single()
    return (data!.config as any).fulfilment
  }

  it('pauses a custom-dates shop when it steps down to basic', async () => {
    const id = await seedWithDates('pro', { mode: 'custom', custom_dates: [iso(7)], lead_days: 3 })

    const res = await postWebhook(subscriptionUpdated(id, PRICES.basicMonthly))
    expect(res.status).toBe(200)

    const f = await readFulfilment(id)
    expect(f.mode).toBe('rolling')
    expect(f.needs_review).toBe(true)
    expect(f.custom_dates).toEqual([iso(7)])   // kept, never deleted
    expect(f.lead_days).toBe(3)                // the rolling settings survive intact
  })

  it('leaves a rolling shop alone when it steps down', async () => {
    const id = await seedWithDates('pro', { mode: 'rolling', lead_days: 2 })

    await postWebhook(subscriptionUpdated(id, PRICES.basicMonthly))

    const f = await readFulfilment(id)
    expect(f.needs_review).toBe(false)
    expect(f.mode).toBe('rolling')
  })

  it('restores custom mode when the shop comes back to Pro', async () => {
    const id = await seedWithDates('basic', {
      mode: 'rolling', custom_dates: [iso(7)], needs_review: true,
    })

    const res = await postWebhook(subscriptionUpdated(id, PRICES.proMonthly))
    expect(res.status).toBe(200)

    const f = await readFulfilment(id)
    expect(f.mode).toBe('custom')
    expect(f.needs_review).toBe(false)
  })

  it('does not resume a paused shop whose dates are all gone', async () => {
    const id = await seedWithDates('basic', { mode: 'rolling', custom_dates: [], needs_review: true })

    await postWebhook(subscriptionUpdated(id, PRICES.proMonthly))

    const f = await readFulfilment(id)
    expect(f.needs_review).toBe(true)
    expect(f.mode).toBe('rolling')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm --filter @bitetime/backend test:db -- webhook-plan
```

Expected: FAIL — `needs_review` is `undefined` after the downgrade.

- [ ] **Step 3: Implement the two transitions**

In `apps/backend/src/billing.ts`, add to the `@bitetime/shared` import: `fulfilmentConfig, pauseFulfilment, resumeFulfilment`. Then add:

```ts
/**
 * Read the shop's config, apply a pure fulfilment transform, write it back if it changed.
 *
 * The read-modify-write is safe because these two transitions only ever fire on a PLAN CHANGE —
 * `reconcilePlan` reads the previous plan and acts on the transition, so a renewal replaying the
 * same event does nothing. The transforms return null when there is nothing to do, which is what
 * makes a replayed webhook cost zero writes.
 */
async function applyFulfilment(
  merchantId: string,
  transform: (cfg: ReturnType<typeof fulfilmentConfig>) => ReturnType<typeof fulfilmentConfig> | null,
) {
  const { data } = await admin.from('merchants').select('config').eq('id', merchantId).maybeSingle()
  const config = (data?.config ?? {}) as Record<string, unknown>
  const next = transform(fulfilmentConfig(config))
  if (!next) return
  const { error } = await admin
    .from('merchants')
    .update({ config: { ...config, fulfilment: next } })
    .eq('id', merchantId)
  if (error) throw error
}

/** Step down: custom dates revert to the rolling window, PAUSED until the owner confirms. */
export const pauseCustomDates = (merchantId: string) => applyFulfilment(merchantId, pauseFulfilment)

/** Step up: the shop's own dates come back and the pause lifts. See ADR 0015 for the asymmetry. */
export const restoreCustomDates = (merchantId: string) => applyFulfilment(merchantId, resumeFulfilment)
```

Inside `revokeProArtifacts`, after `revokeMenuCategories(merchantId)`:

```ts
  // Custom order dates (ADR 0015). Unlike the artifacts above, this one is REVERSIBLE by
  // re-subscribing — the dormant state here is a stopped shop, not a dormant voucher.
  await pauseCustomDates(merchantId)
```

In `reconcilePlan`, beside the existing downgrade branch:

```ts
  if (before?.plan === 'pro' && tier.plan === 'basic') {
    await revokeProArtifacts(merchantId)
  }
  // The only thing in this codebase that comes BACK on a re-subscribe. Idempotent: a replayed
  // event finds no `needs_review` to clear and writes nothing.
  if (before?.plan !== 'pro' && tier.plan === 'pro') {
    await restoreCustomDates(merchantId)
  }
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @bitetime/backend test:db -- webhook-plan
pnpm --filter @bitetime/backend test:db -- billing
```

Expected: PASS, including the existing lapse and sweep suites — `lapseMerchant` calls `revokeProArtifacts`, so a suspended shop is paused too, which is correct and must not break those tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/billing.ts apps/backend/tests/api/webhook-plan.test.ts
git commit -m "feat(billing): pause custom order dates on downgrade, restore them on re-upgrade"
```

---

### Task 4: The Fulfilment tab — mode toggle, calendar, review confirm

**Files:**
- Create: `apps/frontend/src/merchant/CustomDatesCalendar.tsx`
- Modify: `apps/frontend/src/merchant/FulfilmentTab.tsx` (whole component)
- Modify: `apps/frontend/src/index.css` (one import line at the top)

**Interfaces:**
- Consumes: `fulfilmentConfig`, `customDateBounds`, `pruneCustomDates`, `validateCustomDates`, `DEFAULT_TIMEZONE`, `FULFILMENT_HORIZON_DAYS` from `@bitetime/shared`; `useProAccess` from `../plan`; `ProBadge`, `UpgradeLink` from `./ProLock`; `updateMerchantConfig` from `../store`.
- Produces: `CustomDatesCalendar` — `{ value: string[]; onChange: (dates: string[]) => void; first: string; last: string; t: (en: string, zh: string) => string; lang: 'en' | 'zh'; disabled?: boolean }`

- [ ] **Step 1: Import the calendar stylesheet**

At the very top of `apps/frontend/src/index.css`, above the existing content:

```css
/* react-day-picker's own layout styles. Imported HERE rather than in the component so it is one
   bundled stylesheet: an @import inside a component's CSS is invisible to the preload scanner
   and would be a second request behind a render-blocking one (CLAUDE.md → Deployment). This is a
   package specifier, resolved and inlined by Vite at build time, not a runtime @import url(). */
@import 'react-day-picker/style.css';
```

- [ ] **Step 2: Write the calendar component**

Create `apps/frontend/src/merchant/CustomDatesCalendar.tsx`:

```tsx
import { useMemo } from 'react'
import { DayPicker } from 'react-day-picker'
import { zhCN, enGB } from 'react-day-picker/locale'

interface Props {
  /** The ticked dates, `YYYY-MM-DD`, sorted. */
  value: string[]
  onChange: (dates: string[]) => void
  /** The horizon's bounds, `YYYY-MM-DD`, from `customDateBounds`. */
  first: string
  last: string
  t: (en: string, zh: string) => string
  lang: 'en' | 'zh'
  disabled?: boolean
}

/**
 * The one place in this codebase allowed to hold a `Date` for a calendar date.
 *
 * `DayPicker` speaks `Date`, the rest of the app speaks `YYYY-MM-DD`, and the conversion is where
 * a day gets lost. Both directions go through LOCAL midnight — `new Date(y, m, d)` and the local
 * getters — never UTC and never `Date.parse`, so the two are exact inverses whatever zone the
 * merchant's browser is in. Mixing the two conventions is what puts a tick on the wrong day.
 *
 * The shop's clock does NOT come into it: `first` and `last` are computed from the shop timezone
 * by the caller and arrive here as strings.
 */
const toDate = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const toIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function CustomDatesCalendar({ value, onChange, first, last, t, lang, disabled }: Props) {
  const selected = useMemo(() => value.map(toDate), [value])
  const start = toDate(first)
  const end = toDate(last)

  return (
    <div className={disabled ? 'opacity-50 pointer-events-none' : undefined}>
      <DayPicker
        mode="multiple"
        locale={lang === 'zh' ? zhCN : enGB}
        selected={selected}
        onSelect={days => onChange((days ?? []).map(toIso).sort())}
        startMonth={start}
        endMonth={end}
        defaultMonth={selected[0] ?? start}
        // Past days and anything beyond the horizon are visible but unclickable — hidden days
        // read as a broken calendar, and the merchant needs to see WHERE the horizon falls.
        disabled={[{ before: start }, { after: end }]}
        aria-label={t('Order dates', '可选日期')}
      />
      <p className="text-[12px] text-muted-foreground mt-2 leading-[1.5]">
        {t(`You can pick dates up to ${last}.`, `最远可选至 ${last}。`)}
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Rewrite the Fulfilment tab's state and save**

In `apps/frontend/src/merchant/FulfilmentTab.tsx`, replace the imports, the `initial()` factory, the equality function and `save()`:

```tsx
import { useState } from 'react'
import { toast } from 'sonner'
import { useSession } from '../SessionContext'
import { useProAccess } from '../plan'
import { updateMerchantConfig } from '../store'
import { useSaved } from './useSaved'
import { ProBadge, UpgradeLink } from './ProLock'
import CustomDatesCalendar from './CustomDatesCalendar'
import {
  fulfilmentConfig, customDateBounds, pruneCustomDates, validateCustomDates,
  DEFAULT_TIMEZONE, type FulfilmentMode, type CustomDatesError,
} from '@bitetime/shared'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../components/ui/select'
```

```tsx
  const pro = useProAccess()

  const initial = () => {
    const cfg = fulfilmentConfig(merchant!.config)
    return {
      mode: cfg.mode as FulfilmentMode,
      lead: String(cfg.lead_days),
      window: String(cfg.window_days),
      closed: cfg.closed_weekdays,
      dates: cfg.custom_dates,
      timezone: merchant!.timezone ?? DEFAULT_TIMEZONE,
    }
  }
  const [initialFields] = useState(initial)
  const [fields, setFields] = useState(initialFields)
  const [busy, setBusy] = useState(false)

  // The shop is PAUSED until this merchant confirms — read off the SAVED config, never off form
  // state, so it survives a re-render and clears only when a save lands (ADR 0015).
  const needsReview = fulfilmentConfig(merchant!.config).needs_review

  const { commit } = useSaved(
    initialFields,
    fields,
    (a, b) =>
      a.mode === b.mode &&
      a.lead === b.lead &&
      a.window === b.window &&
      a.timezone === b.timezone &&
      a.closed.join(',') === b.closed.join(',') &&
      a.dates.join(',') === b.dates.join(','),
    onDirtyChange,
  )

  const custom = fields.mode === 'custom'
  const allClosed = !custom && fields.closed.length === 7
  // `now` is the browser's clock rather than the server-corrected one used at checkout: this is a
  // settings form, where being a second out cannot cost an order, and the backend re-validates
  // the horizon anyway.
  const bounds = customDateBounds(fields.timezone, new Date())

  const dateError = (code: CustomDatesError): string => ({
    no_dates: t('Pick at least one date, or customers cannot order at all.', '请至少选择一个日期，否则顾客无法下单。'),
    too_many: t('That is more dates than a shop can offer at once.', '所选日期数量超过上限。'),
    past_date: t('One of those dates has already passed.', '其中有日期已过期。'),
    beyond_horizon: t('You can only take orders up to 90 days ahead.', '最多只能接受 90 天内的订单。'),
  })[code]
```

```tsx
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (allClosed) {
      toast.error(t('Leave at least one day open, or customers cannot order at all.', '请至少保留一天营业，否则顾客无法下单。'))
      return
    }
    // Pruned before validating, so a stale tick left over from last month is silently dropped
    // rather than refused — the merchant did not do anything wrong, time passed.
    const dates = custom
      ? pruneCustomDates({ ...fulfilmentConfig(merchant!.config), custom_dates: fields.dates }, fields.timezone, new Date())
      : fields.dates
    if (custom) {
      const bad = validateCustomDates(dates, fields.timezone, new Date())
      if (bad) { toast.error(dateError(bad)); return }
    }
    setBusy(true)
    try {
      const fulfilment = fulfilmentConfig({
        fulfilment: {
          mode: fields.mode,
          lead_days: Number(fields.lead),
          window_days: Number(fields.window),
          closed_weekdays: fields.closed,
          custom_dates: dates,
          // Saving IS the confirmation. The alert above the fields is what makes it deliberate;
          // requiring an EDIT was rejected because change-then-revert is undetectable and it
          // punishes the merchant whose window was already right (ADR 0015).
          needs_review: false,
        },
      })
      const saved = await updateMerchantConfig(merchant!.id, {
        config: { ...(merchant!.config ?? {}), fulfilment },
        timezone: fields.timezone,
      })
      if (!saved.ok) { toast.error(saved.error.message || t('Save failed', '保存失败')); return }
      await refreshMerchant()
      const applied = {
        mode: fulfilment.mode,
        lead: String(fulfilment.lead_days),
        window: String(fulfilment.window_days),
        closed: fulfilment.closed_weekdays,
        dates: fulfilment.custom_dates,
        timezone: fields.timezone,
      }
      setFields(applied)
      commit(applied)
      toast.success(needsReview
        ? t('Your shop is open again', '店铺已重新开放')
        : t('Fulfilment saved', '取货设置已保存'))
    } catch (err: any) {
      toast.error(err.message || t('Save failed', '保存失败'))
    } finally { setBusy(false) }
  }
```

- [ ] **Step 4: Render the review alert, the mode radio and the calendar**

Replace the `Order dates` card's JSX (and leave the Closed days and Time zone cards where they are, adding the greying described below):

```tsx
      {needsReview && (
        <div className="bg-amber-50 border-[0.5px] border-amber-300 rounded-2xl p-5 mb-8 w-full box-border max-sm:p-4">
          <h3 className="font-heading text-[15px] font-medium text-amber-900 mb-2">
            {t('Your shop is paused', '店铺已暂停接单')}
          </h3>
          <p className="text-[13px] text-amber-900/80 leading-[1.6]">
            {t('Specific dates ended when your plan changed, so your shop is back on the rolling window below. Customers cannot order until you confirm it.',
               '方案变更后，指定日期功能已停用，店铺已改回下方的滚动日期范围。确认后顾客才能继续下单。')}
          </p>
        </div>
      )}

      <div className={CARD}>
        <h3 className={HEADING}>
          {t('Order dates', '可选日期')}
        </h3>

        <RadioGroup
          value={fields.mode}
          onValueChange={v => setFields(f => ({ ...f, mode: (v === 'custom' ? 'custom' : 'rolling') }))}
          className="flex flex-col gap-3 mb-5"
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <RadioGroupItem value="rolling" id="ff-mode-rolling" className="mt-[3px]" />
            <span>
              <span className="text-[14px] font-medium text-foreground">{t('Rolling window', '滚动日期范围')}</span>
              <span className="block text-[12px] text-muted-foreground leading-[1.5]">
                {t('Customers pick any day in a range that moves with today.', '顾客可在随当天滚动的日期范围内选择。')}
              </span>
            </span>
          </label>
          {/* Show-but-lock, like every other Pro surface (#110): hiding it would read as a
              missing feature and there would be nothing to sell against. */}
          <label className={'flex items-start gap-3 ' + (pro ? 'cursor-pointer' : 'cursor-not-allowed opacity-70')}>
            <RadioGroupItem value="custom" id="ff-mode-custom" disabled={!pro} className="mt-[3px]" />
            <span>
              <span className="text-[14px] font-medium text-foreground flex items-center gap-2">
                {t('Specific dates', '指定日期')} <ProBadge />
              </span>
              <span className="block text-[12px] text-muted-foreground leading-[1.5]">
                {t('You tick the exact dates you deliver on. Days of notice and closed days do not apply.',
                   '由你勾选具体的配送日期，提前天数与休息日不再适用。')}
              </span>
              {!pro && <UpgradeLink className="mt-2" />}
            </span>
          </label>
        </RadioGroup>

        {custom ? (
          bounds && (
            <>
              <CustomDatesCalendar
                value={fields.dates}
                onChange={dates => setFields(f => ({ ...f, dates }))}
                first={bounds.first}
                last={bounds.last}
                t={t}
                lang={lang}
              />
              <p className="text-[12px] text-muted-foreground mt-3 leading-[1.5]">
                {fields.dates.length === 0
                  ? t('No dates picked — customers would have none to choose.', '尚未选择任何日期，顾客将无日期可选。')
                  : t(`${fields.dates.length} date(s) picked. Removing a date only stops new orders — orders already placed for it are unaffected.`,
                       `已选择 ${fields.dates.length} 个日期。取消某个日期只会停止新订单，已下单的订单不受影响。`)}
              </p>
            </>
          )
        ) : (
          <div className="flex flex-col gap-4">
            {/* the two existing number inputs, unchanged */}
          </div>
        )}
      </div>
```

Then, on the **Closed days** card, wrap the existing content so custom mode greys it out rather than hiding it (the settings stay dormant and come back with rolling mode):

```tsx
      <div className={CARD}>
        <h3 className={HEADING}>{t('Closed days', '休息日')}</h3>
        <div className={custom ? 'opacity-50 pointer-events-none' : undefined}>
          {/* the existing weekday button group, unchanged */}
        </div>
        <p className="text-[12px] text-muted-foreground mt-3 leading-[1.5]">
          {custom
            ? t('Closed days do not apply while you are picking specific dates.', '使用指定日期时，休息日设置不适用。')
            : allClosed
              ? t('Every day is marked closed — customers would have no date to pick.', '所有日期都标记为休息，顾客将无日期可选。')
              : t('Days you take no orders. Customers cannot pick these.', '不接单的日子，顾客无法选择。')}
        </p>
      </div>
```

And the submit button, whose label is the confirmation:

```tsx
      <Button type="submit" size="md" className="mt-1" disabled={busy || allClosed}>
        {busy
          ? t('Saving…', '保存中…')
          : needsReview
            ? t('Confirm and reopen shop', '确认并重新开放店铺')
            : t('Save fulfilment', '保存取货设置')}
      </Button>
```

Add `lang` to the `useSession()` destructure at the top of the component.

- [ ] **Step 5: Verify by running the app**

```bash
pnpm dev
```

Per CLAUDE.md, UI is verified by running the app. Against local Supabase, with a **Pro** shop:

1. Settings → Fulfilment shows the two radios, `Specific dates` selectable.
2. Pick `Specific dates`, tick three days, save → toast, reload, ticks survive.
3. The storefront's date step now offers exactly those three dates — no others, including days the shop is marked closed.
4. Set the shop's `plan` to `basic` in Supabase Studio and reload the tab → the radio locks with a padlock and an Upgrade button; the saved dates stay visible in config.
5. Set `config.fulfilment.needs_review` to `true` in Studio → the storefront's date step shows *This shop is not taking orders for any date right now*; the tab shows the amber alert and the button reads **Confirm and reopen shop**. Press it → the storefront sells again.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/frontend/src/merchant/CustomDatesCalendar.tsx apps/frontend/src/merchant/FulfilmentTab.tsx apps/frontend/src/index.css
git commit -m "feat(fulfilment): merchant calendar for specific order dates"
```

---

### Task 5: The dashboard banner

**Files:**
- Create: `apps/frontend/src/merchant/FulfilmentDatesBanner.tsx`
- Modify: `apps/frontend/src/merchant/Dashboard.tsx:104-106` (mount it under `<BillingBanner />`)

**Interfaces:**
- Consumes: `fulfilmentConfig`, `fulfilmentWarning`, `DEFAULT_TIMEZONE` from `@bitetime/shared` (Task 1); `useDashboardSubsection`'s sibling `useUpgradeNav` is **not** used here — this banner navigates to Settings → Fulfilment via the `onNavigate` the Dashboard already owns.
- Produces: `<FulfilmentDatesBanner onGoToFulfilment={() => void} />`

- [ ] **Step 1: Write the component**

Create `apps/frontend/src/merchant/FulfilmentDatesBanner.tsx`:

```tsx
import { useSession } from '../SessionContext'
import { fulfilmentConfig, fulfilmentWarning, DEFAULT_TIMEZONE } from '@bitetime/shared'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The merchant-facing half of the pause (ADR 0015).
 *
 * A rolling window cannot run dry, so this renders nothing for most shops. A shop on specific
 * dates can, and silence is exactly the failure the feature was asked for in: the merchant who
 * ticked three dates in August must hear about it in July, not from a customer in September.
 *
 * Deliberately not dismissible, for the reason `BillingBanner` is not: a shop that has stopped
 * taking orders is not a thing its owner should be able to hide from themselves.
 *
 * Everything here is derived from the merchant row already in session — no fetch, no job, no
 * send path.
 */
export default function FulfilmentDatesBanner({ onGoToFulfilment }: { onGoToFulfilment: () => void }) {
  const { t, lang, merchant } = useSession()
  if (!merchant) return null

  const cfg = fulfilmentConfig(merchant.config)
  const state = fulfilmentWarning(cfg, merchant.timezone ?? DEFAULT_TIMEZONE, new Date())
  if (state.kind === 'none') return null

  const urgent = state.kind === 'empty' || state.kind === 'review'
  const lastLabel = state.kind === 'ending'
    ? new Date(`${state.last}T00:00:00Z`).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-GB',
        { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
    : ''

  const message =
    state.kind === 'review'
      ? t('Your shop is paused. Confirm your order dates to start taking orders again.',
           '店铺已暂停接单。请确认可选日期后重新开放。')
      : state.kind === 'empty'
        ? t('Your shop is not taking orders — every date you picked has passed. Add more dates.',
             '店铺目前无法接单：所选日期均已过期，请添加新的日期。')
        : t(`Your last order date is ${lastLabel}. Add more dates before customers run out of days to pick.`,
             `最后一个可选日期为 ${lastLabel}。请及时添加更多日期，以免顾客无日期可选。`)

  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-4 rounded-2xl border-[0.5px] p-4 mb-6 w-full box-border max-sm:flex-col max-sm:items-start',
        urgent ? 'bg-red-50 border-red-300 text-red-900' : 'bg-amber-50 border-amber-300 text-amber-900',
      )}
    >
      <p className="text-[13px] leading-[1.6] flex-1">{message}</p>
      <Button type="button" size="sm" onClick={onGoToFulfilment} className="shrink-0">
        {t('Open fulfilment settings', '前往取货设置')}
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Mount it**

In `apps/frontend/src/merchant/Dashboard.tsx`, add the import and render it directly under `<BillingBanner />`. `selectSection` is already in scope there (it is passed to `OnboardingChecklist`), and the Fulfilment tab is a subsection of `settings`:

```tsx
      <BillingBanner />
      <FulfilmentDatesBanner onGoToFulfilment={() => selectSection('settings')} />
```

- [ ] **Step 3: Verify by running the app**

```bash
pnpm dev
```

1. A rolling shop: no banner (this is the case that must stay silent).
2. Edit a Pro shop's `config.fulfilment.custom_dates` in Studio so its only date is 3 days out → amber banner naming that date.
3. Change it to a date in the past → red banner, and the storefront's date step refuses.
4. Set `needs_review: true` → red banner pointing at the confirmation.

- [ ] **Step 4: Lint, typecheck, commit**

```bash
pnpm lint && pnpm typecheck
git add apps/frontend/src/merchant/FulfilmentDatesBanner.tsx apps/frontend/src/merchant/Dashboard.tsx
git commit -m "feat(dashboard): warn a merchant before their order dates run out"
```

---

### Task 6: End-to-end verification and the issue

**Files:**
- Modify: none (verification only), unless a defect is found.

- [ ] **Step 1: Run everything CI runs**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @bitetime/backend test:db
```

Expected: all green. `test:db` needs a running local Supabase (`supabase start` from `apps/backend`).

- [ ] **Step 2: Drive the whole flow in a browser**

With `pnpm dev` and a Pro shop, confirm each in order:

1. **Custom dates sell.** Tick two dates, save, place a real order from the storefront on one of them. The order lands with that `fulfil_date`.
2. **Unticked dates are refused end to end.** With the checkout still open, untick one of the dates in the dashboard and save; back in the still-open storefront tab, submit for the removed date → the backend refuses with `fulfil_date_unavailable` and the storefront asks the customer to choose again. This is the assertion that the browser and the backend read the same rule.
3. **Lead days genuinely do not apply.** Set `Days of notice` to 5 in rolling mode, save, switch to custom, tick tomorrow, save → the storefront offers tomorrow.
4. **The paused storefront still browses.** With `needs_review` set, the menu, prices and photos all render; only the date step refuses. The shop's status is still `active`.
5. **Existing orders survive an un-tick.** The order from step 1 still shows its date in the dashboard after its date is removed from the allowlist.

- [ ] **Step 3: Close the loop on the issue**

```bash
gh issue comment 210 --repo leongcheefai/Bitetime-Order-Platform --body "Shipped: Pro shops can now pick specific order dates instead of a rolling window, up to 90 days ahead. Closed days do not apply in that mode. A shop whose picked dates all pass stops taking orders and says so in the dashboard rather than quietly falling back. Design notes: CONTEXT.md → Fulfilment date, ADR 0015."
```

- [ ] **Step 4: Open the PR**

```bash
git push -u origin HEAD
gh pr create --base dev --title "feat: custom order dates for Pro merchants (#210)" --body "..."
```

Remember the repo's own rule: issues track **production**, so the closing keyword belongs in the eventual `dev → main` PR body, not in a PR whose base is `dev`.

---

## Self-Review

**Spec coverage** — every line of `CONTEXT.md → Fulfilment date` and ADR 0015 maps to a task:

| Requirement | Task |
|---|---|
| Two exclusive modes, dormant settings preserved | 1 (config), 4 (greyed cards) |
| Custom ignores lead/window/closed; only filter is ≥ today | 1 |
| 90-day horizon, one constant for both modes | 1 (`FULFILMENT_HORIZON_DAYS`), 2 (save refusal), 4 (calendar bounds) |
| Pro gate, change-comparison not presence | 2 |
| Zero dates → pause inside the shared rule, both sides | 1 (`needs_review` in both readers) |
| Customer browses, checkout refuses, `fulfil_date_unavailable` | **no code** — `FulfilDatePicker` already renders the empty state and `submitGate` already requires `chosenDate`; `orders.ts` already refuses via `isDateSelectable`. Verified in Task 6 step 2 and 4. |
| Two-level dashboard warning | 1 (`fulfilmentWarning`), 5 |
| Downgrade pauses; confirm is a press, not an edit | 1 (`pauseFulfilment`), 3, 4 |
| Re-upgrade restores | 1 (`resumeFulfilment`), 3 |
| Stale dates filtered on read, pruned on save | 1 (`pruneCustomDates`), 4 |
| Zero future dates refused at save | 1 (`no_dates`), 2 (400), 4 (toast) |
| Un-ticking does not touch placed orders | 4 (helper line), 6 (verified) |
| No migration | Global Constraints; nothing in any task writes SQL |

**Known non-obvious consequence, deliberately in the plan:** `lapseMerchant` also calls `revokeProArtifacts`, so a suspended shop is paused too. That is correct — a suspended shop serves a closed storefront anyway — but it means reactivating a suspended Pro shop restores custom dates through `reconcilePlan`'s upgrade branch only if the plan transition actually fires. A shop that reactivates while already recorded as `pro` keeps `needs_review` and confirms in the tab. Watch for it in Task 6.
