import Stripe from 'stripe'
import { env } from './env.js'
import { priceId } from './pricing.js'

export const stripe = new Stripe(env.stripeSecretKey)

/**
 * True only for a failure Stripe itself returned — a missing customer, a declined card, an
 * outage — as opposed to one thrown by our own code on the way there.
 *
 * The billing routes interleave Stripe calls with their own validation, so a blanket `catch`
 * cannot assume what it caught. This is what keeps a bug in our logic from being reported to
 * the merchant as "the payment provider refused us", and from being logged as one.
 */
export function isStripeError(err: unknown): err is Stripe.errors.StripeError {
  return err instanceof Stripe.errors.StripeError
}

const PLANS = ['basic', 'pro']
const CYCLES = ['monthly', 'yearly']

export function isValidPlan(plan: string) {
  return PLANS.includes(plan)
}
export function isValidCycle(cycle: string) {
  return CYCLES.includes(cycle)
}

// Map (plan, cycle) → the configured MYR Stripe Price ID. We charge MYR for everyone.
export function priceFor(plan: string, cycle: string) {
  return priceId(env.prices, plan, cycle)
}
