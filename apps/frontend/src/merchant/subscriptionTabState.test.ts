import { describe, it, expect } from 'vitest'
import { subscriptionTabState } from './subscriptionTabState'

const NOW = new Date('2026-08-01T00:00:00Z')

describe('subscriptionTabState', () => {
  // A shop with a Stripe customer: the portal is a real destination rather than a 404.
  it('reports a live subscription and offers the portal', () => {
    const state = subscriptionTabState(
      { status: 'active', stripe_customer_id: 'cus_1', current_period_end: '2026-09-01T00:00:00Z' },
      NOW,
    )
    expect(state).toMatchObject({ kind: 'live', canManage: true })
    // There is one plan (#222), so the tab reports no tier and offers no upgrade.
    expect('plan' in state).toBe(false)
    expect('canUpgrade' in state).toBe(false)
  })

  // The dead end that started this: no Stripe customer means the portal answers 404, so the
  // button must not be offered at all. A comped shop is the real-world case.
  it('offers no portal button when there is no billing account', () => {
    expect(subscriptionTabState(null, NOW)).toMatchObject({ kind: 'none', canManage: false })
    expect(subscriptionTabState({ status: null, stripe_customer_id: null }, NOW))
      .toMatchObject({ kind: 'none', canManage: false })
  })

  // An active shop with no live subscription CAN buy one outright — /api/checkout refuses only
  // trialing/active/past_due, the exact set `canManage` covers. Reachable in production:
  // approve-merchant activates a shop without a subscription when it has had one before.
  it('offers checkout, not the portal, when there is no live subscription', () => {
    expect(subscriptionTabState(null, NOW))
      .toMatchObject({ canSubscribe: true, canManage: false })
    expect(subscriptionTabState({ status: 'canceled', stripe_customer_id: 'cus_1' }, NOW))
      .toMatchObject({ canSubscribe: true, canManage: false })
  })

  // The two are exact complements — offering both would mean a second subscription on a shop
  // that already pays.
  it('never offers checkout and the portal at the same time', () => {
    for (const status of ['trialing', 'active', 'past_due']) {
      const state = subscriptionTabState(
        { status, stripe_customer_id: 'cus_1', trial_ends_at: '2026-08-11T00:00:00Z' }, NOW,
      )
      expect(state.canSubscribe).toBe(false)
      expect(state.canManage).toBe(true)
    }
  })

  // A paying shop must still reach the portal — to change its card or read an invoice.
  it('lets a paying shop reach the portal', () => {
    expect(subscriptionTabState({ status: 'active', stripe_customer_id: 'cus_1' }, NOW))
      .toMatchObject({ canManage: true })
  })

  it('surfaces a trial with its end date', () => {
    const state = subscriptionTabState(
      { status: 'trialing', stripe_customer_id: 'cus_1', trial_ends_at: '2026-08-11T00:00:00Z' },
      NOW,
    )
    expect(state).toMatchObject({ kind: 'trial', daysLeft: 10 })
  })

  it('clamps a trial that has already lapsed to zero rather than going negative', () => {
    const state = subscriptionTabState(
      { status: 'trialing', stripe_customer_id: 'cus_1', trial_ends_at: '2026-07-30T00:00:00Z' },
      NOW,
    )
    expect(state).toMatchObject({ kind: 'trial', daysLeft: 0 })
  })

  // The trial banner's bar drains as the trial runs out: fraction remaining = daysLeft / 7.
  it('reports trial progress as the fraction of the 7-day trial remaining', () => {
    const state = subscriptionTabState(
      { status: 'trialing', stripe_customer_id: 'cus_1', trial_ends_at: '2026-08-04T00:00:00Z' },
      NOW, // 2026-08-01 → 3 days left
    )
    expect(state).toMatchObject({ kind: 'trial', daysLeft: 3 })
    expect(state.kind === 'trial' && state.progress).toBeCloseTo(3 / 7)
  })

  it('drains trial progress to zero once the trial has lapsed', () => {
    const state = subscriptionTabState(
      { status: 'trialing', stripe_customer_id: 'cus_1', trial_ends_at: '2026-07-30T00:00:00Z' },
      NOW,
    )
    expect(state.kind === 'trial' && state.progress).toBe(0)
  })

  // The natural full bar: a fresh 7-day trial fills it exactly, without leaning on the clamp.
  it('fills the trial bar for a fresh 7-day trial', () => {
    const state = subscriptionTabState(
      { status: 'trialing', stripe_customer_id: 'cus_1', trial_ends_at: '2026-08-08T00:00:00Z' },
      NOW, // 2026-08-01 → exactly 7 days left
    )
    expect(state).toMatchObject({ kind: 'trial', daysLeft: 7 })
    expect(state.kind === 'trial' && state.progress).toBe(1)
  })

  // A trial longer than 7 days (Stripe could be told otherwise) must not overflow the bar.
  it('clamps trial progress to a full bar when more than 7 days remain', () => {
    const state = subscriptionTabState(
      { status: 'trialing', stripe_customer_id: 'cus_1', trial_ends_at: '2026-08-11T00:00:00Z' },
      NOW, // 10 days left
    )
    expect(state.kind === 'trial' && state.progress).toBe(1)
  })

  it('flags past-due — the card is the problem, and the portal is where it is fixed', () => {
    const state = subscriptionTabState(
      { status: 'past_due', stripe_customer_id: 'cus_1' },
      NOW,
    )
    expect(state).toMatchObject({ kind: 'past-due', canManage: true })
  })

  // A cancelled subscription still has a Stripe customer, but SuspendedScreen owns reactivation
  // via Checkout — so `canManage` must be false and this tab must not grow a second, competing
  // payment path.
  it('offers nothing to act on when the subscription is cancelled', () => {
    expect(subscriptionTabState({ status: 'canceled', stripe_customer_id: 'cus_1' }, NOW))
      .toMatchObject({ kind: 'none', canManage: false })
  })

  // A comped shop runs with no Stripe behind it. Every billing action is off: the portal has
  // nothing to open, checkout is superadmin-only to reverse, and the wind-down actions have no
  // subscription to wind down.
  it('turns every billing action off for a comped shop', () => {
    const state = subscriptionTabState(
      { status: 'active', stripe_customer_id: null, comped: true, current_period_end: '2126-08-01T00:00:00Z' },
      NOW,
    )
    expect(state).toMatchObject({
      kind: 'none',
      comped: true,
      canManage: false,
      canSubscribe: false,
      canCancel: false,
      canResume: false,
    })
  })

  // The production 502, as a unit test. This row is what comp-merchant used to leave behind: a
  // customer id from a test-mode key plus status 'active'. That pair read as a live subscription,
  // rendered "Manage subscription", and sent a dead customer id to Stripe under a live key.
  it('offers no portal to a comped shop that still carries a stale customer id', () => {
    const state = subscriptionTabState(
      { status: 'active', stripe_customer_id: 'cus_stale', comped: true },
      NOW,
    )
    expect(state).toMatchObject({ kind: 'none', comped: true, canManage: false, canSubscribe: false })
  })

  // The flag is the only thing that changed. Without it the same row is a paying shop, and every
  // action stays available — this is what stops `comped` becoming a blanket off-switch.
  it('leaves a paying shop untouched', () => {
    const state = subscriptionTabState(
      { status: 'active', stripe_customer_id: 'cus_1', comped: false, current_period_end: '2026-09-01T00:00:00Z' },
      NOW,
    )
    expect(state).toMatchObject({ kind: 'live', comped: false, canManage: true, canCancel: true })
  })
})

