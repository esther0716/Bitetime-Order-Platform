// The failures of the two backend signup doors — /api/customer/signup and
// /api/merchant/signup — reduced to the outcomes the person in front of the form can act on.
// One union for both because they are one endpoint shape with two sets of adapters
// (accountSignup.ts), and two copies would be two chances for a code to be handled on one
// screen and not the other. Kept pure and separate from the fetch so the panel showing them
// stays a dumb view — the same split as authError.ts, which covers the Supabase-side sign-in
// failures.
export type SignupErrorCode =
  | 'duplicate_email'
  | 'weak_password'
  | 'invalid_email'
  | 'rate_limited'
  | 'network'
  | 'server'
  /** The account was created, but the sign-in that follows it failed. */
  | 'signin_failed'
  /** Merchant signup only: the request carried no usable shop name. */
  | 'invalid_shop'

const BY_BODY: Record<string, SignupErrorCode> = {
  duplicate_email: 'duplicate_email',
  weak_password: 'weak_password',
  invalid_email: 'invalid_email',
  rate_limited: 'rate_limited',
  invalid_shop: 'invalid_shop',
}

export function signupErrorCode(status: number, body: unknown): SignupErrorCode {
  const code = (body as { error?: string } | null)?.error
  if (code && BY_BODY[code]) return BY_BODY[code]
  // Anything not shaped like our JSON — a proxy page, a crash — is a server failure.
  if (status === 409) return 'duplicate_email'
  if (status === 429) return 'rate_limited'
  return 'server'
}

// Carries the code through the store's throw so the panel can switch on it.
export class SignupError extends Error {
  constructor(public readonly code: SignupErrorCode) {
    super(code)
    this.name = 'SignupError'
  }
}
