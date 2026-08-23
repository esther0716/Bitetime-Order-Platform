import type { Merchant } from '../types'

/**
 * The three steps, as names.
 *
 * Here rather than in analytics/events.ts because this module is what DEFINES them: the checklist
 * and the measurement of the checklist must not drift into calling the same step two things.
 */
export type OnboardingStep = 'product' | 'shipping' | 'link'

export interface OnboardingState extends Record<OnboardingStep, boolean> {
  doneCount: number
  allDone: boolean
}

// Derives the three onboarding checklist steps. `product` is read from the live
// product count; `shipping` and `link` are persisted flags on the merchant row —
// read `=== true` so an absent (undefined) column is false, never truthy.
export function onboardingSteps(merchant: Merchant, productCount: number): OnboardingState {
  const product = productCount > 0
  const shipping = merchant.onboarding_shipping_set === true
  const link = merchant.onboarding_link_shared === true
  const doneCount = [product, shipping, link].filter(Boolean).length
  return { product, shipping, link, doneCount, allDone: doneCount === 3 }
}