// ── Winding down ───────────────────────────────────────────────────────────────
// The bug this half of the module exists for: Stripe leaves `status` on 'active' for a
// subscription cancelling at period end, so the tab promised "Renews on 1 Sep" right up to the
// morning the shop was suspended. Nothing about the status can be trusted to reveal it.
describe('subscriptionTabState — pending cancellation', () => {
  const ending = {
    status: 'active',
    stripe_customer_id: 'cus_1',
    current_period_end: '2026-09-01T00:00:00Z',
    cancel_at_period_end: true,
  }

  it('reports a subscription that is ending, not one that renews', () => {
    expect(subscriptionTabState(ending, NOW))
      .toMatchObject({ kind: 'ending', endsAt: '2026-09-01T00:00:00Z' })
  })

  // Two cancel buttons for one subscription is how a merchant ends up unsure whether the first
  // click worked. Once it is cancelling, the only forward action is undoing it.
  it('offers resume instead of cancel once it is already cancelling', () => {
    expect(subscriptionTabState(ending, NOW))
      .toMatchObject({ canResume: true, canCancel: false })
  })

  // Cancelling suspends the shop, so the merchant must still reach the portal for the invoices
  // and receipts of the period they did pay for.
  it('still allows the portal while it is ending', () => {
    expect(subscriptionTabState(ending, NOW)).toMatchObject({ canManage: true })
  })

  // The shop has NOT closed yet, so it must not be sold a second subscription alongside the one
  // still running — that is the double-billing `canSubscribe` exists to prevent.
  it('does not offer checkout while the current subscription still runs', () => {
    expect(subscriptionTabState(ending, NOW)).toMatchObject({ canSubscribe: false })
  })

  // A trial that is cancelling ends the same way — suspended — and saying "3 days left" without
  // saying "then it stops" is the same silence in a friendlier voice.
  it('reports a cancelling trial as ending', () => {
    const state = subscriptionTabState(
      { ...ending, status: 'trialing', trial_ends_at: '2026-08-11T00:00:00Z' }, NOW,
    )
    expect(state.kind).toBe('ending')
  })
})

describe('subscriptionTabState — a row left over from the two-tier release', () => {
  // The step down to Basic is gone (#222), and so is the column that recorded it. A row written
  // before the change can still carry one, and it must read as an ordinary live subscription
  // rather than as a wind-down the merchant can no longer undo.
  it('ignores a pending_plan left on the row by an older release', () => {
    const state = subscriptionTabState(
      {
        status: 'active',
        stripe_customer_id: 'cus_1',
        current_period_end: '2026-09-01T00:00:00Z',
        pending_plan: 'basic',
      } as never,
      NOW,
    )
    expect(state.kind).toBe('live')
    expect(state.canCancel).toBe(true)
    expect(state.canResume).toBe(false)
    expect('canDowngrade' in state).toBe(false)
    expect('pendingPlan' in state).toBe(false)
  })
})

describe('subscriptionTabState — the ordinary case', () => {
  const live = { status: 'active', stripe_customer_id: 'cus_1', current_period_end: '2026-09-01T00:00:00Z' }

  it('offers the cancel, and nothing to resume', () => {
    expect(subscriptionTabState(live, NOW))
      .toMatchObject({ canCancel: true, canResume: false })
  })

  // Every one of these calls Stripe against a subscription id. Without one there is nothing to
  // act on, and the routes answer 409 `no_live_subscription`.
  it('offers none of them without a live subscription', () => {
    expect(subscriptionTabState(null, NOW))
      .toMatchObject({ canCancel: false, canResume: false })
  })

  // A past-due subscription is still a real subscription — a merchant whose card is failing must
  // be able to stop it rather than watch it retry.
  it('lets a past-due shop cancel', () => {
    expect(subscriptionTabState({ status: 'past_due', stripe_customer_id: 'cus_1' }, NOW))
      .toMatchObject({ canCancel: true })
  })
})
