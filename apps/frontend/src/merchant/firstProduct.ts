// WHETHER a product save was the shop's first, for the onboarding activation signal (#102).
//
// A TRANSITION, not a state — which is why it does not live in onboardingSteps.ts. That module
// answers "is the product step done?" and is re-derived on every Overview visit; this one answers
// "did the step just complete?" and must be true exactly once in a shop's life.
//
// Pure and tested because the alternative is a rule reachable only by saving a product in a
// browser, which is a rule nobody tests. Same argument as analytics/cta.ts and analytics/scope.ts.
//
// The counts are read either side of ONE reload, so a bulk menu import (0 → 15) is one first
// product, not fifteen. See ProductsManager, which owns the only call site.

/** Did this save take the shop from an empty menu to a menu with something on it? */
export function firstProductAdded(before: number, after: number): boolean {
  return before === 0 && after > 0
}
