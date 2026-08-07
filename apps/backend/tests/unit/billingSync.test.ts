// tests/unit/billingSync.test.ts
// `pickSubscription` — which of a customer's subscriptions the shop is actually paying for.
//
// It lives in billingLifecycle.ts, with the sweep's other pure predicates, so that this suite can
// run without Stripe keys: the choice it makes is the whole reason a reactivating shop can be
// repaired at all, and it is the one part of billingSync.ts that needs neither a database nor a
// network to be exercised in every combination.
import { describe, it, expect } from 'vitest'
import { pickSubscription, type SubscriptionChoice } from '../../src/billingLifecycle.js'

/** Only the fields the choice reads. A fuller fixture would be a wronger copy of Stripe's schema. */
function sub(id: string, status: string, created: number): SubscriptionChoice {
  return { id, status, created }
}

describe('pickSubscription', () => {
  it('has nothing to pick from an empty list', () => {
    expect(pickSubscription([])).toBeNull()
  })

  // THE case this exists for. A shop reactivating after a lapse has both: the canceled
  // subscription that closed it and the new one it just paid for. `merchant_billing` still names
  // the OLD one — that is precisely the write the missing webhook would have made — so anything
  // that trusted the stored id would read "canceled" and leave a paid shop shut.
  it('prefers a live subscription over a canceled one, whatever is stored', () => {
    const picked = pickSubscription([
      sub('sub_old', 'canceled', 1_000),
      sub('sub_new', 'active', 2_000),
    ])
    expect(picked!.id).toBe('sub_new')
  })

  // Order out of Stripe is not part of the contract, so the choice may not depend on it.
  it('does not depend on the order Stripe returns them in', () => {
    const picked = pickSubscription([
      sub('sub_new', 'active', 2_000),
      sub('sub_old', 'canceled', 1_000),
    ])
    expect(picked!.id).toBe('sub_new')
  })

  it('takes the newest when more than one is live', () => {
    const picked = pickSubscription([
      sub('sub_older', 'trialing', 1_000),
      sub('sub_newer', 'active', 3_000),
      sub('sub_mid', 'past_due', 2_000),
    ])
    expect(picked!.id).toBe('sub_newer')
  })

  // `past_due` is a live status here and in `LIVE_STATUSES`: the shop is still running and
  // Stripe is still retrying the card. Reading it as dead would close a shop mid-dunning.
  it('counts past_due as live', () => {
    const picked = pickSubscription([
      sub('sub_dead', 'canceled', 3_000),
      sub('sub_dunning', 'past_due', 1_000),
    ])
    expect(picked!.id).toBe('sub_dunning')
  })

  // With nothing live there is still a row to bring up to date and a merchant to tell WHICH
  // non-running state they are in — so this returns the newest rather than null.
  it('falls back to the newest when none is live', () => {
    const picked = pickSubscription([
      sub('sub_old', 'canceled', 1_000),
      sub('sub_recent', 'incomplete_expired', 2_000),
    ])
    expect(picked!.id).toBe('sub_recent')
  })
})
